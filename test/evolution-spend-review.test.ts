import { expect, test } from "bun:test";
import { createTeachingRevision, runEpisodeBenchmark } from "../shared/evolution/benchmark.js";
import { TEACHING_CASES } from "../shared/evolution/cases.js";
import { emptyEvolutionState, runTeachingEvolution, type EvolutionStore, type EvolutionState, type TeachingExperiment } from "../shared/evolution/loop.js";
import { EVOLUTION_SPEND_QUESTIONS, reviewEvolutionSpend, type EvolutionSpendReviewer } from "../shared/evolution/spend-review.js";
import { questionDigest, type JudgementBackendKey, type JudgementRequest } from "../packages/learner-contracts/src/judgement/contracts.js";
import { thresholdKey } from "../packages/learner-contracts/src/judgement/projections.js";
import type { EpisodeRunner, EpisodeJudge, SkillProposer } from "../shared/evolution/contracts.js";
import { createCliEvolutionSpendReviewer } from "../src/judgement/cli-evolution.js";

const backend: JudgementBackendKey = { backend: "system-one", model: "spend-fixture-v1", calibrationSha256: "a".repeat(64) };
const runner: EpisodeRunner = async () => ({ messages: [{ role: "assistant", content: "Observed training response" }], toolCalls: [], model: "fixture", runtime: "fixture" });
const judge: EpisodeJudge = async ({ testCase }) => testCase.rubric.map(item => ({ criterionId: item.id, passed: false, rationale: "Fixture failure" }));
const proposer: SkillProposer = async ({ training }) => ({ skill: { id: "repair", title: "Repair", instructions: "Ask a diagnostic question", hypothesis: "Detect confusion", evidenceIds: [training.results[0]!.id] }, hypothesis: { id: "ignored", statement: "Detect confusion", status: "proposed", evidenceIds: [] } });
class Store implements EvolutionStore {
  records = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return structuredClone(this.records.get(key) ?? null) as T | null; }
  async put(key: string, value: unknown) { if (this.records.has(key) && JSON.stringify(this.records.get(key)) !== JSON.stringify(value)) throw new Error("immutable"); this.records.set(key, structuredClone(value)); }
  async writeState(state: EvolutionState) { this.records.set("state", structuredClone(state)); }
  async exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
