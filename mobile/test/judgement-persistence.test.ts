import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LearnerQuestionCheck, PortableLearnerData, UiAction, UiDocument } from "@keating/learner-contracts";
import { initializeRepositorySchema, LearnerRecordStore, UiActionStore, type AsyncSqlDatabase, type AsyncSqlExecutor, type SqlBindValue } from "../src/lib/learner-repository";
import { MobileJudgementReviewStore, mobileJudgementReviewIsCurrent } from "../src/lib/learner-repository/judgement-reviews";
import { mobileQuestionReviewInputs, reviewMobileQuestionChecks, type MobileQuestionJudgement } from "../src/lib/judgement/grading";
import { createMobileJudgementRuntime } from "../src/lib/judgement/runtime";
import { applyLocalUiAction } from "../src/lib/ui-action-mutations";

const AT = "2026-09-19T00:00:00.000Z";
class Sqlite implements AsyncSqlDatabase {
  db: Database;
  constructor(path = ":memory:") { this.db = new Database(path); }
  async execAsync(sql: string) { this.db.exec(sql); }
  async runAsync(sql: string, ...params: SqlBindValue[]) { const r = this.db.query(sql).run(...params); return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) }; }
  async getFirstAsync<T>(sql: string, ...params: SqlBindValue[]) { return this.db.query(sql).get(...params) as T | null; }
  async getAllAsync<T>(sql: string, ...params: SqlBindValue[]) { return this.db.query(sql).all(...params) as T[]; }
  async withExclusiveTransactionAsync(work: (transaction: AsyncSqlExecutor) => Promise<void>) {
    this.db.exec("BEGIN IMMEDIATE"); try { await work(this); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  async closeAsync() { this.db.close(); }
}
const check: LearnerQuestionCheck = { id: "answer-1", question: "What is half?", answer: "One of two equal parts.", topic: "Fractions", grading: "pending", createdAt: AT };
const input = { check, documentId: "lesson", input: { id: check.id, question: check.question, learnerAnswer: check.answer, referenceAnswer: "Half of a whole" } };
const empty: PortableLearnerData = { generatedAt: AT, sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [], studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [], learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };

async function fixture(path?: string) {
  const db = new Sqlite(path); await initializeRepositorySchema(db);
  const records = new LearnerRecordStore(db); await records.replace({ ...empty, questionChecks: [check] });
  const [pending] = await reviewMobileQuestionChecks([input.input], createMobileJudgementRuntime({ hostedEnabled: false }));
  const judgement: MobileQuestionJudgement = { ...pending, evidenceKind: "model-estimate", proposal: {
    verdict: "correct", credit: 1, evidenceQuote: check.answer,
    backend: { backend: "system-one", model: "jev-1.13.0", calibrationSha256: null },
    score: { type: "score", score: 4, confidence: 0.99, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 }, legend: { "0": "wrong", "1": "poor", "2": "partial", "3": "good", "4": "correct" } },
  } };
  return { db, records, reviews: new MobileJudgementReviewStore(db), judgement };
}

test("v5 migration preserves answers and separate estimate survives reopen without a final score", async () => {
  const directory = await mkdtemp(join(tmpdir(), "keating-mobile-judgement-"));
  const path = join(directory, "learner.sqlite");
  const { db, records, reviews, judgement } = await fixture(path);
  let reopenedDb: Sqlite | undefined;
  let originalClosed = false;
  try {
  // Model a populated prior-version repository: migration creates only the new table.
  await db.execAsync("DROP TABLE judgement_reviews; UPDATE repository_meta SET value = '5' WHERE key = 'schema_version';");
  await initializeRepositorySchema(db);
  expect((await records.snapshot()).questionChecks).toEqual([check]);
  expect(await reviews.saveIfCurrent(input, judgement, AT)).toBe(true);
  await db.closeAsync(); originalClosed = true;
  reopenedDb = new Sqlite(path);
  await initializeRepositorySchema(reopenedDb);
  const reopened = new MobileJudgementReviewStore(reopenedDb);
  const reopenedRecords = new LearnerRecordStore(reopenedDb);
  const [saved] = await reopened.list();
  expect(saved.judgement.proposal?.backend.model).toBe("jev-1.13.0");
  expect(saved.judgement.proposal?.evidenceQuote).toBe(check.answer);
  expect((await reopenedRecords.snapshot()).questionChecks[0]).toEqual(check);
  expect(mobileJudgementReviewIsCurrent(saved, check)).toBe(true);
  expect(await reopened.saveIfCurrent(input, judgement, AT)).toBe(false);
  await reopenedRecords.mutatePortable(current => ({ ...current, generatedAt: AT }));
  expect(await reopened.list()).toHaveLength(1);
  await reopenedRecords.clear(); expect(await reopened.list()).toEqual([]);
  } finally {
    if (!originalClosed) await db.closeAsync();
    await reopenedDb?.closeAsync();
    await rm(directory, { recursive: true, force: true });
  }
});

