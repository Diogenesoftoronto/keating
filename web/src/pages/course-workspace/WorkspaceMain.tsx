/**
 * Centre column of the course workspace: renders whichever view is selected
 * (reading desk, discussion, review queue, builder) and wires it to the page
 * state and the named workspace actions. Review and Build render only for
 * viewers who hold the matching permission, whatever the stored view says.
 */
import type { Dispatch } from "react";
import {
  CourseBuilder,
  type CourseBuilderSection,
} from "../../components/courses/CourseBuilder";
import { CourseDiscussion } from "../../components/courses/CourseDiscussion";
import { CourseReviewPanel } from "../../components/courses/CourseReviewPanel";
import type { CourseViewerSnapshot } from "../../courses/contracts";
import { DeskView } from "./DeskView";
import { canBuild, isLessonCompleted, type LessonContext } from "./model";
import type {
  CourseWorkspaceAction,
  CourseWorkspaceState,
  WorkspaceMutate,
  WorkspaceView,
} from "./state";
import { workspaceStyles as s } from "./styles";
import type { WorkspaceActions } from "./workspace-actions";

export interface WorkspaceMainProps {
  snapshot: CourseViewerSnapshot;
  state: CourseWorkspaceState;
  lesson: LessonContext;
  threadCounts: Record<string, number>;
  mutate: WorkspaceMutate;
  actions: WorkspaceActions;
  dispatch: Dispatch<CourseWorkspaceAction>;
  onSelectLesson(lessonId: string, view?: WorkspaceView): void;
  onOpenBuilder(section: CourseBuilderSection): void;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
}

export function WorkspaceMain(props: WorkspaceMainProps) {
  const { snapshot, state, lesson, dispatch, actions } = props;
  const { view, saving } = state;
  const { activeLesson } = lesson;
  const { permissions } = snapshot;
  return (
    <main className={s.center}>
      {view === "read" ? (
        <DeskView
          snapshot={snapshot}
          {...(activeLesson ? { lesson: activeLesson } : {})}
          moduleTitle={lesson.activeModule?.title ?? "Course"}
          completed={isLessonCompleted(snapshot, activeLesson)}
          mutate={props.mutate}
          saving={saving}
          noteText={state.noteText}
          setNoteText={(value) => dispatch({ type: "note.changed", value })}
          sharedNoteVersion={lesson.sharedNote?.version ?? 0}
          answer={state.answer}
          setAnswer={(value) => dispatch({ type: "answer.changed", value })}
          shareAnswer={state.shareAnswer}
          setShareAnswer={(value) =>
            dispatch({ type: "share-answer.changed", value })
          }
          threadCount={activeLesson ? (props.threadCounts[activeLesson.id] ?? 0) : 0}
          onSnapshot={props.onSnapshot}
          onError={props.onError}
          onToggleReaction={actions.toggleReaction}
          onOpenBuilder={props.onOpenBuilder}
          onDiscuss={() => dispatch({ type: "view.changed", view: "discuss" })}
          onComplete={() =>
            activeLesson &&
            actions.setLessonCompleted(
              activeLesson,
              !isLessonCompleted(snapshot, activeLesson),
            )
          }
          onSaveNote={() =>
            activeLesson &&
            actions.saveSharedNote(activeLesson, lesson.sharedNote, state.noteText)
          }
          onSaveAnswer={() =>
            activeLesson &&
            actions.saveAnswer(
              activeLesson,
              lesson.ownSubmission,
              state.answer,
              state.shareAnswer,
            )
          }
        />
      ) : null}
      {view === "discuss" ? (
        <CourseDiscussion
          snapshot={snapshot}
          channel={state.discussChannel}
          onChannelChange={(channel) =>
            dispatch({ type: "discuss.channel", channel })
          }
          saving={saving}
          mutate={props.mutate}
          onSelectLesson={(lessonId) => props.onSelectLesson(lessonId, "discuss")}
        />
      ) : null}
      {view === "review" && permissions.canReview ? (
        <CourseReviewPanel
          snapshot={snapshot}
          saving={saving}
          onReview={actions.reviewSubmission}
          onAssignmentReview={actions.reviewAssignmentSubmission}
          onRequestAccess={actions.requestTeacherAccess}
        />
      ) : null}
      {view === "build" && canBuild(permissions) ? (
        <CourseBuilder
          snapshot={snapshot}
          {...(activeLesson ? { activeLesson } : {})}
          section={state.builderSection}
          saving={saving}
          onSectionChange={props.onOpenBuilder}
          mutate={props.mutate}
          onSnapshot={props.onSnapshot}
          onSelectLesson={(lessonId) => props.onSelectLesson(lessonId)}
          onInvite={() => dispatch({ type: "invite.changed", open: true })}
          onError={props.onError}
        />
      ) : null}
    </main>
  );
}
