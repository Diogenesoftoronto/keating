import { expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { mathProblemPrompt, type JudgementRequest, type JudgementResponse, type UiDocument, type UiDocumentNode } from "@keating/learner-contracts";
import { createQuizPerformanceAttempt, collectCommittedQuizPerformance, exportQuizPerformanceEvidence, type QuizPerformanceStore } from "../keating/judgement/quiz-performance";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";
import { createSharedUiAction, dispatchSharedUiAction, type SharedUiActionIntent } from "../keating/openui/shared-actions";
import { KeatingStorage, type QuestionCheckRecord } from "../keating/storage";
import { JUDGEMENT_MODEL_CHANGED_EVENT } from "../keating/judgement-model";

type Quiz = Extract<UiDocumentNode, { type: "quiz" }>;
const backend = { backend: "system-one" as const, model: "jev-test-1", calibrationSha256: null };
const memory = (): QuizPerformanceStore => { const data = new Map<string, string>(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } }; };
const answer = (request: JudgementRequest): JudgementResponse => ({ backend, answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: "noul", noul: 0.75 }])) });
const runtime = (call: (request: JudgementRequest) => Promise<JudgementResponse> = async request => answer(request), preference: "hosted" | "local" | "off" = "hosted"): WebJudgementRuntime => ({
  settings: { backend: preference, localModelId: "local-test", gatewayPath: "/api/judgement" },
  policy: { calibration: { entries: {} }, tiers: [{ key: backend, call: async request => ({ ok: true, response: await call(request) }) }] },
});
function fixture() {
  let time = Date.now() - 1000;
  const store = memory();
  const node: Quiz = { type: "quiz", id: "quiz", title: "Fractions", questions: [
    { id: "a", kind: "choice", prompt: "Which is a half?", choices: [{ id: "half", label: "1/2" }, { id: "third", label: "1/3" }], correctAnswer: "half" },
    { id: "b", kind: "choice", prompt: "Which is a third?", choices: [{ id: "half", label: "1/2" }, { id: "third", label: "1/3" }], correctAnswer: "third" },
  ] };
  const document: UiDocument = { schemaVersion: 1, id: crypto.randomUUID(), revision: 0, lifecycle: "ready", supportedSurfaces: ["web"], nodes: [node], createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString() };
  const checks: QuestionCheckRecord[] = [{ id: "prior", topic: node.title, question: "Name a half", answer: "1/2", grading: "auto", score: 1, createdAt: time - 1000 }];
  const options = { documentId: document.id, documentRevision: 0, node, source: { getQuestionChecks: async () => structuredClone(checks) }, store, now: () => time };
  const intent: Extract<SharedUiActionIntent, { type: "complete-quiz" }> = { type: "complete-quiz", nodeId: node.id, resultId: "result", answers: [{ questionId: "a", answer: "half" }, { questionId: "b", answer: "half" }], score: 1, partialCreditPoints: 1, partialCredits: { a: 1, b: 0 }, timing: { totalMs: 100, perQuestionMs: { a: 50, b: 50 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: [] };
  return { document, node, store, checks, options, intent, advance: () => { time += 10; }, commit: async () => {
    const action = createSharedUiAction(document, intent);
    const receipt = dispatchSharedUiAction(memory(), document, intent, new Date(time).toISOString()).receipt;
    await collectCommittedQuizPerformance(action, document, receipt, time + 10);
  }, exported: () => exportQuizPerformanceEvidence({ documentId: document.id, nodeId: node.id }, store) };
}

test("persists a pre-input receipt with source/backend/question hashes and only preceding bounded history", async () => {
  const f = fixture(); let calls = 0;
  f.checks.push({ ...f.checks[0], id: "other", topic: "Other", answer: "private unrelated" }, { ...f.checks[0], id: "future", createdAt: Date.now(), answer: "future answer" });
  const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime(async request => {
    calls++; expect(JSON.stringify(request)).not.toContain("private unrelated"); expect(JSON.stringify(request)).not.toContain("future answer");
    expect(Object.keys(request.questions)).toEqual(["item_0", "item_1"]); return answer(request);
  }) });
  expect(await attempt.estimate()).toEqual({ ok: true, expectedCorrect: 1.5, itemCount: 2 });
  const evidence = await f.exported();
  expect(calls).toBe(1); expect(evidence.predictions).toHaveLength(2); expect(evidence.observations).toEqual([]);
  expect(evidence.predictions[0]).toMatchObject({ documentId: f.document.id, documentRevision: 0, nodeId: "quiz", prediction: { backend, probability: 0.75, source: "proxy" } });
  expect(evidence.predictions[0].sourceSha256).toMatch(/^[a-f0-9]{64}$/); expect(evidence.predictions[0].questionSha256).toMatch(/^[a-f0-9]{64}$/);
  attempt.dispose();
});

