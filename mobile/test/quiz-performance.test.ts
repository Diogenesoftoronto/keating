import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { createPortableLearnerEnvelope, type PortableLearnerData, type UiDocument, type UiAction, type JudgementRequest, type JudgementResponse } from "@keating/learner-contracts";
import { initializeRepositorySchema, LearnerRecordStore, UiActionStore, type AsyncSqlDatabase, type AsyncSqlExecutor, type SqlBindValue } from "../src/lib/learner-repository";
import { MobileQuizPerformanceStore } from "../src/lib/learner-repository/quiz-performance";
import { MobileQuizPerformanceSession } from "../src/lib/judgement/quiz-performance";
import { createMobileJudgementRuntime, type MobileJudgementRuntime } from "../src/lib/judgement/runtime";
import { MOBILE_LOCAL_JUDGEMENT_MODEL } from "../src/lib/judgement/local-scorer";
import { applyLocalUiAction } from "../src/lib/ui-action-mutations";

class Sqlite implements AsyncSqlDatabase {
  db = new Database(":memory:");
  tail: Promise<void> = Promise.resolve();
  failEvidence = false;
  async execAsync(sql: string) { this.db.exec(sql); }
  async runAsync(sql: string, ...params: SqlBindValue[]) {
    if (this.failEvidence && sql.startsWith("INSERT INTO repository_meta") && params[0] === "quiz_performance_evidence_v1") throw new Error("evidence quota");
    const r = this.db.query(sql).run(...params); return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
  }
  async getFirstAsync<T>(sql: string, ...params: SqlBindValue[]) { return this.db.query(sql).get(...params) as T | null; }
  async getAllAsync<T>(sql: string, ...params: SqlBindValue[]) { return this.db.query(sql).all(...params) as T[]; }
  withExclusiveTransactionAsync(work: (transaction: AsyncSqlExecutor) => Promise<void>) {
    const task = this.tail.catch(() => undefined).then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try { await work(this); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    });
    this.tail = task.catch(() => undefined); return task;
  }
  async closeAsync() { await this.tail; this.db.close(); }
}
const backend = { backend: "system-one" as const, model: "jev-test-1", calibrationSha256: null };
const answer = (request: JudgementRequest): JudgementResponse => ({ backend, answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: "noul", noul: 0.75 }])) });
const runtime = (call = async (request: JudgementRequest) => answer(request), enabled = true): MobileJudgementRuntime => ({ hostedEnabled: enabled,
  policy: { calibration: { entries: {} }, tiers: [] }, call: async request => ({ ok: true, response: await call(request) }) });
