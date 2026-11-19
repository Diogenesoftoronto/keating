import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";
import { TurnJudgementSummary, summarizeTurnJudgements } from "../components/TurnJudgementSummary";
import { DraftCheckHeatmap, ReplyReviewConfidence } from "../components/MessageDecisionVisuals";
import { DraftProgressCard } from "../components/DraftProgress";
import { MessageDraftDecision } from "../components/MessageDraftDecision";
import type { JudgementLabelRecord, TurnJudgementRecord } from "../keating/judgement/turn-records";

const snapshot = { phase: "released", attempt: 2, maxAttempts: 2, reasoning: "low", standard: "supported", elapsedMs: 1200, judgeModel: "jev", selectedAttempt: 2, reason: null,
  attempts: [1, 2].map(attempt => ({ attempt, reasoning: "low", standard: "supported", generationMs: 1, judgementMs: 1, status: attempt === 1 ? "fail" : "pass", variant: "default",
    checks: [{ id: "mastery_overclaimed", status: attempt === 1 ? "fail" : "pass", source: "jev", severity: "critical", probability: attempt === 1 ? 0.9 : 0.05 },
      { id: "nonempty_reply", status: "pass", source: "deterministic", severity: "critical", probability: 0 }] })) } as unknown as TeachingDraftSnapshot;
const record: Pick<TurnJudgementRecord, "replyReview" | "extraction" | "memory"> = {
  extraction: [{ role: "learner", status: "completed", items: [{ kind: "answer-step", messageId: "m", start: 0, end: 9, quote: "x = 2 + 3" }], reasons: [] }],
  memory: [{ candidate: { id: "c", evidence: "I study at night.", sessionId: "s", messageId: "m", message: "I study at night.", start: 0, end: 17 },
    accepted: false, reason: "below-threshold", category: "study-context", probability: 0.71, threshold: 0.9, backend: "system-one/jev", scope: "a", committed: true }],
};

test("a turn reads as one pipeline with plain-language checks", () => {
  expect(summarizeTurnJudgements({ draft: { snapshot }, record })).toBe("2 drafts · 1 flagged check · released draft 2 · 1 passage extracted · 0 of 1 memory admitted");
  const html = renderToStaticMarkup(<TurnJudgementSummary open draft={{ snapshot }} record={record} />);
  expect(html).toContain("Mastery overclaimed");
  expect(html).toContain("Reply is empty");
  expect(html).toContain("Learner reasoning step");
  expect(html).toContain("x = 2 + 3");
  expect(html).toContain("below the admission threshold");
  expect(html).toContain("(admits at ≥ 0.90)");
  // Read-only outside the review view.
  expect(html).not.toContain("Your verdict");
  expect(html).not.toContain("Admit to memory");
});

test("the review view adds verdict and memory controls and shows the reviewer's decision", () => {
  const labels: JudgementLabelRecord[] = [{ id: "l", sessionId: "s", assistantTimestamp: 2, target: { kind: "memory-admission", candidateId: "c", scope: "a" },
    model: { probability: 0.71, accepted: false }, verdict: "admit", category: "study-context", effect: "pending-account", createdAt: 1, updatedAt: 1 }];
  const html = renderToStaticMarkup(<TurnJudgementSummary open draft={{ snapshot }} record={record}
    checkControls={{ labels, onLabel: () => {} }} memoryControls={{ labels, onLabel: () => {} }} />);
  expect(html).toContain("Your verdict");
  expect(html).toContain("You: admitted as study context.");
  expect(html).toContain("applies once you are signed in");
  expect(html).toContain("Remove from memory");
  expect(html).toContain("1 reviewer label");
});

test("learner messages show only their own extraction", () => {
  const html = renderToStaticMarkup(<TurnJudgementSummary role="learner" draft={{ snapshot }} record={record} />);
  expect(html).toContain("Extracted from this message");
  expect(html).not.toContain("Mastery overclaimed");
  expect(html).not.toContain("Memory admission");
});