test("only actual committed objective answers join; hints produce observed zero and replay is deduplicated", async () => {
  const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
  await attempt.estimate(); f.advance(); attempt.hint("a"); f.advance(); attempt.prepareSubmission(f.intent);
  expect((await f.exported()).observations).toEqual([]);
  await f.commit(); await f.commit();
  const evidence = await f.exported();
  expect(evidence.observations).toHaveLength(2); expect(evidence.observations.map(row => row.observed)).toEqual([0, 0]);
  expect(evidence.observations[0].outcome).toMatchObject({ correct: true, hintUsed: true, grading: "deterministic" });
  expect(evidence.observations[1].outcome).toMatchObject({ correct: false, hintUsed: false });
  expect(attempt.status()).toBe("saved"); attempt.dispose();
});

test("the actual IndexedDB post-commit hook survives UI disposal and preserves answer success", async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
  await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.intent); attempt.dispose();
  const storage = new KeatingStorage(); const action = createSharedUiAction(f.document, f.intent);
  expect((await storage.materializeCanonicalOpenUiAction(action, f.document)).receipt.state).toBe("completed");
  // Collector hashes the committed action off the answer transaction.
  for (let i = 0; i < 20 && !(await f.exported()).observations.length; i++) await new Promise(resolve => setTimeout(resolve, 1));
  expect((await f.exported()).observations).toHaveLength(2);
  expect(await storage.getQuestionChecks()).toHaveLength(2);
  await storage.materializeCanonicalOpenUiAction(action, f.document);
  expect((await f.exported()).observations).toHaveLength(2);
});

test("rejects estimates begun after touch and rejects a late noncooperative response", async () => {
  const f = fixture(); let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime(async request => { entered(); await new Promise<void>(resolve => { release = resolve; }); return answer(request); }) });
  const estimate = attempt.estimate(); await waiting; f.advance(); attempt.touch(); release();
  expect((await estimate).ok).toBe(false); expect((await f.exported()).predictions).toHaveLength(0);
  expect((await attempt.estimate()).ok).toBe(false); attempt.dispose();
});

test("rejects changed source, assessed history, wrong concrete model and malformed probabilities", async () => {
  for (const change of ["source", "history", "model", "probability"]) {
    const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime(async request => {
      const response = answer(request);
      if (change === "source") f.node.questions[0].prompt = "Changed";
      if (change === "history") f.checks[0].answer = "Changed";
      if (change === "model") return { ...response, backend: { ...backend, model: "wrong-model" } };
      if (change === "probability") return { ...response, answers: { ...response.answers, item_0: { type: "noul", noul: NaN } } };
      return response;
    }) });
    expect((await attempt.estimate()).ok).toBe(false); expect((await f.exported()).predictions).toHaveLength(0); attempt.dispose();
  }
});

test("privacy settings changes cancel an in-flight request", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget(); Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  try {
    const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime(async request => { target.dispatchEvent(new Event(JUDGEMENT_MODEL_CHANGED_EVENT)); return answer(request); }) });
    expect((await attempt.estimate()).ok).toBe(false); expect((await f.exported()).predictions).toHaveLength(0); attempt.dispose();
  } finally { if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window"); }
});

