import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENUI_JSON_PARITY_FIXTURE, canonicalUiAction, quizItemSuccessQuestion,
  type UiAction, type UiDocument, type UiActionReceipt } from "@keating/learner-contracts";
import { CliQuizPerformanceStore, cliQuizPerformanceCanonical, cliQuizPerformanceDigest,
  type CliQuizPredictionEnvelope } from "../src/judgement/quiz-performance-store.js";
import { FileUiActionJournalStorage } from "../src/tui/ui/filesystem-journal.js";
import { UiActionJournalStore } from "../src/tui/ui/journal.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const NOW = Date.parse("2026-09-20T12:00:00.000Z");
function document(): UiDocument {
  const doc = structuredClone(OPENUI_JSON_PARITY_FIXTURE);
  doc.nodes = [{ type: "quiz", id: "quiz", title: "Bayes", questions: [
    { id: "item", kind: "multiple_choice", prompt: "What comes before the evidence?", choices: [{ id: "prior", label: "Prior" }, { id: "posterior", label: "Posterior" }], correctAnswer: "prior", hint: "Before." },
  ] }];
  return doc;
}
function prediction(doc = document(), attemptId = "attempt", id = "prediction"): CliQuizPredictionEnvelope {
  const node = doc.nodes[0]; if (node.type !== "quiz") throw Error("fixture");
  const source = { document: doc, history: [{ answer: "Earlier prior", timestamp: NOW - 1000 }], asOf: NOW - 100 };
  const question = quizItemSuccessQuestion(node.questions[0].id);
  return { documentId: doc.id, documentRevision: doc.revision, nodeId: node.id,
    source, sourceSha256: cliQuizPerformanceDigest(source), questionSha256: cliQuizPerformanceDigest(question),
    prediction: { schemaVersion: 1, id, attemptId, itemId: node.questions[0].id, itemSha256: cliQuizPerformanceDigest(node.questions[0]),
      createdAt: NOW - 50, backend: { backend: "system-one", model: "jev-1.13.0", calibrationSha256: null },
      question, probability: 0.99, source: "proxy" } };
}
function action(doc = document(), answer = "prior"): Extract<UiAction, { type: "complete-quiz" }> {
  return { schemaVersion: 1, type: "complete-quiz", documentId: doc.id, documentRevision: doc.revision, nodeId: "quiz", resultId: "result",
    answers: [{ questionId: "item", answer }], score: 1, partialCreditPoints: 1, partialCredits: { item: 1 },
    timing: { totalMs: 10, perQuestionMs: { item: 10 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: [], idempotencyKey: "submit" };
}
const prepared = () => ({ attemptId: "attempt", submittedAt: NOW + 10, hints: [] as string[], predictionIds: ["prediction"] });
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "keating-quiz-store-")); directories.push(cwd);
  const journal = new FileUiActionJournalStorage(cwd);
  let now = NOW;
  const store = new CliQuizPerformanceStore(cwd, journal, () => now);
  const dispatcher = new UiActionJournalStore({ storage: journal, now: () => new Date(now++).toISOString(), dispatcher: {
    dispatch: async (input, doc) => ({ schemaVersion: 1, documentId: doc.id, sourceRevision: doc.revision,
      actionIdempotencyKey: input.idempotencyKey, status: "completed", documentLifecycle: "completed",
      resultingDocument: { ...doc, revision: doc.revision + 1, lifecycle: "completed" } }),
  } });
  return { cwd, journal, store, dispatcher, setNow: (value: number) => { now = value; },
    path: (id: string) => join(cwd, ".keating/state/quiz-performance", `${cliQuizPerformanceDigest(id)}.json`) };
}
async function completed(args: Awaited<ReturnType<typeof setup>>, currentAction = action(), doc = document()) {
  args.setNow(NOW + 20);
  expect((await args.dispatcher.dispatch(currentAction, doc)).ok).toBe(true);
  args.setNow(NOW + 30);
}

test("durable journal completion joins persisted pre-answer predictions and survives reopening", async () => {
  const args = await setup(); await args.store.savePredictions([prediction()]);
  args.setNow(NOW + 10); expect(await args.store.linkCommitted(action(), document(), prepared())).toBe(0);
  await completed(args);
  expect(await args.store.linkCommitted(action(), document(), prepared())).toBe(1);
  expect(await args.store.linkCommitted(action(), document(), prepared())).toBe(0);
  const reopened = new CliQuizPerformanceStore(args.cwd, new FileUiActionJournalStorage(args.cwd), () => NOW + 40);
  expect((await reopened.read(document().id)).observations).toMatchObject([{ predictionId: "prediction", observed: 1,
    outcome: { correct: true, grading: "deterministic", hintUsed: false } }]);
  expect((await stat(args.path(document().id))).mode & 0o777).toBe(0o600);
});