async function fixture() {
  const store = new Store(), incumbent = await createTeachingRevision("Tutor");
  const training = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision: incumbent, runner, judge });
  const id = crypto.randomUUID();
  const state = emptyEvolutionState();
  state.hypotheses.push({ id, statement: "SEALED HYPOTHESIS MUST NOT LEAK", status: "rejected", evidenceIds: [training.results[0]!.id] });
  await store.writeState(state);
  const report = { id, baselineRevisionId: incumbent.id, training, reasons: ["SEALED REASONS"], validation: { secret: "SEALED VALIDATION" }, holdout: { secret: "SEALED HOLDOUT" } };
  await store.put(`experiments/${id}`, report);
  await store.put(`raw/${id}-train-incumbent`, training);
  return { store, incumbent, state, cases: TEACHING_CASES, id };
}
function reviewer(probability: number, calibrated = true, observe?: (request: JudgementRequest) => void): EvolutionSpendReviewer {
  return { calibration: calibrated ? { entries: Object.fromEntries(Object.values(EVOLUTION_SPEND_QUESTIONS).map(question => [thresholdKey(backend, questionDigest(question)), { deferBelow: 0.6, actAtOrAbove: 0.9 }])) } : undefined,
    call: async request => { observe?.(request); return { ok: true, response: { backend, answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: "noul", noul: id === "skip" ? 1 - probability : probability }])) } }; } };
}
test("calibrated deny spends zero generation, preserves cooldown and sealed holdout, and persists independent receipt", async () => {
  const f = await fixture(); let calls = 0; let request: JudgementRequest | undefined;
  const report = await runTeachingEvolution({ ...f, basePrompt: "Tutor", runner: async input => { calls++; return runner(input); }, judge, proposer,
    force: true, spendReviewer: reviewer(0.01, true, value => { request = value; }) });
  expect(calls).toBe(0); expect(report.reasons).toEqual(["spend_review_defer"]);
  expect(report.training).toBeNull(); expect(report.validation).toBeNull(); expect(report.holdout).toBeNull();
  expect(await f.store.read("state")).toEqual(f.state);
  expect(await f.store.read(report.spendReview!.key)).toMatchObject({ status: "defer", source: "synthetic-training-proxy", humanLearning: "unmeasured" });
  expect(JSON.stringify(request)).not.toContain("SEALED");
  expect(JSON.stringify(request)).not.toContain('"split":"validation"');
  expect(JSON.stringify(request)).not.toContain('"split":"holdout"');
  expect(JSON.stringify(request)).not.toContain("suiteDigest");
});
test("missing calibration stays advisory and normal independent rejection gates still execute", async () => {
  const f = await fixture(); let calls = 0;
  const report = await runTeachingEvolution({ ...f, basePrompt: "Tutor", runner: async input => { calls++; return runner(input); }, judge, proposer, spendReviewer: reviewer(0.01, false) });
  expect(calls).toBeGreaterThan(0); expect(report.spendReview!.status).toBe("uncalibrated");
  expect(report.validation).not.toBeNull(); expect(report.status).toBe("rejected");
  expect(report.holdout).toBeNull(); expect((await f.store.read<EvolutionState>("state"))!.active).toBeNull();
});
test("no matching incumbent or training suite never asks a model", async () => {
  for (const mismatch of ["revision", "training"] as const) {
    const f = await fixture(); let called = false;
    const result = await reviewEvolutionSpend({ ...f, ...(mismatch === "revision" ? { incumbent: await createTeachingRevision("Other tutor") }
      : { cases: TEACHING_CASES.map(item => item.split === "train" ? { ...item, messages: [{ role: "user" as const, content: "Changed training" }] } : item) }),
      reviewer: reviewer(0.01, true, () => { called = true; }) });
    expect(result.status).toBe("no-evidence"); expect(called).toBe(false);
  }
});
test("malformed, ambiguous, unavailable and backend-mismatched calibration cannot deny", async () => {
  const f = await fixture();
  expect((await reviewEvolutionSpend({ ...f, reviewer: reviewer(0.5) })).status).toBe("uncertain");
  expect((await reviewEvolutionSpend({ ...f, reviewer: reviewer(0.99) })).status).toBe("allow");
  expect((await reviewEvolutionSpend({ ...f, reviewer: reviewer(NaN) })).status).toBe("unavailable");
  expect((await reviewEvolutionSpend({ ...f, reviewer: { call: async () => { throw new Error("private payload"); } } })).status).toBe("unavailable");
  const mismatch = reviewer(0.01); const call = mismatch.call;
  mismatch.call = async (...args) => { const result = await call(...args); return result.ok ? { ...result, response: { ...result.response, backend: { ...backend, model: "other-model" } } } : result; };
  expect((await reviewEvolutionSpend({ ...f, reviewer: mismatch })).status).toBe("uncalibrated");
});
test("source/state mutation during inference aborts spending, even if model denies", async () => {
  const f = await fixture(); let calls = 0;
  const review = reviewer(0.01, true, () => { f.store.records.set("state", { ...f.state, lastRunAt: new Date().toISOString() }); });
  const report = await runTeachingEvolution({ ...f, basePrompt: "Tutor", runner: async input => { calls++; return runner(input); }, judge, proposer, spendReviewer: review });
  expect(report.reasons).toEqual(["spend_review_stale"]); expect(calls).toBe(0);
});
test("cancellation defeats a noncooperative model without generating or changing state", async () => {
  const f = await fixture(), controller = new AbortController(); let calls = 0;
  const report = await runTeachingEvolution({ ...f, basePrompt: "Tutor", signal: controller.signal,
    runner: async input => { calls++; return runner(input); }, judge, proposer,
    spendReviewer: { call: async () => { controller.abort(); return new Promise(() => {}); } } });
  expect(report.reasons).toEqual(["spend_review_cancelled"]); expect(calls).toBe(0); expect(await f.store.read("state")).toEqual(f.state);
});
test("raw evidence mismatch and oversize complete transcript remain unavailable", async () => {
  const f = await fixture(); const key = `raw/${f.id}-train-incumbent`;
  f.store.records.set(key, {});
  expect((await reviewEvolutionSpend({ ...f, reviewer: reviewer(0.01) })).status).toBe("unavailable");
  const g = await fixture(); const report = await g.store.read<TeachingExperiment>(`experiments/${g.id}`);
  report!.training!.results[0]!.execution!.messages[0]!.content = "x".repeat(65_000);
  g.store.records.set(`experiments/${g.id}`, report); g.store.records.set(`raw/${g.id}-train-incumbent`, report!.training);
  expect((await reviewEvolutionSpend({ ...g, reviewer: reviewer(0.01) })).status).toBe("unavailable");
});
test("CLI spend opt-in is independent and unavailable account cannot fabricate denial", async () => {
  expect(await createCliEvolutionSpendReviewer(".", { env: { KEATING_EVOLUTION_JUDGE: "notorganic-exploratory" } })).toBeUndefined();
  const review = await createCliEvolutionSpendReviewer(".", { env: { KEATING_EVOLUTION_SPEND_JUDGE: "notorganic-exploratory", KEATING_JUDGEMENT_MODEL: "jev-1.13.0" }, transport: { loadCredential: () => null } });
  expect(review).toBeDefined(); expect((await review!.call({ state: {}, questions: EVOLUTION_SPEND_QUESTIONS })).ok).toBe(false);
});

test("unknown stored metadata cannot cross the training-only projection and contradictory answers abstain", async () => {
  const f = await fixture();
  const report = await f.store.read<TeachingExperiment>(`experiments/${f.id}`);
  Object.assign(report!.training!, { sealedLeak: "SEALED EXTRA METADATA" });
  Object.assign(report!.training!.results[0]!.execution!, { sealedLeak: "SEALED NESTED METADATA" });
  f.store.records.set(`experiments/${f.id}`, report); f.store.records.set(`raw/${f.id}-train-incumbent`, report!.training);
  const r = reviewer(0.01, true, request => { expect(JSON.stringify(request)).not.toContain("SEALED"); });
  expect((await reviewEvolutionSpend({ ...f, reviewer: r })).status).toBe("defer");
  const contradiction = reviewer(0.99); const call = contradiction.call;
  contradiction.call = async (...args) => { const outcome = await call(...args); return outcome.ok ? { ...outcome, response: { ...outcome.response, answers: { ...outcome.response.answers, skip: { type: "noul", noul: 0.99 } } } } : outcome; };
  expect((await reviewEvolutionSpend({ ...f, reviewer: contradiction })).status).toBe("uncertain");
});
