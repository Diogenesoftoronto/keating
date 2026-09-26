import { expect, test } from "bun:test";
import { contextCases, makeTrial, type Trial } from "../scripts/context-window/cases.js";
import { hardContextCases } from "../scripts/context-window/hard-cases.js";
import { completeSchedule, replayProvider, runSuite, summarize, type Receipt } from "../scripts/context-window/benchmark.js";
import type { ProviderResult } from "../scripts/context-window/providers.js";

const success = (trial: Trial): ProviderResult => ({ status: "ok", returnedModel: "fixture-v1", answers: Object.fromEntries(Object.entries(trial.expected).map(([id, value]) => [id, { value, probabilities: null, confidence: null }])), latencyMs: 12, usage: null, raw: {} });
const receipt = (trial: Trial, outcome: ProviderResult, repetition = 0): Receipt => ({ version: 1, trialId: trial.id, providerId: "fixture", providerKind: "system-one", requestedModel: "fixture-v1", requestSha256: trial.requestSha256, repetition, outcome, status: outcome.status === "ok" ? "completed" : "provider-error" });

test("quoted structured evidence keeps its authored label until actually evicted", () => {
  const fixture = hardContextCases()[0]!;
  expect(fixture.evidence).toContain('"rules"');
  expect(fixture.expected.evidence_verdict).toBe("supported");
  for (const placement of ["head", "recent", "pinned"] as const) {
    const full = makeTrial(fixture, .9, placement, "full", 4000);
    expect(full.cueRetained).toBe(true);
    expect(full.expected).toEqual(fixture.expected);
  }
  const clipped = makeTrial(fixture, .9, "head", "windowed", 4000);
  expect(clipped.turnsDropped).toBeGreaterThan(0);
  expect(clipped.cueRetained).toBe(false);
  expect(clipped.expected.evidence_verdict).toBe("insufficient_context");
  const pinned = makeTrial(fixture, .9, "pinned", "windowed", 4000);
  expect(pinned.cueRetained).toBe(true);
  expect(pinned.expected).toEqual(fixture.expected);
});

test("an interrupted tape preserves every model, trial and repetition denominator", () => {
  const trials = contextCases().slice(0, 2).map(row => makeTrial(row, .25, "pinned", "full", 4000));
  const providers = [{ id: "fixture", kind: "system-one" as const, model: "fixture-v1" }, { id: "absent", kind: "reference" as const, model: "reference-v1" }];
  const received = receipt(trials[0]!, success(trials[0]!));
  const completed = completeSchedule(trials, providers, 2, [received]);
  expect(completed).toHaveLength(8);
  expect(completed.filter(row => row.reason === "missing-receipt")).toHaveLength(7);
  const summary = summarize(trials, completed);
  expect(summary.models.fixture!.planned).toBe(4);
  expect(summary.models.fixture!.accuracyAllPlannedLabels).toBe(.25);
  expect(summary.models.fixture!.responseCoverage).toBe(.25);
  expect(summary.models.absent!.planned).toBe(4);
  expect(summary.models.absent!.accuracyAllPlannedLabels).toBe(0);
  expect(() => completeSchedule(trials, providers, 2, [received, received])).toThrow("unexpected-or-duplicate-receipt");
  expect(() => completeSchedule(trials, providers, 2, [{ ...received, repetition: 2 }])).toThrow("unexpected-or-duplicate-receipt");
});

test("probability scoring includes uncertain Noul responses without treating them as answered", () => {
  const base = makeTrial(contextCases()[0]!, .25, "pinned", "full", 4000);
  const trial = { ...base, expected: { gate: true }, fullExpected: { gate: true }, labelSource: "deterministic-gate" as const };
  const outcome: ProviderResult = { status: "ok", returnedModel: "fixture-v1", answers: { gate: { value: null, probabilities: { true: .5, false: .5 }, confidence: null } }, latencyMs: 10, usage: null, raw: {} };
  const summary = summarize([trial], [receipt(trial, outcome)]).models.fixture!;
  expect(summary.brierN).toBe(1);
  expect(summary.brier).toBe(.5);
  expect(summary.answered).toBe(0);
  expect(summary.abstentions).toBe(1);
  expect(summary.accuracyAllPlannedLabels).toBe(0);
});

test("replay binds identical requests by trial and repetition even when tape order changes", async () => {
  const fixture = contextCases()[0]!;
  const a = makeTrial(fixture, .25, "head", "full", 4000);
  const b = makeTrial(fixture, .25, "head", "windowed", 4000);
  expect(a.requestSha256).toBe(b.requestSha256);
  const failed: ProviderResult = { status: "error", error: "timeout", latencyMs: 100 };
  const original = [receipt(a, success(a), 0), receipt(b, failed, 0), receipt(a, failed, 1), receipt(b, success(b), 1)];
  const provider = replayProvider("fixture", "fixture-v1", [...original].reverse());
  const result = await runSuite({ trials: [a, b], providers: [provider], repetitions: 2, maxCalls: 4, maxEstimatedInputTokens: 100000 });
  expect(result.map(row => [row.trialId, row.repetition, row.outcome])).toEqual(original.map(row => [row.trialId, row.repetition, row.outcome]));
  expect((await provider.evaluateTrial!(a, 0)).status).toBe("error");
});

test("latency median averages the middle completed requests for even samples", () => {
  const trial = makeTrial(contextCases()[0]!, .25, "pinned", "full", 4000);
  const summaryFor = (latencies: number[]) => summarize([trial], latencies.map((latencyMs, repetition) => receipt(trial, { ...success(trial), latencyMs }, repetition))).models.fixture!;
  expect(summaryFor([20, 12]).medianMs).toBe(16);
  expect(summaryFor([20, 4, 12, 8]).medianMs).toBe(10);
  expect(summaryFor([20, 4, 12]).medianMs).toBe(12);
  expect(summaryFor([12]).medianMs).toBe(12);
  const failed = receipt(trial, { status: "error", error: "timeout", latencyMs: 100 });
  expect(summarize([trial], [failed]).models.fixture!.medianMs).toBeNull();
});
