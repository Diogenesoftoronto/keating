/**
 * Left rail of the course workspace: the module/lesson outline with progress
 * and comment-count badges, followed by the course shelf (documents,
 * assignments, artifacts, cards, course thread). Presentational only; the page
 * owns selection and navigation state and passes callbacks in.
 */
import { BookUp, Check, CreditCard, FileText, MessageSquareText, Shapes } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";
import { courseCountChipClass, courseEmptyClass } from "../../components/courses/course-ui";
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
  return (
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
            onClick={() => onOpenBuilder("outline")}
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
                        onSelectLesson(
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
                      aria-current={activeLessonId === lesson.id ? "page" : undefined}
                      style={
                        activeLessonId === lesson.id
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
              ? () => onOpenBuilder("documents")
              : undefined
          }
        />
        <ShelfRow
          icon={BookUp}
          label="Assignments"
          count={course.assignments.length}
          onClick={
            permissions.canEditCourse
              ? () => onOpenBuilder("assignments")
              : undefined
          }
        />
        <ShelfRow
          icon={Shapes}
          label="Artifacts"
          count={course.artifacts.length}
          onClick={
            permissions.canEditCourse
              ? () => onOpenBuilder("artifacts")
              : undefined
          }
        />
        <ShelfRow
          icon={CreditCard}
          label="Cards"
          count={course.cards.length}
          onClick={
            permissions.canEditDeck ? () => onOpenBuilder("cards") : undefined
          }
        />
        <ShelfRow
          icon={MessageSquareText}
          label="Course thread"
          count={threadCounts.course ?? 0}
          onClick={onOpenCourseThread}
        />
      </div>
    </aside>
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
