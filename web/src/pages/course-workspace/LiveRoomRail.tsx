/**
 * Right rail of the course workspace: who is in the live room, the viewer's
 * progress, the Keating helper, recent activity, and (for Pear-backed courses)
 * the read-only feed key.
 */
import { css } from "../../../styled-system/css";
import { CourseKeatingPanel } from "../../components/courses/CourseKeatingPanel";
import { formatCourseRelative } from "../../components/courses/course-ui";
import {
  courseCompletionPercent,
  type CourseLesson,
  type CourseViewerSnapshot,
} from "../../courses/contracts";
import { memberName } from "./model";
import type { WorkspaceView } from "./state";
import { workspaceStyles as s } from "./styles";

export function LiveRoomRail({
  snapshot,
  onlineAccountIds,
  activeLesson,
  view,
}: {
  snapshot: CourseViewerSnapshot;
  onlineAccountIds: ReadonlySet<string>;
  activeLesson: CourseLesson | undefined;
  view: WorkspaceView;
}) {
  const { course, viewer } = snapshot;
  return (
        <aside className={s.right}>
          <p className={s.sectionLabel}>Live room</p>
          <div className={css({ mt: "0.6rem", display: "grid", gap: "0.5rem" })}>
            {course.members.map((member) => (
              <div
                key={member.accountId}
                className={css({
                  display: "flex",
                  alignItems: "center",
                  gap: "0.55rem",
                  fontSize: "0.78rem",
                })}
              >
                <span
                  className={css({
                    position: "relative",
                    display: "grid",
                    h: "1.75rem",
                    w: "1.75rem",
                    placeItems: "center",
                    borderRadius: "50%",
                    bg:
                      member.role === "teacher" || member.role === "owner"
                        ? "var(--course-green)"
                        : "var(--peer-blue, #3468b3)",
                    fontWeight: 800,
                    color: "white",
                  })}
                >
                  {member.displayName.charAt(0).toUpperCase()}
                  <span
                    className={css({
                      position: "absolute",
                      right: "-1px",
                      bottom: "-1px",
                      h: "0.5rem",
                      w: "0.5rem",
                      border: "1px solid var(--paper-deep)",
                      borderRadius: "50%",
                      bg: onlineAccountIds.has(member.accountId)
                        ? "var(--phosphor, #4be388)"
                        : "#9ba19a",
                    })}
                  />
                </span>
                <span className={css({ minW: 0, flex: 1 })}>
                  <strong
                    className={css({
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    })}
                  >
                    {memberName(member, viewer.accountId)}
                  </strong>
                  <span
                    className={css({
                      fontSize: "0.67rem",
                      color: "var(--ink-soft)",
                      textTransform: "uppercase",
                    })}
                  >
                    {member.role}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <section
            className={css({
              mt: "1.25rem",
              borderTop: "1px solid var(--ink)",
              pt: "1rem",
            })}
          >
            <p className={s.sectionLabel}>Progress</p>
            <div
              className={css({
                mt: "0.6rem",
                h: "0.5rem",
                overflow: "hidden",
                border: "1px solid var(--ink)",
                bg: "var(--paper)",
              })}
            >
              <div
                style={{ width: `${courseCompletionPercent(course, viewer)}%` }}
                className={css({ h: "100%", bg: "var(--course-green)" })}
              />
            </div>
            <p
              className={css({
                mt: "0.35rem",
                fontFamily: "var(--mono-display)",
                fontSize: "0.67rem",
              })}
            >
              {courseCompletionPercent(course, viewer)}% complete
            </p>
          </section>
          <CourseKeatingPanel
            courseId={course.id}
            courseTitle={course.title}
            {...(activeLesson ? { activeLesson } : {})}
            view={view}
          />
          <section
            className={css({
              mt: "1.25rem",
              borderTop: "1px solid var(--ink)",
              pt: "1rem",
            })}
          >
            <p className={s.sectionLabel}>Recent activity</p>
            <div className={css({ mt: "0.6rem", display: "grid", gap: "0.65rem" })}>
              {course.activity.length ? (
                course.activity.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className={css({
                      display: "grid",
                      gridTemplateColumns: "0.5rem minmax(0, 1fr)",
                      gap: "0.5rem",
                      fontSize: "0.72rem",
                    })}
                  >
                    <span
                      className={css({
                        mt: "0.3rem",
                        h: "0.4rem",
                        w: "0.4rem",
                        borderRadius: "50%",
                        bg: "var(--course-green)",
                      })}
                    />
                    <span>
                      {item.message}
                      <small
                        className={css({
                          display: "block",
                          color: "var(--ink-soft)",
                        })}
                      >
                        {formatCourseRelative(item.createdAt)}
                      </small>
                    </span>
                  </div>
                ))
              ) : (
                <p className={css({ fontSize: "0.72rem", color: "var(--ink-soft)" })}>
                  Nothing has happened here yet.
                </p>
              )}
            </div>
          </section>
          {snapshot.network?.publicKey && (
            <details
              className={css({
                mt: "1rem",
                borderTop: "1px solid var(--ink)",
                pt: "0.75rem",
              })}
            >
              <summary
                className={css({
                  cursor: "pointer",
                  fontFamily: "var(--mono-display)",
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                })}
              >
                Pear feed
              </summary>
              <p
                className={css({
                  mt: "0.5rem",
                  overflowWrap: "anywhere",
                  fontFamily: "var(--mono-body)",
                  fontSize: "0.6rem",
                  color: "var(--ink-soft)",
                })}
              >
                {snapshot.network.publicKey}
              </p>
            </details>
          )}
        </aside>
  );
}
