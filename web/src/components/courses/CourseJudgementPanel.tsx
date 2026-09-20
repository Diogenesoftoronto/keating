import { useEffect, useState, useSyncExternalStore } from "react";
import { css } from "../../../styled-system/css";
import type { CourseViewerSnapshot } from "../../courses/contracts";
import { buildCourseAuthorSnapshot, clearCourseJudgement, courseReviewKey, queueCourseReview, readCourseJudgement, subscribeCourseJudgements,
  type CourseJudgementReceipt, type CourseJudgementSnapshot, type CourseReviewTarget, type ReviewUnavailable } from "../../courses/course-judgement";
import { buildCourseSubmissionSnapshot } from "../../courses/course-submission-judgement";
import { loadJudgementModelSettings, subscribeJudgementModelSettings } from "../../keating/judgement-model";
import { judgementAccountStatus } from "../../keating/judgement/public-account";
import { courseButtonClass, courseLabelClass } from "./course-ui";

const explanations: Record<ReviewUnavailable, string> = {
  permission: "Review is unavailable with your current course access.",
  "no-content": "Add the task and source text before requesting a review.",
  "unseen-work": "The submission contains only a link or attachment. Open and review that work yourself; its contents were not sent.",
  "too-large": "This course or submission exceeds the text review limit. No partial review was presented as a complete review.",
  unavailable: "Judgement is unavailable. Check the independent judgement model in Settings, or continue reviewing manually.",
  stale: "The source or access changed. Request a fresh review.",
  cancelled: "Review cancelled. You can continue manually.",
};

export function CourseJudgementDetails({ source, receipt }: { source: CourseJudgementSnapshot; receipt: CourseJudgementReceipt }) {
  if (receipt.sourceDigest !== source.sourceDigest) return null;
  return <div className={css({ mt: "0.7rem" })}>
    <p className={courseLabelClass}>Uncalibrated reviewer suggestions · {receipt.backend.backend} / {receipt.backend.model}</p>
    <p className={css({ fontSize: "0.73rem", mt: "0.3rem" })}>Review pointers, not verified facts. Only the supplied text was checked. Saved for this tab only.</p>
    {source.omitted.map(text => <p key={text} className={css({ fontSize: "0.73rem", mt: "0.3rem" })}>{text}</p>)}
    <ul className={css({ mt: "0.6rem", display: "grid", gap: "0.65rem", listStyle: "none", p: 0 })}>
      {receipt.findings.map(finding => {
        const criterion = source.criteria.find(item => item.id === finding.criterionId);
        const block = source.blocks.find(item => item.id === finding.evidenceBlockId);
        if (!criterion) return null;
        return <li key={criterion.id}>
          <strong>{criterion.label}: {finding.verdict === "attention" ? "check this" : finding.verdict === "supported" ? "appears supported" : "unknown"}</strong>
          {finding.verdict === "attention" && <p>{criterion.action}</p>}
          {finding.verdict === "unknown" && <p>Insufficient evidence for a suggestion.</p>}
          {block && <details className={css({ mt: "0.2rem" })}>
            <summary>Review source · {block.label}</summary>
            <code className={css({ fontSize: "0.65rem", overflowWrap: "anywhere" })}>{block.id}</code>
            <blockquote className={css({ whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderLeft: "2px solid var(--ink)", pl: "0.7rem", mt: "0.3rem" })}>{block.text}</blockquote>
          </details>}
        </li>;
      })}
    </ul>
    <p className={css({ mt: "0.6rem", fontSize: "0.72rem" })}>{source.target.kind === "author" ? "Edit and publish decisions remain yours." : "Write your own feedback below. Marking work reviewed remains a separate action."}</p>
  </div>;
}

/** Passive on mount: only a button or an explicit creation option starts inference. */
export function CourseJudgementPanel({ snapshot, target = { kind: "author" } }: { snapshot: CourseViewerSnapshot; target?: CourseReviewTarget }) {
  const key = courseReviewKey(snapshot, target);
  const state = useSyncExternalStore(subscribeCourseJudgements, () => readCourseJudgement(key), () => undefined);
  const [settings, setSettings] = useState(loadJudgementModelSettings);
  const [source, setSource] = useState<CourseJudgementSnapshot | null>(null);
  const permitted = target.kind === "author" ? snapshot.permissions.canEditCourse : snapshot.permissions.canReview;
  useEffect(() => subscribeJudgementModelSettings(next => { setSettings(next); clearCourseJudgement(key); }), [key]);
  useEffect(() => {
    let active = true;
    setSource(null);
    void (target.kind === "author" ? buildCourseAuthorSnapshot(snapshot) : buildCourseSubmissionSnapshot(snapshot, target)).then(next => {
      if (!active) return;
      const current = readCourseJudgement(key);
      const digest = current?.status === "ready" ? current.receipt.sourceDigest : current?.status === "pending" ? current.sourceDigest : undefined;
      if (next.unavailable || (digest && digest !== next.sourceDigest)) clearCourseJudgement(key);
      setSource(next);
    });
    return () => { active = false; };
  }, [snapshot, key]);
  useEffect(() => {
    const connected = judgementAccountStatus().connected;
    const check = () => { if (connected && !judgementAccountStatus().connected) clearCourseJudgement(key); };
    const timer = setInterval(check, 2000);
    window.addEventListener("focus", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); };
  }, [key]);
  if (!permitted) return null;
  const title = target.kind === "author" ? "Review course design" : "Review this submission";
  const reason = state?.status === "unavailable" ? state.reason : source?.unavailable;
  return <section aria-label={title} className={css({ my: "0.8rem", borderTop: "1px solid var(--ink)", pt: "0.7rem", fontSize: "0.78rem", lineHeight: 1.5 })}>
    <div className={css({ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" })}>
      <button type="button" className={courseButtonClass} disabled={settings.backend === "off" || state?.status === "pending" || !!source?.unavailable || !source}
        onClick={() => queueCourseReview(snapshot, target)}>{state?.status === "pending" ? "Reviewing…" : title}</button>
      {state?.status === "pending" && <button type="button" className={courseButtonClass} onClick={() => clearCourseJudgement(key)}>Cancel review</button>}
      <span>{settings.backend === "off" ? "Judgement is off in Settings." : settings.backend === "hosted" ? "This action may send the listed text to your configured hosted judgement service." : "Uses the independent local judgement model."}</span>
    </div>
    <p className={css({ mt: "0.3rem", fontSize: "0.72rem" })}>{target.kind === "author" ? "Checks saved objectives, teaching order, assessments, instructions and answer support. Unsaved edits are not included." : "Checks only this submitted answer against its task, rubric and reference reading. Attachments are not opened."}</p>
    {state?.status === "pending" && <p role="status">You can keep working while the suggestion is prepared.</p>}
    {reason && <p role="status">{explanations[reason]}</p>}
    {settings.backend !== "off" && source && state?.status === "ready" && <CourseJudgementDetails source={source} receipt={state.receipt} />}
  </section>;
}
