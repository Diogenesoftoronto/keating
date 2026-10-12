import { describe, expect, test } from "bun:test";
import { ACTIVITY_KINDS, type ActivityExposure, type ActivityKind } from "../src/judgement/activity-learning.js";
import { ACTIVITY_SIGNALS, ACTIVITY_QUESTION_FINGERPRINT, type ActivityObservations } from "../src/judgement/activity-observations.js";
import { BACKGROUND_ACTIVITY_POLICY, buildBackgroundActivityBatch, learnBackgroundActivityPolicy,
  rankBackgroundActivityKinds, validateBackgroundActivityPolicy, type BackgroundActivityPolicy } from "../src/judgement/background-activity-policy.js";
import type { OnlineDecisionRequest, OnlineDecisionTransport } from "../src/judgement/online-decision-policy.js";

const start = Date.parse("2026-10-01T12:00:00Z"), asOf = start + 100_000;
function observations(context = 0): ActivityObservations {
  return { version: 1, questionFingerprint: ACTIVITY_QUESTION_FINGERPRINT, judgeModel: "fixed-judge", inferred: Object.fromEntries(ACTIVITY_SIGNALS.map(signal =>
    [signal, signal === "learner_stuck" ? context : 0])) as ActivityObservations["inferred"],
    observed: { focusPresented: null, focusAttempted: null, focusCorrect: null, focusIncorrect: null, pendingGrades: 0, priorLearnerTurns: 1 } };
}
function history(length = 40): ActivityExposure[] {
  return Array.from({ length }, (_, index) => {
    const kind: ActivityKind = index % 2 ? "question" : "prose", context = Math.floor(index / 2) % 2;
    const source = { documentId: `private-document-${index}`, revision: 1, nodeId: "private-node" };
    return { id: `private-exposure-${index}`, sessionId: `private-session-${index}`, createdAt: start + index * 1000,
      observations: observations(context), candidate: { kind, features: [...ACTIVITY_KINDS.map(value => Number(value === kind)), Math.log1p(100)] }, sources: [source],
      outcome: { id: `private-outcome-${index}`, sessionId: `private-session-${index}`, createdAt: start + index * 1000 + 100,
        grading: "auto", attemptStatus: "first-recorded", questionKey: `private-question-${index}`, source,
        score: Number(Number(kind === "question") === context) } };
  });
}
const predict = (request: OnlineDecisionRequest) => request.testFeatures.map(row => Number(row[1] === row[23]));
const transport: OnlineDecisionTransport = async request => ({ model: "v3.5_default", predictions: predict(request) });
const learn = (extra: Partial<Parameters<typeof learnBackgroundActivityPolicy>[0]> = {}) => learnBackgroundActivityPolicy({
  exposures: history(), judgeModel: "fixed-judge", asOf, signal: new AbortController().signal, transport, ...extra,
});
async function active(): Promise<BackgroundActivityPolicy> {
  const result = await learn();
  expect(result.receipt.status).toBe("active");
  expect(result.policy).not.toBeNull();
  return result.policy!;
}

