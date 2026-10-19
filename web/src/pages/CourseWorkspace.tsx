/**
 * Course workspace page. Owns the reducer state and wires data loading,
 * navigation, and drafts to the presentational pieces in `./course-workspace/`:
 * header, banners, outline rail, the selected view, the live-room rail, and
 * overlays. This file reads top to bottom as: gather data → derive → compose.
 */
import { useMemo, useReducer } from "react";
import { useParams } from "@tanstack/react-router";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { commentCounts } from "../courses/course-comments";
import { allCourseLessons } from "../courses/contracts";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";
import { CourseOutline } from "./course-workspace/CourseOutline";
import { LiveRoomRail } from "./course-workspace/LiveRoomRail";
import {
  networkStatusOf,
  resolveLessonContext,
} from "./course-workspace/model";
import { resolveSearchNavigation } from "./course-workspace/search-navigation";
import {
  courseWorkspaceReducer,
  INITIAL_WORKSPACE_STATE,
} from "./course-workspace/state";
import { workspaceStyles as s } from "./course-workspace/styles";
import { useCourseWorkspaceData } from "./course-workspace/useCourseWorkspaceData";
import { useWorkspaceDraftSync } from "./course-workspace/useWorkspaceDraftSync";
import {
  useCommandPaletteShortcut,
  useWorkspaceNavigation,
} from "./course-workspace/useWorkspaceNavigation";
import { createWorkspaceActions } from "./course-workspace/workspace-actions";
import {
  ErrorBanner,
  TeacherAccessBanner,
} from "./course-workspace/WorkspaceBanners";
import { WorkspaceHeader } from "./course-workspace/WorkspaceHeader";
import { WorkspaceMain } from "./course-workspace/WorkspaceMain";
import { WorkspaceOverlays } from "./course-workspace/WorkspaceOverlays";
import {
  WorkspaceLoading,
  WorkspaceUnavailable,
} from "./course-workspace/WorkspaceStatus";

export function CourseWorkspace() {
  const { courseId } = useParams({ strict: false }) as { courseId: string };
  const [access, retryAccess] = useCoursesAccess();
  const [state, dispatch] = useReducer(
    courseWorkspaceReducer,
    INITIAL_WORKSPACE_STATE,
  );
  const { snapshot, loading, error, saving, view, activeLessonId } = state;

  const nav = useWorkspaceNavigation(dispatch);
  const { realtime, mutate, setSnapshot, setError } = useCourseWorkspaceData(
    courseId,
    access.status === "ready",
    dispatch,
  );
  useCommandPaletteShortcut(dispatch);

  const course = snapshot?.course;
  const lessons = useMemo(
    () => (course ? allCourseLessons(course) : []),
    [course],
  );
  const lesson = resolveLessonContext(
    course,
    lessons,
    activeLessonId,
    snapshot?.viewer.accountId,
  );
  const threadCounts = useMemo(
    () => (course ? commentCounts(course.comments) : {}),
    [course],
  );

  useSeo({
    title: course ? `${course.title} — Keating Courses` : "Course — Keating",
    description: course?.description ?? "A collaborative Keating course.",
  });
  useWorkspaceDraftSync({
    dispatch,
    selectLesson: nav.selectLesson,
    activeLessonId,
    lessons,
    viewerActiveLessonId: snapshot?.viewer.progress.activeLessonId,
    sharedNote: lesson.sharedNote,
    ownSubmission: lesson.ownSubmission,
  });

  if (access.status !== "ready")
    return (
      <div className={s.page}>
        <CoursesAccessGate state={access} onRetry={retryAccess} />
      </div>
    );
  if (loading) return <WorkspaceLoading />;
  if (!snapshot || !course) return <WorkspaceUnavailable error={error} />;

  const { viewer, permissions } = snapshot;
  const actions = createWorkspaceActions(course, mutate);
  const openSearchResult = (
    result: Parameters<typeof resolveSearchNavigation>[0],
  ) => {
    dispatch({ type: "palette.changed", open: false });
    const step = resolveSearchNavigation(result, course, permissions);
    if (step) nav.navigate(step);
  };

  return (
    <div className={s.page}>
      <WorkspaceHeader
        snapshot={snapshot}
        activeLessonId={lesson.activeLesson?.id}
        view={view}
        saving={saving}
        networkStatus={networkStatusOf(
          realtime.status,
          snapshot.network?.status,
        )}
        mutate={mutate}
        onSnapshot={setSnapshot}
        onError={setError}
        onOpenBuilder={nav.openBuilder}
        onViewChange={(next) => dispatch({ type: "view.changed", view: next })}
        onOpenPalette={() => dispatch({ type: "palette.changed", open: true })}
        onOpenInvite={() => dispatch({ type: "invite.changed", open: true })}
      />
      {error && <ErrorBanner error={error} onDismiss={() => setError("")} />}
      {viewer.teacherAccess === "requested" && (
        <TeacherAccessBanner onRespond={actions.respondToTeacherAccess} />
      )}
      <div className={s.grid}>
        <CourseOutline
          course={course}
          viewer={viewer}
          permissions={permissions}
          threadCounts={threadCounts}
          activeLessonId={lesson.activeLesson?.id}
          view={view}
          onSelectLesson={nav.selectLesson}
          onOpenBuilder={nav.openBuilder}
          onOpenCourseThread={nav.openCourseThread}
        />
        <WorkspaceMain
          snapshot={snapshot}
          state={state}
          lesson={lesson}
          threadCounts={threadCounts}
          mutate={mutate}
          actions={actions}
          dispatch={dispatch}
          onSelectLesson={nav.selectLesson}
          onOpenBuilder={nav.openBuilder}
          onSnapshot={setSnapshot}
          onError={setError}
        />
        <LiveRoomRail
          snapshot={snapshot}
          onlineAccountIds={new Set(realtime.presentAccountIds)}
          activeLesson={lesson.activeLesson}
          view={view}
        />
      </div>
      <WorkspaceOverlays
        courseId={courseId}
        course={course}
        activeLesson={lesson.activeLesson}
        inviteOpen={state.inviteOpen}
        paletteOpen={state.paletteOpen}
        onCloseInvite={() => dispatch({ type: "invite.changed", open: false })}
        onClosePalette={() => dispatch({ type: "palette.changed", open: false })}
        onSelectResult={openSearchResult}
      />
    </div>
  );
}
