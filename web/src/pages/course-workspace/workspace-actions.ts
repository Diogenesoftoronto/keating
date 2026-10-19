/**
 * Every write the workspace can make, as a named action. Each action builds
 * the matching course operation against the revision the viewer is looking at
 * and hands it to `mutate` with the label the UI uses for its "saving" state.
 * Keeping the operation shapes here leaves the components free of payload
 * plumbing and lets tests assert exactly what is sent.
 */
import { newCourseOperationId } from "../../courses/client";
import type {
  Course,
  CourseLesson,
  CourseReactionTarget,
  CourseSharedNote,
  CourseSubmission,
} from "../../courses/contracts";
import type { WorkspaceMutate } from "./state";

export interface WorkspaceActions {
  toggleReaction(
    targetKind: CourseReactionTarget,
    targetId: string,
    emoji: string,
  ): void;
  respondToTeacherAccess(approve: boolean): void;
  setLessonCompleted(lesson: CourseLesson, completed: boolean): void;
  saveSharedNote(
    lesson: CourseLesson,
    existing: CourseSharedNote | undefined,
    text: string,
  ): void;
  /** No-op for a lesson without an exercise. */
  saveAnswer(
    lesson: CourseLesson,
    existing: CourseSubmission | undefined,
    answer: string,
    sharedWithPeers: boolean,
  ): void;
  reviewSubmission(submissionId: string, feedback: string): void;
  reviewAssignmentSubmission(submissionId: string, feedback: string): void;
  requestTeacherAccess(memberAccountId: string): void;
}

export function createWorkspaceActions(
  course: Pick<Course, "id" | "revision">,
  mutate: WorkspaceMutate,
): WorkspaceActions {
  const base = () => ({
    id: newCourseOperationId(),
    courseId: course.id,
    baseRevision: course.revision,
  });
  return {
    toggleReaction(targetKind, targetId, emoji) {
      void mutate(
        { ...base(), type: "reaction.toggle", targetKind, targetId, emoji },
        `reaction-${targetId}-${emoji}`,
      );
    },
    respondToTeacherAccess(approve) {
      void mutate({ ...base(), type: "teacher-access.respond", approve }, "access");
    },
    setLessonCompleted(lesson, completed) {
      void mutate(
        {
          ...base(),
          type: "lesson.complete",
          lessonId: lesson.id,
          completed,
        },
        "complete",
      );
    },
    saveSharedNote(lesson, existing, text) {
      void mutate(
        {
          ...base(),
          type: "shared-note.update",
          noteId: existing?.id ?? `note_${lesson.id}`,
          lessonId: lesson.id,
          title: `${lesson.title} notes`,
          text,
          baseVersion: existing?.version ?? 0,
        },
        "note",
      );
    },
    saveAnswer(lesson, existing, answer, sharedWithPeers) {
      if (!lesson.exercise) return;
      void mutate(
        {
          ...base(),
          type: "submission.save",
          submissionId:
            existing?.id ??
            `submission_${crypto.randomUUID().replaceAll("-", "")}`,
          lessonId: lesson.id,
          exerciseId: lesson.exercise.id,
          answer,
          sharedWithPeers,
        },
        "answer",
      );
    },
    reviewSubmission(submissionId, feedback) {
      void mutate(
        {
          ...base(),
          type: "submission.review",
          submissionId,
          status: "reviewed",
          feedback,
        },
        "review",
      );
    },
    reviewAssignmentSubmission(submissionId, feedback) {
      void mutate(
        {
          ...base(),
          type: "assignment.submission.review",
          submissionId,
          status: "reviewed",
          feedback,
        },
        "assignment-review",
      );
    },
    requestTeacherAccess(memberAccountId) {
      void mutate(
        { ...base(), type: "teacher-access.request", memberAccountId },
        "access",
      );
    },
  };
}
