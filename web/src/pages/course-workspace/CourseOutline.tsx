/**
 * Left rail of the course workspace: the module/lesson outline with progress
 * and comment-count badges, followed by the course shelf (documents,
 * assignments, artifacts, cards, course thread). Presentational only; the page
 * owns selection and navigation state and passes callbacks in.
 */
import { motion } from "motion/react";
import { SOFT, useMotionAllowed } from "../../design-system/motion";
import { Meter } from "../../design-system/charts";
import { EmptyState, Chip, Eyebrow } from "../../design-system/kit";
import { css } from "../../../styled-system/css";
import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";

import type { Course, CourseMember, CoursePermissions } from "../../courses/contracts";
import type { WorkspaceView } from "./state";
import { workspaceStyles as s } from "./styles";

export interface CourseOutlineProps {
  course: Course;
  viewer: Pick<CourseMember, "progress">;
  permissions: CoursePermissions;
  /** Comment counts keyed by lesson id, plus `course` for the course thread. */
  threadCounts: Record<string, number>;
  activeLessonId: string | undefined;
  view: WorkspaceView;
  onSelectLesson: (lessonId: string, view: WorkspaceView) => void;
  onOpenBuilder: (section: CourseBuilderSection) => void;
  onOpenCourseThread: () => void;
}

export function CourseOutline({
  course,
  viewer,
  permissions,
  threadCounts,
  activeLessonId,
  view,
  onSelectLesson,
  onOpenBuilder,
  onOpenCourseThread,
}: CourseOutlineProps) {
  const allowMotion = useMotionAllowed();
  const lessons = course.modules.flatMap((module) => module.lessons);
  const numbers = new Map(lessons.map((lesson, index) => [lesson.id, index + 1]));
  const completed = new Set(viewer.progress.completedLessonIds);
  const doneCount = lessons.filter((lesson) => completed.has(lesson.id)).length;
  return (
    <aside className={s.left}>
      <div
        className="cw-outline-head k-halftone"
      >
        <Eyebrow muted>Course outline</Eyebrow>
        <Chip>
          {doneCount}/{lessons.length}
        </Chip>
        {view !== "read" && permissions.canEditCourse ? (
          <button
            type="button"
            className={css({
              fontSize: "0.65rem",
              fontWeight: 700,
              textDecoration: "underline",
              cursor: "pointer",
            })}
            onClick={() => onOpenBuilder("outline")}
          >
            edit
          </button>
        ) : null}
      </div>
      <div className={css({ mt: "0.75rem", display: "grid", gap: "1rem" })}>
        {course.modules.length ? (
          course.modules.map((module, index) => (
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
                {index + 1} · {module.title}
              </h2>
              <div className={css({ display: "grid", gap: "0.25rem" })}>
                {module.lessons.map((lesson) => {
                  const done = completed.has(lesson.id);
                  const threads = threadCounts[lesson.id] ?? 0;
                  return (
                    <motion.button
                      key={lesson.id}
                      type="button"
                      className="cw-lesson-row"
                      initial={allowMotion ? { y: 5 } : false}
                      animate={{ y: 0 }}
                      transition={allowMotion ? SOFT : { duration: 0 }}
                      onClick={() =>
                        onSelectLesson(lesson.id, view === "build" || view === "review" ? view : "read")
                      }
                      aria-current={activeLessonId === lesson.id ? "page" : undefined}
                    >
                      <small>{numbers.get(lesson.id)}</small>
                      <Meter className="cw-step-meter" value={Number(done)} max={1}
                        label={done ? "Completed" : "Incomplete"} aria-valuetext={done ? "Completed" : "Incomplete"} />
                      <span>{lesson.title}</span>
                      {threads ? (
                        <span className="k-chip" aria-label={`${threads} unread comments`}>
                          {threads}
                        </span>
                      ) : null}
                    </motion.button>
                  );
                })}
                {module.lessons.length ? null : (
                  <EmptyState className="k-halftone" heading="No lessons yet" />
                )}
              </div>
            </section>
          ))
        ) : (
          <EmptyState className="k-halftone" heading="No modules yet.">A blank course is valid — add the outline when it is clear.</EmptyState>
        )}
      </div>

      <div className="cw-shelf">
        <Eyebrow muted>Course shelf</Eyebrow>
        <ShelfRow
          label="Documents"
          count={course.materials.length}
          onClick={view !== "read" && permissions.canEditCourse ? () => onOpenBuilder("documents") : undefined}
        />
        <ShelfRow
          label="Assignments"
          count={course.assignments.length}
          onClick={view !== "read" && permissions.canEditCourse ? () => onOpenBuilder("assignments") : undefined}
        />
        <ShelfRow
          label="Artifacts"
          count={course.artifacts.length}
          onClick={view !== "read" && permissions.canEditCourse ? () => onOpenBuilder("artifacts") : undefined}
        />
        <ShelfRow
          label="Cards"
          count={course.cards.length}
          onClick={view !== "read" && permissions.canEditDeck ? () => onOpenBuilder("cards") : undefined}
        />
        <ShelfRow label="Course thread" count={threadCounts.course ?? 0} onClick={onOpenCourseThread} />
      </div>
    </aside>
  );
}

function ShelfRow({ label, count, onClick }: { label: string; count: number; onClick?: () => void }) {
  const content = (
    <>
      {label} <span>{count}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div>{content}</div>
  );
}
