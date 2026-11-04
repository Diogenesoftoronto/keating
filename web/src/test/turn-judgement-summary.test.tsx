import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";
import { TurnJudgementSummary, summarizeTurnJudgements } from "../components/TurnJudgementSummary";
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
