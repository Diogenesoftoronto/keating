import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENUI_JSON_PARITY_FIXTURE, type JudgementCaller, type UiAction, type UiDocument } from "@keating/learner-contracts";
import { createCliQuizPerformanceController, exportCliQuizPerformanceEvidence, loadCliQuizPerformanceHistory, QUIZ_FIT_FILE_ENV, QUIZ_FIT_SHA256_ENV } from "../src/judgement/cli-quiz-performance.js";
import { QUIZ_BOOSTING_TARGET } from "../packages/learner-contracts/src/judgement/quiz-boosting-features.js";
import { CliQuizPerformanceStore } from "../src/judgement/quiz-performance-store.js";
import { FileUiActionJournalStorage } from "../src/tui/ui/filesystem-journal.js";
import { UiActionJournalStore } from "../src/tui/ui/journal.js";

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function workspace() { const path = await mkdtemp(join(tmpdir(), "keating-quiz-prediction-")); paths.push(path); return path; }
function document(): UiDocument {
  const doc = structuredClone(OPENUI_JSON_PARITY_FIXTURE);
  doc.nodes = [{ type: "quiz", id: "quiz", title: "Bayes", questions: [
    { id: "item", kind: "multiple_choice", prompt: "What comes before the evidence?", choices: [{ id: "prior", label: "Prior" }, { id: "posterior", label: "Posterior" }], correctAnswer: "prior", hint: "Before." },
  ] }];
  return doc;
}
function action(doc: UiDocument): UiAction {
  return { schemaVersion: 1, type: "complete-quiz", documentId: doc.id, documentRevision: doc.revision, nodeId: "quiz", resultId: "result",
    answers: [{ questionId: "item", answer: "prior" }], score: 1, partialCreditPoints: 1, partialCredits: { item: 1 },
    timing: { totalMs: 10, perQuestionMs: { item: 10 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: [], idempotencyKey: "submit" };
}
const call: JudgementCaller = async request => ({ ok: true, response: { backend: { backend: "system-one", model: "jev-1.13.0", calibrationSha256: null },
  answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: "noul", noul: 0.8 }])) } });
const history = async () => [{ question: "Earlier work", answer: "Prior", correct: true, assessedAt: 1 }];

const fitEnv = () => ({ [QUIZ_FIT_FILE_ENV]: "/private/quiz-fit.json", [QUIZ_FIT_SHA256_ENV]: "a".repeat(64) });
const loadedFit = () => ({ fitSha256: "b".repeat(64), fileSha256: "a".repeat(64), target: QUIZ_BOOSTING_TARGET,
  method: "shallow-tree" as const, backend: { backend: "system-one" as const, model: "jev-1.13.0", calibrationSha256: null },
  predict: () => 0.25, current: async () => true });

test("fitted estimate persists a separate proxy and leaves the original model receipt untouched", async () => {
  const cwd = await workspace(), doc = document(), store = new CliQuizPerformanceStore(cwd);
  const controller = createCliQuizPerformanceController({ cwd, document: doc, nodeId: "quiz", store, history,
    env: fitEnv(), loadFit: async () => loadedFit(), runtime: () => ({ current: () => true, call }) });
  expect(await controller.estimate()).toEqual({ ok: true, expectedCorrect: 0.25, rawExpectedCorrect: 0.8,
    itemCount: 1, estimateMethod: "shallow-tree", fitSha256: "b".repeat(64) });
  const saved = (await store.read(doc.id)).predictions[0]!;
  expect(saved.prediction.probability).toBe(0.8);
  expect(saved.fitted).toMatchObject({ source: "proxy", probability: 0.25, method: "shallow-tree", fileSha256: "a".repeat(64) });
  const invalid = structuredClone(saved); (invalid.fitted as unknown as { source: string }).source = "observed";
  await expect(store.savePredictions([invalid])).rejects.toThrow();
});

test("configured missing pins and unavailable fits fail before hosted inference", async () => {
  for (const env of [{ [QUIZ_FIT_FILE_ENV]: "/missing" }, fitEnv()]) {
    let calls = 0;
    const controller = createCliQuizPerformanceController({ cwd: await workspace(), document: document(), nodeId: "quiz", history, env,
      loadFit: async () => { throw new Error("private file details"); }, runtime: () => ({ current: () => true, call: async request => { calls++; return call(request); } }) });
    expect(await controller.estimate()).toEqual({ ok: false, reason: "fit-unavailable" }); expect(calls).toBe(0);
  }
});

