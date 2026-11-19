import { KeatingGlyph } from "../../design-system/glyphs";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { css } from "../../../styled-system/css";
import { listCourses } from "../../courses/client";
import type { CourseListItem } from "../../courses/contracts";
import { Chip, EmptyState, Loading, IconButton } from "../../design-system/kit";

const itemClass = css({
  display: "grid",
  w: "100%",
  gridTemplateColumns: "1rem minmax(0, 1fr)",
  alignItems: "center",
  gap: "0.5rem",
  px: "0.7rem",
  py: "0.5rem",
  color: "inherit",
  textAlign: "left",
  textDecoration: "none",
  _hover: { bg: "var(--course-wash, #ddebdd)" },
});

/** Move between course workspaces without going back to the library first. */
export function CourseSwitcher({
  courseId,
  title,
  role,
}: {
  courseId: string;
  title: string;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || state !== "idle" || courses.length) return;
    setState("loading");
    listCourses()
      .then((items) => {
        setCourses(items);
        setState("idle");
      })
      .catch(() => setState("error"));
  }, [courses.length, open, state]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); containerRef.current?.querySelector("button")?.focus(); }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? courses.filter((course) => course.title.toLowerCase().includes(needle))
    : courses;

  return (
    <div
      ref={containerRef}
      className={css({ position: "relative", minW: 0, maxW: "100%", flex: 1 })}
    >
      <div className="cw-switcher"><span>{title}</span><IconButton label="Switch course" glyph="chev" size="sm"
        aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)} /><Chip>{role}</Chip></div>
      {open ? (
        <div
          role="dialog" aria-label="Switch course" data-course-switcher
          className={css({
            position: "absolute",
            top: "calc(100% + 0.4rem)",
            left: 0,
            zIndex: 60,
            w: "min(22rem, calc(100vw - 2rem))",
            border: "1px solid var(--line)",
            bg: "var(--card)",
          })}
        >
          <div
            className={css({
              borderBottom: "1px solid var(--ink)",
              p: "0.5rem",
            })}
          >
            <input
              autoFocus
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Find a course…"
              aria-label="Find a course"
              className={css({
                w: "100%",
                border: "1px solid var(--ink)",
                bg: "var(--paper)",
                px: "0.5rem",
                py: "0.4rem",
                fontSize: "0.8rem",
                outline: 0,
              })}
            />
          </div>
          <div className={css({ maxH: "17rem", overflowY: "auto" })}>
            {state === "loading" ? (
              <Loading label="Loading your courses…" />
            ) : state === "error" ? (
              <p
                className={css({
                  px: "0.7rem",
                  py: "0.6rem",
                  fontSize: "0.78rem",
                  color: "var(--destructive)",
                })}
              >
                Your other courses could not be loaded.
              </p>
            ) : visible.length ? (
              visible.map((course) => (
                <Link
                  key={course.id}
                  to="/courses/$courseId"
                  params={{ courseId: course.id }}
                  className={itemClass}
                  onClick={() => setOpen(false)}
                >
                  {course.id === courseId ? (
                    <KeatingGlyph name="check" size={14} />
                  ) : (
                    <KeatingGlyph name="book" size={14} />
                  )}
                  <span className={css({ minW: 0 })}>
                    <strong className="cw-switcher-name">
                      {course.title}
                    </strong>
                    <small className={css({ color: "var(--ink-soft)" })}>
                      {course.lessonCount} lessons · {course.completedLessons} done
                      · {course.role}
                    </small>
                  </span>
                </Link>
              ))
            ) : (
              <EmptyState heading="No other course matches." />
            )}
          </div>
          <div className={css({ borderTop: "1px solid var(--ink)" })}>
            <Link
              to="/courses"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              <KeatingGlyph name="book" size={14} />
              <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                Course library
              </span>
            </Link>
            <Link
              to="/chat"
              search={{ courseMode: "create" }}
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              <KeatingGlyph name="plus" size={14} />
              <span className={css({ fontSize: "0.82rem", fontWeight: 700 })}>
                Plan a new course with Keating
              </span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