test("late estimates cannot overwrite changed answers, teacher grading, feedback or deleted work", async () => {
  for (const changed of [{ ...check, answer: "Revised answer" }, { ...check, grading: "model" as const, score: 0.5 }, { ...check, misconception: "Teacher feedback" }, null]) {
    const { db, records, reviews, judgement } = await fixture();
    await records.replace({ ...empty, questionChecks: changed ? [changed] : [] });
    expect(await reviews.saveIfCurrent(input, judgement, AT)).toBe(false);
    expect(await reviews.list()).toEqual([]);
    expect((await records.snapshot()).questionChecks).toEqual(changed ? [changed] : []);
    await db.closeAsync();
  }
});

test("malformed evidence is rejected atomically; deterministic exact grade and provenance commit together", async () => {
  const { db, records, reviews, judgement } = await fixture();
  await expect(reviews.saveIfCurrent(input, { ...judgement, proposal: { ...judgement.proposal!, evidenceQuote: "Invented words" } }, AT)).rejects.toThrow("Invalid judgement review");
  expect((await records.snapshot()).questionChecks).toEqual([check]); expect(await reviews.list()).toEqual([]);
  const source = { ...input, input: { ...input.input, referenceAnswer: check.answer } };
  const [exact] = await reviewMobileQuestionChecks([source.input], createMobileJudgementRuntime({ hostedEnabled: false }));
  expect(await reviews.saveIfCurrent(source, exact, AT)).toBe(true);
  expect((await records.snapshot()).questionChecks[0]).toMatchObject({ grading: "auto", score: 1 });
  expect((await reviews.list())[0].judgement.evidenceKind).toBe("deterministic");
  await db.closeAsync();
});

test("real canonical submission commits answer and journal before deferred judgement, with objective grading unchanged", async () => {
  const db = new Sqlite(); await initializeRepositorySchema(db);
  const records = new LearnerRecordStore(db); await records.replace(empty);
  const document: UiDocument = { schemaVersion: 1, id: "lesson", revision: 0, lifecycle: "ready", supportedSurfaces: ["mobile"], createdAt: AT, updatedAt: AT,
    nodes: [{ type: "question-group", id: "group", topic: "Fractions", questions: [
      { id: "open", prompt: check.question, kind: "short_answer", correctAnswer: "Half of a whole" },
      { id: "objective", prompt: "Which is half?", kind: "choice", choices: [{ id: "half", label: "1/2" }, { id: "third", label: "1/3" }], correctAnswer: "half" },
      { id: "preference", prompt: "What do you want to study?", kind: "text" },
    ] }] };
  const action: UiAction = { schemaVersion: 1, type: "submit-question-group", documentId: document.id, documentRevision: 0, nodeId: "group", idempotencyKey: "submit-1",
    responses: [{ questionId: "open", type: "text", answer: check.answer }, { questionId: "objective", type: "choice", optionIds: ["half"] }, { questionId: "preference", type: "text", answer: "Decimals" }] };
  const actions = new UiActionStore(db);
  const result = await actions.dispatch(action, document, (current, now) => applyLocalUiAction(current, action, document, now));
  expect(result.status).toBe("completed");
  const saved = await records.snapshot();
  expect(saved.questionChecks.find(c => c.question === check.question)).toMatchObject({ grading: "pending", answer: check.answer });
  expect(saved.questionChecks.find(c => c.question === "Which is half?")).toMatchObject({ grading: "auto", score: 1 });
  const inputs = mobileQuestionReviewInputs(saved.questionChecks, document);
  expect(inputs).toHaveLength(1); expect(inputs[0].input.referenceAnswer).toBe("Half of a whole");
  let finish!: () => void;
  const delayed = new Promise<void>(resolve => { finish = resolve; });
  const background = reviewMobileQuestionChecks(inputs.map(value => value.input), createMobileJudgementRuntime({ hostedEnabled: true, request: async () => { await delayed; return new Response(null, { status: 503 }); } }));
  expect((await records.snapshot()).questionChecks).toHaveLength(3);
  expect((await actions.getJournal(document.id)).receipts).toHaveLength(1);
  finish(); const [review] = await background;
  expect(review.final.grading).toBe("pending"); expect(review.proposal).toBeNull();
  await db.closeAsync();
});
