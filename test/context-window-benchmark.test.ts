import { test, expect } from "bun:test";
import { contextCases, rolloutCases, makeTrial, digest, type Trial } from "../scripts/context-window/cases.js";
import { runSuite, summarize, replayProvider, type Receipt } from "../scripts/context-window/benchmark.js";
import { htmlReport, markdownReport, reportData } from "../scripts/context-window/report.js";
import type { BenchmarkProvider, ProviderResult } from "../scripts/context-window/providers.js";
import { estimatedStateQuestionTokens, measureStateComposition } from "../packages/learner-contracts/src/judgement/state-metrics.js";
import type { TeachingPolicyTurn } from "../packages/learner-contracts/src/judgement/teaching-policy-types.js";
const ok = (trial: Trial): ProviderResult => ({ status: "ok", returnedModel: "test-v1", answers: Object.fromEntries(Object.entries(trial.expected).map(([id, value]) => [id, { value, confidence: null, probabilities: null }])), usage: null, latencyMs: 12, raw: {} });
const receipt = (trial: Trial, outcome: ProviderResult): Receipt => ({ version: 1, trialId: trial.id, providerId: "test", providerKind: "system-one", requestedModel: "test-v1", requestSha256: trial.requestSha256, repetition: 0, outcome, status: outcome.status === "ok" ? "completed" : "provider-error" });

test("production window preserves pinned/recent records and distinguishes loss from misjudgement", () => {
  const fixture = contextCases()[0]!;
  const full = makeTrial(fixture, .9, "head", "full", 4000);
  const fits = makeTrial(fixture, .9, "head", "windowed", 4000);
  expect(fits.before.fillRatio!).toBeLessThan(1);
  expect(fits.turnsDropped).toBe(0);
  expect(fits.requestSha256).toBe(full.requestSha256);

  const retained = makeTrial(fixture, 1.3, "head", "windowed", 4000);
  expect(retained.before.fillRatio!).toBeGreaterThan(1);
  expect(retained.turnsDropped).toBeGreaterThan(0);
  expect((retained.request.state as { turn: TeachingPolicyTurn }).turn.earlierLearnerExcerpts).toContain(fixture.evidence);
  expect(retained.cueRetained).toBe(true);
  expect(retained.expected).toEqual(fixture.expected);

  const earlierHistory = { ...fixture, turn: { ...fixture.turn, earlierLearnerExcerpts: ["First study request.", "Second study request."] } };
  const lost = makeTrial(earlierHistory, 1.2, "head", "windowed", 4000);
  expect(lost.before.fillRatio!).toBeGreaterThan(1);
  expect(lost.after.fillRatio!).toBeLessThanOrEqual(1);
  expect(lost.turnsDropped).toBeGreaterThan(0);
  expect(lost.cueRetained).toBe(false);
  expect(lost.expected.evidence_verdict).toBe("insufficient_context");
  expect(lost.fullExpected.evidence_verdict).toBe("contradicted");
  expect(lost.after.pinned.plan).toBe(true);
  expect(lost.after.pinned.pendingSubmissions).toBe(true);
  for (const placement of ["recent", "pinned"] as const) expect(makeTrial(fixture, 1.2, placement, "windowed", 4000).cueRetained).toBe(true);
  const report = summarize([lost], [receipt(lost, ok(lost))]);
  expect(report.models.test!.accuracyAllPlannedLabels).toBe(1); expect(report.models.test!.fullContextAgreement).toBe(0);
});

test("an optional excerpt cannot cost another whole turn at the supported boundary", () => {
  const fixture = contextCases()[0]!;
  const full = makeTrial(fixture, 1.01, "head", "full", 4000);
  const { turn } = full.request.state as { turn: TeachingPolicyTurn };
  const nextLearner = turn.conversation.findIndex((message, index) => index > 0 && message.role === "user");
  const oneFewerTurn = { ...full.request, state: { turn: { ...turn, conversation: turn.conversation.slice(nextLearner) } } };
  expect(full.before.estimatedStateQuestionTokens).toBeGreaterThan(4000);
  expect(estimatedStateQuestionTokens(oneFewerTurn)).toBeLessThanOrEqual(4000);
  expect(makeTrial(fixture, 1.01, "head", "windowed", 4000).turnsDropped).toBe(1);
});