test("objective grading ignores claimed score and a revealed hint makes observed success zero", async () => {
  for (const [answer, hints] of [["posterior", []], ["prior", ["item"]]] as const) {
    const args = await setup(); await args.store.savePredictions([prediction()]);
    const input = action(document(), answer); await completed(args, input);
    expect(await args.store.linkCommitted(input, document(), { ...prepared(), hints: [...hints] })).toBe(1);
    expect((await args.store.read(document().id)).observations[0].observed).toBe(0);
  }
});

test("blank, skipped, pending, and open-ended answers cannot become observed labels", async () => {
  for (const kind of ["blank", "skipped", "pending", "open"] as const) {
    const args = await setup(); const doc = document();
    if (kind === "open" && doc.nodes[0].type === "quiz") doc.nodes[0].questions[0] = { id: "item", kind: "short_answer", prompt: "Explain priors" };
    await args.store.savePredictions([prediction(doc)]);
    const input = action(doc, kind === "blank" || kind === "skipped" ? "" : "prior");
    if (kind === "pending" || kind === "open") { input.pendingGradeQuestionIds = ["item"]; input.partialCredits = {}; input.partialCreditPoints = 0; input.score = 0; }
    if (kind === "skipped") { input.skippedQuestionIds = ["item"]; input.answers = []; }
    await completed(args, input, doc);
    expect(await args.store.linkCommitted(input, doc, prepared())).toBe(0);
  }
});

test("receipt chronology, source identity, and canonical action must match the prepared attempt", async () => {
  const args = await setup(); await args.store.savePredictions([prediction()]); await completed(args);
  expect(await args.store.linkCommitted(action(), document(), { ...prepared(), submittedAt: NOW + 25 })).toBe(0);
  expect(await args.store.linkCommitted(action(), document(), { ...prepared(), hints: ["unknown"] })).toBe(0);
  expect(await args.store.linkCommitted(action(), document(), { ...prepared(), predictionIds: ["prediction", "prediction"] })).toBe(0);
  expect(await args.store.linkCommitted(action(), document(), { ...prepared(), attemptId: "other" })).toBe(0);
  expect(await args.store.linkCommitted(action(document(), "posterior"), document(), prepared())).toBe(0);
  const changed = document(); changed.title = "Changed source after prediction";
  expect(await args.store.linkCommitted(action(changed), changed, prepared())).toBe(0);
  args.setNow(NOW + 20); // Receipt updatedAt is +21, still in the future.
  expect(await args.store.linkCommitted(action(), document(), prepared())).toBe(0);
});

test("an old replay cannot attach predictions from a new attempt", async () => {
  const args = await setup(); await args.store.savePredictions([prediction()]); await completed(args);
  const original = await args.journal.load(document().id);
  // Simulate an interrupted lane restore: a new prediction is saved without the old receipt visible.
  await args.journal.withDocumentLock(document().id, () => args.journal.save({ ...original!, receipts: [] }));
  const fresh = prediction(document(), "new-attempt", "new-prediction"); fresh.prediction = { ...fresh.prediction, createdAt: NOW + 30 };
  await args.store.savePredictions([fresh]);
  await args.journal.withDocumentLock(document().id, () => args.journal.save(original!));
  args.setNow(NOW + 100);
  expect(await args.store.linkCommitted(action(), document(), { ...prepared(), submittedAt: NOW + 40, attemptId: "new-attempt", predictionIds: ["new-prediction"] })).toBe(0);
  const another = prediction(document(), "third-attempt", "third-prediction");
  await expect(args.store.savePredictions([another])).rejects.toThrow("already_started");
});

test("pending, retryable, accepted, and rejected journal receipts do not authorize evidence", async () => {
  for (const state of ["pending", "retryable", "accepted", "rejected"] as const) {
    const args = await setup(); await args.store.savePredictions([prediction()]);
    const a = action(); const receipt: UiActionReceipt = { schemaVersion: 1, action: a, actionFingerprint: canonicalUiAction(a), state,
      createdAt: new Date(NOW + 20).toISOString(), updatedAt: new Date(NOW + 21).toISOString(),
      ...(state === "pending" ? {} : { result: { schemaVersion: 1 as const, documentId: a.documentId, sourceRevision: a.documentRevision,
        actionIdempotencyKey: a.idempotencyKey, status: state, documentLifecycle: "ready" as const, ...(state === "retryable" ? { retryAfterMs: 0 } : {}) } }) };
    await args.journal.save({ kind: "keating-ui-action-journal", schemaVersion: 1, documentId: a.documentId, receipts: [receipt] });
    args.setNow(NOW + 40); expect(await args.store.linkCommitted(a, document(), prepared())).toBe(0);
  }
});

