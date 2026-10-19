/**
 * Navigation verbs for the workspace (select a lesson, open the builder, open
 * the course thread, run a command-palette navigation) plus the global ⌘K
 * shortcut. Everything funnels into the page reducer via `dispatch`.
 */
import { useCallback, useEffect, useMemo, type Dispatch } from "react";
import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";
import { COURSE_CHANNEL } from "../../components/courses/CourseDiscussion";
import type { WorkspaceNavigation } from "./search-navigation";
import type { CourseWorkspaceAction, WorkspaceView } from "./state";

export function useWorkspaceNavigation(
  dispatch: Dispatch<CourseWorkspaceAction>,
) {
  const selectLesson = useCallback(
    (lessonId: string, nextView?: WorkspaceView) => {
      dispatch({
        type: "lesson.selected",
        lessonId,
        ...(nextView ? { view: nextView } : {}),
      });
    },
    [dispatch],
  );
  const openBuilder = useCallback(
    (section: CourseBuilderSection) => {
      dispatch({ type: "builder.section", section });
    },
    [dispatch],
  );
  const openCourseThread = useCallback(() => {
    dispatch({ type: "discuss.channel", channel: COURSE_CHANNEL });
    dispatch({ type: "view.changed", view: "discuss" });
  }, [dispatch]);

  const navigate = useCallback(
    (step: WorkspaceNavigation) => {
      switch (step.kind) {
        case "lesson":
          selectLesson(step.lessonId, step.view);
          return;
        case "builder":
          openBuilder(step.section);
          return;
        case "url":
          window.open(step.url, "_blank", "noopener");
          return;
        case "discussion":
          dispatch({
            type: "discuss.channel",
            channel: step.lessonId ?? COURSE_CHANNEL,
          });
          if (step.lessonId) selectLesson(step.lessonId, "discuss");
          else dispatch({ type: "view.changed", view: "discuss" });
          return;
      }
    },
    [dispatch, openBuilder, selectLesson],
  );

  return useMemo(
    () => ({ selectLesson, openBuilder, openCourseThread, navigate }),
    [navigate, openBuilder, openCourseThread, selectLesson],
  );
}

/** ⌘K / Ctrl+K opens the course search palette from anywhere on the page. */
export function useCommandPaletteShortcut(
  dispatch: Dispatch<CourseWorkspaceAction>,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "palette.changed", open: true });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}
