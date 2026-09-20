import { expect, test } from "bun:test";
import { lessonPlanBlocks, reviewLessonPlan, lessonPlanReviewMarkdown, type LessonPlanReviewInput } from "../shared/pedagogy/lesson-plan-judgement.js";
import type { JudgementRequest, JudgementResponse } from "../packages/learner-contracts/src/judgement/contracts.js";

const backend = { backend: "system-one" as const, model: "jev-plan-test", calibrationSha256: null };
const input: LessonPlanReviewInput = { id: "plan-test", title: "Fractions", content: "# Fractions\nOutcome: Explain one half.\nRead: One half is one of two equal parts.\nTask: Draw equal parts and label one half." };
function response(request: JudgementRequest, verdict = "attention"): JudgementResponse {
  return { backend, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type !== "choice") throw Error("Expected Choice");
    const labels = Object.keys(question.criteria), selected = labels.includes("supported") ? verdict : labels[0];
    return [id, { type: "choice", choice: selected, confidence: 1, probabilities: Object.fromEntries(labels.map(label => [label, label === selected ? 1 : 0])) }];
  })), usage: { inputTokens: 12, outputTokens: 4 } };
}
test("plan review returns fixed actionable labels and exact source blocks with raw immutable attempts", async () => {
  let calls = 0;
  const result = await reviewLessonPlan(input, async request => { calls++; return { ok: true, response: response(request) }; }, { fresh: async () => ({ ...input }) });
  expect(calls).toBe(2); expect(result.status).toBe("estimated"); expect(result.findings).toHaveLength(5);
  expect(result.questionDigests).toHaveLength(2); expect(result.questionDigests[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(result.attempts[0]).toMatchObject({ ok: true, response: { usage: { inputTokens: 12 } } });
  expect(Object.isFrozen(result.attempts[0])).toBe(true);
  for (const finding of result.findings) expect(lessonPlanBlocks(input.content).find(block => block.id === finding.evidenceBlockId)?.text).toBe(input.content);
  const markdown = lessonPlanReviewMarkdown(input, result);
  expect(markdown).toContain("Uncalibrated reviewer suggestions"); expect(markdown).toContain("Connect each intended outcome"); expect(markdown).toContain("jev-plan-test");
});
test("full first request, Unicode and excessive source blocks abstain before dispatch; disabled remains unknown", async () => {
  let calls = 0; const call = async (request: JudgementRequest) => { calls++; return { ok: true as const, response: response(request) }; };
  for (const large of [{ ...input, title: "x".repeat(90_000) }, { ...input, content: "🧠".repeat(15_000) }, { ...input, content: "x".repeat(1800 * 64) }]) {
    expect(await reviewLessonPlan(large, call)).toMatchObject({ status: "unavailable", reason: "input-budget", findings: [] });
  }
  expect(await reviewLessonPlan(input, null)).toMatchObject({ status: "not-requested", reason: "disabled", findings: [] });
  expect(calls).toBe(0);
});
test("freshness and cancellation discard findings while preserving source-bound raw review history", async () => {
  for (const variation of ["stale", "cancelled"] as const) {
    const controller = new AbortController();
    const result = await reviewLessonPlan(input, async request => ({ ok: true, response: response(request) }), { signal: controller.signal, fresh: async () => {
      if (variation === "cancelled") controller.abort();
      return variation === "stale" ? { ...input, content: input.content + " Changed" } : input;
    } });
    expect(result).toMatchObject({ status: "unavailable", reason: variation, findings: [] }); expect(result.attempts).toHaveLength(2);
  }
});
test("invalid evidence cannot invent prose; malformed identities are retained as raw attempts but rejected", async () => {
  let calls = 0;
  const result = await reviewLessonPlan(input, async request => {
    const value = response(request), answers = { ...value.answers }; calls++;
    if (calls === 2) answers.objectives = { type: "choice", choice: "invented evidence", confidence: 1, probabilities: { "invented evidence": 1 } };
    return { ok: true, response: { ...value, answers } };
  });
  expect(result.findings[0]).toMatchObject({ verdict: "unknown", evidenceBlockId: null });
  expect(lessonPlanReviewMarkdown(input, result)).not.toContain("invented evidence");
  const invalid = await reviewLessonPlan(input, async request => ({ ok: true, response: { ...response(request), backend: { ...backend, model: "jev-latest" } } }));
  expect(invalid).toMatchObject({ status: "unavailable", reason: "invalid-response", findings: [] }); expect(invalid.attempts).toHaveLength(1);
});
test("unknown verdicts skip evidence batch and provider failure never becomes a passing review", async () => {
  let calls = 0;
  const unknown = await reviewLessonPlan(input, async request => { calls++; return { ok: true, response: response(request, "unknown") }; });
  expect(calls).toBe(1); expect(unknown.findings.every(finding => finding.verdict === "unknown")).toBe(true);
  const unavailable = await reviewLessonPlan(input, async () => ({ ok: false, error: { code: "backend-unavailable", retryable: false } }));
  expect(unavailable).toMatchObject({ status: "unavailable", reason: "backend-unavailable", findings: [] }); expect(unavailable.attempts).toHaveLength(1);
});
