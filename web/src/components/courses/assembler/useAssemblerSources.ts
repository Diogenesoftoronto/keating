/**
 * Loads the learner's saved plans, decks, and artifacts once on mount. A load
 * failure is reported but never blocks creating a blank course.
 */
import { useEffect, useState } from "react";
import {
  loadCourseAssemblySources,
  type CourseAssemblySources,
} from "../../../courses/course-assembly";

export function useAssemblerSources() {
  const [sources, setSources] = useState<CourseAssemblySources | null>(null);
  const [sourceError, setSourceError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadCourseAssemblySources()
      .then((value) => {
        if (!cancelled) setSources(value);
      })
      .catch((cause) => {
        if (!cancelled)
          setSourceError(
            cause instanceof Error
              ? cause.message
              : "Saved work could not be loaded.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { sources, sourceError };
}