test("the inline draft picker starts on a flagged draft and exposes the released draft as a button", () => {
  const html = renderToStaticMarkup(<TurnJudgementSummary embedded draft={{ snapshot }} />);
  expect(html).toContain('aria-label="Drafts"');
  expect(html).toMatch(/aria-pressed="true"[^>]*>Draft 1 · failed checks/);
  expect(html).toMatch(/aria-pressed="false"[^>]*>Draft 2 · released/);
  expect(html).toContain("Mastery overclaimed");
  expect(html).toMatch(/aria-expanded="false"[^>]*>Show 1 passed check/);
  expect(html).not.toContain('data-testid="turn-judgements"');
});

test("the draft heatmap distinguishes a missing record from an inconclusive result", () => {
  const heatmap = renderToStaticMarkup(<DraftCheckHeatmap snapshot={{
    ...snapshot,
    attempts: [
      snapshot.attempts[0]!,
      { ...snapshot.attempts[1]!, checks: [{ id: "mastery_overclaimed", source: "jev", status: "unknown", severity: "critical", probability: null }] },
    ],
  }} />);
  expect(heatmap).toContain("Draft check heatmap");
  expect(heatmap).toContain("Draft 1, Mastery overclaimed, Failed, 90% probability of violation");
  expect(heatmap).toContain('aria-label="Draft 2, Mastery overclaimed, Inconclusive"');
  expect(heatmap).toContain('aria-label="No check recorded"');
  expect(heatmap).toContain('aria-label="Draft 1, Reply is empty, Passed"');
  expect(heatmap).not.toContain("What changed between drafts");
});

test("draft comparison shows the direction of the released draft's risk change", () => {
  const chartFor = (before: number, after: number) => renderToStaticMarkup(<DraftCheckHeatmap snapshot={{
    ...snapshot,
    attempts: snapshot.attempts.map((attempt, index) => ({ ...attempt, checks: attempt.checks.map(check =>
      check.id === "mastery_overclaimed" ? { ...check, probability: index === 0 ? before : after } : check) })),
  }} />);
  const lower = chartFor(.88, .12);
  expect(lower).toContain("What changed between drafts");
  expect(lower).toContain("Lower is better");
  expect(lower).toMatch(/aria-label="Draft 1 · earlier estimated risk"[^>]*aria-valuenow="0.88"/);
  expect(lower).toContain("76 percentage points lower in the released draft");
  const higher = chartFor(.12, .88);
  expect(higher).toMatch(/aria-label="Draft 2 · released estimated risk"[^>]*aria-valuenow="0.88"/);
  expect(higher).toContain("76 percentage points higher in the released draft");
  expect(chartFor(.12, .12)).toContain("No change in estimated risk");
});

test("the confidence chart displays the returned choice and leaves absent confidence out", () => {
  const chart = renderToStaticMarkup(<ReplyReviewConfidence review={{
    backend: "local", model: "reviewer", calibrated: false,
    answers: [
      { id: "need", choice: "room_to_reason", confidence: 0.76, probabilities: [] },
      { id: "fit", choice: "unknown", confidence: Number.NaN, probabilities: [] },
    ],
  }} />);
  expect(chart).toContain("room to reason");
  expect(chart).toMatch(/aria-label="Learner need confidence"[^>]*aria-valuenow="0.76"/);
  expect(chart).toContain("Uncalibrated estimates");
  expect(chart).not.toContain("Response fit confidence");
});