test("fit backend, configuration and source changes cannot publish a fitted estimate", async () => {
  for (const kind of ["backend", "config", "source", "after-save"] as const) {
    const fit = loadedFit(), env = fitEnv(); let saves = 0;
    if (kind === "backend") fit.backend.model = "jev-1.14.0";
    fit.current = async () => kind !== "source" && !(kind === "after-save" && saves > 0);
    const controller = createCliQuizPerformanceController({ cwd: await workspace(), document: document(), nodeId: "quiz", history, env,
      loadFit: async () => fit, runtime: () => ({ current: () => true, call: async request => {
        if (kind === "config") env[QUIZ_FIT_SHA256_ENV] = "c".repeat(64);
        return call(request);
      } }), store: { savePredictions: async () => { saves++; }, linkCommitted: async () => 0 } });
    expect(await controller.estimate()).toEqual({ ok: false, reason: kind === "backend" ? "fit-backend-mismatch" : "source-changed" });
    expect(saves).toBe(kind === "after-save" ? 1 : 0);
  }
});

test("answer interaction cancels a non-cooperative fit load before inference or persistence", async () => {
  let release!: (fit: ReturnType<typeof loadedFit>) => void, started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; }); let calls = 0;
  const controller = createCliQuizPerformanceController({ cwd: await workspace(), document: document(), nodeId: "quiz", history, env: fitEnv(),
    loadFit: () => { started(); return new Promise(resolve => { release = resolve; }); },
    runtime: () => ({ current: () => true, call: async request => { calls++; return call(request); } }) });
  const pending = controller.estimate(); await began; controller.touch();
  expect(await pending).toEqual({ ok: false, reason: "cancelled" }); release(loadedFit()); await Promise.resolve(); expect(calls).toBe(0);
});

test("pre-answer prediction joins a real completed journal, freezes hint use, and exports privately", async () => {
  const cwd = await workspace(), doc = document(); let time = Date.now() - 1000;
  const journal = new FileUiActionJournalStorage(cwd);
  const store = new CliQuizPerformanceStore(cwd, journal, () => time);
  let calls = 0;
  const controller = createCliQuizPerformanceController({ cwd, document: doc, nodeId: "quiz", now: () => time, store, history,
    runtime: () => ({ current: () => true, call: async request => {
      calls++; expect(JSON.stringify(request)).not.toContain('"answers"'); return call(request);
    } }) });
  expect(await controller.estimate()).toEqual({ ok: true, expectedCorrect: 0.8, itemCount: 1 });
  time += 10; controller.hint("item");
  expect((await controller.estimate()).ok).toBe(false); expect(calls).toBe(1);
  const input = action(doc); time += 10; controller.prepareSubmission(input);
  expect(await controller.collectCommitted(input, doc)).toBe(0);
  const dispatcher = new UiActionJournalStore({ storage: journal, now: () => new Date(++time).toISOString(), dispatcher: {
    dispatch: async (input, source) => ({ schemaVersion: 1, documentId: source.id, sourceRevision: source.revision,
      actionIdempotencyKey: input.idempotencyKey, status: "completed", documentLifecycle: "completed",
      resultingDocument: { ...source, revision: source.revision + 1, lifecycle: "completed" } }),
  } });
  expect((await dispatcher.dispatch(input, doc)).ok).toBe(true);
  controller.dispose(); // An already prepared successful delivery can finish after closing its view.
  expect(await controller.collectCommitted(input, doc)).toBe(1);
  expect(await controller.collectCommitted(input, doc)).toBe(0);
  const evidence = await store.read(doc.id);
  expect(evidence.observations[0]).toMatchObject({ observed: 0, outcome: { correct: true, hintUsed: true } });
  const exported = await exportCliQuizPerformanceEvidence(cwd, doc.id);
  expect((await stat(exported.path)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(exported.path, "utf8"))).toMatchObject({ calibration: "unfitted", scope: "device-local" });
});

test("touching an answer during an uncancellable request prevents a saved estimate", async () => {
  const cwd = await workspace(); let release!: (value: Awaited<ReturnType<JudgementCaller>>) => void, started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; }); let saves = 0;
  const controller = createCliQuizPerformanceController({ cwd, document: document(), nodeId: "quiz", history,
    runtime: () => ({ current: () => true, call: () => { started(); return new Promise(resolve => { release = resolve; }); } }),
    store: { savePredictions: async () => { saves++; }, linkCommitted: async () => 0 } });
  const pending = controller.estimate(); await began; controller.touch();
  expect(await pending).toEqual({ ok: false, reason: "cancelled" });
  release(await call({ state: {}, questions: {} })); await Promise.resolve();
  expect(saves).toBe(0); expect((await controller.estimate()).ok).toBe(false);
});