test("off, local-only and absent history never dispatch hosted inference", async () => {
  let calls = 0;
  for (const setting of ["off", "local", "hosted"] as const) {
    const f = fixture(); if (setting === "hosted") f.checks.length = 0;
    const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime(async request => { calls++; return answer(request); }, setting) });
    expect((await attempt.estimate()).ok).toBe(false); attempt.dispose();
  }
  expect(calls).toBe(0);
});

test("an estimate cannot become pre-answer evidence by using later commit time", async () => {
  const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
  await attempt.estimate(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.intent); await f.commit();
  expect((await f.exported()).observations).toHaveLength(0); expect(attempt.status()).toBe("unmatched"); attempt.dispose();
});

test("a replayed canonical receipt cannot attach an old answer to a new prediction", async () => {
  const f = fixture();
  const journal = memory();
  const original = dispatchSharedUiAction(journal, f.document, f.intent, new Date(f.options.now() - 100).toISOString());
  const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
  expect((await attempt.estimate()).ok).toBe(true);
  f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.intent);
  const replay = dispatchSharedUiAction(journal, f.document, f.intent, new Date(f.options.now() + 10).toISOString());
  expect(replay.replayed).toBe(true);
  expect(replay.receipt.createdAt).toBe(original.receipt.createdAt);
  await collectCommittedQuizPerformance(createSharedUiAction(f.document, f.intent), f.document, replay.receipt, f.options.now() + 10);
  expect((await f.exported()).observations).toHaveLength(0);
  expect(attempt.status()).toBe("unmatched"); attempt.dispose();
});

test("a delayed commit retains the hint state at submission preparation", async () => {
  const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
  await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.intent);
  f.advance(); attempt.hint("a"); await f.commit();
  const rows = (await f.exported()).observations;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ observed: 1, outcome: { correct: true, hintUsed: false } });
  attempt.dispose();
});

test("throwing status observers cannot prevent prediction or outcome persistence", async () => {
  const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
  let notifications = 0;
  attempt.subscribe(() => { throw new Error("broken view"); });
  attempt.subscribe(() => { notifications++; });
  expect((await attempt.estimate()).ok).toBe(true);
  f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.intent); await f.commit();
  expect(attempt.status()).toBe("saved"); expect(notifications).toBe(2);
  expect((await f.exported()).predictions).toHaveLength(2);
  expect((await f.exported()).observations).toHaveLength(2); attempt.dispose();
});

test("empty, skipped and pending rows never become observed failures; reported credit cannot override source scoring", async () => {
  for (const mode of ["empty", "skip", "pending", "forged"]) {
    const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
    await attempt.estimate(); f.advance(); attempt.touch(); f.advance();
    if (mode === "empty") f.intent.answers[0].answer = "";
    if (mode === "skip") f.intent.skippedQuestionIds = ["a"];
    if (mode === "pending") f.intent.pendingGradeQuestionIds = ["a"];
    if (mode === "forged") f.intent.partialCredits = { a: 0, b: 1 };
    attempt.prepareSubmission(f.intent);
    // Invoke the trusted hook seam with an already-committed envelope; the normal action validator may refuse forged credit.
    const action = createSharedUiAction(f.document, f.intent);
    const receipt = { action, state: "completed", createdAt: new Date(f.options.now()).toISOString(), updatedAt: new Date(f.options.now()).toISOString(), result: { status: "completed", actionIdempotencyKey: action.idempotencyKey } } as Parameters<typeof collectCommittedQuizPerformance>[2];
    await collectCommittedQuizPerformance(action, f.document, receipt, Date.now());
    const rows = (await f.exported()).observations;
    expect(rows).toHaveLength(mode === "forged" ? 2 : 1);
    if (mode === "forged") expect(rows.map(row => row.observed)).toEqual([1, 0]);
    attempt.dispose();
  }
});

test("different staged payload, source revision and colliding live attempts cannot join", async () => {
  for (const mode of ["intent", "revision", "collision"]) {
    const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
    const other = mode === "collision" ? createQuizPerformanceAttempt({ ...f.options, runtime: runtime() }) : undefined;
    await attempt.estimate(); await other?.estimate(); f.advance(); attempt.touch(); other?.touch(); f.advance(); attempt.prepareSubmission(f.intent); other?.prepareSubmission(f.intent);
    if (mode === "intent") f.intent.answers[0].answer = "third";
    if (mode === "revision") f.document.revision = 1;
    await f.commit(); expect((await f.exported()).observations).toHaveLength(0); attempt.dispose(); other?.dispose();
  }
});