const hash = async (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture() {
  let time = Date.parse("2026-09-20T00:00:00Z");
  let id = 0;
  const db = new Sqlite(); await initializeRepositorySchema(db);
  const records = new LearnerRecordStore(db, () => new Date(time).toISOString());
  const initial: PortableLearnerData = { generatedAt: new Date(time).toISOString(), sessions: [], artifacts: [], goals: [], questionChecks: [],
    quizResults: [{ id: "earlier", topic: "Fractions", createdAt: new Date(time - 1000).toISOString(), score: 1, totalQuestions: 1, answers: { old: "one half" } }],
    decks: [], cardReviews: [], studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [], learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };
  await records.replace(initial);
  const document: UiDocument = { schemaVersion: 1, id: "document", revision: 0, lifecycle: "ready", supportedSurfaces: ["mobile"], createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString(), nodes: [{ type: "quiz", id: "quiz", title: "Fractions", questions: [
    { id: "a", kind: "choice", prompt: "Which is half?", choices: [{ id: "half", label: "1/2" }, { id: "third", label: "1/3" }], correctAnswer: "half" },
    { id: "b", kind: "choice", prompt: "Which is third?", choices: [{ id: "half", label: "1/2" }, { id: "third", label: "1/3" }], correctAnswer: "third" },
  ] }] };
  const action: Extract<UiAction, { type: "complete-quiz" }> = { schemaVersion: 1, type: "complete-quiz", documentId: document.id, documentRevision: document.revision, nodeId: "quiz", idempotencyKey: "submit", resultId: "result", answers: [{ questionId: "a", answer: "half" }, { questionId: "b", answer: "half" }], score: 1, partialCreditPoints: 1, partialCredits: { a: 1, b: 0 }, timing: { totalMs: 100, perQuestionMs: { a: 50, b: 50 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: [] };
  const actions = new UiActionStore(db, () => new Date(time).toISOString());
  const store = new MobileQuizPerformanceStore(db);
  const options = { store, history: () => records.snapshot(), id: () => `attempt-${++id}`, sha256: hash, now: () => time, runtime: async () => runtime() };
  const session = new MobileQuizPerformanceSession(options);
  return { db, records, store, actions, initial, options, session, document, action, advance: () => { time += 10; },
    commit: () => actions.dispatch(action, document, (current, now) => applyLocalUiAction(current, action, document, now)),
    exported: () => store.export(document.id, "quiz") };
}

test("native estimate saves concrete predictions before display using prior quiz history without current answers", async () => {
  const f = await fixture(); let calls = 0;
  const session = new MobileQuizPerformanceSession({ ...f.options, runtime: async () => runtime(async request => {
    calls++; expect(JSON.stringify(request.state)).toContain("one half"); expect(JSON.stringify(request.state)).toContain("grading authority was not recorded");
    expect(Object.keys(request.questions)).toEqual(["item_0", "item_1"]); return answer(request);
  }) });
  const attempt = session.create(f.document, "quiz");
  expect(await attempt.estimate()).toEqual({ ok: true, expectedCorrect: 1.5, itemCount: 2 });
  const evidence = await f.exported(); expect(calls).toBe(1); expect(evidence.predictions).toHaveLength(2); expect(evidence.observations).toHaveLength(0);
  expect(evidence.predictions[0].prediction.backend).toEqual(backend); expect(evidence.predictions[0].sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  attempt.dispose(); await f.db.closeAsync();
});

test("SQLite commit links recomputed objective outcomes, frozen hints, disposal, replay and throwing listeners", async () => {
  const f = await fixture(); const attempt = f.session.create(f.document, "quiz");
  attempt.subscribe(() => { throw new Error("broken UI"); });
  expect((await attempt.estimate()).ok).toBe(true); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.action);
  attempt.hint("a"); // After submission cannot change this attempt's observed hint use.
  let notifications = 0; attempt.subscribe(() => { notifications++; }); attempt.dispose();
  expect((await f.exported()).observations).toHaveLength(0);
  await f.commit(); await f.session.collectCommitted(f.action, f.document); await f.commit(); await f.session.collectCommitted(f.action, f.document);
  const evidence = await f.exported(); expect(evidence.observations.map(row => row.observed)).toEqual([1, 0]);
  expect(evidence.observations[0].outcome.hintUsed).toBe(false); expect(notifications).toBe(1); expect(attempt.status()).toBe("saved");
  expect((await f.records.snapshot()).quizResults).toHaveLength(2); await f.db.closeAsync();
});

test("pre-commit collection cannot invent a journal and transaction rollback preserves unmatched predictions", async () => {
  const f = await fixture(); const attempt = f.session.create(f.document, "quiz");
  await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.action);
  await expect(f.actions.dispatch(f.action, f.document, () => { throw new Error("answer rollback"); })).rejects.toThrow("answer rollback");
  expect((await f.exported()).observations).toHaveLength(0); expect((await f.records.snapshot()).quizResults).toHaveLength(1);
  await f.commit(); await f.session.collectCommitted(f.action, f.document);
  expect((await f.exported()).observations).toHaveLength(2); await f.db.closeAsync();
});

test("late noncooperative inference, source changes, wrong probabilities and hosted-off are rejected", async () => {
  for (const mode of ["touch", "source", "bad-probability", "alias", "off"]) {
    const f = await fixture(); let attempt!: ReturnType<MobileQuizPerformanceSession["create"]>; let calls = 0;
    const session = new MobileQuizPerformanceSession({ ...f.options, runtime: async () => runtime(async request => {
      calls++; if (mode === "touch") attempt.touch();
      if (mode === "source") f.document.title = "changed source";
      const response = answer(request);
      if (mode === "bad-probability") return { ...response, answers: { ...response.answers, item_0: { type: "noul", noul: NaN } } };
      if (mode === "alias") return { ...response, backend: { ...backend, model: "jev-latest" } };
      return response;
    }, mode !== "off") });
    attempt = session.create(f.document, "quiz"); expect((await attempt.estimate()).ok).toBe(false);
    expect((await f.exported()).predictions).toHaveLength(0); if (mode === "off") expect(calls).toBe(0);
    attempt.dispose(); await f.db.closeAsync();
  }
});

test("clear and import invalidate durable generations so late writers cannot resurrect or join evidence", async () => {
  for (const change of ["clear", "import"]) {
    const f = await fixture(); const attempt = f.session.create(f.document, "quiz");
    await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.action);
    await f.commit();
    if (change === "clear") await f.records.clear(); else await f.records.importPortable(createPortableLearnerEnvelope(f.initial));
    await f.session.collectCommitted(f.action, f.document);
    const evidence = await f.exported(); expect(evidence.observations).toHaveLength(0); expect(evidence.predictions).toHaveLength(change === "clear" ? 0 : 2);
    await expect(f.store.savePredictions(0, [], () => true)).rejects.toThrow("source was replaced");
    attempt.dispose(); await f.db.closeAsync();
  }
});

test("session invalidation cancels account changes and blocks prepared observations", async () => {
  const f = await fixture(); const attempt = f.session.create(f.document, "quiz");
  await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.action);
  f.session.invalidate(); await f.commit(); await f.session.collectCommitted(f.action, f.document);
  expect((await f.exported()).observations).toHaveLength(0); expect(attempt.status()).toBe("unmatched"); await f.db.closeAsync();
});

