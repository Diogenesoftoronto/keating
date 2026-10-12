import { useState } from "react";
import { JudgementStateInspector } from "./JudgementStateInspector";
import type { TeachingDraftPhase, TeachingDraftSnapshot } from "@keating/learner-contracts";
import { css } from "../../styled-system/css";
import { recordTeachingDraftFeedback, teachingDraftIsActive, type TeachingDraftStatus, type TeachingDraftFeedbackKind } from "../keating/judgement/draft-status";

const muted = css({ color: "var(--muted-foreground)", fontSize: ".75rem", lineHeight: 1.5 });
const detail = css({ cursor: "pointer", fontSize: ".75rem", paddingBlock: ".5rem", _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });
const button = css({ border: "1px solid var(--border)", borderRadius: ".375rem", padding: ".4rem .65rem", fontSize: ".75rem", cursor: "pointer", "&[aria-pressed=true]": { background: "var(--muted)", borderColor: "var(--foreground)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" }, _disabled: { opacity: .6, cursor: "default" } });
const titles: Record<TeachingDraftPhase, string> = {
  planning: "Preparing your response", drafting: "Generating a response", checking: "Reviewing the completed response", revising: "Generating an improved response",
  selecting: "Choosing a response", released: "Response checked", withheld: "A response could not be approved", cancelled: "Draft cancelled",
};
const descriptions: Partial<Record<TeachingDraftPhase, string>> = {
  planning: "Choosing the amount of support this question needs.", drafting: "The model is still writing. Review starts after generation finishes.",
  checking: "Generation finished. Checking the complete response before choosing what to show.", revising: "The model is writing another response using the previous review.",
  selecting: "Choosing the best eligible response from the completed drafts.", cancelled: "The unfinished draft was discarded.",
};

function issues(snapshot: TeachingDraftSnapshot): string[] {
  const failed = snapshot.attempts.flatMap(attempt => attempt.checks.filter(check => check.status !== "pass").map(check => check.id));
  const groups = new Set<string>();
  for (const id of failed) {
    if (/source|citation|fact|tool_success|retention|transfer|mastery|efficacy/.test(id)) groups.add("Claims needed stronger evidence");
    else if (/checkpoint|activity|openui|practice|quiz|grading|schema/.test(id)) groups.add("An activity or tool needed correction");
    else if (/quality|explanation|answer|help|gap|context/.test(id)) groups.add("The response needed to address your request more directly");
    else groups.add("A teaching rule needed another check");
  }
  return [...groups];
}

