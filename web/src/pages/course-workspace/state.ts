/**
 * Course workspace state: the view/selection/draft fields owned by the page,
 * the actions that change them, and the reducer. Keeping this pure lets the
 * transitions be tested without rendering the page.
 */
import { allCourseLessons, type CourseReactionTarget, type CourseViewerSnapshot } from "../../courses/contracts";
import type { applyCourseOperation } from "../../courses/client";
import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";
import { COURSE_CHANNEL } from "../../components/courses/CourseDiscussion";

export type WorkspaceView = "read" | "discuss" | "review" | "build";

export type WorkspaceMutate = (
  operation: Parameters<typeof applyCourseOperation>[0],
  label: string,
) => Promise<void>;

export type ToggleReaction = (
  targetKind: CourseReactionTarget,
  targetId: string,
  emoji: string,
) => void;

export interface CourseWorkspaceState {
  snapshot: CourseViewerSnapshot | null;
  loading: boolean;
  error: string;
  saving: string;
  view: WorkspaceView;
  builderSection: CourseBuilderSection;
  discussChannel: string;
  activeLessonId: string;
  noteText: string;
  answer: string;
  shareAnswer: boolean;
  inviteOpen: boolean;
  paletteOpen: boolean;
}

export type CourseWorkspaceAction =
  | { type: "snapshot.received"; snapshot: CourseViewerSnapshot }
  | { type: "loading.finished" }
  | { type: "error.changed"; message: string }
  | { type: "saving.changed"; label: string }
  | { type: "view.changed"; view: WorkspaceView }
  | { type: "builder.section"; section: CourseBuilderSection }
  | { type: "lesson.selected"; lessonId: string; view?: WorkspaceView }
  | { type: "discuss.channel"; channel: string }
  | { type: "note.changed"; value: string }
  | { type: "note.synced"; noteText: string }
  | { type: "answer.changed"; value: string }
  | { type: "answer.synced"; answer: string; shareAnswer: boolean }
  | { type: "share-answer.changed"; value: boolean }
  | { type: "invite.changed"; open: boolean }
  | { type: "palette.changed"; open: boolean };

export const INITIAL_WORKSPACE_STATE: CourseWorkspaceState = {
  snapshot: null,
  loading: true,
  error: "",
  saving: "",
  view: "read",
  builderSection: "outline",
  discussChannel: COURSE_CHANNEL,
  activeLessonId: "",
  noteText: "",
  answer: "",
  shareAnswer: false,
  inviteOpen: false,
  paletteOpen: false,
};

export function courseWorkspaceReducer(
  state: CourseWorkspaceState,
  action: CourseWorkspaceAction,
): CourseWorkspaceState {
  switch (action.type) {
    case "snapshot.received": {
      const first = state.snapshot === null;
      const lessons = allCourseLessons(action.snapshot.course);
      // A course with nothing to read opens on the builder for whoever can fill it.
      const view =
        first && !lessons.length && action.snapshot.permissions.canEditCourse
          ? "build"
          : state.view;
      return { ...state, snapshot: action.snapshot, error: "", view };
    }
    case "loading.finished":
      return state.loading ? { ...state, loading: false } : state;
    case "error.changed":
      return state.error === action.message
        ? state
        : { ...state, error: action.message };
    case "saving.changed":
      return state.saving === action.label
        ? state
        : { ...state, saving: action.label };
    case "view.changed":
      return state.view === action.view ? state : { ...state, view: action.view };
    case "builder.section":
      return { ...state, builderSection: action.section, view: "build" };
    case "lesson.selected":
      return {
        ...state,
        activeLessonId: action.lessonId,
        discussChannel: action.lessonId,
        ...(action.view ? { view: action.view } : {}),
      };
    case "discuss.channel":
      return { ...state, discussChannel: action.channel };
    case "note.changed":
      return { ...state, noteText: action.value };
    case "note.synced":
      return state.noteText === action.noteText
        ? state
        : { ...state, noteText: action.noteText };
    case "answer.changed":
      return { ...state, answer: action.value };
    case "answer.synced":
      return { ...state, answer: action.answer, shareAnswer: action.shareAnswer };
    case "share-answer.changed":
      return state.shareAnswer === action.value
        ? state
        : { ...state, shareAnswer: action.value };
    case "invite.changed":
      return { ...state, inviteOpen: action.open };
    case "palette.changed":
      return { ...state, paletteOpen: action.open };
  }
}