test("an old durable replay cannot become a new observed prediction", async () => {
  const f = await fixture(); await f.commit(); f.advance();
  const attempt = f.session.create(f.document, "quiz"); await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.action);
  await f.commit(); await f.session.collectCommitted(f.action, f.document);
  expect((await f.exported()).observations).toHaveLength(0); expect(attempt.status()).toBe("unmatched"); await f.db.closeAsync();
});

test("prediction and outcome storage failures remain explicit without changing committed grades", async () => {
  const f = await fixture(); f.db.failEvidence = true;
  const failed = f.session.create(f.document, "quiz"); expect(await failed.estimate()).toEqual({ ok: false, reason: "storage-failed" }); failed.dispose();
  f.db.failEvidence = false; const attempt = f.session.create(f.document, "quiz"); await attempt.estimate(); f.advance(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.action);
  f.db.failEvidence = true; expect((await f.commit()).status).toBe("completed"); await f.session.collectCommitted(f.action, f.document);
  expect(attempt.status()).toBe("storage-failed"); expect((await f.records.snapshot()).quizResults).toHaveLength(2); expect((await f.exported()).observations).toHaveLength(0);
  f.db.failEvidence = false; await f.session.collectCommitted(f.action, f.document); expect((await f.exported()).observations).toHaveLength(2); await f.db.closeAsync();
});

test("concurrent sessions append inside exclusive transactions without losing each other's receipts", async () => {
  const f = await fixture(); const other = structuredClone(f.document); other.id = "other";
  const a = f.session.create(f.document, "quiz"), b = f.session.create(other, "quiz");
  expect((await Promise.all([a.estimate(), b.estimate()])).every(result => result.ok)).toBe(true);
  expect((await f.store.export(f.document.id, "quiz")).predictions).toHaveLength(2);
  expect((await f.store.export(other.id, "quiz")).predictions).toHaveLength(2); a.dispose(); b.dispose(); await f.db.closeAsync();
});

test("full operation deadline bounds a hanging history adapter without dispatch", async () => {
  const f = await fixture(); let calls = 0;
  const session = new MobileQuizPerformanceSession({ ...f.options, timeoutMs: 5, history: () => new Promise(() => {}), runtime: async () => runtime(async request => { calls++; return answer(request); }) });
  const attempt = session.create(f.document, "quiz"); expect(await attempt.estimate()).toEqual({ ok: false, reason: "cancelled" }); expect(calls).toBe(0); attempt.dispose(); await f.db.closeAsync();
});

test("same-tick touch cannot be relabeled as a pre-answer prediction by a later commit", async () => {
  const f = await fixture(); const attempt = f.session.create(f.document, "quiz"); await attempt.estimate(); attempt.touch(); f.advance(); attempt.prepareSubmission(f.action);
  await f.commit(); await f.session.collectCommitted(f.action, f.document); expect((await f.exported()).observations).toHaveLength(0); expect(attempt.status()).toBe("unmatched"); await f.db.closeAsync();
});

test("exports stay available with hosted inference off and reject account/import/clear races", async () => {
  const f = await fixture(); let current = true;
  const session = new MobileQuizPerformanceSession({ ...f.options, current: () => current, hostedAllowed: () => false });
  const exported = await session.export(f.document.id, "quiz"); expect(session.isExportCurrent(exported)).toBe(true);
  current = false; expect(session.isExportCurrent(exported)).toBe(false);
  await expect(session.export(f.document.id, "quiz")).rejects.toThrow("source changed");
  current = true;
  const original = f.store.export.bind(f.store);
  f.store.export = async (...args) => { const data = await original(...args); await f.records.clear(); return data; };
  await expect(session.export(f.document.id, "quiz")).rejects.toThrow("source changed");
  f.store.export = original;
  const beforeInvalidation = await session.export(f.document.id, "quiz"); session.invalidate(); expect(session.isExportCurrent(beforeInvalidation)).toBe(false);
  await f.db.closeAsync();
});

