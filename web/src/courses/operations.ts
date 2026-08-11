import {
  allCourseLessons,
  type Course,
  type CourseActivity,
  type CourseAssignmentSubmission,
  type CourseComment,
  type CourseMember,
  type CourseOperation,
  type CoursePermissions,
  type CourseReactionTarget,
  type CourseRole,
  type CourseSubmission,
  type CourseViewerSnapshot,
} from "./contracts";

export class CourseAuthorizationError extends Error {
  readonly code = "course_forbidden";
}

export class CourseConflictError extends Error {
  readonly code = "course_conflict";
  constructor(
    message: string,
    readonly currentRevision: number,
  ) {
    super(message);
  }
}

export class CourseNotFoundError extends Error {
  readonly code = "course_not_found";
}

function memberFor(course: Course, accountId: string): CourseMember {
  const member = course.members.find(
    (candidate) => candidate.accountId === accountId,
  );
  if (!member)
    throw new CourseAuthorizationError("You are not enrolled in this course.");
  return member;
}

function roleCanTeach(role: CourseRole): boolean {
  return role === "owner" || role === "teacher";
}

function roleCanOwn(role: CourseRole): boolean {
  return role === "owner";
}

function assertLesson(course: Course, lessonId: string): void {
  if (!allCourseLessons(course).some((lesson) => lesson.id === lessonId)) {
    throw new CourseNotFoundError(
      "This lesson is no longer part of the course.",
    );
  }
}

function assertAssignment(course: Course, assignmentId: string): void {
  if (
    !course.assignments.some((assignment) => assignment.id === assignmentId)
  ) {
    throw new CourseNotFoundError(
      "This assignment is no longer part of the course.",
    );
  }
}

function activity(
  id: string,
  type: CourseActivity["type"],
  accountId: string,
  message: string,
  createdAt: string,
  lessonId?: string,
): CourseActivity {
  return {
    // Operation ids are stable across storage replays and Pear replication.
    id,
    type,
    accountId,
    message,
    createdAt,
    ...(lessonId ? { lessonId } : {}),
  };
}

function appendActivity(course: Course, item: CourseActivity): void {
  course.activity = [item, ...course.activity].slice(0, 5_000);
}

function operationNeedsCurrentRevision(operation: CourseOperation): boolean {
  return (
    operation.type === "course.update" ||
    operation.type === "module.upsert" ||
    operation.type === "module.delete" ||
    operation.type === "lesson.update" ||
    operation.type === "lesson.delete" ||
    operation.type === "card.upsert" ||
    operation.type === "cards.import" ||
    operation.type === "card.delete" ||
    operation.type === "artifact.upsert" ||
    operation.type === "artifacts.import" ||
    operation.type === "artifact.delete" ||
    operation.type === "assignment.upsert" ||
    operation.type === "assignment.delete" ||
    operation.type === "material.add" ||
    operation.type === "material.delete" ||
    operation.type === "member.role.update"
  );
}

