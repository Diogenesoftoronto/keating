import { Button, Card, Chip, Eyebrow, Field, EmptyState, Prose, StatusDot, TextArea } from "../../design-system/kit";
import { AttachmentLinks } from "../SubmissionAttachments";
import { CourseJudgementPanel } from "./CourseJudgementPanel";
import { useMemo, useState } from "react";
import { Meter } from "../../design-system/charts";
import "../../pages/course-workspace/course-tabs.css";
import {
  courseCompletionPercent,
  type CourseViewerSnapshot, type CourseSubmission, type CourseAssignmentSubmission,
} from "../../courses/contracts";
import { formatCourseRelative } from "./course-ui";

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

  function workCard(submission: CourseSubmission | CourseAssignmentSubmission) {
    const assignment = "assignmentId" in submission;
    const kind = assignment ? "assignment" : "lesson";
    const name = learnerName(submission.accountId);
    const context = assignment
      ? course.assignments.find(item => item.id === submission.assignmentId)?.title ?? "Assignment"
      : lessons.find(item => item.id === submission.lessonId)?.title ?? "Lesson";
    const feedback = drafts[submission.id] ?? submission.review?.feedback ?? "";
    const review = assignment ? onAssignmentReview : onReview;
    return (
      <Card as="article" key={submission.id} className="ct-work">
        <header className="ct-row k-halftone">
          <strong>{name} · {context}</strong>
          <Chip>{assignment && `${submission.status} · `}{submission.review?.status ?? "needs review"}</Chip>
          <small>{formatCourseRelative(submission.updatedAt)}</small>
        </header>
        <Prose className="ct-text">{submission.answer}</Prose>
        {assignment && !!submission.attachments?.length && <AttachmentLinks attachments={submission.attachments} courseId={course.id}/>}
        <CourseJudgementPanel snapshot={snapshot} target={{ kind, submissionId: submission.id }}/>
        <Field label={`Feedback for ${name}`}>
          <TextArea rows={assignment ? 3 : 2} value={feedback}
            onChange={event => setDrafts(current => ({ ...current, [submission.id]: event.target.value }))}
            placeholder={assignment ? "Assignment feedback…" : "What is working, then what is missing…"}/>
        </Field>
        <div className="ct-footer">
          <Button variant="primary" busy={saving === (assignment ? "assignment-review" : "review")}
            onClick={() => review(submission.id, feedback)}>Mark reviewed</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="ct-tab">
      <header className="ct-row k-halftone">
        <div><Eyebrow>Review</Eyebrow><h2>Many learners, one clear view.</h2></div>
        <label className="ct-filter">
          <input type="checkbox" checked={pendingOnly} onChange={event => setPendingOnly(event.target.checked)}/>
          Only work awaiting review
        </label>
      </header>
      <section className="ct-stack">
        <Eyebrow>Roster · {learners.length}</Eyebrow>
        {learners.length ? (
          <table className="ct-roster" aria-label="Learner roster" role="table">
            <thead role="rowgroup"><tr role="row">
              {["Learner", "Progress", "Teacher access", "Last active"].map(title => <th key={title} scope="col" role="columnheader">{title}</th>)}
            </tr></thead>
            <tbody role="rowgroup">{learners.map(member => {
              const progress = courseCompletionPercent(course, member);
              const access = member.teacherAccess;
              return <tr key={member.accountId} role="row">
                <th role="rowheader" scope="row">{member.displayName}</th>
                <td role="cell"><span className="ct-mobile-label" aria-hidden>Progress</span>
                  <Meter value={progress} max={100} label={`Progress for ${member.displayName}`} valueText={`${progress}%`}/>
                </td>
                <td role="cell"><span className="ct-mobile-label" aria-hidden>Teacher access</span>
                  <div className="ct-access"><StatusDot tone={access === "full" ? "ok" : access === "requested" ? "warn" : "idle"}/>
                    {access === "full" ? "Granted" : access === "requested" ? "Requested" : "Private"}
                    {access === "private" && snapshot.permissions.canRequestTeacherAccess &&
                      <Button variant="line" size="sm" busy={saving === "access"} onClick={() => onRequestAccess(member.accountId)}>Request access</Button>}
                  </div>
                </td>
                <td role="cell"><span className="ct-mobile-label" aria-hidden>Last active</span>{formatCourseRelative(member.progress.lastActiveAt)}</td>
              </tr>;
            })}</tbody>
          </table>
        ) : <EmptyState glyph="people" heading="No learners have joined yet." />}
      </section>
      <section className="ct-stack">
        <Eyebrow>Lesson work · {submissions.length}</Eyebrow>
        {submissions.length ? submissions.map(workCard) :
          <EmptyState className="cw-secondary-empty k-halftone" heading={pendingOnly ? "Nothing is waiting on you." : "Approved learner work appears here. Private work stays hidden until a learner grants access."} />}
      </section>
      <section className="ct-stack">
        <Eyebrow>Assignment submissions · {assignmentSubmissions.length}</Eyebrow>
        {assignmentSubmissions.length ? assignmentSubmissions.map(workCard) :
          <EmptyState className="cw-secondary-empty k-halftone" heading={pendingOnly ? "No assignment drafts are waiting." : "No assignment submissions yet."} />}
      </section>
    </div>
  );
}
