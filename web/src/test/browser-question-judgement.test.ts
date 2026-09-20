import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openResponseCalibration, type JudgementBackendKey, type JudgementCaller,
  type JudgementRequest, type UiAction, type UiDocument } from "@keating/learner-contracts";
import { KeatingStorage } from "../keating/storage";
import { browserQuestionGradeInput, reviewBrowserQuestionChecks } from "../keating/judgement/browser-grading";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";
import { DEFAULT_JUDGEMENT_MODEL_SETTINGS } from "../keating/judgement-model";

beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); });
const at = "2026-09-20T00:00:00.000Z";
const question = { id: "reason", kind: "short_answer" as const, prompt: "Why is a transaction atomic?",
  correctAnswer: "All changes commit together or none do.", rubric: "Explains all-or-nothing commit." };
const document: UiDocument = { schemaVersion: 1, id: "assessment", revision: 0, lifecycle: "ready",
  supportedSurfaces: ["web"], title: "Transactions", createdAt: at, updatedAt: at,
  nodes: [{ type: "question", ...question }] };
const action: Extract<UiAction, { type: "submit-answer" }> = { schemaVersion: 1, type: "submit-answer", documentId: document.id,
  documentRevision: 0, nodeId: question.id, idempotencyKey: "answer-once",
  answer: "A failure rolls back the whole set of changes." };
const key: JudgementBackendKey = { backend: "local", model: "synthetic-grader-v1", calibrationSha256: null };
function answer(request: JudgementRequest, backend = key) {
  const score = request.questions.score;
  const evidence = request.questions.evidence;
  if (score.type !== "score" || evidence.type !== "choice") throw new Error("Expected decomposed review");
  const last = score.criteria.length - 1;
  const selected = Object.keys(evidence.criteria).find(text => text.includes("failure"))!;
  return { ok: true as const, response: { backend, answers: {
    score: { type: "score" as const, score: last, confidence: 1,
      probabilities: Object.fromEntries(score.criteria.map((_, i) => [i, i === last ? 1 : 0])),
      legend: Object.fromEntries(score.criteria.map((label, i) => [i, label])) },
    evidence: { type: "choice" as const, choice: selected, confidence: 1,
      probabilities: Object.fromEntries(Object.keys(evidence.criteria).map(text => [text, text === selected ? 1 : 0])) },
  } } };
}
function runtime(call: JudgementCaller, backend = key, calibrated = false): WebJudgementRuntime {
  return { settings: { ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, localModelId: backend.model },
    policy: { tiers: [{ key: backend, call }], calibration: calibrated
      ? openResponseCalibration(backend, [browserQuestionGradeInput("unused", question, String(action.answer))])
      : { entries: {} } } };
}

test("canonical answer commits before a slow semantic review and proposal never becomes a final grade", async () => {
  const storage = new KeatingStorage();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const configured = runtime(async request => { calls++; await gate; return answer(request); });
  const receipt = await storage.materializeCanonicalOpenUiAction(action, document, at, configured);
  expect(receipt.replayed).toBe(false);
  expect((await storage.getQuestionChecks())[0]).toMatchObject({ grading: "pending", answer: action.answer });
  expect((await storage.getQuestionChecks())[0].score).toBeUndefined();
  release();
  await storage.waitForQuestionJudgements();
  const [saved] = await storage.getQuestionChecks();
  expect(calls).toBe(1);
  expect(saved.grading).toBe("pending");
  expect(saved.score).toBeUndefined();
  expect(saved.judgement).toMatchObject({ evidenceKind: "model-estimate", final: { credit: null },
    proposal: { verdict: "correct", credit: 1, backend: key, evidenceQuote: action.answer } });
  await storage.materializeCanonicalOpenUiAction(action, document, at, configured);
  await storage.waitForQuestionJudgements();
  expect(calls).toBe(1);
});

test("calibrated shared grade is persisted with exact source evidence and attempts", async () => {
  const backend = { ...key, calibrationSha256: "a".repeat(64) };
  const storage = new KeatingStorage();
  await storage.materializeCanonicalOpenUiAction(action, document, at, runtime(async request => answer(request, backend), backend, true));
  await storage.waitForQuestionJudgements();
  const [saved] = await storage.getQuestionChecks();
  expect(saved).toMatchObject({ grading: "model", score: 1,
    judgement: { evidenceKind: "calibrated-model-grade", proposal: null,
      final: { source: "proxy", evidenceQuote: action.answer } } });
  expect(saved.judgement!.final.attempts.length).toBeGreaterThan(0);
});

test("failed semantic review preserves the locally saved answer as pending with no invented score", async () => {
  const storage = new KeatingStorage();
  await storage.materializeCanonicalOpenUiAction(action, document, at,
    runtime(async () => { throw new Error("PRIVATE provider detail"); }));
  await storage.waitForQuestionJudgements();
  const [saved] = await storage.getQuestionChecks();
  expect(saved.grading).toBe("pending");
  expect(saved.score).toBeUndefined();
  expect(saved.judgement?.proposal).toBeNull();
  expect(JSON.stringify(saved)).not.toContain("PRIVATE");
});

