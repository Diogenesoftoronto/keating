import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createLocalJudgementCaller, type JudgementQuestion } from "@keating/learner-contracts";
import { prepareJudgementCalibrationArtifact, serializeJudgementCalibrationArtifact } from "../../packages/learner-contracts/src/judgement/calibration-artifact";
import { createMobileLocalLabelScorer, MOBILE_LABEL_SCORER_VERSION, MOBILE_LOCAL_JUDGEMENT_MODEL, type MobileLabelRuntime } from "../src/lib/judgement/local-scorer";
import { configuredMobileJudgementRuntime, createMobileJudgementRuntime } from "../src/lib/judgement/runtime";
import { MobileJudgementCalibrationStore } from "../src/lib/judgement/calibration";
import { normalizeUiSettings } from "../src/lib/ui-settings";

const question: JudgementQuestion = { type: "choice", instructions: "Which explanation matches the saved answer?", criteria: { correct: "The answer explains the concept", other: "It does not explain the concept" } };
const hash = async (text: string) => createHash("sha256").update(text).digest("hex");
const storage = () => { const values = new Map<string, string>(); return { values, getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); } }; };

test("actual local caller preserves closed labels, full criteria and stable candidate likelihoods", async () => {
  let calls = 0;
  const runtime: MobileLabelRuntime = { labelScorerVersion: MOBILE_LABEL_SCORER_VERSION, cancelGeneration() {},
    async scoreLabelsAsync(id, uri, message, count) {
      calls++; expect(id).toBe("request"); expect(uri).toBe("file:///verified-model"); expect(count).toBe(2);
      const prompt = JSON.parse(message).content;
      expect(prompt).toContain("The answer explains the concept"); expect(prompt).toContain("saved explanation");
      return [1000, 1002];
    } };
  const scoreLabels = createMobileLocalLabelScorer({ id: () => "request", withModel: async use => use("file:///verified-model", runtime) });
  const caller = createLocalJudgementCaller({ scoreLabels, model: MOBILE_LOCAL_JUDGEMENT_MODEL });
  const result = await caller({ state: "saved explanation", questions: { q: question } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("fixture");
  expect(result.response.backend).toEqual({ backend: "local", model: MOBILE_LOCAL_JUDGEMENT_MODEL, calibrationSha256: null });
  expect(result.response.answers.q).toMatchObject({ type: "choice", choice: "correct" });
  expect(result.response.answers.q?.type === "choice" && result.response.answers.q.probabilities.correct).toBeCloseTo(1 / (1 + Math.exp(-2)), 12);
  expect(calls).toBe(1);
});

test("native scorer mismatch, malformed NLLs and cancellation abstain without generation", async () => {
  let wrongVersionCalls = 0;
  const mismatched = createMobileLocalLabelScorer({ withModel: async use => use("model", {
    labelScorerVersion: "different-scorer", cancelGeneration() {}, scoreLabelsAsync: async () => { wrongVersionCalls++; return [0, 1]; },
  }) });
  expect(await mismatched({ state: "x", question, instructions: question.instructions, labels: ["correct", "other"] })).toBeNull();
  expect(wrongVersionCalls).toBe(0);
  for (const scores of [[-1, 2], [NaN, 1], [1], [Infinity, 1]]) {
    const scorer = createMobileLocalLabelScorer({ id: () => "bad", withModel: async use => use("model", {
      labelScorerVersion: MOBILE_LABEL_SCORER_VERSION, cancelGeneration() {}, scoreLabelsAsync: async () => scores,
    }) });
    expect(await scorer({ state: "x", question, instructions: question.instructions, labels: ["correct", "other"] })).toBeNull();
  }
  let resolve!: (scores: number[]) => void, started!: () => void, cancelled = "";
  const began = new Promise<void>(done => { started = done; });
  const abort = new AbortController();
  const scorer = createMobileLocalLabelScorer({ id: () => "cancel-me", withModel: async use => use("model", {
    labelScorerVersion: MOBILE_LABEL_SCORER_VERSION, cancelGeneration(id) { cancelled = id; },
    scoreLabelsAsync: async () => { started(); return new Promise(done => { resolve = done; }); },
  }) });
  const result = scorer({ state: "x", question, instructions: question.instructions, labels: ["correct", "other"], signal: abort.signal });
  await began; abort.abort(); resolve([0, 2]); expect(await result).toBeNull(); expect(cancelled).toBe("cancel-me");
});

test("local-only configured runtime uses independent preferences and never calls hosted service", async () => {
  let calls = 0, selected = "minicpm5-2b-int4";
  const runtime = await configuredMobileJudgementRuntime({ loadSettings: async () => ({ judgementHosted: false, judgementLocalModel: selected }),
    localCalibrationStore: new MobileJudgementCalibrationStore(storage(), hash, "local"),
    localScorer: async () => [9, 1], request: async () => { calls++; throw Error("unexpected hosted call"); } });
  expect(runtime.hostedEnabled).toBe(false); expect(runtime.enabled).toBe(true); expect(runtime.policy.tiers).toHaveLength(1);
  const result = await runtime.call({ state: "work", questions: { q: question } });
  expect(result.ok && result.response.backend.backend).toBe("local"); expect(calls).toBe(0);
  selected = "off"; expect((await runtime.call({ state: "work", questions: { q: question } })).ok).toBe(false);
  expect(normalizeUiSettings({ judgementLocalModel: "minicpm5-2b-int4" }).judgementHosted).toBe(false);
  expect(normalizeUiSettings({ judgementLocalModel: "unknown" }).judgementLocalModel).toBe("off");
  expect(normalizeUiSettings({ judgementMemory: "true" }).judgementMemory).toBe(false);
  expect(normalizeUiSettings({ judgementMemory: true }).judgementMemory).toBe(true);
});

test("local calibration binds exact model and scorer, is immutable, and removal invalidates operations", async () => {
  const input = { schemaVersion: 1 as const, policy: { maxFalsePositiveRate: 0.1, maxActionErrorRate: 0.1, minSamples: 40, minActions: 40, minNegatives: 40 },
    observations: (["fit", "validation"] as const).flatMap(split => Array.from({ length: 100 }, (_, i) => ({
      observationId: `${split}-${i}`, sourceId: `source-${split}-${i}`, groupId: `${split}-${i}`, split, evidence: "observed" as const,
      backend: { backend: "local" as const, model: MOBILE_LOCAL_JUDGEMENT_MODEL, calibrationSha256: null }, question,
      metricKind: "choice-confidence" as const, value: i < 50 ? 0.1 : 0.9, label: i < 50 ? 0 as const : 1 as const,
    }))) };
  const prepared = prepareJudgementCalibrationArtifact(input), artifact = prepared.complete(await hash(prepared.identityInput));
  const text = serializeJudgementCalibrationArtifact(artifact), disk = storage(), store = new MobileJudgementCalibrationStore(disk, hash, "local");
  await store.install(text, await hash(text));
  const runtime = await configuredMobileJudgementRuntime({ loadSettings: async () => ({ judgementHosted: false, judgementLocalModel: "minicpm5-2b-int4" }),
    localCalibrationStore: store, localScorer: async () => [99, 1] });
  expect(runtime.policy.tiers[0]!.key.calibrationSha256).toBe(artifact.calibrationSha256);
  expect(Object.isFrozen(Object.values(runtime.policy.calibration.entries)[0])).toBe(true);
  const hosted = new MobileJudgementCalibrationStore(disk, hash); expect(await hosted.load()).toBeNull();
  await store.remove(); expect((await runtime.call({ state: "x", questions: { q: question } })).ok).toBe(false);
  const changed = { ...input, observations: input.observations.map(row => ({ ...row, backend: { ...row.backend, model: "different-scorer" } })) };
  const other = prepareJudgementCalibrationArtifact(changed), wrong = serializeJudgementCalibrationArtifact(other.complete(await hash(other.identityInput)));
  await expect(store.install(wrong, await hash(wrong))).rejects.toThrow();
});

test("local timeout settles even when a scorer ignores abort", async () => {
  const runtime = createMobileJudgementRuntime({ hostedEnabled: false, localEnabled: true, localScorer: async () => new Promise(() => {}), timeoutMs: 5 });
  expect(await runtime.call({ state: "work", questions: { q: question } })).toMatchObject({ ok: false, error: { code: "cancelled" } });
});
