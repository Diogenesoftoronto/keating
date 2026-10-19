/**
 * Keeps the workspace's editable drafts and selection aligned with the course
 * snapshot: opens on the viewer's last lesson, and reloads the shared-note and
 * answer drafts when the saved record behind them changes (a new version from a
 * peer, or the learner moving to another lesson).
 */
import { useEffect, type Dispatch } from "react";
import type {
  CourseLesson,
  CourseSharedNote,
  CourseSubmission,
} from "../../courses/contracts";
import type { CourseWorkspaceAction, WorkspaceView } from "./state";

export function useWorkspaceDraftSync({
  dispatch,
  selectLesson,
  activeLessonId,
  lessons,
  viewerActiveLessonId,
  sharedNote,
  ownSubmission,
}: {
  dispatch: Dispatch<CourseWorkspaceAction>;
  selectLesson(lessonId: string, view?: WorkspaceView): void;
  activeLessonId: string;
  lessons: readonly CourseLesson[];
  viewerActiveLessonId: string | undefined;
  sharedNote: CourseSharedNote | undefined;
  ownSubmission: CourseSubmission | undefined;
}) {
  useEffect(() => {
    if (!activeLessonId && lessons[0])
      selectLesson(viewerActiveLessonId ?? lessons[0].id);
  }, [activeLessonId, lessons, selectLesson, viewerActiveLessonId]);
  useEffect(() => {
    dispatch({ type: "note.synced", noteText: sharedNote?.text ?? "" });
    // Re-sync only when the record identity/version changes, not on every keystroke.
  }, [sharedNote?.id, sharedNote?.version]);
  useEffect(() => {
    dispatch({
      type: "answer.synced",
      answer: ownSubmission?.answer ?? "",
      shareAnswer: ownSubmission?.sharedWithPeers ?? false,
    });
  }, [ownSubmission?.id, ownSubmission?.version]);
}
