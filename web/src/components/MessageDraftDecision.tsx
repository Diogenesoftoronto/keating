import { KeatingGlyph } from "../design-system/glyphs";
import { projectTeachingDraftSelection, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { css } from "../../styled-system/css";
import { describeTeachingCheck } from "../keating/judgement/check-descriptions";
import { DiagnosticHelp } from "./DiagnosticHelp";

const block = css({ display: "grid", gap: ".25rem", minWidth: 0, overflowWrap: "anywhere" });
const label = css({ display: "inline-flex", alignItems: "center", gap: ".125rem", fontSize: ".8125rem" });
const text = css({ fontSize: ".8125rem", lineHeight: 1.5 });
const traceToggle = css({ minHeight: "1.5rem", cursor: "pointer", fontSize: ".75rem", fontWeight: 600 });
const trace = css({ display: "grid", gap: ".375rem", paddingInlineStart: "1.125rem", fontSize: ".75rem" });
const traceMeta = css({ display: "block", color: "var(--muted-foreground)" });
const traceMark = css({
  fontWeight: 700, marginInlineEnd: ".375rem", color: "var(--muted-foreground)",
  "&[data-result=pass]": { color: "var(--green-deep)" },
  "&[data-result=fail], &[data-result=generation-error]": { color: "var(--destructive)" },
});
const attemptResults = { pass: "Passed review", fail: "Failed review", unknown: "Review inconclusive", "generation-error": "Generation failed" };
const attemptMarks = { pass: "check", fail: "x", unknown: "help", "generation-error": "x" } as const;

export function MessageDraftDecision({ snapshot }: { snapshot: TeachingDraftSnapshot }) {
  const selection = projectTeachingDraftSelection(snapshot);
  if (!selection) return null;
  const released = snapshot.attempts.find(attempt => attempt.attempt === selection.attempt)!;
  const flagged = snapshot.attempts.filter(attempt => attempt.attempt < released.attempt).flatMap(attempt =>
    attempt.checks.filter(check => check.status !== "pass").map(check => ({
      attempt: attempt.attempt,
      check,
      resolved: released.checks.some(result => result.id === check.id && result.status === "pass"),
    })),
  );
  const notable = flagged.find(entry => entry.resolved) ?? flagged[0];
  const selectionReason = selection.rule === "requested-prediction-over-prose"
    ? "Keating picked the draft with the requested prediction activity."
    : selection.rule === "presentation-only-checkpoint-retained"
      ? "Keating kept the checkpoint because the remaining issue was in its presentation."
      : undefined;
  const earlierSentence = notable ? `Draft ${notable.attempt} was flagged on “${describeTeachingCheck(notable.check.id).title}”. ` : "";
  const releaseSentence = selection.review === "best-effort"
    ? `Keating released draft ${released.attempt} as a best-effort reply.`
    : `${earlierSentence}Draft ${released.attempt} passed ${notable?.resolved && !snapshot.pairReviews ? "that check" : "review"} and was released.`;

  return <section className={block} aria-label="Why this reply?">
    <div className={label}><strong>Why this reply?</strong>
      <DiagnosticHelp term="why this reply" text="This summary uses the recorded draft reviews and release decision. If Keating recorded a specific selection rule, it appears here." />
    </div>
    <p className={text}>{releaseSentence}{selectionReason ? ` ${selectionReason}` : ""}</p>
    {snapshot.attempts.length > 1 && <details>
      <summary className={traceToggle}>Decision trail · {snapshot.attempts.length} drafts</summary>
      <ol className={trace}>
        {[...snapshot.attempts].sort((a, b) => a.attempt - b.attempt).map(attempt => {
          const checks = attempt.checks.filter(check => check.status !== "pass");
          return <li key={attempt.attempt}>
            <span className={traceMark} data-result={attempt.status} aria-hidden="true"><KeatingGlyph name={attemptMarks[attempt.status]} size={13} /></span>
            <strong>Draft {attempt.attempt}</strong> · {attemptResults[attempt.status]}
            {checks.length > 0 && <span className={traceMeta}>Flagged checks · {checks.map(check => describeTeachingCheck(check.id).title).join(", ")}</span>}
            {attempt.attempt === released.attempt && <span className={traceMeta}>Released in chat {selection.review === "best-effort" ? "as a best-effort reply" : "after passing review"}</span>}
          </li>;
        })}
      </ol>
    </details>}
  </section>;
}
