/**
 * Course workspace page. Owns the reducer state and wires data loading,
 * navigation, and drafts to the presentational pieces in `./course-workspace/`:
 * header, banners, outline rail, the selected view, the live-room rail, and
 * overlays. This file reads top to bottom as: gather data → derive → compose.
 */
import { useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useMediaQuery } from "../hooks/use-media-query";
import { KeatingGlyph } from "../design-system/glyphs";
import { motionAllowed } from "../design-system/motion";
import { Button, Sheet } from "../design-system/kit";
import "./course-workspace/courses.css";
import { useLocation, useParams, useSearch } from "@tanstack/react-router";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import {
  LessonReadingSourceReturn,
  LessonReadingUnavailable,
  resolveLessonReadingContext,
} from "../components/private-fork/LessonReadingSourceReturn";
import { useDiscussionUnread } from "../courses/discussion-read";
import { allCourseLessons } from "../courses/contracts";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";
import { CourseOutline } from "./course-workspace/CourseOutline";
import { LiveRoomRail } from "./course-workspace/LiveRoomRail";
import { networkStatusOf } from "./course-workspace/model";
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
  const { lesson, tab } = useSearch({ strict: false }) as { lesson?: string; tab?: unknown };
  const review = tab === "review";
  const hash = useLocation({ select: (location) => location.hash });
  // Remount for a different source URL so an old snapshot, draft, or pending
  // private continuation cannot carry across course/lesson navigation.
  return <CourseWorkspaceContent key={JSON.stringify([courseId, lesson, hash, review])} review={review} courseId={courseId} requestedLessonId={lesson} hash={hash} />;
}

function CourseWorkspaceContent({
  courseId, requestedLessonId, hash, review,
}: { review: boolean; courseId: string; requestedLessonId: string | undefined; hash: string }) {
  const [access, retryAccess] = useCoursesAccess();
  const [state, dispatch] = useReducer(
    courseWorkspaceReducer,
    { ...INITIAL_WORKSPACE_STATE, view: review ? "review" : "read", activeLessonId: requestedLessonId ?? "" },
  );
  const { snapshot, loading, error, saving, view, activeLessonId } = state;

  const narrowWorkspace = useMediaQuery("(max-width: 1000px)");
  const compactRail = narrowWorkspace || view === "build";
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outlineRef = useRef<HTMLDivElement>(null);
  const openOutline = () => {
    if (outlineRef.current?.getClientRects().length) {
      outlineRef.current.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    } else setOutlineOpen(true);
  };

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
  const { returningToSource, sourceIssue, lesson } = resolveLessonReadingContext({
    course,
    lessons,
    activeLessonId,
    requestedLessonId,
    hash,
    viewerAccountId: snapshot?.viewer.accountId,
  });
  const threadCounts = useDiscussionUnread(
    snapshot, view === "discuss" && !sourceIssue ? state.discussChannel : undefined,
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
  if (!snapshot || !course || course.id !== courseId) return <WorkspaceUnavailable error={error} />;

  const { viewer, permissions } = snapshot;
  const actions = createWorkspaceActions(course, mutate);
  const openSearchResult = (
    result: Parameters<typeof resolveSearchNavigation>[0],
  ) => {
    dispatch({ type: "palette.changed", open: false });
    const step = resolveSearchNavigation(result, course, permissions);
    if (step) nav.navigate(step);
  };

  const index = lessons.findIndex(item => item.id === lesson.activeLesson?.id);
  const moduleIndex = course.modules.findIndex(item => item.id === lesson.activeModule?.id);
  const previous = lessons[index - 1];
  const next = index >= 0 ? lessons[index + 1] : undefined;
  const readLesson = (id: string) => {
    const show = () => {
      flushSync(() => {
        setOutlineOpen(false);
        nav.selectLesson(id, "read");
      });
      const heading = document.querySelector<HTMLElement>(".cw-lesson-intro h2");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "nearest" });
    };
    if (view === "read" && id !== lesson.activeLesson?.id && motionAllowed() && document.startViewTransition) {
      document.startViewTransition(show);
    } else show();
  };
  const outline = (<CourseOutline
          course={course}
          viewer={viewer}
          permissions={permissions}
          threadCounts={threadCounts}
          activeLessonId={lesson.activeLesson?.id}
          view={view}
          onSelectLesson={(id, nextView) => { if (nextView === "read") readLesson(id);
            else { setOutlineOpen(false); nav.selectLesson(id, nextView); } }}
          onOpenBuilder={section => { setOutlineOpen(false); nav.openBuilder(section); }}
          onOpenCourseThread={() => { setOutlineOpen(false); nav.openCourseThread(); }}
        />);
  const rail = (
        <LiveRoomRail
          snapshot={snapshot}
          onlineAccountIds={new Set(realtime.presentAccountIds)}
          activeLesson={lesson.activeLesson}
          view={view}
        />
  );
  return (
    <div className={s.page}>
      <LessonReadingSourceReturn
        lessonId={returningToSource ? requestedLessonId : undefined}
        hash={hash}
        ready={view === "read" || !!sourceIssue}
      />
      <WorkspaceHeader
        unread={Object.values(threadCounts).reduce((total, count) => total + count, 0)}
        snapshot={snapshot}
        activeLessonId={lesson.activeLesson?.id}
        navigation={<div className="cw-navigation">
          <Button variant="line" size="sm" className={view === "build" ? "cw-build-outline-trigger" : "cw-outline-trigger"} onClick={() => setOutlineOpen(true)}>Outline</Button>
          {view === "read" && !sourceIssue && index >= 0 && <div className="cw-position">
            <small>Module {moduleIndex + 1} · Lesson {index + 1} of {lessons.length}</small>
            <Button size="sm" variant="ghost" glyph="left" disabled={!previous} onClick={() => previous && readLesson(previous.id)}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={!next} onClick={() => next && readLesson(next.id)}>Next<KeatingGlyph name="right" size={14} /></Button>
          </div>}
          {compactRail && <Button size="sm" variant="ghost" glyph="people" onClick={() => setPeopleOpen(true)}>People</Button>}
        </div>}
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
      {error ? <ErrorBanner error={error} onDismiss={() => setError("")} /> : viewer.teacherAccess === "requested" && (
        <TeacherAccessBanner onRespond={actions.respondToTeacherAccess} />
      )}
      <div className={s.grid} data-view={view}>
        <div className="cw-outline-desktop" ref={outlineRef}>{outline}</div>
        {outlineOpen && <Sheet open onClose={() => setOutlineOpen(false)} side="bottom" title="Course outline">{outline}</Sheet>}
        {sourceIssue && requestedLessonId ? (
          <main className={s.center}>
            <LessonReadingUnavailable courseId={courseId} lessonId={requestedLessonId} message={sourceIssue} />
          </main>
        ) : <WorkspaceMain
          snapshot={snapshot}
          nextAction={{ label: next ? `Lesson ${index + 2} · ${next.title}` : "Back to the outline",
            run: next ? () => readLesson(next.id) : openOutline }}
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
        />}
        {compactRail ? peopleOpen && (
          <Sheet open onClose={() => setPeopleOpen(false)} side="bottom" title="Course people and activity">{rail}</Sheet>
        ) : rail}
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
