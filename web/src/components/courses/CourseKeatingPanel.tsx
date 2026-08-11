import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, MessageSquareText, Sparkles } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import {
  courseAskActions,
  courseChatSearch,
  type CourseAskView,
} from "../../courses/course-ask";
import type { CourseLesson } from "../../courses/contracts";
import { courseLabelClass, formatCourseRelative } from "./course-ui";

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
  }).slice(0, 4);

  return (
    <section
      className={css({
        mt: "1.25rem",
        borderTop: "1px solid var(--ink)",
        pt: "1rem",
      })}
    >
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        })}
      >
        <p className={courseLabelClass}>Work with Keating</p>
        <Sparkles size={14} />
      </div>
      <div className={css({ mt: "0.6rem", display: "grid", gap: "0.35rem" })}>
        {actions.map((action) => (
          <Link
            key={action.id}
            to="/chat"
            search={courseChatSearch(courseId, action.prompt)}
            target="_blank"
            rel="noreferrer"
            className={css({
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 0.9rem",
              alignItems: "center",
              gap: "0.4rem",
              border: "1px solid var(--ink)",
              bg: "var(--card)",
              px: "0.55rem",
              py: "0.45rem",
              color: "inherit",
              textDecoration: "none",
              _hover: { bg: "var(--course-wash, #ddebdd)" },
            })}
          >
            <span className={css({ minW: 0 })}>
              <strong className={css({ display: "block", fontSize: "0.76rem" })}>
                {action.label}
              </strong>
              <small
                className={css({
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "0.66rem",
                  color: "var(--ink-soft)",
                })}
              >
                {action.description}
              </small>
            </span>
            <ArrowUpRight size={13} />
          </Link>
        ))}
      </div>
      <Link
        to="/chat"
        search={courseChatSearch(courseId)}
        className={cx(
          css({
            mt: "0.5rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            fontSize: "0.72rem",
            fontWeight: 700,
            color: "inherit",
            textDecoration: "underline",
          }),
        )}
      >
        <MessageSquareText size={13} /> Open the full conversation
      </Link>
      {lastChange ? (
        <p
          className={css({
            mt: "0.6rem",
            borderLeft: "3px solid var(--course-green)",
            bg: "var(--course-wash, #ddebdd)",
            px: "0.5rem",
            py: "0.4rem",
            fontSize: "0.7rem",
            lineHeight: 1.45,
          })}
        >
          {lastChange.change}
          <small
            className={css({ display: "block", color: "var(--ink-soft)" })}
          >
            Applied {formatCourseRelative(lastChange.at)}
          </small>
        </p>
      ) : null}
    </section>
  );
}
