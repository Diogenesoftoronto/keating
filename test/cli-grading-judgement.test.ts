import { afterEach, expect, test } from "bun:test";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { webcrypto } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { NOTORGANIC_AUTH_ENV, notOrganicAuthPath } from "../src/core/notorganic-auth.js";
import { learnerStatePath } from "../src/core/paths.js";
import { loadLearnerState } from "../src/core/learner-state.js";
import { loadCliQuizRecord } from "../src/core/quiz-grading.js";
import { reviewCliOpenResponses, GRADING_JUDGE_ENV } from "../src/judgement/cli-grading.js";
import { teachingTools } from "../src/pi/hyper-teacher/tools/teaching.js";
import { pendingQuizResults, setActiveCtx } from "../src/pi/hyper-teacher/tools/shared.js";

const quizTool = teachingTools.find((tool) => tool.name === "quiz")!;
const gradeTool = teachingTools.find((tool) => tool.name === "grade_quiz")!;
const originalFetch = globalThis.fetch;
const originalMode = process.env[GRADING_JUDGE_ENV];
const originalModel = process.env.KEATING_JUDGEMENT_MODEL;
const directories: string[] = [];
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [[GRADING_JUDGE_ENV, originalMode], ["KEATING_JUDGEMENT_MODEL", originalModel]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  pendingQuizResults.clear(); setActiveCtx(null);
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});
async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "keating-cli-grading-")); directories.push(cwd); setActiveCtx({ cwd });
  const path = notOrganicAuthPath(cwd); await mkdir(dirname(path), { recursive: true });
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  AuthStorage.create(path).set("notorganic", { type: "api_key", key: "fixture-grading-token", env: {
    [NOTORGANIC_AUTH_ENV.issuer]: "https://grading.example", [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(await webcrypto.subtle.exportKey("jwk", pair.privateKey)),
    [NOTORGANIC_AUTH_ENV.scope]: "infer:balanced judgement:evaluate", [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP", [NOTORGANIC_AUTH_ENV.expiresAt]: String(Date.now() + 300_000),
  } });
  process.env[GRADING_JUDGE_ENV] = "notorganic"; process.env.KEATING_JUDGEMENT_MODEL = "jev-grading-test";
  return cwd;
}
function response(body: any) {
  const levels = body.questions.score.criteria as string[];
  const choices = Object.keys(body.questions.evidence.criteria);
  return { model: "jev-grading-test", answers: {
    score: { type: "score", score: 4, legend: Object.fromEntries(levels.map((label, index) => [String(index), label])), probabilities: Object.fromEntries(levels.map((_, index) => [String(index), index === 4 ? 1 : 0])), confidence: 1 },
    evidence: { type: "choice", choice: choices[0], probabilities: Object.fromEntries(choices.map((key, index) => [key, index === 0 ? 1 : 0])), confidence: 1 },
  }, usage: { input_tokens: 37, output_tokens: 0 } };
}
const authored = [
  { question: "Calculate.", correctAnswer: "4", explanation: "Two plus two.", mathProblem: { kind: "arithmetic", expression: "2+2" } },
  { question: "Explain why practice helps memory.", correctAnswer: "Retrieval strengthens memory.", explanation: "Practice retrieves knowledge.", type: "short_answer" },
];

test("real quiz consumer saves typed proposals separately, reloads submission, and finalizes only explicit review", async () => {
  const cwd = await workspace();
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++; expect(String(url)).toBe("https://grading.example/v1/judgement");
    expect(new Headers(init?.headers).get("authorization")).toBe("DPoP fixture-grading-token");
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(String(init?.body)); expect(body.model).toBe("judgement");
    return Response.json(response(body));
  }) as typeof fetch;
  const generated = await quizTool.execute("quiz", { topic: "Memory", questions: authored }, undefined, undefined, {});
  const quiz = (generated.details as any).quiz;
  const math = quiz.questions.find((q: any) => q.mathProblem).id;
  const open = quiz.questions.find((q: any) => !q.mathProblem).id;
  const answers = { [math]: "4", [open]: "Working to retrieve ideas makes them easier to recall." };
  const result = await quizTool.execute("quiz", { topic: "Memory", questions: authored }, undefined, undefined, { hasUI: true, ui: { custom: async () => answers } });
  const details = result.details as any;
  expect(calls).toBe(1); expect(details.objectiveResults[math]).toBe(true); expect(details.objectiveResults[open]).toBeUndefined();
  expect(details.grading.grades[0].grading).toBe("pending"); expect(details.grading.grades[0].credit).toBeNull();
  expect(details.grading.proposals[0].proposal).toMatchObject({ verdict: "correct", credit: 1, evidenceQuote: answers[open], backend: { model: "jev-grading-test", calibrationSha256: null } });
  expect(JSON.stringify(result.content)).toContain("uncalibrated proposal only");
  const rendered = quizTool.renderResult!(result, {}, { fg: (_tone: string, text: string) => text, bold: (text: string) => text }, {});
  expect(rendered.render(100).join("\n")).toContain("Final open-response grades pending");
  expect(rendered.render(100).join("\n")).toContain("jev-grading-test (uncalibrated proposal)");
  expect((await loadLearnerState(learnerStatePath(cwd))).quizResults).toHaveLength(0);
  const saved = await loadCliQuizRecord(cwd, details.resultId);
  expect(saved?.submission.answers).toEqual(answers); expect(saved?.review).toBeNull();
  expect(await readFile(details.gradingRecordPath, "utf8")).not.toContain("fixture-grading-token");
  const other = await mkdtemp(join(tmpdir(), "keating-other-project-")); directories.push(other); setActiveCtx({ cwd: other });
  const wrongWorkspace = await gradeTool.execute("grade", { result_id: details.resultId, grades: [{ question_id: open, verdict: "correct" }] }, undefined, undefined, {});
  expect(wrongWorkspace.isError).toBe(true);
  setActiveCtx({ cwd });
  pendingQuizResults.clear();
  const inspect = await gradeTool.execute("grade", { result_id: details.resultId }, undefined, undefined, {});
  expect(JSON.stringify(inspect.content)).toContain("remain pending");
  const bad = await gradeTool.execute("grade", { result_id: details.resultId, grades: [{ question_id: math, verdict: "incorrect" }] }, undefined, undefined, {});
  expect(bad.isError).toBe(true);
  const final = await gradeTool.execute("grade", { result_id: details.resultId, grades: [{ question_id: open, verdict: "partial", note: "Reviewer found a missing explanation." }] }, undefined, undefined, {});
  expect((final.details as any).review.score).toEqual({ correct: 1.5, total: 2 });
  expect((await loadCliQuizRecord(cwd, details.resultId))?.submission.answers).toEqual(answers);
  expect((await loadCliQuizRecord(cwd, details.resultId))?.proposal?.proposals[0]?.proposal?.credit).toBe(1);
  const again = await gradeTool.execute("grade", { result_id: details.resultId, grades: [{ question_id: open, verdict: "correct" }] }, undefined, undefined, {});
  expect((again.details as any).review.score.correct).toBe(1.5); expect(calls).toBe(1);
  expect((await loadLearnerState(learnerStatePath(cwd))).quizResults).toHaveLength(1);
});

