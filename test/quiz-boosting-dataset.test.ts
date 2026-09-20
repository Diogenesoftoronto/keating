import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENUI_JSON_PARITY_FIXTURE, quizItemSuccessQuestion, type UiAction } from "@keating/learner-contracts";
import { CliQuizPerformanceStore, cliQuizPerformanceDigest as digest, type CliQuizPredictionEnvelope } from "../src/judgement/quiz-performance-store.js";
import { FileUiActionJournalStorage } from "../src/tui/ui/filesystem-journal.js";
import { UiActionJournalStore } from "../src/tui/ui/journal.js";
import { buildCliQuizBoostingDataset } from "../src/judgement/quiz-boosting-dataset.js";
import { exportCliQuizBoostingDataset } from "../scripts/training/build-quiz-boosting-dataset.js";
import { fitCliQuizPerformance } from "../src/judgement/quiz-boosting-fit.js";
import { exportCliQuizPerformanceFit } from "../scripts/training/fit-quiz-performance.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const NOW = Date.parse("2026-09-20T12:00:00Z");
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "quiz-boosting-")); dirs.push(cwd);
  const journal = new FileUiActionJournalStorage(cwd);
  let clock = NOW;
  const store = new CliQuizPerformanceStore(cwd, journal, () => clock);
  const dispatcher = new UiActionJournalStore({ storage: journal, now: () => new Date(clock++).toISOString(), dispatcher: {
    dispatch: async (a, d) => ({ schemaVersion: 1, documentId: d.id, sourceRevision: d.revision, actionIdempotencyKey: a.idempotencyKey,
      status: "completed", documentLifecycle: "completed", resultingDocument: { ...d, revision: d.revision + 1, lifecycle: "completed" } }),
  } });
  async function add(id: string, { answer = "yes", hint = false, model = "jev-1.13.0", itemId = id, attemptId = `attempt-${id}`, prompt = `Pick the right answer for ${itemId}` } = {}) {
    const doc = structuredClone(OPENUI_JSON_PARITY_FIXTURE); doc.id = `doc-${id}`;
    const item = { id: itemId, kind: "multiple_choice" as const, prompt, choices: [{ id: "yes", label: "Correct" }, { id: "no", label: "Wrong" }], correctAnswer: "yes", hint: "Think again" };
    doc.nodes = [{ id: "quiz", type: "quiz", title: "Topic", questions: [item] }];
    const source = { document: doc, history: [{ source: "prior work" }], asOf: NOW - 100 }, question = quizItemSuccessQuestion(itemId);
    const row: CliQuizPredictionEnvelope = { documentId: doc.id, documentRevision: doc.revision, nodeId: "quiz", source,
      sourceSha256: digest(source), questionSha256: digest(question), prediction: { schemaVersion: 1, id: `p-${id}`, attemptId,
        itemId, itemSha256: digest(item), createdAt: NOW - 50, probability: 0.8, source: "proxy", question,
        backend: { backend: "system-one", model, calibrationSha256: null } } };
    clock = NOW; await store.savePredictions([row]);
    const action: Extract<UiAction, { type: "complete-quiz" }> = { schemaVersion: 1, type: "complete-quiz", documentId: doc.id,
      documentRevision: doc.revision, nodeId: "quiz", resultId: "result", answers: [{ questionId: itemId, answer }],
      score: 1, partialCreditPoints: 1, partialCredits: { [itemId]: 1 }, timing: { totalMs: 10, perQuestionMs: { [itemId]: 10 } },
      flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: [], idempotencyKey: `submit-${id}` };
    clock = NOW + 20; expect((await dispatcher.dispatch(action, doc)).ok).toBe(true);
    clock = NOW + 30; expect(await store.linkCommitted(action, doc, { attemptId, submittedAt: NOW + 10, hints: hint ? [itemId] : [], predictionIds: [row.prediction.id] })).toBe(1);
    return { documentId: doc.id, predictions: [{ predictionId: row.prediction.id, groupId: `group-${id}`, split: "fit" as "fit" | "validation" }] };
  }
  return { cwd, journal, store, add, file: (id: string) => join(cwd, ".keating/state/quiz-performance", `${digest(id)}.json`) };
}
const options = { now: () => NOW + 100 };

