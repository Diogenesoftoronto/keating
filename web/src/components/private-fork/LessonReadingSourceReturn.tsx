import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { css } from "../../../styled-system/css";
import type { Course, CourseLesson } from "../../courses/contracts";
import { resolveLessonContext } from "../../pages/course-workspace/model";
import { roomStyles } from "../rooms/room-ui";

export function exactLessonReadingTarget(lessons: readonly CourseLesson[], lessonId: string): CourseLesson | undefined {
  const matches = lessons.filter((lesson) => lesson.id === lessonId);
  return matches.length === 1 ? matches[0] : undefined;
}

/** A source URL must identify one reading, never the first available lesson. */
export function lessonReadingSourceIssue(
  lessons: readonly CourseLesson[],
  lessonId: string,
  hash: string,
): string | undefined {
  const matches = lessons.filter((lesson) => lesson.id === lessonId);
  if (matches.length === 0) return "The linked lesson is unavailable. It may have been removed from this course.";
  if (matches.length > 1) return "The linked lesson cannot be identified uniquely in this course.";
  if (hash && hash.replace(/^#/, "") !== `lesson-reading-${lessonId}`) {
    return "This link does not identify the selected lesson reading.";
  }
  if (!matches[0]!.reading.trim()) return "The linked lesson reading is unavailable. This lesson has no reading now.";
  return undefined;
}

/** Keep URL source identity strict through both initial and realtime snapshots. */
export function resolveLessonReadingContext({
  course, lessons, activeLessonId, requestedLessonId, hash, viewerAccountId,
}: {
  course: Course | undefined;
  lessons: readonly CourseLesson[];
  activeLessonId: string;
  requestedLessonId: string | undefined;
  hash: string;
  viewerAccountId: string | undefined;
}) {
  const requested = requestedLessonId && activeLessonId === requestedLessonId ? requestedLessonId : undefined;
  const target = requested ? exactLessonReadingTarget(lessons, requested) : undefined;
  return {
    returningToSource: !!requested,
    sourceIssue: requested ? lessonReadingSourceIssue(lessons, requested, hash) : undefined,
    lesson: resolveLessonContext(course, requested ? (target ? [target] : []) : lessons, activeLessonId, viewerAccountId),
  };
}

/** Wait for the exact desk to mount; realtime refreshes must not reset scrolling. */
export function LessonReadingSourceReturn({
  lessonId, hash, ready,
}: { lessonId: string | undefined; hash: string; ready: boolean }) {
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !lessonId) return;
    const anchor = `lesson-reading-${lessonId}`;
    if (hash.replace(/^#/, "") !== anchor || revealed.current === anchor) return;
    const element = document.getElementById(anchor);
    if (!element) return;
    element.scrollIntoView({ block: "start", behavior: "instant" });
    element.focus({ preventScroll: true });
    revealed.current = anchor;
  }, [lessonId, hash, ready]);
  return null;
}

export function LessonReadingUnavailable({
  courseId, lessonId, message,
}: { courseId: string; lessonId: string; message: string }) {
  return (
    <section
      id={`lesson-reading-${lessonId}`}
      tabIndex={-1}
      aria-labelledby="lesson-reading-unavailable-title"
      className={css({ border: "1px solid var(--ink)", bg: "var(--paper)", p: "1rem", scrollMarginTop: "8rem" })}
    >
      <h2 id="lesson-reading-unavailable-title" className={roomStyles.heading}>Lesson reading unavailable</h2>
      <p role="status" className={roomStyles.help}>{message}</p>
      <p className={roomStyles.help}>Any excerpt saved in your private Chat remains there.</p>
      <Link
        to="/courses/$courseId"
        params={{ courseId }}
        search={{}}
        hash=""
        className={`${roomStyles.button} ${css({ mt: "0.75rem" })}`}
      >Browse course</Link>
    </section>
  );
}