test("prediction persistence failure is explicit and answer-time evidence failure leaves commit successful", async () => {
  const f = fixture(); let fail = true;
  const store: QuizPerformanceStore = { getItem: key => f.store.getItem(key), setItem: (key, value) => { if (fail) throw new Error("quota"); f.store.setItem(key, value); } };
  const failed = createQuizPerformanceAttempt({ ...f.options, store, runtime: runtime() });
  expect(await failed.estimate()).toEqual({ ok: false, reason: "storage-failed" }); failed.dispose();
  fail = false; const attempt = createQuizPerformanceAttempt({ ...f.options, store, runtime: runtime() });
  await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.intent); fail = true;
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const storage = new KeatingStorage();
  expect((await storage.materializeCanonicalOpenUiAction(createSharedUiAction(f.document, f.intent), f.document)).receipt.state).toBe("completed");
  for (let i = 0; i < 20 && attempt.status() !== "storage-failed"; i++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(attempt.status()).toBe("storage-failed"); expect(await storage.getQuestionChecks()).toHaveLength(2);
  fail = false; await f.commit(); expect((await f.exported()).observations).toHaveLength(2); attempt.dispose();
});


test("a hanging history adapter times out before any model dispatch", async () => {
  const f = fixture(); let calls = 0;
  const attempt = createQuizPerformanceAttempt({ ...f.options, timeoutMs: 5,
    source: { getQuestionChecks: () => new Promise(() => {}) },
    runtime: runtime(async request => { calls++; return answer(request); }) });
  expect((await attempt.estimate()).ok).toBe(false); expect(calls).toBe(0); attempt.dispose();
});

test("a failed learner-record transaction produces no observations and an exact retry can link later", async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const f = fixture(); const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
  await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.intent);
  const storage = new KeatingStorage(); const action = createSharedUiAction(f.document, f.intent);
  await storage.init();
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function() { throw new Error("transaction write failed"); };
  try { await expect(storage.materializeCanonicalOpenUiAction(action, f.document)).rejects.toThrow("transaction write failed"); }
  finally { IDBObjectStore.prototype.put = original; }
  expect((await f.exported()).observations).toHaveLength(0);
  await storage.materializeCanonicalOpenUiAction(action, f.document);
  for (let i = 0; i < 20 && !(await f.exported()).observations.length; i++) await new Promise(resolve => setTimeout(resolve, 1));
  expect((await f.exported()).observations).toHaveLength(2); attempt.dispose();
});


test("verified math keys are eligible but unparseable answers remain unobserved", async () => {
  const f = fixture();
  f.node.questions[0] = { id: "a", kind: "short_answer", prompt: mathProblemPrompt({ kind: "arithmetic", expression: "1+1" }), correctAnswer: "2", mathProblem: { kind: "arithmetic", expression: "1+1" } };
  f.node.questions[1] = { id: "b", kind: "short_answer", prompt: mathProblemPrompt({ kind: "arithmetic", expression: "2+2" }), correctAnswer: "4", mathProblem: { kind: "arithmetic", expression: "2+2" } };
  const attempt = createQuizPerformanceAttempt({ ...f.options, runtime: runtime() });
  expect(await attempt.estimate()).toMatchObject({ ok: true, itemCount: 2 });
  f.advance(); attempt.touch(); f.advance(); f.intent.answers = [{ questionId: "a", answer: "2" }, { questionId: "b", answer: "I do not know" }];
  f.intent.pendingGradeQuestionIds = ["b"]; f.intent.partialCredits = { a: 1 };
  attempt.prepareSubmission(f.intent); await f.commit();
  const rows = (await f.exported()).observations;
  expect(rows).toHaveLength(1); expect(rows[0].observed).toBe(1); attempt.dispose();
});
