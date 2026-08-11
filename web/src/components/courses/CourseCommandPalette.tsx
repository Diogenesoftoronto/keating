import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CreditCard,
  FileText,
  Layers3,
  MessageSquareText,
  Search,
  Shapes,
  Sparkles,
  StickyNote,
  Users,
  BookUp,
} from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import {
  COURSE_SEARCH_KIND_LABEL,
  searchCourse,
  type CourseSearchKind,
  type CourseSearchResult,
} from "../../courses/course-search";
import { allCourseLessons, type Course } from "../../courses/contracts";
import { courseLabelClass } from "./course-ui";

const KIND_ICON: Record<CourseSearchKind, typeof BookOpen> = {
  lesson: BookOpen,
  module: Layers3,
  document: FileText,
  artifact: Shapes,
  assignment: BookUp,
  card: CreditCard,
  comment: MessageSquareText,
  note: StickyNote,
  member: Users,
};

const rowClass = css({
  display: "grid",
  w: "100%",
  gridTemplateColumns: "1.4rem minmax(0, 1fr) auto",
  alignItems: "center",
  gap: "0.6rem",
  borderLeft: "3px solid transparent",
  px: "0.75rem",
  py: "0.55rem",
  textAlign: "left",
  cursor: "pointer",
});

const activeRowClass = css({
  borderLeftColor: "var(--course-green, #1e9b50)",
  bg: "var(--course-wash, #ddebdd)",
});

/**
 * One search box over everything a course holds, plus a hand-off to Keating
 * when the answer is not in the course yet.
 */
export function CourseCommandPalette({
  course,
  onClose,
  onSelect,
  onAskKeating,
}: {
  course: Course;
  onClose(): void;
  onSelect(result: CourseSearchResult): void;
  onAskKeating(query: string): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed) return searchCourse(course, trimmed, { limit: 24 });
    return allCourseLessons(course)
      .slice(0, 8)
      .map<CourseSearchResult>((lesson) => ({
        key: `lesson:${lesson.id}`,
        kind: "lesson",
        id: lesson.id,
        title: lesson.title,
        detail: lesson.summary || "Open this lesson",
        lessonId: lesson.id,
        score: 0,
      }));
  }, [course, query]);

  const askIndex = results.length;
  const optionCount = results.length + (query.trim() ? 1 : 0);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  const choose = (index: number) => {
    if (index === askIndex && query.trim()) {
      onAskKeating(query.trim());
      return;
    }
    const result = results[index];
    if (result) onSelect(result);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search this course"
      className={css({
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "flex",
        justifyContent: "center",
        bg: "color-mix(in srgb, var(--ink) 45%, transparent)",
        px: "1rem",
        pt: { base: "3rem", md: "6rem" },
      })}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={css({
          display: "flex",
          w: "100%",
          maxW: "40rem",
          maxH: "70vh",
          flexDir: "column",
          border: "2px solid var(--ink)",
          bg: "var(--card)",
          boxShadow: "8px 8px 0 color-mix(in srgb, var(--ink) 35%, transparent)",
        })}
      >
        <div
          className={css({
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            borderBottom: "2px solid var(--ink)",
            px: "0.85rem",
            py: "0.7rem",
          })}
        >
          <Search size={17} />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => (index + 1) % Math.max(optionCount, 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(
                  (index) =>
                    (index - 1 + Math.max(optionCount, 1)) %
                    Math.max(optionCount, 1),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(active);
              }
            }}
            placeholder="Search lessons, documents, artifacts, discussion…"
            aria-label="Search this course"
            className={css({
              w: "100%",
              bg: "transparent",
              fontSize: "0.95rem",
              color: "var(--ink)",
              outline: 0,
            })}
          />
          <kbd
            className={css({
              display: { base: "none", sm: "inline-block" },
              border: "1px solid color-mix(in srgb, var(--ink) 40%, transparent)",
              px: "0.35rem",
              fontFamily: "var(--mono-display)",
              fontSize: "0.6rem",
              color: "var(--ink-soft)",
            })}
          >
            ESC
          </kbd>
        </div>
        <div ref={listRef} className={css({ overflowY: "auto" })}>
          <p className={cx(courseLabelClass, css({ px: "0.85rem", pt: "0.7rem" }))}>
            {query.trim()
              ? `${results.length} result${results.length === 1 ? "" : "s"}`
              : "Jump to a lesson"}
          </p>
          <div className={css({ mt: "0.4rem", pb: "0.5rem" })}>
            {results.map((result, index) => {
              const Icon = KIND_ICON[result.kind];
              return (
                <button
                  key={result.key}
                  type="button"
                  data-active={index === active}
                  className={cx(rowClass, index === active && activeRowClass)}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  <Icon size={15} />
                  <span className={css({ minW: 0 })}>
                    <strong
                      className={css({
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: "0.85rem",
                      })}
                    >
                      {result.title}
                    </strong>
                    <small
                      className={css({
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--ink-soft)",
                      })}
                    >
                      {result.detail}
                    </small>
                  </span>
                  <span
                    className={css({
                      fontFamily: "var(--mono-display)",
                      fontSize: "0.58rem",
                      textTransform: "uppercase",
                      color: "var(--ink-soft)",
                    })}
                  >
                    {COURSE_SEARCH_KIND_LABEL[result.kind]}
                  </span>
                </button>
              );
            })}
            {query.trim() ? (
              <button
                type="button"
                data-active={active === askIndex}
                className={cx(rowClass, active === askIndex && activeRowClass)}
                onMouseEnter={() => setActive(askIndex)}
                onClick={() => choose(askIndex)}
              >
                <Sparkles size={15} />
                <span className={css({ minW: 0 })}>
                  <strong
                    className={css({ display: "block", fontSize: "0.85rem" })}
                  >
                    Ask Keating to search for “{query.trim()}”
                  </strong>
                  <small
                    className={css({ display: "block", color: "var(--ink-soft)" })}
                  >
                    Opens chat with the course loaded and the request ready to send
                  </small>
                </span>
                <span
                  className={css({
                    fontFamily: "var(--mono-display)",
                    fontSize: "0.58rem",
                    textTransform: "uppercase",
                    color: "var(--ink-soft)",
                  })}
                >
                  Keating
                </span>
              </button>
            ) : null}
            {query.trim() && !results.length ? (
              <p
                className={css({
                  px: "0.85rem",
                  py: "0.6rem",
                  fontSize: "0.78rem",
                  color: "var(--ink-soft)",
                })}
              >
                Nothing in this course matches yet.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
