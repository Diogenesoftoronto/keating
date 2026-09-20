import { expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { questionDigest, thresholdKey, type JudgementAnswer, type JudgementBackendKey, type JudgementRequest } from "@keating/learner-contracts";
import { IDBFactory } from "fake-indexeddb";
import { strFromU8, unzipSync } from "fflate";
import { buildRubricJudgementPlan, readRubricJudgement, runRubricJudgementPass } from "../keating/trajectory-passes";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "../keating/judgement/runtime";
import { createReviewRecord, isRubricJudgementRecord } from "../keating/trajectory-review";
import { TrajectoryReviewStore } from "../keating/trajectory-store";
import { initialReviewWorkspaceUiState, reviewWorkspaceUiReducer } from "../keating/trajectory-review-ui-state";
import { buildTrajectoryReviewArchive } from "../keating/trajectory-export";

const text = "A fraction describes equal parts of one whole.";
const messages = (content = text): AgentMessage[] => [
  { id: "user-1", role: "user", content: "Explain fractions", timestamp: 1 },
  { id: "tutor-1", role: "assistant", content: [{ type: "text", text: content }], timestamp: 2 },
] as unknown as AgentMessage[];
const local: JudgementBackendKey = { backend: "local", model: "selected-local", calibrationSha256: null };
const hosted: JudgementBackendKey = { backend: "system-one", model: "jev-concrete", calibrationSha256: null };
function answers(request: JudgementRequest): Record<string, JudgementAnswer> {
  return Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    if (question.type === "score") return [key, { type: "score", score: 4, confidence: 0.99,
      probabilities: { "0": 0, "1": 0, "2": 0, "3": 0, "4": 1 }, legend: Object.fromEntries(question.criteria.map((label, index) => [index, label])) }];
    if (question.type !== "choice") throw new Error("unexpected question");
    const choice = key === "verdict" ? "accepted" : Object.keys(question.criteria)[0];
    return [key, { type: "choice", choice, confidence: 0.99, probabilities: Object.fromEntries(Object.keys(question.criteria).map(label => [label, label === choice ? 1 : 0])) }];
  }));
}
const selectedRuntime = (): WebJudgementRuntime => createWebJudgementRuntime({
  settings: { backend: "local", localModelId: local.model, gatewayPath: "/api/judgement" },
  localScorer: { modelId: local.model, scoreLabels: async ({ question, labels }) => labels.map((label, index) => {
    const chosen = question.type === "score" ? index === 4 : labels.includes("accepted") ? label === "accepted" : index === 0;
    return chosen ? 1 : 0.000001;
  }) },
});

test("real configured local scorer produces anchored typed review with honest provenance", async () => {
  const result = await runRubricJudgementPass({ trajectory: messages(), runtime: selectedRuntime() });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.proposal.ratings).toHaveLength(6);
  expect(result.proposal.judgement).toMatchObject({ source: "proxy", backend: local, calibrated: false });
  expect(isRubricJudgementRecord(result.proposal.judgement)).toBe(true);
  for (const rating of result.proposal.ratings) {
    expect(rating.rating).toBe(5); expect(rating.messageId).toBe("tutor-1");
    expect(text.slice(rating.anchor.start, rating.anchor.end)).toBe(rating.anchor.quote);
  }
});

test("uncertain evidence, missing calibration, bimodality and missing source never become ratings", () => {
  const plan = buildRubricJudgementPlan({ trajectory: messages() })!;
  const valid = answers(plan.request);
  const uncertain = structuredClone(valid);
  for (const key of Object.keys(uncertain).filter(key => key.startsWith("evidence."))) {
    (uncertain[key] as { confidence: number }).confidence = 0.1;
  }
  const none = readRubricJudgement(plan, uncertain, local, messages());
  expect(none.ratings).toHaveLength(0); expect(none.overallRating).toBeUndefined(); expect(none.verdict).toBeUndefined();
  expect(readRubricJudgement(plan, valid, local, messages("The recorded tutor turn was changed.")).ratings).toHaveLength(0);
  const calibrated = { ...local, calibrationSha256: "a".repeat(64) };
  expect(readRubricJudgement(plan, valid, calibrated, messages()).ratings).toHaveLength(0);
  const table = { entries: Object.fromEntries(Object.entries(plan.request.questions).map(([, question]) => [thresholdKey(calibrated, questionDigest(question)), { deferBelow: 0.5, actAtOrAbove: 0.9 }])) };
  expect(readRubricJudgement(plan, valid, calibrated, messages(), { calibration: table }).ratings).toHaveLength(6);
  const mixed = structuredClone(valid);
  (mixed["rubric.accuracy"] as { probabilities: Record<string, number> }).probabilities = { "0": 0.49, "1": 0, "2": 0.02, "3": 0, "4": 0.49 };
  expect(readRubricJudgement(plan, mixed, local, messages()).abstentions).toContainEqual({ key: "accuracy", reason: "bimodal-distribution" });
});