function removeLessonState(
  course: Course,
  lessonIds: ReadonlySet<string>,
): void {
  for (const member of course.members) {
    member.progress.completedLessonIds =
      member.progress.completedLessonIds.filter((id) => !lessonIds.has(id));
    if (
      member.progress.activeLessonId &&
      lessonIds.has(member.progress.activeLessonId)
    ) {
      delete member.progress.activeLessonId;
    }
  }
  const removedNoteIds = new Set(
    course.sharedNotes
      .filter((note) => lessonIds.has(note.lessonId))
      .map((note) => note.id),
  );
  course.sharedNotes = course.sharedNotes.filter(
    (note) => !lessonIds.has(note.lessonId),
  );
  dropReactions(course, "shared-note", removedNoteIds);
  course.submissions = course.submissions.filter(
    (submission) => !lessonIds.has(submission.lessonId),
  );
  const removedCommentIds = new Set(
    course.comments
      .filter((comment) => comment.lessonId && lessonIds.has(comment.lessonId))
      .map((comment) => comment.id),
  );
  course.comments = course.comments.filter(
    (comment) => !removedCommentIds.has(comment.id),
  );
  dropReactions(course, "comment", removedCommentIds);
  course.cards = course.cards.map((card) =>
    card.lessonId && lessonIds.has(card.lessonId)
      ? (() => {
          const { lessonId: _lessonId, ...unlinked } = card;
          return unlinked;
        })()
      : card,
  );
  course.artifacts = course.artifacts.map((artifact) =>
    artifact.lessonId && lessonIds.has(artifact.lessonId)
      ? (() => {
          const { lessonId: _lessonId, ...unlinked } = artifact;
          return unlinked;
        })()
      : artifact,
  );
  course.materials = course.materials.map((material) =>
    material.lessonId && lessonIds.has(material.lessonId)
      ? (() => {
          const { lessonId: _lessonId, ...unlinked } = material;
          return unlinked;
        })()
      : material,
  );
  course.assignments = course.assignments.map((assignment) =>
    assignment.lessonId && lessonIds.has(assignment.lessonId)
      ? (() => {
          const { lessonId: _lessonId, ...unlinked } = assignment;
          return unlinked;
        })()
      : assignment,
  );
}

function dropReactions(
  course: Course,
  targetKind: CourseReactionTarget,
  targetIds: ReadonlySet<string>,
): void {
  course.reactions = course.reactions.filter(
    (reaction) =>
      reaction.targetKind !== targetKind || !targetIds.has(reaction.targetId),
  );
}

/** A comment and every reply beneath it, so deletion never orphans a thread. */
function commentSubtreeIds(
  comments: readonly CourseComment[],
  commentId: string,
): Set<string> {
  const ids = new Set([commentId]);
  for (const comment of comments) {
    if (comment.parentId && ids.has(comment.parentId)) ids.add(comment.id);
  }
  return ids;
}

function removeCardReferences(course: Course, cardId: string): void {
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      lesson.cardIds = lesson.cardIds.filter((id) => id !== cardId);
    }
  }
}

function removeMaterialReferences(course: Course, materialId: string): void {
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      lesson.materialIds = lesson.materialIds.filter((id) => id !== materialId);
    }
  }
}

export function permissionsFor(
  course: Course,
  accountId: string,
): CoursePermissions {
  const member = memberFor(course, accountId);
  const canTeach = roleCanTeach(member.role);
  return {
    canEditCourse: canTeach,
    canInvite: canTeach,
    canReview: canTeach,
    canEditDeck: canTeach || course.settings.allowPeerDeckEdits,
    canRequestTeacherAccess: canTeach,
  };
}