test("review terms have individually named help controls and screen-reader descriptions", () => {
  const chart = renderToStaticMarkup(<ReplyReviewConfidence review={{
    backend: "local", model: "reviewer", calibrated: false,
    answers: ["move", "need", "fit"].map(id => ({ id, choice: "unknown", confidence: 0.65, probabilities: [] })),
  }} />);
  for (const term of ["Tutor move", "Learner need", "Response fit", "reply review confidence", "review calibration"]) {
    const describedBy = chart.split(`aria-label="Explain ${term}" aria-describedby="`)[1]?.split('"')[0];
    expect(describedBy).toBeTruthy();
    expect(chart).toContain(`hidden="" id="${describedBy}"`);
  }
  expect(chart).toContain("Overhelp means it gave too much away.");
  expect(chart).toContain("This review ran without a calibration table.");
});

test("the release summary uses recorded checks and preserves best-effort status", () => {
  const released = renderToStaticMarkup(<MessageDraftDecision snapshot={snapshot} />);
  expect(released).toContain("Draft 1 was flagged on “Mastery overclaimed”. Draft 2 passed that check and was released.");
  expect(released).toContain("Decision trail · 2 drafts");
  const bestEffort = renderToStaticMarkup(<MessageDraftDecision snapshot={{ ...snapshot, selectedAttempt: 1, reason: "best-effort-draft" }} />);
  expect(bestEffort).toContain("Keating released draft 1 as a best-effort reply.");
  expect(bestEffort).not.toContain("Draft 1 passed review");
  expect(renderToStaticMarkup(<MessageDraftDecision snapshot={{ ...snapshot, phase: "withheld", selectedAttempt: null }} />)).toBe("");
});

test("alternate reply answers retain the model's scores and the original selected label", () => {
  const chart = renderToStaticMarkup(<ReplyReviewConfidence review={{
    backend: "local", model: "reviewer", calibrated: false,
    answers: [{ id: "fit", choice: "appropriate", confidence: 0.86, probabilities: [
      { label: "overhelp", value: 0.14 }, { label: "appropriate", value: 0.86 }, { label: "unknown", value: NaN },
    ] }],
  }} />);
  expect(chart).toContain('aria-label="See other answers for Response fit"');
  expect(chart).toContain(" · selected");
  expect(chart).toMatch(/aria-label="Response fit: overhelp"[^>]*aria-valuenow="0.14"/);
  expect(chart).not.toContain("Response fit: unknown");
});

test("inline memory decisions show the recorded score and cutoff together", () => {
  const html = renderToStaticMarkup(<TurnJudgementSummary embedded record={record} />);
  expect(html).toContain("Worth remembering");
  expect(html).toContain("Cutoff (%) 90");
  expect(html).toMatch(/aria-label="Estimated worth remembering, cutoff 90%"[^>]*aria-valuenow="71"/);
});

test("draft progress reports stage completion, elapsed budget and the actual attempt count", () => {
  const html = renderToStaticMarkup(<DraftProgressCard status={{ id: 1, feedback: null,
    snapshot: { ...snapshot, phase: "checking", selectedAttempt: null, elapsedMs: 57000, maxAttempts: 3 } }} />);
  expect(html).toMatch(/aria-label="Completed draft stages"[^>]*aria-valuetext="2 of 4"/);
  expect(html).toMatch(/aria-label="Draft 2 of 3"[^>]*aria-valuenow="2"/);
  expect(html).toContain('aria-valuetext="57 of 90 seconds"');
});

test("the judgement summary exposes exact option probabilities as a table", () => {
  const html = renderToStaticMarkup(<TurnJudgementSummary record={{ ...record, replyReview: {
    backend: "local", model: "reviewer", calibrated: false,
    answers: [{ id: "fit", choice: "appropriate", confidence: .7, probabilities: [
      { label: "appropriate", value: .7 }, { label: "overhelp", value: .12 },
      { label: "underhelp", value: .13 }, { label: "other", value: .05 },
    ] }],
  } }} />);
  expect(html).toContain("Review option probabilities");
  expect(html).toMatch(/aria-label="Response fit: underhelp"[^>]*aria-valuenow="0.13"/);
  expect(html).toContain("<td>underhelp</td><td>0.13</td>");
});