export function DraftReviewStatus({ sessionId, status }: { sessionId: string; status: TeachingDraftStatus | null }) {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  if (!status) return null;
  const snapshot = status.snapshot;
  const active = teachingDraftIsActive(status);
  const canFeedback = snapshot.phase === "released" || snapshot.phase === "withheld";
  const notes = issues(snapshot);
  const reviewerUnavailable = snapshot.phase === "withheld" &&
    ["backend-unavailable", "backend-unauthorized", "review-unavailable"].includes(snapshot.reason ?? "");
  const reviewedCount = snapshot.attempts.filter(attempt => attempt.status !== "generation-error").length;
  const combining = snapshot.phase === "revising" && !!snapshot.synthesisSourceAttempts?.length;
  const bestEffort = snapshot.phase === "released" && snapshot.reason === "best-effort-draft";
  const description = snapshot.phase === "released"
    ? bestEffort ? "The best available response is shown. Some review concerns remain; you can flag a problem below."
      : `${reviewedCount} ${reviewedCount === 1 ? "draft reviewed" : "drafts reviewed"}. You can flag a missed problem below.`
    : snapshot.phase === "withheld"
      ? snapshot.reason === "unsupported-evidence" ? "The reviewer needs the attachment's text or a transcript. Send it in a new conversation to continue."
        : snapshot.reason === "backend-payment-required" ? "The review provider couldn't fund this review. Check your account credit and request spending limit, then retry."
        : snapshot.reason === "time-budget" ? "The review reached its time limit. Try a more focused request or another model."
        : reviewerUnavailable ? "The reviewer is unavailable. Set up a judgement model, then retry."
        : snapshot.attempts.length ? "The drafts did not pass all checks. Try a more focused request or another model."
        : "The reviewer is unavailable. Check the judgement model in Settings → Providers & Models, then retry."
      : combining ? "Combining the completed drafts into one coherent response. The merged response still awaits its own review."
      : descriptions[snapshot.phase];
  const feedback = (kind: TeachingDraftFeedbackKind) => recordTeachingDraftFeedback(sessionId, status.id, kind);
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(status, null, 2)); setCopiedId(status.id); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  return <section aria-label="Response review" className={css({ width: "100%", maxWidth: "56rem", marginInline: "auto", paddingBlock: ".75rem", minWidth: 0 })}>
    <div role="status" aria-live="polite" aria-atomic="true">
      <div className={css({ display: "flex", alignItems: "baseline", gap: ".75rem", flexWrap: "wrap" })}>
        <span className={css({ fontSize: ".8rem", fontWeight: 600 })}>{bestEffort ? "Best available response" : combining ? "Combining completed drafts" : titles[snapshot.phase]}</span>
        {active && snapshot.attempt > 0 && <span className={muted}>Attempt {snapshot.attempt} of {snapshot.maxAttempts}</span>}
      </div>
      <p className={muted}>{description}</p>
      {reviewerUnavailable &&
        <a href="/chat?settings=judgement" target="_blank" rel="noopener noreferrer" className={button}>Set up judgement model</a>}
    </div>
    {!active && snapshot.phase !== "cancelled" && <details>
      <summary className={detail}>About this review</summary>
      {notes.length > 0 && <><p className={muted}>During drafting:</p><ul className={muted}>{notes.map(note => <li key={note}>{note}</li>)}</ul></>}
      <p className={muted}>These checks can miss problems or reject a useful answer. Your feedback stays in this tab and is included if you copy the review.</p>
      {canFeedback && <div role="group" aria-label="Review feedback" className={css({ display: "flex", flexWrap: "wrap", gap: ".375rem", marginBlock: ".5rem" })}>
        <button className={button} type="button" aria-pressed={status.feedback === "helpful"} onClick={() => feedback("helpful")}>Helpful</button>
        <button className={button} type="button" aria-pressed={status.feedback === "too-strict"} onClick={() => feedback("too-strict")}>Too strict</button>
        <button className={button} type="button" aria-pressed={status.feedback === "missed-problem"} onClick={() => feedback("missed-problem")}>Missed a problem</button>
      </div>}
      {status.feedback && <p role="status" className={muted}>Feedback saved in this tab.</p>}
    </details>}
    <details>
        <summary className={detail}>Developer diagnostics</summary>
        <JudgementStateInspector snapshot={snapshot} />
        <p className={muted}>{snapshot.judgeModel ?? "No reviewer dispatched"} · {snapshot.reasoning} reasoning · {snapshot.standard} response · {(snapshot.elapsedMs / 1000).toFixed(1)} s</p>
        <p className={muted}>Uncalibrated probability estimates. Evidence and runtime checks determine eligibility; quality and teaching style guide revision and selection.</p>
        {snapshot.reason && <p className={muted}>Outcome: {snapshot.reason}</p>}
        {snapshot.synthesisSourceAttempts?.length ? <p className={muted}>Source attempts: {snapshot.synthesisSourceAttempts.join(", ")}</p> : null}
        {snapshot.attempts.map(attempt => <details key={attempt.attempt}>
          <summary className={detail}>{attempt.status === "generation-error" ? "Attempt" : "Draft"} {attempt.attempt} · {attempt.status} · {attempt.reasoning} reasoning</summary>
          <p className={muted}>Generation {Math.round(attempt.generationMs)} ms · review {Math.round(attempt.judgementMs)} ms</p>
          {attempt.synthesisSourceAttempts?.length ? <p className={muted}>Source attempts: {attempt.synthesisSourceAttempts.join(", ")}</p> : null}
          <div className={css({ overflowX: "auto", maxWidth: "100%" })}>
            <table className={css({ width: "100%", fontSize: ".7rem", textAlign: "left", borderCollapse: "collapse" })}>
              <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">P(violation)</th></tr></thead>
              <tbody>{attempt.checks.map(check => <tr key={check.id}><th scope="row" className={css({ fontWeight: 400, overflowWrap: "anywhere", paddingBlock: ".2rem" })}>{check.id}</th><td>{check.status}</td><td>{check.probability === null ? "Unknown" : check.probability.toFixed(3)}</td></tr>)}</tbody>
            </table>
          </div>
        </details>)}
        <button className={button} type="button" onClick={() => { void copy(); }}>{copiedId === status.id ? "Review copied" : "Copy review"}</button>
        {copyFailed && <p role="status" className={muted}>Clipboard access was unavailable.</p>}
    </details>
  </section>;
}