export function applyCourseOperation(
  current: Course,
  actorAccountId: string,
  operation: CourseOperation,
  now = new Date().toISOString(),
): Course {
  if (operation.courseId !== current.id) {
    throw new CourseNotFoundError("The operation targets a different course.");
  }
  if (
    operationNeedsCurrentRevision(operation) &&
    operation.baseRevision !== current.revision
  ) {
    throw new CourseConflictError(
      "The course changed while you were editing. Refresh and try again.",
      current.revision,
    );
  }

  const actor = memberFor(current, actorAccountId);
  const next = structuredClone(current);

  switch (operation.type) {
    case "course.update": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can change course details.",
        );
      }
      const { settings, ...details } = operation.patch;
      Object.assign(next, details);
      if (settings) {
        next.settings = {
          ...next.settings,
          ...Object.fromEntries(
            Object.entries(settings).filter(([, value]) => value !== undefined),
          ),
        };
      }
      break;
    }
    case "module.upsert": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit modules.",
        );
      }
      const duplicateLesson = operation.module.lessons.find((lesson) =>
        next.modules.some(
          (module) =>
            module.id !== operation.module.id &&
            module.lessons.some((item) => item.id === lesson.id),
        ),
      );
      if (duplicateLesson) {
        throw new CourseConflictError(
          "A lesson with this id already exists in another module.",
          next.revision,
        );
      }
      const index = next.modules.findIndex(
        (module) => module.id === operation.module.id,
      );
      if (index === -1) next.modules.push(operation.module);
      else {
        const retainedIds = new Set(
          operation.module.lessons.map((lesson) => lesson.id),
        );
        const removedIds = new Set(
          next.modules[index]!.lessons.map((lesson) => lesson.id).filter(
            (id) => !retainedIds.has(id),
          ),
        );
        if (removedIds.size) removeLessonState(next, removedIds);
        next.modules[index] = operation.module;
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "module-updated",
          actorAccountId,
          "Updated the course outline",
          now,
        ),
      );
      break;
    }
    case "module.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove modules.",
        );
      }
      const index = next.modules.findIndex(
        (module) => module.id === operation.moduleId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This module is no longer part of the course.",
        );
      const lessonIds = new Set(
        next.modules[index]!.lessons.map((lesson) => lesson.id),
      );
      next.modules.splice(index, 1);
      removeLessonState(next, lessonIds);
      appendActivity(
        next,
        activity(
          operation.id,
          "module-removed",
          actorAccountId,
          "Removed a course module",
          now,
        ),
      );
      break;
    }
    case "lesson.update": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit lessons.",
        );
      }
      const module = next.modules.find(
        (candidate) => candidate.id === operation.moduleId,
      );
      if (!module)
        throw new CourseNotFoundError(
          "This module is no longer part of the course.",
        );
      if (
        next.modules.some(
          (candidate) =>
            candidate.id !== module.id &&
            candidate.lessons.some(
              (lesson) => lesson.id === operation.lesson.id,
            ),
        )
      ) {
        throw new CourseConflictError(
          "A lesson with this id already exists in another module.",
          next.revision,
        );
      }
      const index = module.lessons.findIndex(
        (lesson) => lesson.id === operation.lesson.id,
      );
      if (index === -1) module.lessons.push(operation.lesson);
      else module.lessons[index] = operation.lesson;
      appendActivity(
        next,
        activity(
          operation.id,
          "lesson-updated",
          actorAccountId,
          "Updated a course lesson",
          now,
          operation.lesson.id,
        ),
      );
      break;
    }
    case "lesson.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove lessons.",
        );
      }
      const module = next.modules.find(
        (candidate) => candidate.id === operation.moduleId,
      );
      if (!module)
        throw new CourseNotFoundError(
          "This module is no longer part of the course.",
        );
      const index = module.lessons.findIndex(
        (lesson) => lesson.id === operation.lessonId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This lesson is no longer part of the course.",
        );
      module.lessons.splice(index, 1);
      removeLessonState(next, new Set([operation.lessonId]));
      appendActivity(
        next,
        activity(
          operation.id,
          "lesson-removed",
          actorAccountId,
          "Removed a course lesson",
          now,
        ),
      );
      break;
    }
    case "lesson.complete": {
      assertLesson(next, operation.lessonId);
      const target = next.members.find(
        (member) => member.accountId === actorAccountId,
      )!;
      const completed = new Set(target.progress.completedLessonIds);
      if (operation.completed) completed.add(operation.lessonId);
      else completed.delete(operation.lessonId);
      target.progress.completedLessonIds = [...completed];
      target.progress.activeLessonId = operation.lessonId;
      target.progress.lastActiveAt = now;
      appendActivity(
        next,
        activity(
          operation.id,
          "lesson-completed",
          actorAccountId,
          operation.completed ? "Completed a lesson" : "Reopened a lesson",
          now,
          operation.lessonId,
        ),
      );
      break;
    }
    case "shared-note.update": {
      assertLesson(next, operation.lessonId);
      const index = next.sharedNotes.findIndex(
        (note) => note.id === operation.noteId,
      );
      const existing = index === -1 ? null : next.sharedNotes[index];
      if (existing && existing.version !== operation.baseVersion) {
        throw new CourseConflictError(
          "Someone else changed these shared notes. Review their version before saving yours.",
          next.revision,
        );
      }
      const note = {
        id: operation.noteId,
        lessonId: operation.lessonId,
        title: operation.title,
        text: operation.text,
        version: (existing?.version ?? 0) + 1,
        updatedAt: now,
        updatedBy: actorAccountId,
      };
      if (index === -1) next.sharedNotes.push(note);
      else next.sharedNotes[index] = note;
      appendActivity(
        next,
        activity(
          operation.id,
          "note-updated",
          actorAccountId,
          "Updated shared notes",
          now,
          operation.lessonId,
        ),
      );
      break;
    }
    case "submission.save": {
      assertLesson(next, operation.lessonId);
      const index = next.submissions.findIndex(
        (submission) =>
          submission.id === operation.submissionId &&
          submission.accountId === actorAccountId,
      );
      const existing = index === -1 ? null : next.submissions[index];
      const submission: CourseSubmission = {
        id: operation.submissionId,
        lessonId: operation.lessonId,
        exerciseId: operation.exerciseId,
        accountId: actorAccountId,
        answer: operation.answer,
        sharedWithPeers: operation.sharedWithPeers,
        version: (existing?.version ?? 0) + 1,
        updatedAt: now,
        ...(existing?.review ? { review: existing.review } : {}),
      };
      if (index === -1) next.submissions.push(submission);
      else next.submissions[index] = submission;
      appendActivity(
        next,
        activity(
          operation.id,
          "submission-saved",
          actorAccountId,
          "Saved exercise work",
          now,
          operation.lessonId,
        ),
      );
      break;
    }
    case "submission.review": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can review submissions.",
        );
      }
      const submission = next.submissions.find(
        (candidate) => candidate.id === operation.submissionId,
      );
      if (!submission)
        throw new CourseNotFoundError("This submission could not be found.");
      const student = memberFor(next, submission.accountId);
      if (student.teacherAccess !== "full") {
        throw new CourseAuthorizationError(
          "The learner has not granted full teacher access.",
        );
      }
      submission.review = {
        status: operation.status,
        feedback: operation.feedback,
        reviewerAccountId: actorAccountId,
        updatedAt: now,
      };
      appendActivity(
        next,
        activity(
          operation.id,
          "submission-reviewed",
          actorAccountId,
          "Reviewed exercise work",
          now,
          submission.lessonId,
        ),
      );
      break;
    }
    case "comment.add": {
      if (!next.settings.allowPeerComments && !roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Peer comments are disabled for this course.",
        );
      }
      if (operation.lessonId) assertLesson(next, operation.lessonId);
      const parent = operation.parentId
        ? next.comments.find(
            (comment) => comment.id === operation.parentId,
          )
        : undefined;
      if (operation.parentId && !parent) {
        throw new CourseNotFoundError(
          "The comment you replied to is no longer here.",
        );
      }
      // Replies to a reply join the same thread instead of nesting further.
      const parentId = parent ? (parent.parentId ?? parent.id) : undefined;
      const lessonId = parent ? parent.lessonId : operation.lessonId;
      next.comments.push({
        id: operation.commentId,
        ...(lessonId ? { lessonId } : {}),
        ...(parentId ? { parentId } : {}),
        accountId: actorAccountId,
        body: operation.body,
        createdAt: now,
      });
      appendActivity(
        next,
        activity(
          operation.id,
          "comment-added",
          actorAccountId,
          parentId
            ? "Replied in a course discussion"
            : lessonId
              ? "Added a lesson comment"
              : "Added a course comment",
          now,
          lessonId,
        ),
      );
      break;
    }
    case "comment.update": {
      const comment = next.comments.find(
        (candidate) => candidate.id === operation.commentId,
      );
      if (!comment)
        throw new CourseNotFoundError("This comment is no longer here.");
      if (comment.accountId !== actorAccountId) {
        throw new CourseAuthorizationError(
          "Only the author can edit a comment.",
        );
      }
      comment.body = operation.body;
      comment.editedAt = now;
      appendActivity(
        next,
        activity(
          operation.id,
          "comment-updated",
          actorAccountId,
          "Edited a course comment",
          now,
          comment.lessonId,
        ),
      );
      break;
    }
    case "comment.delete": {
      const comment = next.comments.find(
        (candidate) => candidate.id === operation.commentId,
      );
      if (!comment)
        throw new CourseNotFoundError("This comment is no longer here.");
      if (comment.accountId !== actorAccountId && !roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only the author or a course teacher can remove a comment.",
        );
      }
      const removedIds = commentSubtreeIds(next.comments, comment.id);
      next.comments = next.comments.filter(
        (candidate) => !removedIds.has(candidate.id),
      );
      dropReactions(next, "comment", removedIds);
      appendActivity(
        next,
        activity(
          operation.id,
          "comment-removed",
          actorAccountId,
          removedIds.size > 1
            ? `Removed a comment and ${removedIds.size - 1} replies`
            : "Removed a course comment",
          now,
          comment.lessonId,
        ),
      );
      break;
    }
    case "reaction.toggle": {
      if (!next.settings.allowPeerComments && !roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Peer reactions are disabled for this course.",
        );
      }
      const exists = {
        comment: () =>
          next.comments.some((item) => item.id === operation.targetId),
        artifact: () =>
          next.artifacts.some((item) => item.id === operation.targetId),
        material: () =>
          next.materials.some((item) => item.id === operation.targetId),
        assignment: () =>
          next.assignments.some((item) => item.id === operation.targetId),
        "shared-note": () =>
          next.sharedNotes.some((item) => item.id === operation.targetId),
      }[operation.targetKind]();
      if (!exists) {
        throw new CourseNotFoundError(
          "The post you reacted to is no longer here.",
        );
      }
      const index = next.reactions.findIndex(
        (reaction) =>
          reaction.targetKind === operation.targetKind &&
          reaction.targetId === operation.targetId &&
          reaction.emoji === operation.emoji &&
          reaction.accountId === actorAccountId,
      );
      if (index === -1)
        next.reactions.push({
          targetKind: operation.targetKind,
          targetId: operation.targetId,
          emoji: operation.emoji,
          accountId: actorAccountId,
          createdAt: now,
        });
      else next.reactions.splice(index, 1);
      break;
    }
    case "card.upsert": {
      if (!roleCanTeach(actor.role) && !next.settings.allowPeerDeckEdits) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit this deck.",
        );
      }
      if (operation.card.lessonId) assertLesson(next, operation.card.lessonId);
      const index = next.cards.findIndex(
        (card) => card.id === operation.card.id,
      );
      const card = {
        ...operation.card,
        updatedAt: now,
        updatedBy: actorAccountId,
      };
      if (index === -1) next.cards.push(card);
      else next.cards[index] = card;
      removeCardReferences(next, card.id);
      if (card.lessonId) {
        const lesson = allCourseLessons(next).find(
          (candidate) => candidate.id === card.lessonId,
        )!;
        lesson.cardIds.push(card.id);
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "card-updated",
          actorAccountId,
          "Updated an Anki card",
          now,
          card.lessonId,
        ),
      );
      break;
    }
    case "cards.import": {
      if (!roleCanTeach(actor.role) && !next.settings.allowPeerDeckEdits) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit this deck.",
        );
      }
      for (const imported of operation.cards) {
        if (imported.lessonId) assertLesson(next, imported.lessonId);
        const index = next.cards.findIndex((card) => card.id === imported.id);
        const card = { ...imported, updatedAt: now, updatedBy: actorAccountId };
        if (index === -1) next.cards.push(card);
        else next.cards[index] = card;
        removeCardReferences(next, card.id);
        if (card.lessonId) {
          const lesson = allCourseLessons(next).find(
            (candidate) => candidate.id === card.lessonId,
          )!;
          lesson.cardIds.push(card.id);
        }
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "card-updated",
          actorAccountId,
          `Imported ${operation.cards.length} course cards`,
          now,
        ),
      );
      break;
    }
    case "card.delete": {
      if (!roleCanTeach(actor.role) && !next.settings.allowPeerDeckEdits) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit this deck.",
        );
      }
      const index = next.cards.findIndex(
        (card) => card.id === operation.cardId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This card is no longer part of the course.",
        );
      next.cards.splice(index, 1);
      removeCardReferences(next, operation.cardId);
      appendActivity(
        next,
        activity(
          operation.id,
          "card-removed",
          actorAccountId,
          "Removed a course card",
          now,
        ),
      );
      break;
    }
    case "artifact.upsert": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit course artifacts.",
        );
      }
      if (operation.artifact.lessonId)
        assertLesson(next, operation.artifact.lessonId);
      const index = next.artifacts.findIndex(
        (artifact) => artifact.id === operation.artifact.id,
      );
      const artifact = {
        ...operation.artifact,
        updatedAt: now,
        updatedBy: actorAccountId,
      };
      if (index === -1) next.artifacts.push(artifact);
      else next.artifacts[index] = artifact;
      appendActivity(
        next,
        activity(
          operation.id,
          "artifact-updated",
          actorAccountId,
          `Updated ${artifact.title}`,
          now,
          artifact.lessonId,
        ),
      );
      break;
    }
    case "artifacts.import": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can import course artifacts.",
        );
      }
      for (const imported of operation.artifacts) {
        if (imported.lessonId) assertLesson(next, imported.lessonId);
        const index = next.artifacts.findIndex(
          (artifact) => artifact.id === imported.id,
        );
        const artifact = {
          ...imported,
          updatedAt: now,
          updatedBy: actorAccountId,
        };
        if (index === -1) next.artifacts.push(artifact);
        else next.artifacts[index] = artifact;
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "artifact-updated",
          actorAccountId,
          `Imported ${operation.artifacts.length} course artifacts`,
          now,
        ),
      );
      break;
    }
    case "artifact.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove course artifacts.",
        );
      }
      const index = next.artifacts.findIndex(
        (artifact) => artifact.id === operation.artifactId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This artifact is no longer part of the course.",
        );
      const [removed] = next.artifacts.splice(index, 1);
      dropReactions(next, "artifact", new Set([operation.artifactId]));
      appendActivity(
        next,
        activity(
          operation.id,
          "artifact-removed",
          actorAccountId,
          `Removed ${removed?.title ?? "a course artifact"}`,
          now,
        ),
      );
      break;
    }
    case "assignment.upsert": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can edit assignments.",
        );
      }
      if (operation.assignment.lessonId)
        assertLesson(next, operation.assignment.lessonId);
      const index = next.assignments.findIndex(
        (assignment) => assignment.id === operation.assignment.id,
      );
      const assignment = {
        ...operation.assignment,
        updatedAt: now,
        updatedBy: actorAccountId,
      };
      if (index === -1) next.assignments.push(assignment);
      else next.assignments[index] = assignment;
      appendActivity(
        next,
        activity(
          operation.id,
          "assignment-updated",
          actorAccountId,
          `Updated ${assignment.title}`,
          now,
          assignment.lessonId,
        ),
      );
      break;
    }
    case "assignment.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove assignments.",
        );
      }
      const index = next.assignments.findIndex(
        (assignment) => assignment.id === operation.assignmentId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This assignment is no longer part of the course.",
        );
      const [removed] = next.assignments.splice(index, 1);
      next.assignmentSubmissions = next.assignmentSubmissions.filter(
        (submission) => submission.assignmentId !== operation.assignmentId,
      );
      dropReactions(next, "assignment", new Set([operation.assignmentId]));
      appendActivity(
        next,
        activity(
          operation.id,
          "assignment-removed",
          actorAccountId,
          `Removed ${removed?.title ?? "an assignment"}`,
          now,
        ),
      );
      break;
    }
    case "assignment.submission.save": {
      assertAssignment(next, operation.assignmentId);
      const index = next.assignmentSubmissions.findIndex(
        (submission) =>
          submission.id === operation.submissionId &&
          submission.accountId === actorAccountId,
      );
      const existing = index === -1 ? null : next.assignmentSubmissions[index];
      if (existing && existing.version !== operation.baseVersion) {
        throw new CourseConflictError(
          "This assignment draft changed while you were editing. Review the latest version before saving.",
          next.revision,
        );
      }
      const submission: CourseAssignmentSubmission = {
        id: operation.submissionId,
        assignmentId: operation.assignmentId,
        accountId: actorAccountId,
        answer: operation.answer,
        status: operation.status,
        sharedWithPeers: operation.sharedWithPeers,
        version: (existing?.version ?? 0) + 1,
        updatedAt: now,
        ...(existing?.review ? { review: existing.review } : {}),
      };
      if (index === -1) next.assignmentSubmissions.push(submission);
      else next.assignmentSubmissions[index] = submission;
      appendActivity(
        next,
        activity(
          operation.id,
          "assignment-submitted",
          actorAccountId,
          operation.status === "submitted"
            ? "Submitted an assignment"
            : "Saved an assignment draft",
          now,
        ),
      );
      break;
    }
    case "assignment.submission.review": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can review assignment submissions.",
        );
      }
      const submission = next.assignmentSubmissions.find(
        (candidate) => candidate.id === operation.submissionId,
      );
      if (!submission)
        throw new CourseNotFoundError(
          "This assignment submission could not be found.",
        );
      const student = memberFor(next, submission.accountId);
      if (student.teacherAccess !== "full") {
        throw new CourseAuthorizationError(
          "The learner has not granted full teacher access.",
        );
      }
      submission.review = {
        status: operation.status,
        feedback: operation.feedback,
        reviewerAccountId: actorAccountId,
        updatedAt: now,
      };
      appendActivity(
        next,
        activity(
          operation.id,
          "assignment-reviewed",
          actorAccountId,
          "Reviewed an assignment submission",
          now,
        ),
      );
      break;
    }
    case "material.add": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can add course materials.",
        );
      }
      if (operation.material.lessonId)
        assertLesson(next, operation.material.lessonId);
      const material = {
        ...operation.material,
        createdAt: now,
        createdBy: actorAccountId,
      };
      const index = next.materials.findIndex(
        (candidate) => candidate.id === material.id,
      );
      if (index === -1) next.materials.push(material);
      else next.materials[index] = material;
      removeMaterialReferences(next, material.id);
      if (material.lessonId) {
        const lesson = allCourseLessons(next).find(
          (candidate) => candidate.id === material.lessonId,
        )!;
        lesson.materialIds.push(material.id);
      }
      appendActivity(
        next,
        activity(
          operation.id,
          "material-added",
          actorAccountId,
          "Added course material",
          now,
        ),
      );
      break;
    }
    case "material.delete": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can remove course materials.",
        );
      }
      const index = next.materials.findIndex(
        (material) => material.id === operation.materialId,
      );
      if (index === -1)
        throw new CourseNotFoundError(
          "This source is no longer part of the course.",
        );
      next.materials.splice(index, 1);
      removeMaterialReferences(next, operation.materialId);
      dropReactions(next, "material", new Set([operation.materialId]));
      appendActivity(
        next,
        activity(
          operation.id,
          "material-removed",
          actorAccountId,
          "Removed course material",
          now,
        ),
      );
      break;
    }
    case "teacher-access.request": {
      if (!roleCanTeach(actor.role)) {
        throw new CourseAuthorizationError(
          "Only course teachers can request full access.",
        );
      }
      const target = memberFor(next, operation.memberAccountId);
      if (roleCanTeach(target.role)) {
        throw new CourseAuthorizationError(
          "Teacher access applies to learners and invited peers.",
        );
      }
      target.teacherAccess = "requested";
      appendActivity(
        next,
        activity(
          operation.id,
          "teacher-access-requested",
          actorAccountId,
          "Requested full teacher access",
          now,
        ),
      );
      break;
    }
    case "teacher-access.respond": {
      const target = memberFor(next, actorAccountId);
      if (target.teacherAccess !== "requested") {
        throw new CourseConflictError(
          "There is no active teacher-access request.",
          next.revision,
        );
      }
      target.teacherAccess = operation.approve ? "full" : "private";
      appendActivity(
        next,
        activity(
          operation.id,
          "teacher-access-changed",
          actorAccountId,
          operation.approve
            ? "Granted full teacher access"
            : "Declined full teacher access",
          now,
        ),
      );
      break;
    }
    case "member.role.update": {
      if (!roleCanOwn(actor.role)) {
        throw new CourseAuthorizationError(
          "Only the course owner can change member roles.",
        );
      }
      const target = memberFor(next, operation.memberAccountId);
      if (target.role === "owner") {
        throw new CourseAuthorizationError(
          "Transfer ownership before changing the owner role.",
        );
      }
      target.role = operation.role;
      appendActivity(
        next,
        activity(
          operation.id,
          "member-role-changed",
          actorAccountId,
          "Changed a course member role",
          now,
        ),
      );
      break;
    }
  }

  next.revision += 1;
  next.updatedAt = now;
  return next;
}