test("failures and stop-loss rows remain in accuracy and selection denominators", async () => {
  const trials = rolloutCases().slice(0, 3).map(row => makeTrial(row, .25, "pinned", "full", 4000));
  let calls = 0;
  const provider: BenchmarkProvider = { id: "test", kind: "system-one", model: "test-v1", async evaluate(request) { calls++; const trial = trials.find(row => row.requestSha256 === digest(request))!; return ok(trial); } };
  const rows = await runSuite({ trials, providers: [provider], maxCalls: 1, maxEstimatedInputTokens: 10000 });
  expect(calls).toBe(1); expect(rows).toHaveLength(3);
  const summary = summarize(trials, rows).models.test!;
  expect(summary.labelled).toBe(3); expect(summary.correct).toBe(1); expect(summary.undispatched).toBe(2);
  expect(summary.selectedPassRate).toBeCloseTo(1 / 3); expect(summary.randomCandidatePassRate).toBe(.25);
  expect(summary.responseCoverage).toBeCloseTo(1 / 3);
  const blocked = await runSuite({ trials, providers: [provider], maxCalls: 10, maxEstimatedInputTokens: 0 });
  expect(blocked.every(row => row.status === "not-dispatched")).toBe(true); expect(calls).toBe(1);
});

test("imbalanced gates expose always-negative baseline and class recall", () => {
  const base = makeTrial(contextCases()[0]!, .25, "pinned", "full", 4000);
  const trial = { ...base, expected: { a: true, b: false, c: false, d: false }, fullExpected: { a: true, b: false, c: false, d: false }, labelSource: "deterministic-gate" as const };
  const outcome: ProviderResult = { status: "ok", returnedModel: "test-v1", answers: Object.fromEntries(Object.keys(trial.expected).map(id => [id, { value: false, confidence: null, probabilities: { true: 0, false: 1 } }])), latencyMs: 1, usage: null, raw: {} };
  const summary = summarize([trial], [receipt(trial, outcome)]).models.test!;
  expect(summary.accuracyAllPlannedLabels).toBe(.75); expect(summary.balancedAccuracy).toBe(.5); expect(summary.positiveRecall).toBe(0); expect(summary.negativeRecall).toBe(1); expect(summary.alwaysNegativeAccuracy).toBe(.75);
});

test("replay requires exact requests and supports identical requests in distinct window cells", async () => {
  const fixture = contextCases()[0]!, a = makeTrial(fixture, .25, "head", "full", 4000), b = makeTrial(fixture, .25, "head", "windowed", 4000);
  expect(a.requestSha256).toBe(b.requestSha256);
  const provider = replayProvider("test", "test-v1", [receipt(a, ok(a)), receipt(b, ok(b))]);
  expect((await provider.evaluateTrial!(a, 0)).status).toBe("ok"); expect((await provider.evaluateTrial!(b, 0)).status).toBe("ok");
  expect(await provider.evaluate({ ...a.request, state: { changed: true } })).toMatchObject({ status: "error", error: "tape-missing" });
  expect(() => replayProvider("test", "test-v1", [receipt(a, ok(a)), receipt(a, ok(a))])).toThrow("duplicate_tape_entry");
});

test("reports omit raw learner records and safely serialize script-like metadata", () => {
  const trial = makeTrial(contextCases()[0]!, .25, "pinned", "full", 4000);
  trial.request = { ...trial.request, state: { private: "PRIVATE_LEARNER_TEXT" } }; trial.id = "</script><script>alert(1)</script>";
  const row = receipt(trial, { ...ok(trial), raw: "PRIVATE_RAW_RESPONSE" } as ProviderResult);
  const html = htmlReport([trial], [row]);
  expect(html).not.toContain("PRIVATE_LEARNER_TEXT"); expect(html).not.toContain("PRIVATE_RAW_RESPONSE"); expect(html).not.toContain("</script><script>alert(1)</script>");
  for (const report of [html, markdownReport([trial], [row])]) {
    expect(report).toContain("Each report uses the estimates, window changes and labels recorded in its own plan.");
    expect(report).not.toContain("aiming for 65%");
  }
});

test("reporting a frozen below-limit trim uses its saved request, window trace and label", () => {
  const full = makeTrial(contextCases()[0]!, .9, "head", "full", 4000);
  const { turn } = full.request.state as { turn: TeachingPolicyTurn };
  const turnsDropped = 12;
  const request = { ...full.request, state: { turn: { ...turn, conversation: turn.conversation.slice(turnsDropped * 2) } } };
  const saved: Trial = { ...full, path: "windowed", request, requestSha256: digest(request), turnsDropped,
    cueRetained: false, expected: { evidence_verdict: "insufficient_context" },
    after: measureStateComposition(request, 4000) };
  const result = reportData([saved], [receipt(saved, ok(saved))]);
  expect(result.trials[0]).toMatchObject({ cueRetained: false, turnsDropped, requestSha256: saved.requestSha256,
    before: full.before, after: saved.after });
  expect(result.models.test!.accuracyAllPlannedLabels).toBe(1);
  expect(result.models.test!.fullContextAgreement).toBe(0);
});
