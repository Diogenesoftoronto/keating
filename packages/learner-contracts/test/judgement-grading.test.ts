import { expect, test } from "bun:test";
import {
  gradeOpenResponses,
  openResponseCalibration,
  type JudgementBackendKey,
  type JudgementCaller,
  type RouterPolicy,
} from "../src/judgement/index.js";

const backend: JudgementBackendKey = {
  backend: "fixture", model: "grading-fixture", calibrationSha256: "a".repeat(64),
};
const input = {
  id: "heat", question: "Why does twice the mass require twice the energy?",
  learnerAnswer: "The material and temperature rise stay fixed. Energy scales with mass.",
  rubric: "Identifies mass proportionality with material and temperature rise fixed.",
};

function policy(call: JudgementCaller): RouterPolicy {
  return { tiers: [{ key: backend, call }], calibration: openResponseCalibration(backend, [input]) };
}

test("shared grading batches rubric and evidence, preserving verbatim learner evidence", async () => {
  let calls = 0;
  const [result] = await gradeOpenResponses([input], policy(async (request) => {
    calls++;
    expect(Object.keys(request.questions)).toEqual(["score", "evidence"]);
    expect(request.state).toHaveProperty("learner_answer", input.learnerAnswer);
    const evidence = request.questions.evidence;
    if (evidence.type !== "choice") throw new Error("expected evidence Choice");
    const selected = "Energy scales with mass.";
    expect(Object.hasOwn(evidence.criteria, selected)).toBe(true);
    const question = request.questions.score;
    if (question.type !== "score") throw new Error("expected rubric Score");
    const top = question.criteria.length - 1;
    return { ok: true, response: { backend, answers: {
      score: { type: "score", score: top, confidence: 1,
        probabilities: Object.fromEntries(question.criteria.map((_, index) => [index, index === top ? 1 : 0])),
        legend: Object.fromEntries(question.criteria.map((level, index) => [index, level])) },
      evidence: { type: "choice", choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(evidence.criteria).map((key) => [key, key === selected ? 1 : 0])) },
    } } };
  }));
  expect(calls).toBe(1);
  expect(result).toMatchObject({ grading: "model", credit: 1, source: "proxy", evidenceQuote: "Energy scales with mass." });
  expect(input.learnerAnswer.includes(result.evidenceQuote!)).toBe(true);
});

test("shared grading preserves pending and null credit on transport abstention", async () => {
  const [result] = await gradeOpenResponses([input], policy(async () => ({
    ok: false, error: { code: "backend-unavailable", retryable: false },
  })));
  expect(result).toMatchObject({ grading: "pending", credit: null, verdict: "pending", evidenceQuote: null });
});

test("shared grading never calls an uncalibrated scorer", async () => {
  let calls = 0;
  const [result] = await gradeOpenResponses([input], {
    tiers: [{ key: backend, call: async () => { calls++; throw new Error("must not run"); } }],
    calibration: { entries: {} },
  });
  expect(calls).toBe(0);
  expect(result.grading).toBe("pending");
});

test("Tier 0 exact answers bypass all model requests", async () => {
  const results = await gradeOpenResponses([
    { ...input, learnerAnswer: " fixed mass ", referenceAnswer: "fixed mass" },
    { ...input, learnerAnswer: " " },
  ], policy(async () => { throw new Error("must not run"); }));
  expect(results.map((result) => [result.grading, result.credit])).toEqual([["auto", 1], ["auto", 0]]);
});
