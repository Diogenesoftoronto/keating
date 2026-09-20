import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENUI_JSON_PARITY_FIXTURE, quizItemSuccessQuestion, type UiAction } from "@keating/learner-contracts";
import { CliQuizPerformanceStore, cliQuizPerformanceCanonical as canonical, cliQuizPerformanceDigest as digest, type CliQuizPredictionEnvelope } from "../src/judgement/quiz-performance-store.js";
import { FileUiActionJournalStorage } from "../src/tui/ui/filesystem-journal.js";
import { UiActionJournalStore } from "../src/tui/ui/journal.js";
import { fitCliQuizPerformance } from "../src/judgement/quiz-boosting-fit.js";
import { loadCliQuizFit } from "../src/judgement/quiz-fit-loader.js";
import { withLearnerProfile } from "../src/core/learner-profile-selection.js";
import { createCliQuizPerformanceController, QUIZ_FIT_FILE_ENV, QUIZ_FIT_SHA256_ENV } from "../src/judgement/cli-quiz-performance.js";

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

test("loader verifies complete source-bound reports and refuses repinned changes", async () => {
  const f = await fixture(), documents = [];
  for (let i = 0; i < 60; i++) {
    const id = String(i).padStart(2, "0");
    const positive = i < 2 ? i % 2 === 0 : i % 2 === 1;
    const row = await f.add(id, { answer: positive ? "yes" : "no", prompt: `${i % 2 ? "A longer synthetic question used for a deterministic test" : "Short"} ${id}` });
    row.predictions[0]!.split = i < 40 ? "fit" : "validation"; documents.push(row);
  }
  const fit = await fitCliQuizPerformance(f.cwd, { schemaVersion: 1, documents }, { ...options, train: async dataset => ({
    framework: { name: "catboost", version: "1.2.10", parameters: { depth: 3, iterations: 300 } },
    model: { features_info: { float_features: dataset.features.map((_, i) => ({ feature_index: i })) },
      scale_and_bias: [1, [0]], oblivious_trees: [{ splits: [{ split_type: "FloatFeature", float_feature_index: 2, border: 30 }], leaf_values: [-2, 2] }] },
  }) });
  const file = join(f.cwd, "fit.json");
  async function save(value: unknown) {
    const text = `${canonical(value)}\n`; await writeFile(file, text, { mode: 0o600 });
    return createHash("sha256").update(text).digest("hex");
  }
  const pin = await save(fit);
  const loaded = await loadCliQuizFit(f.cwd, "fit.json", pin, options);
  expect(loaded.method).toBe("shallow-tree"); expect(loaded.fitSha256).toBe(fit.fitSha256);
  expect(loaded.fileSha256).toBe(pin); expect(await loaded.current()).toBe(true);
  const question = { id: "new", kind: "multiple_choice" as const, prompt: "Short", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], correctAnswer: "a" };
  expect(loaded.predict(question, 0.8)).toBeCloseTo(0.05);
  expect(loaded.predict({ ...question, prompt: "A sufficiently long new question with a known objective answer" }, 0.8)).toBeCloseTo(0.95);
  expect(loaded.predict(question, NaN)).toBeNull();
  expect(loaded.predict({ ...question, kind: "open" as never }, 0.8)).toBeNull();
  expect(Object.isFrozen(loaded)).toBe(true); expect(Object.isFrozen(loaded.backend)).toBe(true);
  expect(await withLearnerProfile(f.cwd, "other", () => loaded.current())).toBe(false);
  const doc = structuredClone(OPENUI_JSON_PARITY_FIXTURE); doc.id = "new-projection-document";
  doc.nodes = [{ type: "quiz", id: "quiz", title: "Topic", questions: [question] }];
  const prior = await f.store.read(documents[3]!.documentId);
  const controller = createCliQuizPerformanceController({ cwd: f.cwd, document: doc, nodeId: "quiz", ...options,
    env: { [QUIZ_FIT_FILE_ENV]: "fit.json", [QUIZ_FIT_SHA256_ENV]: pin },
    history: async () => prior.observations,
    runtime: () => ({ current: () => true, call: async request => ({ ok: true, response: {
      backend: { backend: "system-one", model: "jev-1.13.0", calibrationSha256: null },
      answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: "noul", noul: 0.8 }])),
    } }) }) });
  expect(await controller.estimate()).toEqual({ ok: true, expectedCorrect: 0.05, rawExpectedCorrect: 0.8,
    itemCount: 1, estimateMethod: "shallow-tree", fitSha256: fit.fitSha256 });
  const persisted = (await new CliQuizPerformanceStore(f.cwd, undefined, options.now).read(doc.id)).predictions[0]!;
  expect(persisted.prediction.probability).toBe(0.8);
  expect(persisted.fitted).toMatchObject({ source: "proxy", probability: 0.05, method: "shallow-tree", fitSha256: fit.fitSha256, fileSha256: pin });
  controller.dispose();
  await expect(loadCliQuizFit(f.cwd, file, "0".repeat(64), options)).rejects.toThrow();
  for (const kind of ["tree", "metrics", "backend", "selection", "version", "hash"] as const) {
    const changed = structuredClone(fit);
    if (kind === "tree") changed.shallow.tree = { kind: "leaf", probability: 0.6, sampleSize: 40 };
    if (kind === "metrics") Object.assign(changed.boosting!.metrics, { brier: 0 });
    if (kind === "backend") Object.assign(changed.sourceBinding.sourceBackend, { model: "jev-other" });
    if (kind === "selection") changed.selected = "boosting";
    if (kind === "version") Object.assign(changed.boosting!.input.framework, { version: "9.9.9" });
    if (kind === "hash") changed.fitSha256 = "0".repeat(64);
    else { const { fitSha256: _, ...body } = changed; changed.fitSha256 = digest(body); }
    const changedPin = await save(changed);
    expect(await loaded.current()).toBe(false);
    await expect(loadCliQuizFit(f.cwd, file, changedPin, options)).rejects.toThrow();
  }
  const stronger = await fitCliQuizPerformance(f.cwd, { schemaVersion: 1, documents }, { ...options, train: async dataset => ({
    framework: { name: "catboost", version: "1.2.10", parameters: { depth: 3, iterations: 300 } },
    model: { features_info: { float_features: dataset.features.map((_, i) => ({ feature_index: i })) },
      scale_and_bias: [1, [0]], oblivious_trees: [{ splits: [{ split_type: "FloatFeature", float_feature_index: 2, border: 30 }], leaf_values: [-4, 4] }] },
  }) });
  const strongerPin = await save(stronger);
  const boosted = await loadCliQuizFit(f.cwd, file, strongerPin, options);
  expect(boosted.method).toBe("boosting"); expect(boosted.predict(question, 0.8)).toBeCloseTo(1 / (1 + Math.exp(4)), 12);
  await save(fit); expect(await loaded.current()).toBe(true); expect(await boosted.current()).toBe(false);
  const journal = (await f.journal.load(documents[0]!.documentId))!;
  await f.journal.save({ ...journal, receipts: [] });
  expect(await loaded.current()).toBe(false);
  await expect(loadCliQuizFit(f.cwd, file, pin, options)).rejects.toThrow();
}, 30_000);

test("insufficient source reports never yield a projection", async () => {
  const f = await fixture(), row = await f.add("small");
  const fit = await fitCliQuizPerformance(f.cwd, { schemaVersion: 1, documents: [row] }, { ...options,
    train: async () => { throw new Error("must not train"); } });
  const file = join(f.cwd, "fit.json"), text = `${canonical(fit)}\n`;
  await writeFile(file, text, { mode: 0o600 });
  const pin = createHash("sha256").update(text).digest("hex");
  await expect(loadCliQuizFit(f.cwd, file, pin, options)).rejects.toThrow();
});
