import { KeatingGlyph } from "../../design-system/glyphs";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import {
  courseAskActions,
  courseChatSearch,
  type CourseAskView,
} from "../../courses/course-ask";
import type { CourseLesson } from "../../courses/contracts";
import { Eyebrow, Note } from "../../design-system/kit";
import { formatCourseRelative } from "./course-ui";

interface CourseUpdatedDetail {
  courseId?: string;
  revision?: number;
  change?: string;
}

/**
 * Hand a specific request to Keating without losing the workspace. Links open
 * chat in a second tab, so edits Keating makes stream back into this view.
 */
export function CourseKeatingPanel({
  courseId,
  courseTitle,
  activeLesson,
  view,
}: {
  courseId: string;
  courseTitle: string;
  activeLesson?: CourseLesson;
  view: CourseAskView;
}) {
  const [lastChange, setLastChange] = useState<{
    change: string;
    at: string;
  } | null>(null);

  useEffect(() => {
    const onCourseUpdated = (event: Event) => {
      const detail = (event as CustomEvent<CourseUpdatedDetail>).detail;
      if (!detail || detail.courseId !== courseId || !detail.change) return;
      setLastChange({ change: detail.change, at: new Date().toISOString() });
    };
    window.addEventListener("keating:course-updated", onCourseUpdated);
    return () =>
      window.removeEventListener("keating:course-updated", onCourseUpdated);
  }, [courseId]);

  const actions = courseAskActions({
    courseTitle,
    ...(activeLesson
      ? { lessonTitle: activeLesson.title, lessonId: activeLesson.id }
      : {}),
    view,
  });
  const lessonActions = ["lesson-review", "lesson-practice", "lesson-sources"];
  const primary = activeLesson && (view === "read" || view === "build")
    ? lessonActions.flatMap(id => actions.filter(action => action.id === id))
    : actions.slice(0, 3);
  const actionLink = (action: (typeof actions)[number]) => (
    <Link key={action.id} to="/chat" search={courseChatSearch(courseId, action.prompt)}
      target="_blank" rel="noreferrer" title={action.description} className="cw-keating-link">
      {action.label}<KeatingGlyph name="ext" size={12} />
    </Link>
  );

  return <section className="cw-keating-actions">
    <Eyebrow muted>Work with Keating</Eyebrow>
    {primary.map(actionLink)}
    <details>
      <summary>More</summary>
      {actions.filter(action => !primary.includes(action)).map(actionLink)}
      <Link to="/chat" search={courseChatSearch(courseId)} className="cw-keating-link">
        Open the full conversation <KeatingGlyph name="message" size={12} />
      </Link>
    </details>
    {lastChange && <Note role="status">{lastChange.change} <small>Applied {formatCourseRelative(lastChange.at)}</small></Note>}
  </section>;
}
