/**
 * Data lifecycle for the course workspace: loading the viewer snapshot,
 * keeping it fresh (realtime channel, and the `keating:course-updated` event
 * Keating dispatches after editing a course from chat), and applying
 * operations. All state changes go through the page's reducer `dispatch`.
 */
import { useCallback, useEffect, type Dispatch } from "react";
import {
  applyCourseOperation,
  CourseApiError,
  getCourse,
} from "../../courses/client";
import {
  normalizeCourseViewerSnapshot,
  type CourseViewerSnapshot,
} from "../../courses/contracts";
import { useCourseRealtime } from "../../courses/useCourseRealtime";
import type { CourseWorkspaceAction, WorkspaceMutate } from "./state";

export function useCourseWorkspaceData(
  courseId: string,
  accessReady: boolean,
  dispatch: Dispatch<CourseWorkspaceAction>,
) {
  const setSnapshot = useCallback(
    (next: CourseViewerSnapshot) => {
      dispatch({
        type: "snapshot.received",
        snapshot: normalizeCourseViewerSnapshot(next),
      });
    },
    [dispatch],
  );
  const setError = useCallback(
    (message: string) => {
      dispatch({ type: "error.changed", message });
    },
    [dispatch],
  );

  const refresh = useCallback(async () => {
    if (!accessReady) return;
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
  }, [accessReady, courseId, dispatch, setError, setSnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const realtime = useCourseRealtime(
    accessReady ? courseId : null,
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
    [dispatch, refresh, setError, setSnapshot],
  );

  return { realtime, mutate, refresh, setSnapshot, setError };
}