test("late SQLite prediction writes roll back after the operation times out", async () => {
  const f = await fixture(); const original = f.db.runAsync.bind(f.db);
  let entered!: () => void, release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.db.runAsync = async (sql, ...params) => {
    const result = await original(sql, ...params);
    if (sql.startsWith("INSERT INTO repository_meta") && params[0] === "quiz_performance_evidence_v1") { entered(); await gate; }
    return result;
  };
  const session = new MobileQuizPerformanceSession({ ...f.options, timeoutMs: 30 });
  const attempt = session.create(f.document, "quiz"); const result = attempt.estimate(); await writing;
  expect(await result).toEqual({ ok: false, reason: "cancelled" }); release(); await f.db.tail;
  expect((await f.exported()).predictions).toHaveLength(0); attempt.dispose(); await f.db.closeAsync();
});

test("fixture models, absent history, changed generation during inference and collisions never produce linked observations", async () => {
  for (const mode of ["fixture", "history", "generation", "collision"]) {
    const f = await fixture();
    if (mode === "history") await f.records.replace({ ...f.initial, quizResults: [] });
    const session = new MobileQuizPerformanceSession({ ...f.options, runtime: async () => runtime(async request => {
      if (mode === "generation") await f.records.clear();
      const response = answer(request); return mode === "fixture" ? { ...response, backend: { ...backend, model: "fixture-je v" } } : response;
    }) });
    const attempt = session.create(f.document, "quiz"); const result = await attempt.estimate();
    if (mode !== "collision") { expect(result.ok).toBe(false); expect((await f.exported()).predictions).toHaveLength(0); }
    else {
      const other = session.create(f.document, "quiz"); await other.estimate(); f.advance(); attempt.touch(); other.touch(); f.advance(); attempt.prepareSubmission(f.action); other.prepareSubmission(f.action);
      await f.commit(); await session.collectCommitted(f.action, f.document); expect((await f.exported()).observations).toHaveLength(0); other.dispose();
    }
    attempt.dispose(); await f.db.closeAsync();
  }
});

test("objective observations ignore reported credit and exclude empty, skipped and pending answers", async () => {
  for (const mode of ["forged", "empty", "skip", "pending", "hint"]) {
    const f = await fixture(); const attempt = f.session.create(f.document, "quiz"); await attempt.estimate(); f.advance();
    if (mode === "hint") attempt.hint("a"); else attempt.touch(); f.advance();
    if (mode === "forged") f.action.partialCredits = { a: 0, b: 1 };
    if (mode === "empty") f.action.answers[0].answer = "";
    if (mode === "skip") { f.action.answers.shift(); f.action.skippedQuestionIds = ["a"]; }
    if (mode === "pending") f.action.pendingGradeQuestionIds = ["a"];
    attempt.prepareSubmission(f.action); await f.commit(); await f.session.collectCommitted(f.action, f.document);
    const rows = (await f.exported()).observations;
    expect(rows).toHaveLength(mode === "forged" || mode === "hint" ? 2 : 1);
    if (mode === "forged") expect(rows.map(row => row.observed)).toEqual([1, 0]);
    if (mode === "hint") expect(rows[0].observed).toBe(0);
    await f.db.closeAsync();
  }
});

test("local-only judgement reaches actual SQLite predictions and objective outcome joins", async () => {
  const f = await fixture();
  try {
    const session = new MobileQuizPerformanceSession({ ...f.options,
      runtime: async () => createMobileJudgementRuntime({ hostedEnabled: false, localEnabled: true, localScorer: async () => [1, 3] }) });
    const attempt = session.create(f.document, "quiz");
    expect(await attempt.estimate()).toEqual({ ok: true, expectedCorrect: 1.5, itemCount: 2 });
    expect((await f.exported()).predictions[0]!.prediction.backend).toEqual({ backend: "local", model: MOBILE_LOCAL_JUDGEMENT_MODEL, calibrationSha256: null });
    f.advance(); attempt.prepareSubmission(f.action); f.advance(); await f.commit();
    await session.collectCommitted(f.action, f.document);
    expect((await f.exported()).observations.map(row => row.observed)).toEqual([1, 0]);
  } finally { await f.db.closeAsync(); }
});