test("local abstention escalates to opted-in hosted model; disabled scoring and oversized evidence do not call", async () => {
  const calls: string[] = [];
  const runtime: WebJudgementRuntime = { settings: { backend: "hosted", localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { calibration: { entries: {} }, tiers: [
    { key: local, call: async () => { calls.push("local"); return { ok: true, response: { backend: local, answers: {} } }; } },
    { key: { ...hosted, model: "judgement" }, call: async request => { calls.push("hosted"); return { ok: true, response: { backend: hosted, answers: answers(request) } }; } },
  ] } };
  const result = await runRubricJudgementPass({ trajectory: messages(), runtime });
  expect(result.ok && result.proposal.backend).toEqual(hosted); expect(calls).toEqual(["local", "hosted"]);
  calls.length = 0;
  expect((await runRubricJudgementPass({ trajectory: messages(), runtime: { ...runtime, settings: { ...runtime.settings, backend: "off" } } })).ok).toBe(false);
  const long = messages(Array.from({ length: 49 }, (_, i) => `This is distinct evidence sentence number ${i}.`).join("\n"));
  expect(await runRubricJudgementPass({ trajectory: long, runtime })).toMatchObject({ ok: false, error: "evidence-budget-exceeded" });
  expect(calls).toEqual([]);
  expect(buildRubricJudgementPlan({ trajectory: messages(), maxCandidates: 64 })).toBeNull();
});

test("secrets cannot enter evidence options and upstream exceptions never echo learner text", async () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz01234567890123456789";
  const plan = buildRubricJudgementPlan({ trajectory: messages(`${text}\nMy API key is ${secret}.`) })!;
  expect(JSON.stringify(plan.request)).not.toContain(secret);
  const result = await runRubricJudgementPass({ trajectory: messages(), caller: async () => { throw new Error("private learner answer"); } });
  expect(result).toEqual({ ok: false, error: "backend-unavailable" });
});

test("accepted proposal survives dirty sync, IndexedDB and archive with original evidence; malformed metadata is rejected", async () => {
  const result = await runRubricJudgementPass({ trajectory: messages(), runtime: selectedRuntime() });
  if (!result.ok) throw new Error("fixture scoring failed");
  const store = new TrajectoryReviewStore({ indexedDB: new IDBFactory(), databaseName: "rubric-provenance" });
  const old = await store.getOrCreateReview("session", 1);
  expect(old.rubricJudgement).toBeUndefined();
  const proposed = { ...old, rubricJudgement: result.proposal.judgement, ratings: { accuracy: 5 as const } };
  let state = reviewWorkspaceUiReducer(initialReviewWorkspaceUiState, { type: "change-review", review: proposed });
  state = reviewWorkspaceUiReducer(state, { type: "sync-review", review: old });
  expect(state.reviewDraft?.rubricJudgement).toEqual(result.proposal.judgement);
  await store.saveReview(state.reviewDraft!, 3);
  const snapshot = await store.exportSnapshot(old.id);
  expect(snapshot.review.rubricJudgement).toEqual(result.proposal.judgement);
  const files = unzipSync(buildTrajectoryReviewArchive({ snapshot }).bytes);
  const raw = JSON.parse(strFromU8(files["data/reviews/trajectory-reviews.jsonl"]).trim());
  expect(raw.review.rubricJudgement.backend).toEqual(local);
  expect(raw.review.rubricJudgement.ratings[0].anchor.quote).toBe(text);
  const bad = structuredClone(proposed);
  bad.rubricJudgement!.backend = { ...bad.rubricJudgement!.backend, model: "judgement" };
  await expect(store.saveReview(bad)).rejects.toThrow("Invalid rubric judgement provenance");
  expect((await store.getReviewForSession("session"))?.rubricJudgement?.backend).toEqual(local);
  const manual = { ...createReviewRecord("legacy"), summary: "Teacher only" };
  await store.saveReview(manual); expect((await store.getReviewForSession("legacy"))?.rubricJudgement).toBeUndefined();
  store.close();
});