test("tampered source, questions, items, backend aliases and duplicate identity fail before persistence", async () => {
  const args = await setup();
  for (const change of [
    (row: CliQuizPredictionEnvelope) => { row.source.history.push("changed"); },
    (row: CliQuizPredictionEnvelope) => { row.questionSha256 = "a".repeat(64); },
    (row: CliQuizPredictionEnvelope) => { row.prediction = { ...row.prediction, itemSha256: "b".repeat(64) }; },
    (row: CliQuizPredictionEnvelope) => { row.prediction = { ...row.prediction, backend: { ...row.prediction.backend, model: "jev-latest" } }; },
    (row: CliQuizPredictionEnvelope) => { row.prediction = { ...row.prediction, backend: { ...row.prediction.backend, backend: "fixture" } }; },
    (row: CliQuizPredictionEnvelope) => { row.prediction = { ...row.prediction, backend: { ...row.prediction.backend, model: "fixture-v1" } }; },
    (row: CliQuizPredictionEnvelope) => { row.prediction = { ...row.prediction, createdAt: NOW + 1 }; },
  ]) { const row = prediction(); change(row); await expect(args.store.savePredictions([row])).rejects.toThrow(); }
  await args.store.savePredictions([prediction()]);
  const duplicate = prediction(); duplicate.prediction = { ...duplicate.prediction, probability: 0.1 };
  await expect(args.store.savePredictions([duplicate])).rejects.toThrow();
  expect((await args.store.read(document().id)).predictions).toHaveLength(1);
});

test("cross-instance saves serialize under the journal document lock", async () => {
  const args = await setup();
  const other = new CliQuizPerformanceStore(args.cwd, new FileUiActionJournalStorage(args.cwd), () => NOW);
  await Promise.all([args.store.savePredictions([prediction()]), other.savePredictions([prediction(document(), "second", "other")])]);
  expect((await args.store.read(document().id)).predictions).toHaveLength(2);
});

test("quota and symlink failures preserve previously saved evidence", async () => {
  const args = await setup(); await args.store.savePredictions([prediction()]);
  const before = await readFile(args.path(document().id), "utf8");
  await expect(args.store.savePredictions(Array.from({ length: 501 }, () => prediction()))).rejects.toThrow();
  const huge = prediction(document(), "large", "large"); huge.source.history = ["a".repeat(2 * 1024 * 1024)]; huge.sourceSha256 = cliQuizPerformanceDigest(huge.source);
  await expect(args.store.savePredictions([huge])).rejects.toThrow("limit");
  expect(await readFile(args.path(document().id), "utf8")).toBe(before);
  await rm(args.path(document().id));
  const target = join(args.cwd, "outside.json"); await writeFile(target, before); await symlink(target, args.path(document().id));
  await expect(args.store.read(document().id)).rejects.toThrow();
  await expect(args.store.savePredictions([prediction()])).rejects.toThrow();
  expect(await readFile(target, "utf8")).toBe(before);
  const second = await setup(); await mkdir(join(second.cwd, ".keating"));
  await symlink(args.cwd, join(second.cwd, ".keating/state"));
  await expect(second.store.savePredictions([prediction()])).rejects.toThrow("path_invalid");
});

test("raw exports retain evidence without inventing labels or calibration assignments", async () => {
  const args = await setup(); await args.store.savePredictions([prediction()]); await completed(args);
  await args.store.linkCommitted(action(), document(), prepared());
  const data = await args.store.read(document().id);
  expect(data.predictions[0].source.history).toEqual(prediction().source.history);
  expect(JSON.stringify(data)).not.toContain('"groupId"'); expect(JSON.stringify(data)).not.toContain('"split"');
  data.observations[0].observed = 0;
  await writeFile(args.path(document().id), JSON.stringify(data));
  await expect(args.store.read(document().id)).rejects.toThrow("evidence_invalid");
});

test("canonical digest is key-order stable and rejects lossy values", () => {
  expect(cliQuizPerformanceDigest({ b: 1, a: [2] })).toBe(cliQuizPerformanceDigest({ a: [2], b: 1 }));
  for (const value of [undefined, NaN, Infinity, Array(1), new Date(), { a: undefined }]) expect(() => cliQuizPerformanceCanonical(value)).toThrow();
});
