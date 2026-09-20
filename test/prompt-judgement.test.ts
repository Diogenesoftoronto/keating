import { expect, test } from "bun:test";
import { evaluatePromptRubric, promptRubricRequest, PROMPT_OBJECTIVES, PROMPT_MAX_CHARS } from "../shared/pedagogy/prompt-judgement.js";
import type { JudgementOutcome, JudgementRequest } from "../packages/learner-contracts/src/judgement/contracts.js";

const prompt = "Ask the learner to explain in their own words. Diagnose prerequisite gaps before teaching. Verify factual claims. Require retrieval without looking. Ask for transfer to another context. Continue only after the learner checkpoint.";
function answer(request: JudgementRequest): JudgementOutcome {
  return { ok: true, response: { backend: { backend: "fixture", model: "prompt-fixture-v1", calibrationSha256: null }, answers: Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    if (question.type === "score") return [key, { type: "score", score: 1.1, confidence: 0.8, probabilities: { "0": 0, "1": 0, "2": 0.7, "3": 0.3 }, legend: Object.fromEntries(question.criteria.map((level, index) => [String(index), level])) }];
    if (question.type !== "choice") throw new Error("unexpected primitive");
    const keys = Object.keys(question.criteria);
    return [key, { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((option, index) => [option, index === 0 ? 1 : 0])) }];
  })) } } as JudgementOutcome;
}

test("twelve atomic questions retain full input and project modal levels with exact evidence", async () => {
  let request!: JudgementRequest;
  const result = await evaluatePromptRubric(prompt, async (input) => { request = input; return answer(input); });
  expect(Object.keys(request.questions)).toHaveLength(12);
  expect(request.state).toMatchObject({ promptText: prompt });
  expect(result.source).toBe("proxy");
  expect(result.score).toBeCloseTo(200 / 3);
  expect(result.judgement.calibration).toBe("uncalibrated");
  expect(result.judgement.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  for (const key of PROMPT_OBJECTIVES) {
    expect(result.objectives[key]).toBe(2 / 3);
    const span = result.judgement.evidence[key]!;
    expect(prompt.slice(span.start, span.end)).toBe(span.quote);
  }
  expect(result.judgement.outcome).toEqual(answer(request));
  expect(result.feedback.join(" ")).toContain("human learning remains unmeasured");
});

test("whole-input and candidate budgets abstain without dispatching or clipping", async () => {
  let calls = 0;
  for (const oversized of ["x".repeat(PROMPT_MAX_CHARS + 1), "x".repeat(2_001)]) {
    expect(promptRubricRequest(oversized)).toBeNull();
    const result = await evaluatePromptRubric(oversized, async (input) => { calls++; return answer(input); });
    expect(result.source).toBe("heuristic");
    expect(result.judgement.reason).toBe("input-budget");
  }
  expect(calls).toBe(0);
});

test("many sentences group into exact contiguous spans without losing repeated or Unicode source text", async () => {
  const source = Array.from({ length: 181 }, (_, i) => `${i % 2 ? "Repeat this idea." : `Explain λ${i} in your own words.`}\n`).join("");
  const request = promptRubricRequest(source)!;
  expect(request).not.toBeNull();
  const state = request.state as { promptText: string; evidenceSpans: Record<string, { quote: string; start: number; end: number }> };
  expect(state.promptText).toBe(source);
  const spans = Object.values(state.evidenceSpans);
  expect(spans.length).toBeLessThanOrEqual(63);
  for (const span of spans) expect(source.slice(span.start, span.end)).toBe(span.quote);
  expect(spans.map(span => span.quote).join("").replace(/\s/g, "")).toBe(source.replace(/\s/g, ""));
  const result = await evaluatePromptRubric(source, async input => answer(input));
  expect(result.source).toBe("proxy");
  for (const evidence of Object.values(result.judgement.evidence)) expect(source.slice(evidence.start, evidence.end)).toBe(evidence.quote);
});

for (const problem of ["bimodal", "missing-evidence", "bad-legend", "missing-level", "choice-not-mode", "alias", "low-confidence"] as const) {
  test(`${problem} preserves raw receipt but never supplies a typed score`, async () => {
    const result = await evaluatePromptRubric(prompt, async (input) => {
      const result = answer(input); if (!result.ok) return result;
      const score = result.response.answers["score:diagnosis"];
      const evidence = result.response.answers["evidence:diagnosis"];
      if (score?.type !== "score" || evidence?.type !== "choice") throw new Error("fixture");
      if (problem === "bimodal") Object.assign(score, { probabilities: { "0": 0.5, "1": 0, "2": 0, "3": 0.5 } });
      if (problem === "missing-evidence") delete result.response.answers["evidence:diagnosis"];
      if (problem === "bad-legend") Object.assign(score, { legend: { ...score.legend, "2": "invented" } });
      if (problem === "missing-level") Object.assign(score, { probabilities: { "2": 1 } });
      if (problem === "choice-not-mode") Object.assign(evidence, { probabilities: Object.fromEntries(Object.keys(evidence.probabilities).map((key, index) => [key, index === 0 ? 0.4 : index === 1 ? 0.6 : 0])) });
      if (problem === "alias") Object.assign(result.response, { backend: { ...result.response.backend, model: "jev-latest" } });
      if (problem === "low-confidence") Object.assign(score, { confidence: 0.1 });
      return result;
    });
    expect(result.source).toBe("heuristic");
    expect(result.score).toBe(result.baseline.score);
    expect(result.judgement.status).toBe("abstained");
    expect(result.judgement.outcome).not.toBeNull();
    expect(result.judgement.evidence).toEqual({});
  });
}

test("disabled, cancelled and throwing callers do not invent a judgement or reveal errors", async () => {
  expect((await evaluatePromptRubric(prompt, null)).judgement.status).toBe("not-requested");
  const cancelled = new AbortController(); cancelled.abort();
  const result = await evaluatePromptRubric(prompt, async () => { throw new Error("must not run"); }, cancelled.signal);
  expect(result.judgement.reason).toBe("cancelled");
  const failed = await evaluatePromptRubric(prompt, async () => { throw new Error("PRIVATE_PROVIDER_ERROR"); });
  expect(failed.judgement.status).toBe("unavailable");
  expect(JSON.stringify(failed)).not.toContain("PRIVATE_PROVIDER_ERROR");
});