test("deterministic matches and blanks avoid inference; long answers remain intact and pending", async () => {
  const cwd = await workspace(); let calls = 0;
  const fetch = async () => { calls++; throw new Error("must not call"); };
  const long = "x".repeat(8_001);
  const receipt = await reviewCliOpenResponses(cwd, [
    { id: "exact", question: "Value?", learnerAnswer: "  Alpha   beta ", referenceAnswer: "alpha beta" },
    { id: "blank", question: "Explain", learnerAnswer: "  " },
    { id: "long", question: "Explain", learnerAnswer: long, referenceAnswer: "different" },
    { id: "many", question: "Explain", learnerAnswer: Array.from({ length: 64 }, (_, i) => `Sentence ${i}.`).join(" ") },
  ], { env: { [GRADING_JUDGE_ENV]: "notorganic" }, transport: { fetch } });
  expect(receipt.grades.map((grade) => grade.credit)).toEqual([1, 0, null, null]);
  expect(receipt.proposals.every((entry) => entry.proposal === null)).toBe(true); expect(calls).toBe(0);
});

test("provider failure never produces zero credit or a final grade", async () => {
  const cwd = await workspace();
  const receipt = await reviewCliOpenResponses(cwd, [{ id: "answer", question: "Explain", learnerAnswer: "My own answer.", referenceAnswer: "Reference" }], {
    env: { [GRADING_JUDGE_ENV]: "notorganic" }, transport: { retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 }, fetch: async () => ({ ok: false, status: 503, json: async () => { throw new Error("never read provider errors"); } }) },
  });
  expect(receipt.grades[0]?.grading).toBe("pending"); expect(receipt.grades[0]?.credit).toBeNull();
  expect(receipt.proposals[0]?.proposal).toBeNull(); expect(receipt.observations[0]?.outcome.ok).toBe(false);
});