test("actual store and completed journal produce reproducible pre-answer features, observed labels and bindings", async () => {
  const f = await fixture(), a = await f.add("a"), b = await f.add("b", { hint: true }), c = await f.add("c", { answer: "no" });
  c.predictions[0]!.split = "validation";
  const first = await buildCliQuizBoostingDataset(f.cwd, { schemaVersion: 1, documents: [c, b, a] }, options);
  const second = await buildCliQuizBoostingDataset(f.cwd, { schemaVersion: 1, documents: [a, b, c] }, options);
  expect(second).toEqual(first);
  expect(first.dataset.observations.map(r => r.label)).toEqual([1, 0, 0]);
  expect(first.dataset.observations.every(r => r.baseline === 0.8 && r.features.jevProbability === 0.8)).toBe(true);
  expect(first.dataset.features).not.toContain("hintUsed"); expect(first.dataset.features).not.toContain("correct");
  expect(first.binding.sourceBackend.calibrationSha256).toBeNull();
  expect(first.binding.datasetSha256).toBe(digest(first.dataset)); expect(first.binding.provenance).toHaveLength(3);
});

test("tampered self-consistent correctness is rejected by regrading the original committed action", async () => {
  const f = await fixture(), a = await f.add("a", { answer: "no" });
  const data = JSON.parse(await readFile(f.file(a.documentId), "utf8")); data.observations[0].outcome.correct = true; data.observations[0].observed = 1;
  await writeFile(f.file(a.documentId), JSON.stringify(data));
  await expect(buildCliQuizBoostingDataset(f.cwd, { schemaVersion: 1, documents: [a] }, options)).rejects.toThrow();
});

test("missing or no-longer-completed journal cannot supply an observed training row", async () => {
  const f = await fixture(), a = await f.add("a");
  const journal = (await f.journal.load(a.documentId))!;
  await f.journal.save({ ...journal, receipts: [] });
  await expect(buildCliQuizBoostingDataset(f.cwd, { schemaVersion: 1, documents: [a] }, options)).rejects.toThrow();
});

test("mixed backends, repeated item/attempt groups, unknown and duplicate selections are rejected", async () => {
  for (const kind of ["backend", "item", "attempt", "missing", "duplicate"] as const) {
    const f = await fixture(), a = await f.add("a", { itemId: "shared", attemptId: "same-attempt" });
    const b = await f.add("b", { ...(kind === "backend" ? { model: "jev-1.14.0" } : {}),
      ...(kind === "item" ? { itemId: "shared" } : {}), ...(kind === "attempt" ? { attemptId: "same-attempt" } : {}) });
    b.predictions[0]!.split = "validation";
    if (kind === "missing") a.predictions[0]!.predictionId = "absent";
    const documents = kind === "duplicate" ? [a, a] : [a, b];
    await expect(buildCliQuizBoostingDataset(f.cwd, { schemaVersion: 1, documents }, options)).rejects.toThrow();
  }
});

test("identical task content with regenerated IDs stays in one group and split", async () => {
  const f = await fixture();
  const a = await f.add("a", { prompt: "Pick the same correct answer" });
  const b = await f.add("b", { prompt: "Pick the same correct answer" });
  const selection = { schemaVersion: 1, documents: [a, b] };
  await expect(buildCliQuizBoostingDataset(f.cwd, selection, options)).rejects.toThrow();
  b.predictions[0]!.split = "validation";
  await expect(buildCliQuizBoostingDataset(f.cwd, selection, options)).rejects.toThrow();
  b.predictions[0]!.groupId = a.predictions[0]!.groupId;
  b.predictions[0]!.split = "fit";
  const built = await buildCliQuizBoostingDataset(f.cwd, selection, options);
  expect(built.binding.provenance[0]!.itemSha256).not.toBe(built.binding.provenance[1]!.itemSha256);
  expect(built.binding.provenance[0]!.taskContentSha256).toBe(built.binding.provenance[1]!.taskContentSha256);
});