function canSeeSubmission(
  course: Course,
  viewer: CourseMember,
  submission: CourseSubmission,
): boolean {
  if (submission.accountId === viewer.accountId) return true;
  if (roleCanTeach(viewer.role)) {
    return memberFor(course, submission.accountId).teacherAccess === "full";
  }
  return submission.sharedWithPeers;
}

function canSeeAssignmentSubmission(
  course: Course,
  viewer: CourseMember,
  submission: CourseAssignmentSubmission,
): boolean {
  if (submission.accountId === viewer.accountId) return true;
  if (roleCanTeach(viewer.role)) {
    return memberFor(course, submission.accountId).teacherAccess === "full";
  }
  return submission.sharedWithPeers;
}

function canSeeMemberPrivateState(
  viewer: CourseMember,
  member: CourseMember,
): boolean {
  if (member.accountId === viewer.accountId) return true;
  return (
    roleCanTeach(viewer.role) &&
    !roleCanTeach(member.role) &&
    member.teacherAccess === "full"
  );
}

function canSeeMemberConsentState(
  viewer: CourseMember,
  member: CourseMember,
): boolean {
  if (member.accountId === viewer.accountId) return true;
  return roleCanTeach(viewer.role) && !roleCanTeach(member.role);
}

function projectMemberForViewer(
  course: Course,
  viewer: CourseMember,
  member: CourseMember,
): CourseMember {
  if (canSeeMemberPrivateState(viewer, member)) return structuredClone(member);
  return {
    accountId: member.accountId,
    displayName: member.displayName,
    role: member.role,
    teacherAccess: canSeeMemberConsentState(viewer, member)
      ? member.teacherAccess
      : "private",
    // CourseMember remains schema-compatible without revealing member-specific timestamps.
    joinedAt: course.createdAt,
    progress: {
      completedLessonIds: [],
      lastActiveAt: course.createdAt,
    },
  };
}

export function projectCourseForViewer(
  course: Course,
  viewerAccountId: string,
): CourseViewerSnapshot {
  const viewer = memberFor(course, viewerAccountId);
  const projected = structuredClone(course);
  projected.materials = projected.materials.map((material) => {
    const { storageKey: _storageKey, ...publicMaterial } = material;
    return publicMaterial;
  });
  projected.members = course.members.map((member) =>
    projectMemberForViewer(course, viewer, member),
  );
  projected.submissions = projected.submissions.filter((submission) =>
    canSeeSubmission(course, viewer, submission),
  );
  projected.assignmentSubmissions = projected.assignmentSubmissions.filter(
    (submission) => canSeeAssignmentSubmission(course, viewer, submission),
  );
  projected.activity = projected.activity.filter((item) => {
    const member = course.members.find(
      (candidate) => candidate.accountId === item.accountId,
    );
    return member ? canSeeMemberPrivateState(viewer, member) : false;
  });
  return {
    course: projected,
    viewer: structuredClone(viewer),
    permissions: permissionsFor(course, viewerAccountId),
  };
}
