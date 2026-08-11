import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookUp,
  Check,
  Circle,
  CreditCard,
  ExternalLink,
  FileText,
  Hammer,
  Layers3,
  MessageSquareText,
  PenLine,
  Search,
  Send,
  Share2,
  Shapes,
  ClipboardCheck,
  StickyNote,
  X,
} from "lucide-react";
import { css, cx } from "../../styled-system/css";
import {
  CourseAddMenu,
  CourseDocumentUploadButton,
} from "../components/courses/CourseAddMenu";
import { CourseArtifactCard } from "../components/courses/CourseArtifactCard";
import {
  CourseBuilder,
  type CourseBuilderSection,
} from "../components/courses/CourseBuilder";
import { CourseCommandPalette } from "../components/courses/CourseCommandPalette";
import {
  COURSE_CHANNEL,
  CourseDiscussion,
} from "../components/courses/CourseDiscussion";
import { CourseInviteDialog } from "../components/courses/CourseInviteDialog";
import { CourseKeatingPanel } from "../components/courses/CourseKeatingPanel";
import { CourseReactionBar } from "../components/courses/CourseReactionBar";
import { CourseReviewPanel } from "../components/courses/CourseReviewPanel";
import { CourseSwitcher } from "../components/courses/CourseSwitcher";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import {
  courseButtonClass,
  courseCountChipClass,
  courseEmptyClass,
  courseInputClass,
  courseLabelClass,
  coursePrimaryButtonClass,
  formatCourseRelative,
} from "../components/courses/course-ui";
import {
  applyCourseOperation,
  courseMaterialUrl,
  CourseApiError,
  getCourse,
  newCourseOperationId,
} from "../courses/client";
import { courseChatSearch, courseSearchAsk } from "../courses/course-ask";
import { commentCounts } from "../courses/course-comments";
import type { CourseSearchResult } from "../courses/course-search";
import {
  allCourseLessons,
  courseCompletionPercent,
  normalizeCourseViewerSnapshot,
  type CourseAssignment,
  type CourseArtifact,
  type CourseLesson,
  type CourseMaterial,
  type CourseMember,
  type CourseReactionTarget,
  type CourseViewerSnapshot,
} from "../courses/contracts";
import { useCourseRealtime } from "../courses/useCourseRealtime";
import { useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

const s = {
  page: css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" }),
  top: css({
    position: "sticky",
    top: 0,
    zIndex: 40,
    borderBottom: "2px solid var(--ink)",
    bg: "color-mix(in srgb, var(--paper) 94%, transparent)",
    backdropFilter: "blur(12px)",
  }),
  topInner: css({
    mx: "auto",
    display: "flex",
    w: "100%",
    maxW: "104rem",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.6rem",
    px: "1rem",
    py: "0.5rem",
  }),
  tabRow: css({
    mx: "auto",
    display: "flex",
    w: "100%",
    minW: 0,
    maxW: "104rem",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    px: "1rem",
    pb: "0.45rem",
  }),
  tab: css({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    borderBottom: "3px solid transparent",
    px: "0.5rem",
    py: "0.35rem",
    fontFamily: "var(--mono-display)",
    fontSize: "0.68rem",
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--ink-soft)",
    cursor: "pointer",
    _hover: { color: "var(--ink)" },
  }),
  grid: css({
    mx: "auto",
    display: "grid",
    w: "100%",
    gridTemplateColumns: "minmax(0, 1fr)",
    minH: "calc(100vh - 96px)",
    maxW: "104rem",
    lg: { gridTemplateColumns: "17rem minmax(0, 1fr)" },
    xl: { gridTemplateColumns: "17rem minmax(0, 1fr) 19rem" },
  }),
  left: css({
    borderBottom: "2px solid var(--ink)",
    bg: "var(--paper-deep, #e9e2d2)",
    p: "1rem",
    lg: { borderRight: "2px solid var(--ink)", borderBottom: 0 },
  }),
  center: css({
    minW: 0,
    bg: "var(--card)",
    p: { base: "1rem", md: "2rem", xl: "2.5rem" },
  }),
  right: css({
    borderTop: "2px solid var(--ink)",
    bg: "var(--paper-deep, #e9e2d2)",
    p: "1rem",
    lg: { gridColumn: "1 / -1" },
    xl: { gridColumn: "auto", borderTop: 0, borderLeft: "2px solid var(--ink)" },
  }),
  sectionLabel: courseLabelClass,
  button: courseButtonClass,
  primaryButton: coursePrimaryButtonClass,
  input: courseInputClass,
};

function memberName(member: CourseMember, viewerId: string): string {
  return member.accountId === viewerId ? "You" : member.displayName;
}

/** Reactions follow the same rule as comments, so nothing offers a dead click. */
function canReact(snapshot: CourseViewerSnapshot): boolean {
  return (
    snapshot.course.settings.allowPeerComments || snapshot.permissions.canReview
  );
}

type WorkspaceView = "read" | "discuss" | "review" | "build";

type WorkspaceMutate = (
  operation: Parameters<typeof applyCourseOperation>[0],
  label: string,
) => Promise<void>;

type ToggleReaction = (
  targetKind: CourseReactionTarget,
  targetId: string,
  emoji: string,
) => void;

