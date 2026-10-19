/**
 * Discussion operations: shared notes, lesson submissions, comment threads, and reactions.
 * Each handler receives the cloned course (mutated in place), the acting
 * member, the operation, and the clock. Revision checks and the single
 * revision increment live in the dispatcher, not here.
 */
import {
  type Course,
  type CourseMember,
  type CourseOperation,
  type CourseSubmission,
} from "../contracts";
import {
  CourseAuthorizationError,
  CourseConflictError,
  CourseNotFoundError,
} from "./errors";
import {
  activity,
  appendActivity,
  assertLesson,
  commentSubtreeIds,
  dropReactions,
  memberFor,
  roleCanTeach,
} from "./shared";

const DISCUSSION_TYPES = ["shared-note.update", "submission.save", "submission.review", "comment.add", "comment.update", "comment.delete", "reaction.toggle"] as const;

export type DiscussionOperation = Extract<
  CourseOperation,
  { type: (typeof DISCUSSION_TYPES)[number] }
>;

export function isDiscussionOperation(
  operation: CourseOperation,
): operation is DiscussionOperation {
  return ((DISCUSSION_TYPES as readonly string[])).includes(operation.type);
}

export function applyDiscussionOperation(
  next: Course,
  actor: CourseMember,
  operation: DiscussionOperation,
  now: string,
): void {
  const actorAccountId = actor.accountId;
  switch (operation.type) {
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
  }
}