describe("background activity research data", () => {
  test("legacy and different question meanings cannot silently enter a new policy", () => {
    const rows = history();
    rows[0].observations = { ...rows[0].observations, questionFingerprint: undefined };
    rows[1].observations = { ...rows[1].observations, questionFingerprint: "different-questions" };
    const batch = buildBackgroundActivityBatch(rows, "fixed-judge", asOf);
    expect(batch.receipt.counts.labelled).toBe(38);
    expect(batch.train.some(row => row.id === rows[0].id || row.id === rows[1].id)).toBe(false);
  });
  test("exports only 29 numeric features, excludes reply length, keeps chronological labels local", () => {
    const batch = buildBackgroundActivityBatch(history(), "fixed-judge", asOf);
    expect(batch.request).not.toBeNull();
    expect(batch.train).toHaveLength(32);
    expect(batch.validation).toHaveLength(8);
    expect(batch.request!.featureNames).toHaveLength(29);
    expect(batch.request!.featureNames.some(name => name.includes("length"))).toBe(false);
    expect(batch.request!.testFeatures.length).toBeLessThanOrEqual(64);
    expect(batch.request!.trainFeatures.every(row => row.length === 29 && row.every(Number.isFinite))).toBe(true);
    expect(batch.request!.trainTargets).toEqual(history().slice(0, 32).map(row => row.outcome!.score!));
    expect(JSON.stringify(batch.request)).not.toContain("private-");
    const changed = history();
    changed.slice(32).forEach(row => { row.outcome!.score = 1 - row.outcome!.score!; });
    expect(buildBackgroundActivityBatch(changed, "fixed-judge", asOf).request).toEqual(batch.request);
    const changedLengths = history();
    changedLengths.forEach(row => { row.candidate = { ...row.candidate, features: [...row.candidate.features.slice(0, 7), 0] }; });
    expect(buildBackgroundActivityBatch(changedLengths, "fixed-judge", asOf).request).toEqual(batch.request);
  });
  test("excludes training labels that arrived after the first held-out exposure", () => {
    const rows = history();
    rows[31].outcome!.createdAt = start + 32_500;
    const batch = buildBackgroundActivityBatch(rows, "fixed-judge", asOf);
    expect(batch.train).toHaveLength(31);
    expect(batch.train.some(row => row.id === rows[31].id)).toBe(false);
    expect(batch.validation).toHaveLength(8);
  });
  test("keeps equal-time groups together at the chronological boundary", () => {
    const rows = history();
    rows[31].createdAt = rows[32].createdAt;
    rows[31].outcome!.createdAt = rows[32].createdAt + 100;
    const batch = buildBackgroundActivityBatch(rows, "fixed-judge", asOf);
    expect(batch.train).toHaveLength(31);
    expect(batch.validation).toHaveLength(9);
    expect(batch.train.every(row => row.createdAt < batch.validation[0].createdAt)).toBe(true);
  });
  test("revalidates objective source links, first recorded attempts, boundaries and future timestamps", () => {
    const rows = history();
    rows[0].outcome!.grading = "model";
    rows[1].outcome!.attemptStatus = "repeat";
    rows[2].outcome!.source = { ...rows[2].outcome!.source!, revision: 2 };
    rows[3].outcome!.createdAt = asOf;
    rows[4].outcome!.createdAt = rows[4].createdAt;
    const batch = buildBackgroundActivityBatch(rows, "fixed-judge", asOf);
    expect([...batch.train, ...batch.validation].every(row => !rows.slice(0, 5).some(bad => bad.id === row.id))).toBe(true);
    const bounded = history();
    bounded[1].sessionId = bounded[0].sessionId;
    bounded[1].outcome!.sessionId = bounded[0].sessionId;
    bounded[0].outcome!.createdAt = bounded[1].createdAt + 1;
    expect(buildBackgroundActivityBatch(bounded, "fixed-judge", asOf).train.some(row => row.id === bounded[0].id)).toBe(false);
  });
  test("filters exact judge identity, keeps held-out contexts out of prototype choice", () => {
    const rows = history();
    rows[0].observations = { ...rows[0].observations, judgeModel: "another-judge" };
    const batch = buildBackgroundActivityBatch(rows, "fixed-judge", asOf);
    expect(batch.train.some(row => row.id === rows[0].id)).toBe(false);
    const changed = history();
    changed.slice(32).forEach(row => { row.observations = observations(.5); });
    expect(buildBackgroundActivityBatch(changed, "fixed-judge", asOf).prototypes).toEqual(buildBackgroundActivityBatch(history(), "fixed-judge", asOf).prototypes);
  });
  test("does not call the provider without enough history, kind coverage or matching judge", async () => {
    let calls = 0;
    const countCalls: OnlineDecisionTransport = async request => { calls++; return transport(request); };
    const tooFew = await learn({ exposures: history(24), transport: countCalls });
    expect(tooFew.receipt.status).toBe("insufficient-history");
    const oneKind = history().map(row => ({ ...row, candidate: { kind: "prose" as const, features: [1, 0, 0, 0, 0, 0, 0, 0] } }));
    expect((await learn({ exposures: oneKind, transport: countCalls })).receipt.status).toBe("unsupported-history");
    expect((await learn({ judgeModel: "different-judge", transport: countCalls })).policy).toBeNull();
    expect(calls).toBe(0);
  });
  test("refuses counterfactual prototype queries without nearby observed support for every kind", async () => {
    const rows = history();
    rows.forEach(row => { row.observations = observations(Number(row.candidate.kind === "question")); });
    let calls = 0;
    const result = await learn({ exposures: rows, transport: async request => { calls++; return transport(request); } });
    expect(result.receipt.reasons).toEqual(["no-supported-training-contexts"]);
    expect(calls).toBe(0);
  });
  test("bounds requests for all seven activity kinds", () => {
    const rows = history(350).map((row, index) => {
      const kind = ACTIVITY_KINDS[index % ACTIVITY_KINDS.length];
      return { ...row, candidate: { kind, features: [...ACTIVITY_KINDS.map(value => Number(value === kind)), 0] } };
    });
    const batch = buildBackgroundActivityBatch(rows, "fixed-judge", start + 500_000);
    expect(batch.request).not.toBeNull();
    expect(batch.request!.trainFeatures.length).toBeLessThanOrEqual(500);
    expect(batch.request!.testFeatures.length).toBeLessThanOrEqual(64);
    expect(batch.kinds).toHaveLength(7);
  });
});