test("deadline releases the UI even when a backend ignores abort", async () => {
  const cwd = await workspace();
  const controller = createCliQuizPerformanceController({ cwd, document: document(), nodeId: "quiz", history, timeoutMs: 5,
    runtime: () => ({ current: () => true, call: async () => new Promise(() => {}) }) });
  expect(await controller.estimate()).toEqual({ ok: false, reason: "cancelled" });
});

test("source, account, and history changes discard late results", async () => {
  for (const change of ["source", "account", "history"] as const) {
    const cwd = await workspace(), doc = document(); let current = true, changed = false, saves = 0;
    const controller = createCliQuizPerformanceController({ cwd, document: doc, nodeId: "quiz",
      history: async () => [{ answer: changed ? "changed" : "original" }],
      runtime: () => ({ current: () => current, call: async request => {
        if (change === "source") doc.title = "Different";
        if (change === "account") current = false;
        if (change === "history") changed = true;
        return call(request);
      } }), store: { savePredictions: async () => { saves++; }, linkCommitted: async () => 0 } });
    expect((await controller.estimate()).ok).toBe(false); expect(saves).toBe(0);
  }
});

test("aliases, fixture identities, incomplete answers, and invalid probabilities are refused", async () => {
  for (const invalid of ["jev-latest", "fixture-model", "missing", "nan"]) {
    const cwd = await workspace(); let saves = 0;
    const controller = createCliQuizPerformanceController({ cwd, document: document(), nodeId: "quiz", history,
      runtime: () => ({ current: () => true, call: async () => ({ ok: true, response: {
        backend: { backend: "system-one", model: invalid === "missing" || invalid === "nan" ? "jev-1.13.0" : invalid, calibrationSha256: null },
        answers: invalid === "missing" ? {} : { item_0: { type: "noul", noul: invalid === "nan" ? NaN : 0.8 } },
      } }) }), store: { savePredictions: async () => { saves++; }, linkCommitted: async () => 0 } });
    expect(await controller.estimate()).toEqual({ ok: false, reason: "response-malformed" }); expect(saves).toBe(0);
  }
});

test("missing account never uses direct API env overrides and empty history never calls inference", async () => {
  const cwd = await workspace(); let calls = 0;
  const controller = createCliQuizPerformanceController({ cwd, document: document(), nodeId: "quiz", history,
    env: { TYPESAFE_API_KEY: "never-send", KEATING_JUDGEMENT_DIRECT: "true" },
    transport: { loadCredential: () => null, fetch: async () => { calls++; throw new Error("unexpected"); } } });
  expect(await controller.estimate()).toEqual({ ok: false, reason: "judgement-unavailable" });
  const empty = createCliQuizPerformanceController({ cwd, document: document(), nodeId: "quiz", history: async () => [],
    runtime: () => ({ current: () => true, call: async request => { calls++; return call(request); } }) });
  expect(await empty.estimate()).toEqual({ ok: false, reason: "no-history" }); expect(calls).toBe(0);
});

test("failed persistence, same-tick answers, changed actions and expired predictions never link", async () => {
  for (const invalid of ["persistence", "same-tick", "changed-action", "expired"]) {
    const cwd = await workspace(), doc = document(); let time = 1000, links = 0;
    const controller = createCliQuizPerformanceController({ cwd, document: doc, nodeId: "quiz", now: () => time, history,
      runtime: () => ({ current: () => true, call }), store: {
        savePredictions: async () => { if (invalid === "persistence") throw new Error("disk full"); },
        linkCommitted: async () => { links++; return 1; },
      } });
    expect((await controller.estimate()).ok).toBe(invalid !== "persistence");
    if (invalid !== "same-tick") time += invalid === "expired" ? 16 * 60_000 : 10;
    const input = action(doc); controller.prepareSubmission(input);
    if (invalid === "changed-action") controller.prepareSubmission({ ...input, idempotencyKey: "different" });
    expect(await controller.collectCommitted(input, doc)).toBe(0); expect(links).toBe(0);
  }
});