test("export writes new private fitter inputs and cannot overwrite an existing directory", async () => {
  const f = await fixture(), a = await f.add("a"), output = join(f.cwd, "export");
  const selection = { schemaVersion: 1, documents: [a] };
  const receipt = await exportCliQuizBoostingDataset(f.cwd, selection, output, options);
  expect(receipt.rows).toBe(1); expect((await stat(output)).mode & 0o777).toBe(0o700);
  const original = await readFile(join(output, "dataset.json"), "utf8");
  expect((await stat(join(output, "binding.json"))).mode & 0o777).toBe(0o600);
  await expect(exportCliQuizBoostingDataset(f.cwd, selection, output, options)).rejects.toThrow();
  expect(await readFile(join(output, "dataset.json"), "utf8")).toBe(original);
});

test("an insufficient source dataset writes a private report without calling a trainer", async () => {
  const f = await fixture(), a = await f.add("a"), output = join(f.cwd, "fit");
  let calls = 0;
  const train = async () => { calls++; throw new Error("must not train"); };
  const selection = { schemaVersion: 1, documents: [a] };
  const result = await exportCliQuizPerformanceFit(f.cwd, selection, output, { ...options, train });
  expect(result.selected).toBeNull(); expect(result.shallowStatus).toBe("insufficient"); expect(calls).toBe(0);
  expect((await stat(join(output, "quiz-fit.json"))).mode & 0o777).toBe(0o600);
  await expect(exportCliQuizPerformanceFit(f.cwd, selection, output, { ...options, train })).rejects.toThrow(); expect(calls).toBe(0);
});

test("source-bound fit gates the ensemble, preserves the better shallow tree and rejects source changes", async () => {
  const f = await fixture(); const documents = [];
  for (let i = 0; i < 60; i++) {
    const id = String(i).padStart(2, "0");
    const row = await f.add(id, { answer: i % 2 ? "yes" : "no", prompt: `${i % 2 ? "A longer synthetic question used for a deterministic test" : "Short"} ${id}` });
    row.predictions[0]!.split = i < 40 ? "fit" : "validation"; documents.push(row);
  }
  const selection = { schemaVersion: 1, documents };
  let calls = 0;
  const train = async (dataset: import("../src/judgement/boosting-artifact.js").BoostingDataset) => {
    calls++;
    // Deliberately weaker synthetic model; production training has its own parity check.
    return { framework: { name: "catboost", version: "1.2.10", parameters: { depth: 3, iterations: 300 } },
      model: { features_info: { float_features: dataset.features.map((_, i) => ({ feature_index: i })) },
        scale_and_bias: [1, [0]], oblivious_trees: [{ splits: [{ split_type: "FloatFeature", float_feature_index: 2, border: 30 }], leaf_values: [-3, 3] }] } };
  };
  const fit = await fitCliQuizPerformance(f.cwd, selection, { ...options, train });
  expect(calls).toBe(1); expect(fit.selected).toBe("shallow-tree"); expect(fit.shallow.comparison?.candidateBrier).toBe(0);
  expect(fit.boosting?.status).toBe("validated"); expect(fit.sourceBinding.provenance).toHaveLength(60);
  const { fitSha256, ...evidence } = fit; expect(fitSha256).toBe(digest(evidence));
  await expect(fitCliQuizPerformance(f.cwd, selection, { ...options, train: async dataset => {
    const journal = (await f.journal.load(documents[0]!.documentId))!;
    await f.journal.save({ ...journal, receipts: [] });
    return train(dataset);
  } })).rejects.toThrow();
}, 20_000);