describe("independent model and local policy validation", () => {
  test("activates only when both held-out predictions beat the kind mean", async () => {
    const result = await learn();
    expect(result.receipt.status).toBe("active");
    expect(result.receipt.validation).toEqual({ kind: "squared-error", modelLoss: 0, localLoss: 0, baselineLoss: .25, rows: 8, coveredRows: 8, passed: true });
    expect(validateBackgroundActivityPolicy(result.policy)).toBe(true);
    expect(JSON.stringify(result.policy)).not.toContain("private-");
    expect(result.receipt.causal).toBe(false);
    expect(result.receipt.unaidedLearning).toBe("unknown");
  });
  test("rejects a strong hosted model when its local approximation does not improve", async () => {
    const result = await learn({ transport: async request => ({ model: "v3.5_default", predictions: predict(request).map((value, index) => index < 8 ? value : .5) }) });
    expect(result.policy).toBeNull();
    expect(result.receipt.reasons).toEqual(["local-policy-holdout-does-not-beat-baseline"]);
    expect(result.receipt.validation?.modelLoss).toBe(0);
    expect(result.receipt.validation?.localLoss).toBe(.25);
  });
  test("rejects a weak hosted model even if prototype predictions happen to be good", async () => {
    const result = await learn({ transport: async request => ({ model: "v3.5_default", predictions: predict(request).map((value, index) => index < 8 ? .5 : value) }) });
    expect(result.policy).toBeNull();
    expect(result.receipt.reasons).toEqual(["model-holdout-does-not-beat-baseline"]);
    expect(result.receipt.validation?.localLoss).toBe(0);
  });
  test("requires meaningful local coverage instead of crediting one lucky covered row", async () => {
    const rows = history();
    rows.slice(33).forEach(row => { row.observations = observations(.5); });
    const result = await learn({ exposures: rows, transport: async request => ({ model: "v3.5_default", predictions: predict(request).map((value, index) => index < 8 ? rows[index + 32].outcome!.score! : value) }) });
    expect(result.policy).toBeNull();
    expect(result.receipt.reasons).toEqual(["local-policy-has-insufficient-holdout-coverage"]);
    expect(result.receipt.validation?.coveredRows).toBe(1);
  });
  test.each(["wrong-model", "wrong-count", "nan", "infinite", "negative", "above-one"])("rejects invalid provider output: %s", async failure => {
    const result = await learn({ transport: async request => {
      const predictions = predict(request);
      if (failure === "wrong-count") predictions.pop();
      if (failure === "nan") predictions[0] = NaN;
      if (failure === "infinite") predictions[0] = Infinity;
      if (failure === "negative") predictions[0] = -.01;
      if (failure === "above-one") predictions[0] = 1.01;
      return { model: failure === "wrong-model" ? "other" : "v3.5_default", predictions };
    } });
    expect(result.policy).toBeNull();
    expect(result.receipt.status).toBe("invalid-response");
  });
  test("cancels before dispatch and while an uncooperative transport remains pending", async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    expect((await learn({ signal: controller.signal, transport: async () => { calls++; throw new Error("unexpected"); } })).receipt.status).toBe("cancelled");
    expect(calls).toBe(0);
    const running = new AbortController(); let deliveredSignal: AbortSignal | undefined;
    const pending = learn({ signal: running.signal, transport: async (_, signal) => { deliveredSignal = signal; return new Promise(() => {}); } });
    running.abort();
    expect((await pending).receipt.status).toBe("cancelled");
    expect(deliveredSignal?.aborted).toBe(true);
  });
  test("provider failure leaves no replacement policy", async () => {
    const result = await learn({ transport: async () => { throw new Error("private failure text"); } });
    expect(result.policy).toBeNull();
    expect(result.receipt.status).toBe("failed");
    expect(JSON.stringify(result.receipt)).not.toContain("private failure");
  });
});