test("late semantic results cannot replace an explicit teacher grade", async () => {
  const storage = new KeatingStorage();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await storage.materializeCanonicalOpenUiAction(action, document, at,
    runtime(async request => { await gate; return answer(request); }));
  const [pending] = await storage.getQuestionChecks();
  await storage.gradeQuestionCheck(pending.id, { score: 0.5, misconception: "Teacher reviewed" });
  release();
  await storage.waitForQuestionJudgements();
  expect((await storage.getQuestionChecks())[0]).toMatchObject({ grading: "model", score: 0.5, misconception: "Teacher reviewed" });
  expect((await storage.getQuestionChecks())[0].judgement).toBeUndefined();
});

test("exact and empty authored answers keep deterministic grades without dispatch", async () => {
  const storage = new KeatingStorage();
  let calls = 0;
  const configured = runtime(async () => { calls++; throw new Error("Not expected"); });
  for (const [index, value] of [question.correctAnswer, " "].entries()) {
    await storage.materializeCanonicalOpenUiAction({ ...action, idempotencyKey: `answer-${index}`, answer: value }, document, at, configured);
  }
  await storage.waitForQuestionJudgements();
  expect((await storage.getQuestionChecks()).map(item => [item.grading, item.score]).sort()).toEqual([["auto", 0], ["auto", 1]]);
  expect(calls).toBe(0);
});

test("objective choices retain exact grading and preference text is not sent to a judge", async () => {
  const storage = new KeatingStorage();
  let calls = 0;
  const configured = runtime(async () => { calls++; throw new Error("Not expected"); });
  const source: UiDocument = { ...document, nodes: [
    { type: "question", id: "choice", kind: "choice", prompt: "Which?", choices: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], correctAnswer: "yes" },
    { type: "question", id: "preference", kind: "text", prompt: "What do you want to learn?" },
  ] };
  await storage.materializeCanonicalOpenUiAction({ schemaVersion: 1, type: "choose-option", documentId: document.id,
    documentRevision: 0, nodeId: "choice", optionIds: ["no"], idempotencyKey: "choice" }, source, at, configured);
  await storage.materializeCanonicalOpenUiAction({ ...action, nodeId: "preference", idempotencyKey: "preference", answer: "Drawing" }, source, at, configured);
  await storage.waitForQuestionJudgements();
  const checks = await storage.getQuestionChecks();
  expect(checks.find(item => item.question === "Which?")).toMatchObject({ grading: "auto", score: 0 });
  expect(checks.find(item => item.question.startsWith("What"))).toMatchObject({ grading: "pending", answer: "Drawing" });
  expect(calls).toBe(0);
});

test("off preserves pending semantic answers without calling a model", async () => {
  let calls = 0;
  const configured = runtime(async () => { calls++; throw new Error("Not expected"); });
  const off = { ...configured, settings: { ...configured.settings, backend: "off" as const }, policy: { tiers: [], calibration: { entries: {} } } };
  const [result] = await reviewBrowserQuestionChecks([browserQuestionGradeInput("answer", question, String(action.answer))], off);
  expect(result).toMatchObject({ final: { grading: "pending", credit: null }, proposal: null, evidenceKind: "unavailable" });
  expect(calls).toBe(0);
});

test("question groups and pending quiz answers reach the same typed review path", async () => {
  const storage = new KeatingStorage();
  let calls = 0;
  const configured = runtime(async request => { calls++; return answer(request); });
  const source: UiDocument = { ...document, nodes: [
    { type: "question-group", id: "group", questions: [question] },
  ] };
  const quizSource: UiDocument = { ...document, id: "quiz-assessment", nodes: [
    { type: "quiz", id: "quiz", title: "Atomicity", questions: [question] },
  ] };
  await storage.materializeCanonicalOpenUiAction({ schemaVersion: 1, type: "submit-question-group",
    documentId: document.id, documentRevision: 0, nodeId: "group", idempotencyKey: "group",
    responses: [{ questionId: question.id, type: "text", answer: String(action.answer) }] }, source, at, configured);
  await storage.materializeCanonicalOpenUiAction({ schemaVersion: 1, type: "complete-quiz",
    documentId: quizSource.id, documentRevision: 0, nodeId: "quiz", idempotencyKey: "quiz", resultId: "result",
    answers: [{ questionId: question.id, answer: String(action.answer) }], score: 0, partialCreditPoints: 0,
    partialCredits: {}, timing: { totalMs: 100, perQuestionMs: { reason: 100 } }, flaggedQuestionIds: [],
    pendingGradeQuestionIds: [question.id], skippedQuestionIds: [] }, quizSource, at, configured);
  await storage.waitForQuestionJudgements();
  const checks = await storage.getQuestionChecks();
  expect(checks).toHaveLength(2);
  expect(calls).toBe(2);
  expect(checks.every(check => check.grading === "pending" && check.score === undefined
    && check.judgement?.evidenceKind === "model-estimate")).toBe(true);
});