test("history includes only prior same-topic objective work and labels profile estimates", async () => {
  const cwd = await workspace(); const directory = join(cwd, ".keating/state/quiz-submissions"); await mkdir(directory, { recursive: true });
  const now = Date.now();
  for (const [suffix, title, offset] of [["previous", "Bayes", -1000], ["futurexx", "Bayes", 1000], ["unrelated", "Geometry", -1000]] as const) {
    const id = `quiz-${suffix}`;
    await writeFile(join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 1, id, createdAt: new Date(now + offset).toISOString(),
      quiz: { slug: title, questions: [{ id: "objective", question: "Earlier question" }, { id: "open", question: "Explain" }] },
      answers: { objective: "Earlier answer", open: "Unreviewed" }, objectiveResults: { objective: true } }));
  }
  await writeFile(join(cwd, ".keating/state/learner.json"), JSON.stringify({ profile: { priorKnowledge: 0.4, privateNote: "DO NOT SHARE" }, coveredTopics: [] }));
  const prior = await loadCliQuizPerformanceHistory(cwd, "Bayes", now);
  expect(prior).toHaveLength(2); expect(prior[0]).toMatchObject({ id: "quiz-previous:objective", correct: true });
  expect(prior[1]).toMatchObject({ source: "learner-profile-proxy" });
  expect(JSON.stringify(prior)).not.toContain("Unreviewed");
  expect(JSON.stringify(prior)).not.toContain("DO NOT SHARE");
  expect(prior[1]).toMatchObject({ profile: { priorKnowledge: 0.4 } });
});

test("account changes after prediction cannot attach an answer to that account's estimate", async () => {
  const cwd = await workspace(), doc = document(); let time = 1000, current = true, links = 0;
  const controller = createCliQuizPerformanceController({ cwd, document: doc, nodeId: "quiz", history, now: () => time,
    runtime: () => ({ current: () => current, call }),
    store: { savePredictions: async () => {}, linkCommitted: async () => { links++; return 1; } } });
  expect((await controller.estimate()).ok).toBe(true);
  time += 10; controller.prepareSubmission(action(doc)); current = false;
  expect(await controller.collectCommitted(action(doc), doc)).toBe(0); expect(links).toBe(0);
});

test("prediction eligibility excludes unsupported quiz editors and noncanonical answer keys", async () => {
  for (const kind of ["ordering", "matching", "fill_in", "bad-key"] as const) {
    const cwd = await workspace(), doc = document(); let calls = 0;
    const node = doc.nodes[0]; if (node.type !== "quiz") throw Error("fixture");
    if (kind === "bad-key") node.questions[0].correctAnswer = "Prior";
    else node.questions[0].kind = kind;
    const controller = createCliQuizPerformanceController({ cwd, document: doc, nodeId: "quiz", history,
      runtime: () => ({ current: () => true, call: async request => { calls++; return call(request); } }) });
    expect((await controller.estimate()).ok).toBe(false); expect(calls).toBe(0);
  }
});

test("a terminal quiz completed without a prediction supplies history for a later estimate", async () => {
  const cwd = await workspace(), doc = document(); let time = Date.now() - 1000;
  const first = createCliQuizPerformanceController({ cwd, document: doc, nodeId: "quiz", now: () => time });
  const input = action(doc); first.touch(); first.prepareSubmission(input);
  const dispatcher = new UiActionJournalStore({ storage: new FileUiActionJournalStorage(cwd), now: () => new Date(++time).toISOString(), dispatcher: {
    dispatch: async (submitted, source) => ({ schemaVersion: 1, documentId: source.id, sourceRevision: source.revision,
      actionIdempotencyKey: submitted.idempotencyKey, status: "completed", documentLifecycle: "completed",
      resultingDocument: { ...source, revision: source.revision + 1, lifecycle: "completed", nodes: [
        { type: "callout", id: "result", tone: "check", title: "Quiz submitted", markdown: "Objective score: 1/1" },
      ] } }),
  } });
  expect((await dispatcher.dispatch(input, doc)).ok).toBe(true);
  expect(await first.collectCommitted(input, doc)).toBe(0); // History is saved without inventing a prediction.
  time += 10;
  const prior = await loadCliQuizPerformanceHistory(cwd, "Bayes", time);
  expect(prior).toHaveLength(1); expect(prior[0]).toMatchObject({ answer: "prior", correct: true });
  const next = document(); next.id = "next-quiz";
  const second = createCliQuizPerformanceController({ cwd, document: next, nodeId: "quiz", now: () => time,
    runtime: () => ({ current: () => true, call: async request => {
      expect(JSON.stringify(request.state)).toContain("What comes before the evidence?");
      return call(request);
    } }) });
  expect(await second.estimate()).toEqual({ ok: true, expectedCorrect: 0.8, itemCount: 1 });
});