describe("local policy serving", () => {
  test("uses context to rank only allowed supported kinds with no provider", async () => {
    const policy = await active();
    expect(rankBackgroundActivityKinds(policy, observations(0), ["question", "prose"], asOf + 1)).toEqual(["prose", "question"]);
    expect(rankBackgroundActivityKinds(policy, observations(1), ["prose", "question"], asOf + 1)).toEqual(["question", "prose"]);
    expect(rankBackgroundActivityKinds(policy, observations(1), ["question"], asOf + 1)).toEqual([]);
    expect(rankBackgroundActivityKinds(policy, observations(1), ["simulation", "prose"], asOf + 1)).toEqual([]);
  });
  test("falls back for stale, future, judge mismatch and uncovered contexts", async () => {
    const policy = await active();
    expect(rankBackgroundActivityKinds(policy, observations(), ["prose", "question"], policy.expiresAt)).toEqual([]);
    expect(rankBackgroundActivityKinds(policy, observations(), ["prose", "question"], asOf - 1)).toEqual([]);
    expect(rankBackgroundActivityKinds(policy, { ...observations(), judgeModel: "other" }, ["prose", "question"], asOf)).toEqual([]);
    expect(rankBackgroundActivityKinds(policy, observations(.5), ["prose", "question"], asOf)).toEqual([]);
    const outside = { ...observations(), observed: { ...observations().observed, priorLearnerTurns: 2 } };
    expect(rankBackgroundActivityKinds(policy, outside, ["prose", "question"], asOf)).toEqual([]);
    const unknown = { ...observations(), inferred: { ...observations().inferred, learner_stuck: null } };
    expect(rankBackgroundActivityKinds(policy, unknown, ["prose", "question"], asOf)).toEqual([]);
    expect(rankBackgroundActivityKinds(policy, observations(-1), ["prose", "question"], asOf)).toEqual([]);
  });
  test("falls back on score ties", async () => {
    const policy = await active();
    policy.prototypes[0].scores = [.5, .5];
    expect(rankBackgroundActivityKinds(policy, observations(), ["prose", "question"], asOf)).toEqual([]);
  });
  test("rejects stored extensions, invalid feature/model versions, bounds and failed gates", async () => {
    const policy = await active();
    for (const patch of [{ model: "other" }, { featureVersion: "old" }, { questionFingerprint: "changed-questions" }, { version: 2 }, { expiresAt: Infinity }, { judgeModel: "" },
      { trainRows: 19 }, { causal: true }, { privateText: "private learner text" }, { kinds: ["question", "question"] },
      { validation: { ...policy.validation, passed: false } }, { validation: { ...policy.validation, localLoss: .25 } },
      { bounds: { ...policy.bounds, min: [0] } }, { prototypes: [{ features: policy.prototypes[0].features, scores: [NaN, 1] }] }]) {
      expect(validateBackgroundActivityPolicy({ ...policy, ...patch })).toBe(false);
      expect(rankBackgroundActivityKinds({ ...policy, ...patch } as BackgroundActivityPolicy, observations(), ["prose", "question"], asOf)).toEqual([]);
    }
    expect(policy.expiresAt - policy.createdAt).toBe(BACKGROUND_ACTIVITY_POLICY.ttlMs);
  });
});
