import { useMemo, useState } from "react";
import { ClipboardCheck, Users } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import {
  courseCompletionPercent,
  type CourseViewerSnapshot,
} from "../../courses/contracts";
import {
  courseButtonClass,
  courseEmptyClass,
  courseInputClass,
  courseLabelClass,
  coursePrimaryButtonClass,
  formatCourseRelative,
} from "./course-ui";

/** Teacher-side review: who is where, and what is waiting for feedback. */
export function CourseReviewPanel({
  snapshot,
  saving,
  onReview,
  onAssignmentReview,
  onRequestAccess,
}: {
  snapshot: CourseViewerSnapshot;
  saving: string;
  onReview(submissionId: string, feedback: string): void;
  onAssignmentReview(submissionId: string, feedback: string): void;
  onRequestAccess(accountId: string): void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingOnly, setPendingOnly] = useState(true);
  const { course } = snapshot;

  const lessons = useMemo(
    () => course.modules.flatMap((module) => module.lessons),
    [course.modules],
  );
  const learners = course.members.filter(
    (member) => member.role === "student" || member.role === "peer",
  );
  const submissions = pendingOnly
    ? course.submissions.filter(
        (submission) => submission.review?.status !== "reviewed",
      )
    : course.submissions;
  const assignmentSubmissions = pendingOnly
    ? course.assignmentSubmissions.filter(
        (submission) => submission.review?.status !== "reviewed",
      )
    : course.assignmentSubmissions;

  const learnerName = (accountId: string) =>
    course.members.find((member) => member.accountId === accountId)
      ?.displayName ?? "Learner";

  return (
    <div className={css({ mx: "auto", maxW: "52rem" })}>
      <div
        className={css({
          display: "flex",
          flexWrap: "wrap",
          alignItems: "end",
          justifyContent: "space-between",
          gap: "0.75rem",
        })}
      >
        <div>
          <p className={courseLabelClass}>Review</p>
          <h2
            className={css({
              mt: "0.3rem",
              fontFamily: "Georgia, serif",
              fontSize: { base: "1.9rem", md: "2.4rem" },
              lineHeight: 1.05,
            })}
          >
            Many learners, one clear view.
          </h2>
        </div>
        <label
          className={css({
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            fontSize: "0.76rem",
          })}
        >
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(event) => setPendingOnly(event.target.checked)}
          />
          Only work awaiting review
        </label>
      </div>

      <section className={css({ mt: "1.25rem" })}>
        <p
          className={cx(
            courseLabelClass,
            css({ display: "flex", alignItems: "center", gap: "0.35rem" }),
          )}
        >
          <Users size={13} /> Roster · {learners.length}
        </p>
        <div className={css({ mt: "0.5rem", overflowX: "auto" })}>
          <table
            className={css({
              w: "100%",
              borderCollapse: "collapse",
              fontSize: "0.78rem",
              "& th, & td": {
                borderBottom: "1px solid var(--ink)",
                px: "0.5rem",
                py: "0.6rem",
                textAlign: "left",
                whiteSpace: "nowrap",
              },
            })}
          >
            <thead>
              <tr>
                <th>Learner</th>
                <th>Progress</th>
                <th>Teacher access</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {learners.length ? (
                learners.map((member) => (
                  <tr key={member.accountId}>
                    <td>{member.displayName}</td>
                    <td>{courseCompletionPercent(course, member)}%</td>
                    <td>
                      {member.teacherAccess === "private" &&
                      snapshot.permissions.canRequestTeacherAccess ? (
                        <button
                          type="button"
                          className={courseButtonClass}
                          disabled={saving === "access"}
                          onClick={() => onRequestAccess(member.accountId)}
                        >
                          Request access
                        </button>
                      ) : (
                        member.teacherAccess
                      )}
                    </td>
                    <td>{formatCourseRelative(member.progress.lastActiveAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>No learners have joined yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={css({ mt: "1.75rem" })}>
        <p
          className={cx(
            courseLabelClass,
            css({ display: "flex", alignItems: "center", gap: "0.35rem" }),
          )}
        >
          <ClipboardCheck size={13} /> Lesson work · {submissions.length}
        </p>
        <div className={css({ mt: "0.6rem", display: "grid", gap: "0.7rem" })}>
          {submissions.length ? (
            submissions.map((submission) => {
              const feedback =
                drafts[submission.id] ?? submission.review?.feedback ?? "";
              return (
                <article
                  key={submission.id}
                  className={css({
                    borderLeft: "3px solid var(--course-green)",
                    bg: "var(--card)",
                    p: "0.8rem",
                  })}
                >
                  <div
                    className={css({
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      fontSize: "0.73rem",
                    })}
                  >
                    <strong>
                      {learnerName(submission.accountId)} ·{" "}
                      {lessons.find(
                        (lesson) => lesson.id === submission.lessonId,
                      )?.title ?? "Lesson"}
                    </strong>
                    <span className={css({ color: "var(--ink-soft)" })}>
                      {submission.review?.status ?? "needs review"} ·{" "}
                      {formatCourseRelative(submission.updatedAt)}
                    </span>
                  </div>
                  <p
                    className={css({
                      mt: "0.6rem",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.55,
                    })}
                  >
                    {submission.answer}
                  </p>
                  <textarea
                    rows={2}
                    value={feedback}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [submission.id]: event.target.value,
                      }))
                    }
                    className={cx(
                      courseInputClass,
                      css({ mt: "0.7rem", resize: "vertical" }),
                    )}
                    placeholder="What is working, then what is missing…"
                    aria-label={`Feedback for ${learnerName(submission.accountId)}`}
                  />
                  <div
                    className={css({
                      mt: "0.5rem",
                      display: "flex",
                      justifyContent: "flex-end",
                    })}
                  >
                    <button
                      type="button"
                      className={cx(courseButtonClass, coursePrimaryButtonClass)}
                      disabled={saving === "review"}
                      onClick={() => onReview(submission.id, feedback)}
                    >
                      Mark reviewed
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <p className={courseEmptyClass}>
              {pendingOnly
                ? "Nothing is waiting on you."
                : "Approved learner work appears here. Private work stays hidden until a learner grants access."}
            </p>
          )}
        </div>
      </section>

      <section className={css({ mt: "1.75rem" })}>
        <p className={courseLabelClass}>
          Assignment submissions · {assignmentSubmissions.length}
        </p>
        <div className={css({ mt: "0.6rem", display: "grid", gap: "0.7rem" })}>
          {assignmentSubmissions.length ? (
            assignmentSubmissions.map((submission) => {
              const feedback =
                drafts[submission.id] ?? submission.review?.feedback ?? "";
              return (
                <article
                  key={submission.id}
                  className={css({
                    borderLeft: "3px solid var(--peer-blue, #3468b3)",
                    bg: "var(--card)",
                    p: "0.8rem",
                  })}
                >
                  <div
                    className={css({
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      fontSize: "0.73rem",
                    })}
                  >
                    <strong>
                      {learnerName(submission.accountId)} ·{" "}
                      {course.assignments.find(
                        (assignment) => assignment.id === submission.assignmentId,
                      )?.title ?? "Assignment"}
                    </strong>
                    <span className={css({ color: "var(--ink-soft)" })}>
                      {submission.status} ·{" "}
                      {submission.review?.status ?? "needs review"}
                    </span>
                  </div>
                  <p
                    className={css({
                      mt: "0.6rem",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.55,
                    })}
                  >
                    {submission.answer}
                  </p>
                  <textarea
                    rows={3}
                    value={feedback}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [submission.id]: event.target.value,
                      }))
                    }
                    className={cx(
                      courseInputClass,
                      css({ mt: "0.7rem", resize: "vertical" }),
                    )}
                    placeholder="Assignment feedback…"
                    aria-label={`Feedback for ${learnerName(submission.accountId)}`}
                  />
                  <div
                    className={css({
                      mt: "0.5rem",
                      display: "flex",
                      justifyContent: "flex-end",
                    })}
                  >
                    <button
                      type="button"
                      className={cx(courseButtonClass, coursePrimaryButtonClass)}
                      disabled={saving === "assignment-review"}
                      onClick={() => onAssignmentReview(submission.id, feedback)}
                    >
                      Mark reviewed
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <p className={courseEmptyClass}>
              {pendingOnly
                ? "No assignment drafts are waiting."
                : "No assignment submissions yet."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
