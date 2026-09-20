import { expect, test } from "bun:test";
import { proposeOpenResponses, type JudgementCaller, type JudgementRequest } from "../src/judgement/index.js";

const input = { id: "heat", question: "Why does more mass need more energy?", learnerAnswer: "Energy is proportional to mass.", rubric: "Explains proportionality at fixed material and temperature rise." };
const backend = { backend: "system-one" as const, model: "jev-test-concrete", calibrationSha256: null };
function response(request: JudgementRequest, confidence = 1) {
  const question = request.questions.score;
  if (question.type !== "score") throw new Error("expected score");
  return { ok: true as const, response: { backend, answers: {
    score: { type: "score" as const, score: 4, confidence,
      legend: Object.fromEntries(question.criteria.map((label, index) => [index, label])),
      probabilities: Object.fromEntries(question.criteria.map((_, index) => [index, index === 4 ? 1 : 0])) },
    evidence: { type: "choice" as const, choice: input.learnerAnswer, confidence: 1, probabilities: { [input.learnerAnswer]: 1 } },
  } } };
}

test("uncalibrated review keeps actual model identity and evidence without issuing a final grade", async () => {
  const [result] = await proposeOpenResponses([input], async (request) => {
    expect(request.state).toHaveProperty("learner_answer", input.learnerAnswer);
    expect(Object.keys(request.questions)).toEqual(["score", "evidence"]);
    return response(request);
  });
  expect(result.proposal).toMatchObject({ verdict: "correct", credit: 1, backend, evidenceQuote: input.learnerAnswer });
  expect(result.proposal).not.toHaveProperty("grading");
});

test("uncertain and bimodal estimates keep null credit", async () => {
  const [uncertain] = await proposeOpenResponses([input], async (request) => response(request, 0.2));
  expect(uncertain.proposal).toMatchObject({ verdict: "pending", credit: null });
  const [bimodal] = await proposeOpenResponses([input], async (request) => {
    const out = response(request);
    out.response.answers.score.probabilities = { "0": 0.5, "1": 0, "2": 0, "3": 0, "4": 0.5 };
    return out;
  });
  expect(bimodal.proposal).toMatchObject({ verdict: "pending", credit: null });
});

test("live two-decimal probability rounding preserves the raw estimate", async () => {
  const [result] = await proposeOpenResponses([input], async (request) => {
    const out = response(request);
    out.response.answers.score.probabilities = { "0": 0, "1": 0, "2": 0.02, "3": 0.12, "4": 0.85 };
    return out;
  });
  expect(result.proposal?.verdict).toBe("correct");
  expect(result.proposal?.score.probabilities["4"]).toBe(0.85);
});

test("failures and malformed distributions cannot become proposals", async () => {
  const callers: JudgementCaller[] = [
    async () => { throw new Error("private learner data"); },
    async () => ({ ok: false, error: { code: "backend-timeout", retryable: false } }),
    async (request) => { const out = response(request); out.response.answers.score.probabilities = { "4": 1 }; return out; },
    async (request) => { const out = response(request); out.response.answers.score.legend["4"] = "wrong rubric"; return out; },
  ];
  for (const call of callers) expect((await proposeOpenResponses([input], call))[0].proposal).toBeNull();
});

test("complete evidence budgets, objective answers and cancellation avoid dispatch", async () => {
  let calls = 0;
  const call: JudgementCaller = async (request) => { calls++; return response(request); };
  const results = await proposeOpenResponses([
    { ...input, learnerAnswer: " " },
    { ...input, referenceAnswer: input.learnerAnswer.toUpperCase() },
    { ...input, learnerAnswer: "x".repeat(8001) },
    { ...input, learnerAnswer: "Sentence. ".repeat(65) },
  ], call);
  const aborted = await proposeOpenResponses([input], call, AbortSignal.abort());
  expect([...results, ...aborted].every((row) => row.proposal === null)).toBe(true);
  expect(calls).toBe(0);
});
