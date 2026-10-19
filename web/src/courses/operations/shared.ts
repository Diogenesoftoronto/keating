/**
 * Helpers shared by every course operation group: membership lookup, role
 * predicates, existence assertions, the activity feed, and cascading removal
 * of lesson/card/material references. All mutators act on an already-cloned
 * course and never touch the caller's copy.
 */
import {
  allCourseLessons,
  type Course,
  type CourseActivity,
  type CourseComment,
  type CourseMember,
  type CourseReactionTarget,
  type CourseRole,
} from "../contracts";
import { CourseAuthorizationError, CourseNotFoundError } from "./errors";

export function memberFor(course: Course, accountId: string): CourseMember {
  const member = course.members.find(
    (candidate) => candidate.accountId === accountId,
  );
  if (!member)
    throw new CourseAuthorizationError("You are not enrolled in this course.");
  return member;
}

export function roleCanTeach(role: CourseRole): boolean {
  return role === "owner" || role === "teacher";
}

export function roleCanOwn(role: CourseRole): boolean {
  return role === "owner";
}

export function assertLesson(course: Course, lessonId: string): void {
  if (!allCourseLessons(course).some((lesson) => lesson.id === lessonId)) {
    throw new CourseNotFoundError(
      "This lesson is no longer part of the course.",
    );
  }
}

export function assertAssignment(course: Course, assignmentId: string): void {
  if (
    !course.assignments.some((assignment) => assignment.id === assignmentId)
  ) {
    throw new CourseNotFoundError(
      "This assignment is no longer part of the course.",
    );
  }
}

export function activity(
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

export function appendActivity(course: Course, item: CourseActivity): void {
  course.activity = [item, ...course.activity].slice(0, 5_000);
}

export function removeLessonState(
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

export function dropReactions(
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
export function commentSubtreeIds(
  comments: readonly CourseComment[],
  commentId: string,
): Set<string> {
  const ids = new Set([commentId]);
  for (const comment of comments) {
    if (comment.parentId && ids.has(comment.parentId)) ids.add(comment.id);
  }
  return ids;
}

export function removeCardReferences(course: Course, cardId: string): void {
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      lesson.cardIds = lesson.cardIds.filter((id) => id !== cardId);
    }
  }
}

export function removeMaterialReferences(course: Course, materialId: string): void {
  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      lesson.materialIds = lesson.materialIds.filter((id) => id !== materialId);
    }
  }
}