interface CourseWorkspaceState {
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

type CourseWorkspaceAction =
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

const INITIAL_WORKSPACE_STATE: CourseWorkspaceState = {
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

function courseWorkspaceReducer(
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

export function CourseWorkspace() {
  const { courseId } = useParams({ strict: false }) as { courseId: string };
  const [access, retryAccess] = useCoursesAccess();
  const [state, dispatch] = useReducer(
    courseWorkspaceReducer,
    INITIAL_WORKSPACE_STATE,
  );
  const {
    snapshot,
    loading,
    error,
    saving,
    view,
    builderSection,
    discussChannel,
    activeLessonId,
    noteText,
    answer,
    shareAnswer,
    inviteOpen,
    paletteOpen,
  } = state;

  const setSnapshot = useCallback((next: CourseViewerSnapshot) => {
    dispatch({
      type: "snapshot.received",
      snapshot: normalizeCourseViewerSnapshot(next),
    });
  }, []);
  const setError = useCallback((message: string) => {
    dispatch({ type: "error.changed", message });
  }, []);
  const selectLesson = useCallback(
    (lessonId: string, nextView?: WorkspaceView) => {
      dispatch({
        type: "lesson.selected",
        lessonId,
        ...(nextView ? { view: nextView } : {}),
      });
    },
    [],
  );
  const openBuilder = useCallback((section: CourseBuilderSection) => {
    dispatch({ type: "builder.section", section });
  }, []);

  const refresh = useCallback(async () => {
    if (access.status !== "ready") return;
    try {
      setSnapshot(await getCourse(courseId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The course could not be loaded.",
      );
    } finally {
      dispatch({ type: "loading.finished" });
    }
  }, [access.status, courseId, setError, setSnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const realtime = useCourseRealtime(
    access.status === "ready" ? courseId : null,
    setSnapshot,
    () => void refresh(),
  );

  // Keating edits the course through the same API from a chat tab; refresh so
  // its work lands here without a reload.
  useEffect(() => {
    const onCourseUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ courseId?: string }>).detail;
      if (detail?.courseId === courseId) void refresh();
    };
    window.addEventListener("keating:course-updated", onCourseUpdated);
    return () =>
      window.removeEventListener("keating:course-updated", onCourseUpdated);
  }, [courseId, refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "palette.changed", open: true });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const course = snapshot?.course;
  const lessons = useMemo(
    () => (course ? allCourseLessons(course) : []),
    [course],
  );
  const activeLesson =
    lessons.find((lesson) => lesson.id === activeLessonId) ?? lessons[0];
  const activeModule = course?.modules.find((module) =>
    module.lessons.some((lesson) => lesson.id === activeLesson?.id),
  );
  const sharedNote = course?.sharedNotes.find(
    (note) => note.lessonId === activeLesson?.id,
  );
  const ownSubmission = course?.submissions.find(
    (submission) =>
      submission.lessonId === activeLesson?.id &&
      submission.accountId === snapshot?.viewer.accountId,
  );
  const threadCounts = useMemo(
    () => (course ? commentCounts(course.comments) : {}),
    [course],
  );

  useSeo({
    title: course ? `${course.title} — Keating Courses` : "Course — Keating",
    description: course?.description ?? "A collaborative Keating course.",
  });

  useEffect(() => {
    if (!activeLessonId && lessons[0])
      selectLesson(snapshot?.viewer.progress.activeLessonId ?? lessons[0].id);
  }, [
    activeLessonId,
    lessons,
    selectLesson,
    snapshot?.viewer.progress.activeLessonId,
  ]);
  useEffect(() => {
    dispatch({ type: "note.synced", noteText: sharedNote?.text ?? "" });
  }, [sharedNote?.id, sharedNote?.version]);
  useEffect(() => {
    dispatch({
      type: "answer.synced",
      answer: ownSubmission?.answer ?? "",
      shareAnswer: ownSubmission?.sharedWithPeers ?? false,
    });
  }, [ownSubmission?.id, ownSubmission?.version]);

  const mutate = useCallback<WorkspaceMutate>(
    async (operation, label) => {
      dispatch({ type: "saving.changed", label });
      dispatch({ type: "error.changed", message: "" });
      try {
        const result = await applyCourseOperation(operation);
        setSnapshot(result.snapshot);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The change could not be saved.",
        );
        if (cause instanceof CourseApiError && cause.status === 409)
          void refresh();
      } finally {
        dispatch({ type: "saving.changed", label: "" });
      }
    },
    [refresh, setError, setSnapshot],
  );

  const askKeating = useCallback(
    (ask: string) => {
      const params = new URLSearchParams(
        courseChatSearch(courseId, ask) as Record<string, string>,
      );
      window.open(`/chat?${params.toString()}`, "_blank", "noopener");
    },
    [courseId],
  );

  if (access.status !== "ready")
    return (
      <div className={s.page}>
        <CoursesAccessGate state={access} onRetry={retryAccess} />
      </div>
    );
  if (loading)
    return (
      <div className={s.page}>
        <p
          className={css({
            py: "8rem",
            textAlign: "center",
            color: "var(--ink-soft)",
          })}
        >
          Opening course desk…
        </p>
      </div>
    );
  if (!snapshot || !course)
    return (
      <div className={s.page}>
        <div
          className={css({
            mx: "auto",
            maxW: "42rem",
            px: "1rem",
            py: "6rem",
            textAlign: "center",
          })}
        >
          <h1 className={css({ fontFamily: "Georgia, serif", fontSize: "2rem" })}>
            Course unavailable
          </h1>
          <p className={css({ mt: "0.75rem", color: "var(--destructive)" })}>
            {error || "This course could not be loaded."}
          </p>
          <Link
            to="/courses"
            className={cx(
              s.button,
              css({ mt: "1.5rem", textDecoration: "none", color: "inherit" }),
            )}
          >
            <ArrowLeft size={15} /> Course library
          </Link>
        </div>
      </div>
    );

  const viewer = snapshot.viewer;
  const permissions = snapshot.permissions;
  const canBuild = permissions.canEditCourse || permissions.canEditDeck;
  const completed = activeLesson
    ? viewer.progress.completedLessonIds.includes(activeLesson.id)
    : false;
  const online = new Set(realtime.presentAccountIds);
  const networkStatus =
    realtime.status === "connected"
      ? (snapshot.network?.status ?? "connected")
      : realtime.status;

  const toggleReaction: ToggleReaction = (targetKind, targetId, emoji) => {
    void mutate(
      {
        id: newCourseOperationId(),
        courseId,
        baseRevision: course.revision,
        type: "reaction.toggle",
        targetKind,
        targetId,
        emoji,
      },
      `reaction-${targetId}-${emoji}`,
    );
  };

  const tabs: { id: WorkspaceView; label: string; icon: typeof BookUp }[] = [
    { id: "read", label: "Read", icon: FileText },
    { id: "discuss", label: "Discuss", icon: MessageSquareText },
    ...(permissions.canReview
      ? [
          {
            id: "review" as const,
            label: "Review",
            icon: ClipboardCheck,
          },
        ]
      : []),
    ...(canBuild
      ? [{ id: "build" as const, label: "Build", icon: Hammer }]
      : []),
  ];

  const openSearchResult = (result: CourseSearchResult) => {
    dispatch({ type: "palette.changed", open: false });
    switch (result.kind) {
      case "lesson":
        selectLesson(result.id, "read");
        return;
      case "module": {
        if (permissions.canEditCourse) {
          openBuilder("outline");
          return;
        }
        const firstLesson = course.modules.find(
          (module) => module.id === result.id,
        )?.lessons[0];
        if (firstLesson) selectLesson(firstLesson.id, "read");
        return;
      }
      case "document": {
        const material = course.materials.find((item) => item.id === result.id);
        if (material)
          window.open(
            material.url ?? courseMaterialUrl(course.id, material.id),
            "_blank",
            "noopener",
          );
        return;
      }
      case "comment": {
        dispatch({
          type: "discuss.channel",
          channel: result.lessonId ?? COURSE_CHANNEL,
        });
        if (result.lessonId) selectLesson(result.lessonId, "discuss");
        else dispatch({ type: "view.changed", view: "discuss" });
        return;
      }
      case "card":
        if (permissions.canEditDeck) openBuilder("cards");
        return;
      case "member":
        if (permissions.canEditCourse) openBuilder("access");
        return;
      default: {
        if (result.lessonId) {
          selectLesson(result.lessonId, "read");
          return;
        }
        if (permissions.canEditCourse)
          openBuilder(result.kind === "assignment" ? "assignments" : "artifacts");
      }
    }
  };

  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.topInner}>
          <div
            className={css({
              display: "flex",
              minW: 0,
              flex: 1,
              alignItems: "center",
              gap: "0.5rem",
            })}
          >
            <Link
              to="/courses"
              aria-label="Back to courses"
              className={css({
                display: "grid",
                h: "2rem",
                w: "2rem",
                flexShrink: 0,
                placeItems: "center",
                color: "inherit",
                _hover: { bg: "var(--course-wash, #ddebdd)" },
              })}
            >
              <ArrowLeft size={18} />
            </Link>
            <CourseSwitcher
              courseId={course.id}
              title={course.title}
              role={viewer.role}
            />
          </div>
          <div
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            })}
          >
            <button
              type="button"
              className={s.button}
              onClick={() => dispatch({ type: "palette.changed", open: true })}
              title="Search this course · ⌘K"
            >
              <Search size={14} />
              <span className={css({ display: { base: "none", md: "inline" } })}>
                Search
              </span>
              <kbd
                className={css({
                  display: { base: "none", lg: "inline" },
                  fontFamily: "var(--mono-display)",
                  fontSize: "0.6rem",
                  color: "var(--ink-soft)",
                })}
              >
                ⌘K
              </kbd>
            </button>
            <CourseAddMenu
              snapshot={snapshot}
              {...(activeLesson ? { activeLessonId: activeLesson.id } : {})}
              saving={saving}
              mutate={mutate}
              onSnapshot={setSnapshot}
              onError={setError}
              onOpenBuilder={openBuilder}
            />
            <Link
              to="/chat"
              search={courseChatSearch(course.id)}
              target="_blank"
              rel="noreferrer"
              aria-label="Work on this course with Keating"
              title="Work on this course with Keating"
              className={cx(
                s.button,
                css({ color: "inherit", textDecoration: "none" }),
              )}
            >
              <MessageSquareText size={15} />
              <span className={css({ display: { base: "none", sm: "inline" } })}>
                Keating
              </span>
            </Link>
            {permissions.canInvite && (
              <button
                type="button"
                className={s.button}
                onClick={() => dispatch({ type: "invite.changed", open: true })}
              >
                <Share2 size={15} />
                <span
                  className={css({ display: { base: "none", lg: "inline" } })}
                >
                  Invite
                </span>
              </button>
            )}
          </div>
        </div>
        <div className={s.tabRow}>
          <nav
            aria-label="Course views"
            className={css({
              display: "grid",
              w: "100%",
              minW: 0,
              flex: 1,
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "0.4rem",
              sm: {
                display: "flex",
                w: "auto",
                flexWrap: "wrap",
              },
            })}
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const current = view === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={current}
                  className={s.tab}
                  style={
                    current
                      ? {
                          borderBottomColor: "var(--course-green, #1e9b50)",
                          color: "var(--ink)",
                        }
                      : undefined
                  }
                  onClick={() =>
                    dispatch({ type: "view.changed", view: tab.id })
                  }
                >
                  <Icon size={13} /> {tab.label}
                  {tab.id === "discuss" && course.comments.length ? (
                    <span className={courseCountChipClass}>
                      {course.comments.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <span
            className={css({
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontFamily: "var(--mono-display)",
              fontSize: "0.63rem",
              color:
                networkStatus === "connected"
                  ? "var(--course-green-dark, #14743c)"
                  : "var(--amber, #e8a33d)",
            })}
          >
            {saving ? (
              <span className={css({ color: "var(--ink-soft)" })}>saving…</span>
            ) : null}
            <span
              className={css({
                h: "0.45rem",
                w: "0.45rem",
                borderRadius: "50%",
                bg: "currentColor",
              })}
            />
            {networkStatus}
          </span>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className={css({
            position: "sticky",
            top: "88px",
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            borderBottom: "1px solid var(--destructive)",
            bg: "#f8e4de",
            px: "1rem",
            py: "0.6rem",
            color: "#7d2b1d",
          })}
        >
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      {viewer.teacherAccess === "requested" && (
        <div
          className={css({
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            borderBottom: "2px solid var(--ink)",
            bg: "#fff0d4",
            px: "1rem",
            py: "0.75rem",
            fontSize: "0.82rem",
          })}
        >
          <strong>
            Your teacher requested full access to current and future course work.
          </strong>
          <button
            type="button"
            className={cx(s.button, s.primaryButton)}
            onClick={() =>
              void mutate(
                {
                  id: newCourseOperationId(),
                  courseId,
                  baseRevision: course.revision,
                  type: "teacher-access.respond",
                  approve: true,
                },
                "access",
              )
            }
          >
            Approve once
          </button>
          <button
            type="button"
            className={s.button}
            onClick={() =>
              void mutate(
                {
                  id: newCourseOperationId(),
                  courseId,
                  baseRevision: course.revision,
                  type: "teacher-access.respond",
                  approve: false,
                },
                "access",
              )
            }
          >
            Keep private
          </button>
        </div>
      )}

      <div className={s.grid}>
        <aside className={s.left}>
          <div
            className={css({
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            })}
          >
            <p className={s.sectionLabel}>Course outline</p>
            {permissions.canEditCourse ? (
              <button
                type="button"
                className={css({
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  textDecoration: "underline",
                  cursor: "pointer",
                })}
                onClick={() => openBuilder("outline")}
              >
                edit
              </button>
            ) : null}
          </div>
          <div className={css({ mt: "0.75rem", display: "grid", gap: "1rem" })}>
            {course.modules.length ? (
              course.modules.map((module) => (
                <section key={module.id}>
                  <h2
                    className={css({
                      mb: "0.35rem",
                      fontSize: "0.75rem",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    })}
                  >
                    {module.title}
                  </h2>
                  <div className={css({ display: "grid", gap: "0.25rem" })}>
                    {module.lessons.map((lesson, index) => {
                      const done = viewer.progress.completedLessonIds.includes(
                        lesson.id,
                      );
                      const threads = threadCounts[lesson.id] ?? 0;
                      return (
                        <button
                          key={lesson.id}
                          type="button"
                          onClick={() =>
                            selectLesson(
                              lesson.id,
                              view === "build" || view === "review"
                                ? view
                                : "read",
                            )
                          }
                          className={css({
                            display: "grid",
                            gridTemplateColumns: "1.4rem minmax(0, 1fr) auto",
                            alignItems: "center",
                            gap: "0.45rem",
                            borderLeft: "3px solid transparent",
                            px: "0.4rem",
                            py: "0.5rem",
                            textAlign: "left",
                            cursor: "pointer",
                            _hover: { bg: "var(--card)" },
                          })}
                          style={
                            activeLesson?.id === lesson.id
                              ? {
                                  background: "var(--card)",
                                  borderLeftColor: "var(--course-green)",
                                }
                              : undefined
                          }
                        >
                          <span
                            className={css({
                              display: "grid",
                              h: "1.25rem",
                              w: "1.25rem",
                              placeItems: "center",
                              borderRadius: "50%",
                              bg: done ? "var(--course-green)" : "transparent",
                              color: done ? "white" : "var(--ink-soft)",
                              fontSize: "0.7rem",
                            })}
                          >
                            {done ? <Check size={12} /> : index + 1}
                          </span>
                          <span
                            className={css({
                              fontSize: "0.78rem",
                              lineHeight: 1.35,
                            })}
                          >
                            {lesson.title}
                          </span>
                          {threads ? (
                            <span
                              className={courseCountChipClass}
                              title={`${threads} comments`}
                            >
                              {threads}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    {module.lessons.length ? null : (
                      <p
                        className={css({
                          fontSize: "0.72rem",
                          color: "var(--ink-soft)",
                        })}
                      >
                        No lessons yet
                      </p>
                    )}
                  </div>
                </section>
              ))
            ) : (
              <p className={courseEmptyClass}>
                No modules yet. A blank course is valid — add the outline when it
                is clear.
              </p>
            )}
          </div>

          <div
            className={css({
              mt: "1.25rem",
              display: "grid",
              gap: "0.15rem",
              borderTop: "1px solid var(--ink)",
              pt: "0.85rem",
            })}
          >
            <p className={cx(s.sectionLabel, css({ mb: "0.35rem" }))}>
              Course shelf
            </p>
            <ShelfRow
              icon={FileText}
              label="Documents"
              count={course.materials.length}
              onClick={
                permissions.canEditCourse
                  ? () => openBuilder("documents")
                  : undefined
              }
            />
            <ShelfRow
              icon={BookUp}
              label="Assignments"
              count={course.assignments.length}
              onClick={
                permissions.canEditCourse
                  ? () => openBuilder("assignments")
                  : undefined
              }
            />
            <ShelfRow
              icon={Shapes}
              label="Artifacts"
              count={course.artifacts.length}
              onClick={
                permissions.canEditCourse
                  ? () => openBuilder("artifacts")
                  : undefined
              }
            />
            <ShelfRow
              icon={CreditCard}
              label="Cards"
              count={course.cards.length}
              onClick={
                permissions.canEditDeck ? () => openBuilder("cards") : undefined
              }
            />
            <ShelfRow
              icon={MessageSquareText}
              label="Course thread"
              count={threadCounts.course ?? 0}
              onClick={() => {
                dispatch({ type: "discuss.channel", channel: COURSE_CHANNEL });
                dispatch({ type: "view.changed", view: "discuss" });
              }}
            />
          </div>
        </aside>

        <main className={s.center}>
          {view === "read" ? (
            <DeskView
              snapshot={snapshot}
              {...(activeLesson ? { lesson: activeLesson } : {})}
              moduleTitle={activeModule?.title ?? "Course"}
              completed={completed}
              mutate={mutate}
              saving={saving}
              noteText={noteText}
              setNoteText={(value) =>
                dispatch({ type: "note.changed", value })
              }
              sharedNoteVersion={sharedNote?.version ?? 0}
              answer={answer}
              setAnswer={(value) => dispatch({ type: "answer.changed", value })}
              shareAnswer={shareAnswer}
              setShareAnswer={(value) =>
                dispatch({ type: "share-answer.changed", value })
              }
              threadCount={
                activeLesson ? (threadCounts[activeLesson.id] ?? 0) : 0
              }
              onSnapshot={setSnapshot}
              onError={setError}
              onToggleReaction={toggleReaction}
              onOpenBuilder={openBuilder}
              onDiscuss={() =>
                dispatch({ type: "view.changed", view: "discuss" })
              }
              onComplete={() =>
                activeLesson &&
                void mutate(
                  {
                    id: newCourseOperationId(),
                    courseId,
                    baseRevision: course.revision,
                    type: "lesson.complete",
                    lessonId: activeLesson.id,
                    completed: !completed,
                  },
                  "complete",
                )
              }
              onSaveNote={() =>
                activeLesson &&
                void mutate(
                  {
                    id: newCourseOperationId(),
                    courseId,
                    baseRevision: course.revision,
                    type: "shared-note.update",
                    noteId: sharedNote?.id ?? `note_${activeLesson.id}`,
                    lessonId: activeLesson.id,
                    title: `${activeLesson.title} notes`,
                    text: noteText,
                    baseVersion: sharedNote?.version ?? 0,
                  },
                  "note",
                )
              }
              onSaveAnswer={() =>
                activeLesson?.exercise &&
                void mutate(
                  {
                    id: newCourseOperationId(),
                    courseId,
                    baseRevision: course.revision,
                    type: "submission.save",
                    submissionId:
                      ownSubmission?.id ??
                      `submission_${crypto.randomUUID().replaceAll("-", "")}`,
                    lessonId: activeLesson.id,
                    exerciseId: activeLesson.exercise.id,
                    answer,
                    sharedWithPeers: shareAnswer,
                  },
                  "answer",
                )
              }
            />
          ) : null}
          {view === "discuss" ? (
            <CourseDiscussion
              snapshot={snapshot}
              channel={discussChannel}
              onChannelChange={(channel) =>
                dispatch({ type: "discuss.channel", channel })
              }
              saving={saving}
              mutate={mutate}
              onSelectLesson={(lessonId) => selectLesson(lessonId, "discuss")}
            />
          ) : null}
          {view === "review" && permissions.canReview ? (
            <CourseReviewPanel
              snapshot={snapshot}
              saving={saving}
              onReview={(submissionId, feedback) =>
                void mutate(
                  {
                    id: newCourseOperationId(),
                    courseId,
                    baseRevision: course.revision,
                    type: "submission.review",
                    submissionId,
                    status: "reviewed",
                    feedback,
                  },
                  "review",
                )
              }
              onAssignmentReview={(submissionId, feedback) =>
                void mutate(
                  {
                    id: newCourseOperationId(),
                    courseId,
                    baseRevision: course.revision,
                    type: "assignment.submission.review",
                    submissionId,
                    status: "reviewed",
                    feedback,
                  },
                  "assignment-review",
                )
              }
              onRequestAccess={(accountId) =>
                void mutate(
                  {
                    id: newCourseOperationId(),
                    courseId,
                    baseRevision: course.revision,
                    type: "teacher-access.request",
                    memberAccountId: accountId,
                  },
                  "access",
                )
              }
            />
          ) : null}
          {view === "build" && canBuild ? (
            <CourseBuilder
              snapshot={snapshot}
              {...(activeLesson ? { activeLesson } : {})}
              section={builderSection}
              saving={saving}
              onSectionChange={openBuilder}
              mutate={mutate}
              onSnapshot={setSnapshot}
              onSelectLesson={(lessonId) => selectLesson(lessonId)}
              onInvite={() => dispatch({ type: "invite.changed", open: true })}
              onError={setError}
            />
          ) : null}
        </main>

        <aside className={s.right}>
          <p className={s.sectionLabel}>Live room</p>
          <div className={css({ mt: "0.6rem", display: "grid", gap: "0.5rem" })}>
            {course.members.map((member) => (
              <div
                key={member.accountId}
                className={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "0.55rem",
                  fontSize: "0.78rem",
                })}
              >
                <span
                  className={css({
                    position: "relative",
                    display: "grid",
                    h: "1.75rem",
                    w: "1.75rem",
                    placeItems: "center",
                    borderRadius: "50%",
                    bg:
                      member.role === "teacher" || member.role === "owner"
                        ? "var(--course-green)"
                        : "var(--peer-blue, #3468b3)",
                    fontWeight: 800,
                    color: "white",
                  })}
                >
                  {member.displayName.charAt(0).toUpperCase()}
                  <span
                    className={css({
                      position: "absolute",
                      right: "-1px",
                      bottom: "-1px",
                      h: "0.5rem",
                      w: "0.5rem",
                      border: "1px solid var(--paper-deep)",
                      borderRadius: "50%",
                      bg: online.has(member.accountId)
                        ? "var(--phosphor, #4be388)"
                        : "#9ba19a",
                    })}
                  />
                </span>
                <span className={css({ minW: 0, flex: 1 })}>
                  <strong
                    className={css({
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    })}
                  >
                    {memberName(member, viewer.accountId)}
                  </strong>
                  <span
                    className={css({
                      fontSize: "0.67rem",
                      color: "var(--ink-soft)",
                      textTransform: "uppercase",
                    })}
                  >
                    {member.role}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <section
            className={css({
              mt: "1.25rem",
              borderTop: "1px solid var(--ink)",
              pt: "1rem",
            })}
          >
            <p className={s.sectionLabel}>Progress</p>
            <div
              className={css({
                mt: "0.6rem",
                h: "0.5rem",
                overflow: "hidden",
                border: "1px solid var(--ink)",
                bg: "var(--paper)",
              })}
            >
              <div
                style={{ width: `${courseCompletionPercent(course, viewer)}%` }}
                className={css({ h: "100%", bg: "var(--course-green)" })}
              />
            </div>
            <p
              className={css({
                mt: "0.35rem",
                fontFamily: "var(--mono-display)",
                fontSize: "0.67rem",
              })}
            >
              {courseCompletionPercent(course, viewer)}% complete
            </p>
          </section>
          <CourseKeatingPanel
            courseId={course.id}
            courseTitle={course.title}
            {...(activeLesson ? { activeLesson } : {})}
            view={view}
          />
          <section
            className={css({
              mt: "1.25rem",
              borderTop: "1px solid var(--ink)",
              pt: "1rem",
            })}
          >
            <p className={s.sectionLabel}>Recent activity</p>
            <div className={css({ mt: "0.6rem", display: "grid", gap: "0.65rem" })}>
              {course.activity.length ? (
                course.activity.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className={css({
                      display: "grid",
                      gridTemplateColumns: "0.5rem minmax(0, 1fr)",
                      gap: "0.5rem",
                      fontSize: "0.72rem",
                    })}
                  >
                    <span
                      className={css({
                        mt: "0.3rem",
                        h: "0.4rem",
                        w: "0.4rem",
                        borderRadius: "50%",
                        bg: "var(--course-green)",
                      })}
                    />
                    <span>
                      {item.message}
                      <small
                        className={css({
                          display: "block",
                          color: "var(--ink-soft)",
                        })}
                      >
                        {formatCourseRelative(item.createdAt)}
                      </small>
                    </span>
                  </div>
                ))
              ) : (
                <p className={css({ fontSize: "0.72rem", color: "var(--ink-soft)" })}>
                  Nothing has happened here yet.
                </p>
              )}
            </div>
          </section>
          {snapshot.network?.publicKey && (
            <details
              className={css({
                mt: "1rem",
                borderTop: "1px solid var(--ink)",
                pt: "0.75rem",
              })}
            >
              <summary
                className={css({
                  cursor: "pointer",
                  fontFamily: "var(--mono-display)",
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                })}
              >
                Pear feed
              </summary>
              <p
                className={css({
                  mt: "0.5rem",
                  overflowWrap: "anywhere",
                  fontFamily: "var(--mono-body)",
                  fontSize: "0.6rem",
                  color: "var(--ink-soft)",
                })}
              >
                {snapshot.network.publicKey}
              </p>
            </details>
          )}
        </aside>
      </div>
      {inviteOpen && (
        <CourseInviteDialog
          courseId={courseId}
          onClose={() => dispatch({ type: "invite.changed", open: false })}
        />
      )}
      {paletteOpen && (
        <CourseCommandPalette
          course={course}
          onClose={() => dispatch({ type: "palette.changed", open: false })}
          onSelect={openSearchResult}
          onAskKeating={(query) => {
            dispatch({ type: "palette.changed", open: false });
            askKeating(
              courseSearchAsk(query, {
                courseTitle: course.title,
                ...(activeLesson ? { lessonTitle: activeLesson.title } : {}),
              }),
            );
          }}
        />
      )}
    </div>
  );
}

function ShelfRow({
  icon: Icon,
  label,
  count,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  count: number;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={css({
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          fontSize: "0.76rem",
          fontWeight: 650,
        })}
      >
        <Icon size={14} /> {label}
      </span>
      <span
        className={css({
          fontFamily: "var(--mono-display)",
          fontSize: "0.68rem",
          color: "var(--ink-soft)",
        })}
      >
        {count}
      </span>
    </>
  );
  const layout = css({
    display: "flex",
    w: "100%",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    px: "0.25rem",
    py: "0.3rem",
    textAlign: "left",
  });
  if (!onClick) return <div className={layout}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        layout,
        css({ cursor: "pointer", _hover: { bg: "var(--card)" } }),
      )}
    >
      {body}
    </button>
  );
}

function CourseSourceCard({
  snapshot,
  material,
  onToggleReaction,
}: {
  snapshot: CourseViewerSnapshot;
  material: CourseMaterial;
  onToggleReaction: ToggleReaction;
}) {
  const href = material.url ?? courseMaterialUrl(snapshot.course.id, material.id);
  const reactions = (
    <CourseReactionBar
      reactions={snapshot.course.reactions}
      members={snapshot.course.members}
      targetKind="material"
      targetId={material.id}
      viewerAccountId={snapshot.viewer.accountId}
      disabled={!canReact(snapshot)}
      onToggle={(emoji) => onToggleReaction("material", material.id, emoji)}
    />
  );
  if (material.kind === "image")
    return (
      <figure className={css({ mt: "1rem" })}>
        <a href={href} target="_blank" rel="noreferrer">
          <img
            src={href}
            alt={material.description ?? material.title}
            loading="lazy"
            className={css({
              display: "block",
              maxH: "42rem",
              w: "100%",
              border: "1px solid var(--ink)",
              objectFit: "contain",
            })}
          />
        </a>
        <figcaption
          className={css({
            mt: "0.4rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            fontSize: "0.72rem",
            color: "var(--ink-soft)",
          })}
        >
          {material.title}
          {reactions}
        </figcaption>
      </figure>
    );
  return (
    <div
      className={css({
        mt: "0.75rem",
        border: "1px solid var(--ink)",
        bg: "var(--paper)",
      })}
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={css({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          px: "0.8rem",
          py: "0.7rem",
          color: "inherit",
          textDecoration: "none",
          _hover: { bg: "var(--course-wash, #ddebdd)" },
        })}
      >
        <span
          className={css({
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
          })}
        >
          {material.kind === "link" ? (
            <ExternalLink size={15} />
          ) : (
            <FileText size={15} />
          )}
          <span>
            <strong className={css({ display: "block", fontSize: "0.8rem" })}>
              {material.title}
            </strong>
            <small className={css({ color: "var(--ink-soft)" })}>
              {material.fileName ?? material.url ?? "Course document"}
            </small>
          </span>
        </span>
        <ExternalLink size={14} />
      </a>
      <div
        className={css({
          borderTop: "1px solid color-mix(in srgb, var(--ink) 20%, transparent)",
          px: "0.8rem",
          py: "0.4rem",
        })}
      >
        {reactions}
      </div>
    </div>
  );
}

function AssignmentSubmissionCard({
  snapshot,
  assignment,
  mutate,
  saving,
  onToggleReaction,
  courseWide = false,
}: {
  snapshot: CourseViewerSnapshot;
  assignment: CourseAssignment;
  mutate: WorkspaceMutate;
  saving: string;
  onToggleReaction: ToggleReaction;
  courseWide?: boolean;
}) {
  const submission = snapshot.course.assignmentSubmissions.find(
    (candidate) =>
      candidate.assignmentId === assignment.id &&
      candidate.accountId === snapshot.viewer.accountId,
  );
  const [answer, setAnswer] = useState(submission?.answer ?? "");
  const [share, setShare] = useState(submission?.sharedWithPeers ?? false);
  useEffect(() => {
    setAnswer(submission?.answer ?? "");
    setShare(submission?.sharedWithPeers ?? false);
  }, [submission?.id, submission?.version]);
  const save = (status: "draft" | "submitted") =>
    mutate(
      {
        id: newCourseOperationId(),
        courseId: snapshot.course.id,
        baseRevision: snapshot.course.revision,
        type: "assignment.submission.save",
        submissionId:
          submission?.id ??
          `assignment_submission_${crypto.randomUUID().replaceAll("-", "")}`,
        assignmentId: assignment.id,
        answer,
        status,
        sharedWithPeers: share,
        baseVersion: submission?.version ?? 0,
      },
      `assignment-submit-${assignment.id}`,
    );
  return (
    <section
      className={css({
        mt: "1.5rem",
        border: "2px solid var(--ink)",
        bg: "var(--paper)",
        boxShadow: `5px 5px 0 ${courseWide ? "var(--peer-blue, #3468b3)" : "var(--amber, #e8a33d)"}`,
      })}
    >
      <header
        className={css({
          borderBottom: "1px solid var(--ink)",
          bg: courseWide ? "#e3ebfa" : "#fff0d4",
          px: "1rem",
          py: "0.75rem",
        })}
      >
        <p className={s.sectionLabel}>
          {courseWide ? "Course assignment" : "Long-range assignment"}
          {submission ? ` · ${submission.status}` : ""}
        </p>
        <h3
          className={css({
            mt: "0.2rem",
            fontFamily: "Georgia, serif",
            fontSize: "1.45rem",
          })}
        >
          {assignment.title}
        </h3>
        <div
          className={css({
            mt: "0.35rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            fontSize: "0.7rem",
            color: "var(--ink-soft)",
          })}
        >
          {assignment.dueAt ? (
            <span>Due {new Date(assignment.dueAt).toLocaleString()}</span>
          ) : (
            <span>No fixed due date</span>
          )}
          {assignment.estimatedHours ? (
            <span>{assignment.estimatedHours} estimated hours</span>
          ) : null}
        </div>
      </header>
      <div className={css({ p: "1rem" })}>
        <p
          className={css({
            whiteSpace: "pre-wrap",
            fontFamily: "Georgia, serif",
            fontSize: "1rem",
            lineHeight: 1.65,
          })}
        >
          {assignment.brief}
        </p>
        {assignment.deliverables.length ? (
          <div className={css({ mt: "1rem" })}>
            <p className={s.sectionLabel}>Deliverables</p>
            <ul
              className={css({
                mt: "0.4rem",
                pl: "1.1rem",
                listStyle: "square",
                lineHeight: 1.6,
              })}
            >
              {assignment.deliverables.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {assignment.rubric.length ? (
          <details className={css({ mt: "0.9rem" })}>
            <summary
              className={css({
                cursor: "pointer",
                fontSize: "0.78rem",
                fontWeight: 750,
              })}
            >
              Review rubric
            </summary>
            <ul
              className={css({
                mt: "0.4rem",
                pl: "1.1rem",
                listStyle: "square",
                fontSize: "0.8rem",
                lineHeight: 1.6,
              })}
            >
              {assignment.rubric.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          rows={9}
          className={cx(
            s.input,
            css({ mt: "1rem", resize: "vertical", lineHeight: 1.55 }),
          )}
          placeholder="Keep the draft here as the work develops…"
        />
        <div
          className={css({
            mt: "0.7rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.6rem",
          })}
        >
          <label
            className={css({
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.72rem",
            })}
          >
            <input
              type="checkbox"
              checked={share}
              onChange={(event) => setShare(event.target.checked)}
            />
            Share submission with peers
          </label>
          <div className={css({ display: "flex", gap: "0.4rem" })}>
            <button
              type="button"
              className={s.button}
              disabled={saving === `assignment-submit-${assignment.id}`}
              onClick={() => void save("draft")}
            >
              Save draft
            </button>
            <button
              type="button"
              className={cx(s.button, s.primaryButton)}
              disabled={
                !answer.trim() || saving === `assignment-submit-${assignment.id}`
              }
              onClick={() => void save("submitted")}
            >
              <Send size={13} /> Submit
            </button>
          </div>
        </div>
        <div className={css({ mt: "0.7rem" })}>
          <CourseReactionBar
            reactions={snapshot.course.reactions}
            members={snapshot.course.members}
            targetKind="assignment"
            targetId={assignment.id}
            viewerAccountId={snapshot.viewer.accountId}
            disabled={!canReact(snapshot)}
            onToggle={(emoji) =>
              onToggleReaction("assignment", assignment.id, emoji)
            }
          />
        </div>
        {submission?.review ? (
          <div
            className={css({
              mt: "1rem",
              borderLeft: "3px solid var(--course-green)",
              bg: "var(--course-wash, #ddebdd)",
              p: "0.75rem",
            })}
          >
            <p className={s.sectionLabel}>
              Teacher review · {submission.review.status}
            </p>
            <p
              className={css({
                mt: "0.3rem",
                whiteSpace: "pre-wrap",
                fontSize: "0.8rem",
              })}
            >
              {submission.review.feedback || "Reviewed without a written note."}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ArtifactWithReactions({
  snapshot,
  artifact,
  onToggleReaction,
  courseWide = false,
}: {
  snapshot: CourseViewerSnapshot;
  artifact: CourseArtifact;
  onToggleReaction: ToggleReaction;
  courseWide?: boolean;
}) {
  return (
    <div>
      <CourseArtifactCard artifact={artifact} courseWide={courseWide} />
      <div className={css({ mt: "0.35rem" })}>
        <CourseReactionBar
          reactions={snapshot.course.reactions}
          members={snapshot.course.members}
          targetKind="artifact"
          targetId={artifact.id}
          viewerAccountId={snapshot.viewer.accountId}
          disabled={!canReact(snapshot)}
          onToggle={(emoji) => onToggleReaction("artifact", artifact.id, emoji)}
        />
      </div>
    </div>
  );
}

interface DeskViewProps {
  snapshot: CourseViewerSnapshot;
  lesson?: CourseLesson;
  moduleTitle: string;
  completed: boolean;
  mutate: WorkspaceMutate;
  saving: string;
  noteText: string;
  setNoteText(value: string): void;
  sharedNoteVersion: number;
  answer: string;
  setAnswer(value: string): void;
  shareAnswer: boolean;
  setShareAnswer(value: boolean): void;
  threadCount: number;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
  onToggleReaction: ToggleReaction;
  onOpenBuilder(section: CourseBuilderSection): void;
  onDiscuss(): void;
  onComplete(): void;
  onSaveNote(): void;
  onSaveAnswer(): void;
}

function DeskView(props: DeskViewProps) {
  const { snapshot, lesson } = props;
  const { course, permissions } = snapshot;
  const courseArtifacts = course.artifacts.filter(
    (artifact) => !artifact.lessonId,
  );
  const courseAssignments = course.assignments.filter(
    (assignment) => !assignment.lessonId,
  );
  const courseMaterials = course.materials.filter(
    (material) => !material.lessonId,
  );

  if (!lesson)
    return (
      <div className={css({ mx: "auto", maxW: "48rem" })}>
        <p className={s.sectionLabel}>Reading desk</p>
        <h2
          className={css({
            mt: "0.5rem",
            fontFamily: "Georgia, serif",
            fontSize: { base: "2.2rem", md: "3rem" },
            lineHeight: 1.03,
          })}
        >
          Nothing to read yet.
        </h2>
        <p
          className={css({
            mt: "0.9rem",
            maxW: "46ch",
            color: "var(--ink-soft)",
            lineHeight: 1.65,
          })}
        >
          This course has no lessons. That is a valid state — add documents,
          assignments, or cards first and shape the outline around them.
        </p>
        {permissions.canEditCourse ? (
          <div
            className={css({
              mt: "1.25rem",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
            })}
          >
            <button
              type="button"
              className={cx(s.button, s.primaryButton)}
              onClick={() => props.onOpenBuilder("outline")}
            >
              <Layers3 size={14} /> Build the outline
            </button>
            <CourseDocumentUploadButton
              courseId={course.id}
              onSnapshot={props.onSnapshot}
              onError={props.onError}
            />
          </div>
        ) : null}
        {courseMaterials.map((material) => (
          <CourseSourceCard
            key={material.id}
            snapshot={snapshot}
            material={material}
            onToggleReaction={props.onToggleReaction}
          />
        ))}
        {courseArtifacts.map((artifact) => (
          <ArtifactWithReactions
            key={artifact.id}
            snapshot={snapshot}
            artifact={artifact}
            onToggleReaction={props.onToggleReaction}
            courseWide
          />
        ))}
        {courseAssignments.map((assignment) => (
          <AssignmentSubmissionCard
            key={assignment.id}
            snapshot={snapshot}
            assignment={assignment}
            mutate={props.mutate}
            saving={props.saving}
            onToggleReaction={props.onToggleReaction}
            courseWide
          />
        ))}
      </div>
    );

  const lessonMaterials = course.materials.filter(
    (material) => material.lessonId === lesson.id,
  );
  const lessonArtifacts = course.artifacts.filter(
    (artifact) => artifact.lessonId === lesson.id,
  );
  const lessonAssignments = course.assignments.filter(
    (assignment) => assignment.lessonId === lesson.id,
  );

  return (
    <article className={css({ mx: "auto", maxW: "48rem" })}>
      <div
        className={css({
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        })}
      >
        <p className={s.sectionLabel}>
          {props.moduleTitle} ·{" "}
          {lesson.estimatedMinutes
            ? `${lesson.estimatedMinutes} min`
            : "self paced"}
        </p>
        <div className={css({ display: "flex", flexWrap: "wrap", gap: "0.35rem" })}>
          <button type="button" className={s.button} onClick={props.onDiscuss}>
            <MessageSquareText size={13} /> Discuss
            {props.threadCount ? ` · ${props.threadCount}` : ""}
          </button>
          {permissions.canEditCourse ? (
            <>
              <CourseDocumentUploadButton
                courseId={course.id}
                lessonId={lesson.id}
                onSnapshot={props.onSnapshot}
                onError={props.onError}
                label="Add document"
              />
              <button
                type="button"
                className={s.button}
                onClick={() => props.onOpenBuilder("lesson")}
              >
                <PenLine size={13} /> Edit
              </button>
            </>
          ) : null}
        </div>
      </div>
      <h2
        className={css({
          mt: "0.75rem",
          maxW: "18ch",
          fontFamily: "Georgia, serif",
          fontSize: { base: "2.35rem", md: "3.35rem" },
          lineHeight: 1.02,
          letterSpacing: "-0.035em",
        })}
      >
        {lesson.title}
      </h2>
      {lesson.summary ? (
        <p
          className={css({
            mt: "0.8rem",
            fontFamily: "Georgia, serif",
            fontSize: "1.15rem",
            fontStyle: "italic",
            color: "var(--ink-soft)",
          })}
        >
          {lesson.summary}
        </p>
      ) : null}
      {lesson.objectives.length > 0 && (
        <div
          className={css({
            mt: "1.5rem",
            borderLeft: "4px solid var(--course-green)",
            bg: "var(--course-wash, #ddebdd)",
            p: "1rem",
          })}
        >
          <p className={s.sectionLabel}>By the end</p>
          <ul
            className={css({
              mt: "0.5rem",
              pl: "1.1rem",
              lineHeight: 1.65,
              listStyle: "square",
            })}
          >
            {lesson.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </div>
      )}
      {lesson.reading.trim() ? (
        <div
          className={css({
            mt: "2rem",
            fontFamily: "Georgia, serif",
            fontSize: { base: "1.08rem", md: "1.17rem" },
            lineHeight: 1.85,
            "& p + p": { mt: "1.25rem" },
          })}
        >
          {lesson.reading.split(/\n\n+/).map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
        </div>
      ) : (
        <p className={cx(courseEmptyClass, css({ mt: "1.5rem" }))}>
          This lesson has no reading yet.
          {permissions.canEditCourse ? " Open Build → Lesson to write it." : ""}
        </p>
      )}
      {lessonMaterials.length ? (
        <section className={css({ mt: "2rem" })}>
          <p className={s.sectionLabel}>Lesson sources</p>
          {lessonMaterials.map((material) => (
            <CourseSourceCard
              key={material.id}
              snapshot={snapshot}
              material={material}
              onToggleReaction={props.onToggleReaction}
            />
          ))}
        </section>
      ) : null}
      {lessonArtifacts.map((artifact) => (
        <ArtifactWithReactions
          key={artifact.id}
          snapshot={snapshot}
          artifact={artifact}
          onToggleReaction={props.onToggleReaction}
        />
      ))}
      {lesson.exercise && (
        <section
          className={css({
            mt: "2.5rem",
            border: "2px solid var(--ink)",
            bg: "var(--paper)",
            boxShadow: "5px 5px 0 var(--amber, #e8a33d)",
          })}
        >
          <header
            className={css({
              borderBottom: "1px solid var(--ink)",
              px: "1rem",
              py: "0.65rem",
            })}
          >
            <p className={s.sectionLabel}>Worked exercise</p>
          </header>
          <div className={css({ p: "1rem" })}>
            <p
              className={css({
                fontFamily: "Georgia, serif",
                fontSize: "1.1rem",
                lineHeight: 1.6,
              })}
            >
              {lesson.exercise.prompt}
            </p>
            <textarea
              value={props.answer}
              onChange={(event) => props.setAnswer(event.target.value)}
              placeholder={lesson.exercise.placeholder}
              rows={7}
              className={cx(
                s.input,
                css({ mt: "1rem", resize: "vertical", lineHeight: 1.55 }),
              )}
            />
            <div
              className={css({
                mt: "0.75rem",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
              })}
            >
              <label
                className={css({
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  fontSize: "0.78rem",
                })}
              >
                <input
                  type="checkbox"
                  checked={props.shareAnswer}
                  onChange={(event) => props.setShareAnswer(event.target.checked)}
                />
                Share with peers
              </label>
              <button
                type="button"
                className={cx(s.button, s.primaryButton)}
                disabled={!props.answer.trim() || props.saving === "answer"}
                onClick={props.onSaveAnswer}
              >
                <Send size={14} />{" "}
                {props.saving === "answer" ? "Saving…" : "Save work"}
              </button>
            </div>
          </div>
        </section>
      )}
      {lessonAssignments.map((assignment) => (
        <AssignmentSubmissionCard
          key={assignment.id}
          snapshot={snapshot}
          assignment={assignment}
          mutate={props.mutate}
          saving={props.saving}
          onToggleReaction={props.onToggleReaction}
        />
      ))}
      {courseAssignments.length ? (
        <details
          className={css({
            mt: "2rem",
            borderTop: "2px solid var(--ink)",
            pt: "1rem",
          })}
        >
          <summary
            className={css({
              cursor: "pointer",
              fontFamily: "Georgia, serif",
              fontSize: "1.2rem",
              fontWeight: 700,
            })}
          >
            Course-wide assignments · {courseAssignments.length}
          </summary>
          {courseAssignments.map((assignment) => (
            <AssignmentSubmissionCard
              key={assignment.id}
              snapshot={snapshot}
              assignment={assignment}
              mutate={props.mutate}
              saving={props.saving}
              onToggleReaction={props.onToggleReaction}
              courseWide
            />
          ))}
        </details>
      ) : null}
      {courseArtifacts.length ? (
        <details
          className={css({
            mt: "2rem",
            borderTop: "2px solid var(--ink)",
            pt: "1rem",
          })}
        >
          <summary
            className={css({
              cursor: "pointer",
              fontFamily: "Georgia, serif",
              fontSize: "1.2rem",
              fontWeight: 700,
            })}
          >
            Course artifact shelf · {courseArtifacts.length}
          </summary>
          {courseArtifacts.map((artifact) => (
            <ArtifactWithReactions
              key={artifact.id}
              snapshot={snapshot}
              artifact={artifact}
              onToggleReaction={props.onToggleReaction}
              courseWide
            />
          ))}
        </details>
      ) : null}
      <section className={css({ mt: "2.5rem" })}>
        <div
          className={css({
            display: "flex",
            alignItems: "end",
            justifyContent: "space-between",
            gap: "1rem",
          })}
        >
          <div>
            <p className={s.sectionLabel}>
              Shared notes · version {props.sharedNoteVersion}
            </p>
            <h3
              className={css({
                mt: "0.25rem",
                fontFamily: "Georgia, serif",
                fontSize: "1.45rem",
              })}
            >
              The margin everyone can write in.
            </h3>
          </div>
          <StickyNote size={22} />
        </div>
        <textarea
          value={props.noteText}
          onChange={(event) => props.setNoteText(event.target.value)}
          rows={7}
          className={cx(
            s.input,
            css({
              mt: "0.8rem",
              resize: "vertical",
              bg: "#fff9dc",
              lineHeight: 1.55,
            }),
          )}
          placeholder="Add a definition, question, or useful example…"
        />
        <div
          className={css({
            mt: "0.65rem",
            display: "flex",
            justifyContent: "flex-end",
          })}
        >
          <button
            type="button"
            className={s.button}
            disabled={props.saving === "note"}
            onClick={props.onSaveNote}
          >
            {props.saving === "note" ? "Saving…" : "Save shared notes"}
          </button>
        </div>
      </section>
      <div
        className={css({
          mt: "2.5rem",
          display: "flex",
          justifyContent: "flex-end",
          borderTop: "1px solid var(--ink)",
          pt: "1rem",
        })}
      >
        <button
          type="button"
          className={cx(s.button, props.completed && s.primaryButton)}
          onClick={props.onComplete}
        >
          {props.completed ? <Check size={15} /> : <Circle size={15} />}
          {props.completed ? "Lesson complete" : "Mark complete"}
        </button>
      </div>
    </article>
  );
}
