import { expect, test } from "bun:test";
import { questionDigest, thresholdKey, type JudgementBackendKey, type JudgementCaller, type JudgementOutcome } from "@keating/learner-contracts";
import { buildJudgeQuestions, createRuntimeExportJudge, JUDGE_DIMENSIONS, type JudgeCheckpoint, type JudgeProgress } from "../keating/export-judge";
import { buildWebFineTuneExportFromSources } from "../keating/export";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "../keating/judgement/runtime";
import type { RewardedTurn } from "../keating/reward";
import type { SessionData } from "../types/session";

const local: JudgementBackendKey = { backend: "local", model: "local-selected", calibrationSha256: null };
const hosted: JudgementBackendKey = { backend: "system-one", model: "jev-concrete", calibrationSha256: null };
const alias = { ...hosted, model: "judgement" };
const turn = (completion: string): RewardedTurn => ({ context: [{ role: "user", content: "Explain fractions" }], completion } as RewardedTurn);
const store = () => {
  const values = new Map<string, JudgeCheckpoint>();
  return { values, get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: JudgeCheckpoint) => { values.set(key, value); } };
};
const answers = Object.fromEntries(JUDGE_DIMENSIONS.map(dimension => [dimension, {
  type: "score" as const, score: 4, confidence: 0.99,
  probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 },
  legend: { "0": "none", "1": "little", "2": "some", "3": "good", "4": "strong" },
}]));
const success = (backend = hosted): JudgementOutcome => ({ ok: true, response: { backend, answers } });
const failure: JudgementOutcome = { ok: false, error: { code: "backend-unavailable", retryable: false } };
function runtime(key: JudgementBackendKey, call: JudgementCaller, backend: "off" | "local" | "hosted" = "hosted"): WebJudgementRuntime {
  return { settings: { backend, localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { tiers: [{ key, call }], calibration: { entries: {} } } };
}

test("actual export pipeline reaches the independently selected runtime and resumes exact local scores", async () => {
  let calls = 0;
  const selected = createWebJudgementRuntime({ settings: { backend: "local", localModelId: local.model, gatewayPath: "/api/judgement" },
    localScorer: { modelId: local.model, scoreLabels: async ({ question, labels }) => {
      calls++; expect(question.type).toBe("score"); return labels.map((_, index) => index === 4 ? 1 : 0.001);
    } } });
  const cache = store();
  const session: SessionData = { id: "fixture", title: "Fractions", model: {} as SessionData["model"], thinkingLevel: "off", createdAt: "2026-09-19", lastModified: "2026-09-19", messages: [
    { role: "user", content: "Explain fractions", timestamp: 1 }, { role: "assistant", content: "A fraction counts equal parts of a whole.", timestamp: 2 },
  ] as SessionData["messages"] };
  const options = { source: "sessions" as const, format: "both" as const, redact: false, minAssistantChars: 1 };
  const run = () => buildWebFineTuneExportFromSources({ sessions: [session] }, { ...options, judge: createRuntimeExportJudge({ runtime: selected, cache }) });
  const first = await run();
  expect(first.rewardStats?.bySource.judge).toBe(1);
  expect(JSON.parse(first.manifestJson).judgeScoring).toMatchObject({ scored: 1, unscored: 0, model: null });
  expect(calls).toBe(5);
  expect([...cache.values.values()][0]).toMatchObject({ model: local.model, backend: local, calibrated: false });
  await run(); expect(calls).toBe(5);
});

test("off and local preferences cannot call or reuse a hosted tier", async () => {
  let calls = 0;
  const cache = store();
  const call: JudgementCaller = async () => { calls++; return success(); };
  await createRuntimeExportJudge({ runtime: runtime(hosted, call), cache })([turn("One")]);
  for (const backend of ["off", "local"] as const) {
    expect(await createRuntimeExportJudge({ runtime: runtime(hosted, call, backend), cache })([turn("One")])).toEqual([null]);
  }
  expect(calls).toBe(1);
});

test("hosted alias must resolve anew before resume and never reuses another version", async () => {
  const cache = store(); let calls = 0;
  let actual = hosted;
  const selected = runtime(alias, async () => { calls++; return success(actual); });
  const run = () => createRuntimeExportJudge({ runtime: selected, cache })([turn("One"), turn("Two")]);
  await run(); expect(calls).toBe(2);
  await run(); expect(calls).toBe(3); // First response re-establishes the version; second is reusable.
  actual = { ...hosted, model: "jev-next" };
  await run(); expect(calls).toBe(5);
  expect(cache.values.size).toBe(4);
  expect([...cache.values.values()].every(checkpoint => checkpoint.model !== "judgement")).toBe(true);
});

test("model drift, wrong backend and borrowed calibration abstain without caching", async () => {
  for (const actual of [{ ...hosted, model: "judgement" }, local, { ...hosted, calibrationSha256: "a".repeat(64) }]) {
    const cache = store();
    expect(await createRuntimeExportJudge({ runtime: runtime(alias, async () => success(actual)), cache, retries: 0 })([turn("One")])).toEqual([null]);
    expect(cache.values.size).toBe(0);
  }
  let calls = 0; const cache = store();
  const result = await createRuntimeExportJudge({ runtime: runtime(alias, async () => success(++calls === 1 ? hosted : { ...hosted, model: "jev-next" })), cache, retries: 0 })([turn("One"), turn("Two")]);
  expect(result[0]).not.toBeNull(); expect(result[1]).toBeNull(); expect(cache.values.size).toBe(1);
});

test("fallback and exact calibration determine stored provenance and cache identity", async () => {
  const calibrated = { ...hosted, calibrationSha256: "a".repeat(64) };
  const selected = runtime(calibrated, async () => success(calibrated));
  const questions = buildJudgeQuestions();
  // Fixture table only, never production calibration.
  const withTable = { ...selected, policy: { ...selected.policy, calibration: { entries: Object.fromEntries(JUDGE_DIMENSIONS.map(dimension => [thresholdKey(calibrated, questionDigest(questions[dimension])), { deferBelow: 0.5, actAtOrAbove: 0.9 }])) }, tiers: [
    { key: local, call: async () => failure }, ...selected.policy.tiers,
  ] } };
  const cache = store();
  expect((await createRuntimeExportJudge({ runtime: withTable, cache, retries: 0 })([turn("One")]))[0]).not.toBeNull();
  expect([...cache.values.values()][0]).toMatchObject({ fallback: true, calibrated: true, backend: calibrated });
  const changed = { ...withTable, policy: { ...withTable.policy, tiers: [{ key: { ...calibrated, calibrationSha256: "b".repeat(64) }, call: async () => success({ ...calibrated, calibrationSha256: "b".repeat(64) }) }] } };
  expect(await createRuntimeExportJudge({ runtime: changed, cache, retries: 0 })([turn("One")])).toEqual([null]);
  expect(cache.values.size).toBe(1);
});

test("timeout, cancellation and uncertain scores preserve aligned partial results", async () => {
  const cache = store(); let latest: JudgeProgress | undefined;
  const selected = runtime(local, async () => new Promise(() => {}), "local");
  expect(await createRuntimeExportJudge({ runtime: selected, cache, timeoutMs: 2, retries: 0, onProgress: value => { latest = value; } })([turn("One")])).toEqual([null]);
  expect(latest).toMatchObject({ failed: 1, scored: 0 });
  const controller = new AbortController();
  const interrupted = runtime(local, async () => { controller.abort(); return failure; }, "local");
  expect(await createRuntimeExportJudge({ runtime: interrupted, cache, signal: controller.signal, onProgress: value => { latest = value; } })([turn("One"), turn("Two")])).toEqual([null, null]);
  expect(latest).toMatchObject({ completed: 0, paused: true });
  const uncertain = { ...answers, retention: { ...answers.retention, confidence: 0.1 } };
  expect(await createRuntimeExportJudge({ runtime: runtime(local, async () => ({ ok: true, response: { backend: local, answers: uncertain } }), "local"), cache, retries: 0 })([turn("One")])).toEqual([null]);
  expect(cache.values.size).toBe(0);
});

test("cache corruption and persistence failure cannot claim completed scoring", async () => {
  const selected = runtime(hosted, async () => success());
  const cache = store(); await createRuntimeExportJudge({ runtime: selected, cache })([turn("One")]);
  for (const value of cache.values.values()) value.backend = local;
  let calls = 0;
  await createRuntimeExportJudge({ runtime: runtime(hosted, async () => { calls++; return success(); }), cache })([turn("One")]);
  expect(calls).toBe(1);
  await expect(createRuntimeExportJudge({ runtime: selected, cache: { get: async () => null, set: async () => { throw new Error("storage unavailable"); } } })([turn("One")])).rejects.toThrow("storage unavailable");
});
