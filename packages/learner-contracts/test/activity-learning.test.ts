import { describe, expect, test } from "bun:test";
import { ACTIVITY_SIGNALS, type ActivityObservations, type ActivitySelectionInput } from "../src/judgement/activity-observations.js";
import { activitySourcesFromDocuments, buildActivityLearningBatch, descriptor, linkActivityOutcomes, projectActivitySelectionReceipt, selectActivityCandidate,
  validateActivityExposure, type ActivityExposure, type ActivityObjectiveOutcome } from "../src/judgement/activity-learning.js";
import type { TeachingPolicyReply } from "../src/judgement/teaching-policy-types.js";
import type { UiDocument } from "../src/ui.js";

const start = Date.parse("2026-10-01T12:00:00.000Z");
const document: UiDocument = { schemaVersion: 1, id: "private-document", revision: 7, lifecycle: "ready", supportedSurfaces: ["web"],
  nodes: [{ type: "question", id: "private-question-node", prompt: "Private prompt", kind: "text", allowText: true }],
  createdAt: new Date(start).toISOString(), updatedAt: new Date(start).toISOString() };
const prose: TeachingPolicyReply = { text: "An explanation with private learner context.", toolCalls: [] };
const question: TeachingPolicyReply = { text: "```keating-ui\n" + JSON.stringify(document) + "\n```", toolCalls: [] };
function observations(): ActivityObservations {
  return { version: 1, judgeModel: "judge-model", inferred: Object.fromEntries(ACTIVITY_SIGNALS.map(signal => [signal, null])) as ActivityObservations["inferred"],
    observed: { focusPresented: null, focusAttempted: null, focusCorrect: null, focusIncorrect: null, pendingGrades: 0, priorLearnerTurns: 1 } };
}
function exposure(index = 0): ActivityExposure {
  return { id: `private-exposure-${index}`, sessionId: "private-session", createdAt: start + index * 1000,
    observations: observations(), candidate: descriptor(index % 4 < 2 ? prose : question)!, sources: activitySourcesFromDocuments([document]) };
}
function outcome(index = 0): ActivityObjectiveOutcome {
  return { id: `private-outcome-${index}`, sessionId: "private-session", createdAt: start + index * 1000 + 100,
    score: index % 2, grading: "auto", attemptStatus: "first-recorded", questionKey: `private-question-${index}`, source: activitySourcesFromDocuments([document])[0] };
}
function history(count = 40): ActivityExposure[] {
  return linkActivityOutcomes(Array.from({ length: count }, (_, index) => exposure(index)), Array.from({ length: count }, (_, index) => outcome(index)), start + 100_000);
}
function selection(): ActivitySelectionInput {
  return { turn: { learnerMessage: "private-learner-message", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: null, domain: "general" },
    observations: observations(), candidates: [{ attempt: 1, reply: prose, variant: "prose" }, { attempt: 2, reply: question, variant: "interactive" }], baselineAttempt: 1, signal: new AbortController().signal };
}

describe("released activity descriptors", () => {
  test("parses inert UI, keeps prose distinct, and rejects tools and invalid UI", () => {
    expect(descriptor(prose)?.kind).toBe("prose");
    expect(descriptor(question)?.kind).toBe("question");
    expect(descriptor({ ...prose, toolCalls: [{ name: "read", arguments: {} }] })).toBeNull();
    expect(descriptor({ ...prose, text: "```openui\nroot = LearningSurface(" })).toBeNull();
    expect(descriptor({ ...prose, text: "```keating-ui\n{}\n```" })).toBeNull();
    expect(descriptor({ ...prose, text: "````text\n" + question.text + "\n````" })?.kind).toBe("prose");
  });
  test("extracts actual published revision and node identities", () => {
    expect(activitySourcesFromDocuments([document])).toEqual([{ documentId: "private-document", revision: 7, nodeId: "private-question-node" }]);
  });
  test("rejects malformed persisted records, inferred values and descriptors", () => {
    expect(validateActivityExposure(exposure())).toBe(true);
    expect(validateActivityExposure({ ...exposure(), createdAt: NaN })).toBe(false);
    expect(validateActivityExposure({ ...exposure(), observations: { ...observations(), inferred: {} } })).toBe(false);
    expect(validateActivityExposure({ ...exposure(), candidate: { kind: "prose", features: [0] } })).toBe(false);
    expect(validateActivityExposure({ ...exposure(), receipt: { status: "active" } })).toBe(false);
  });
});

describe("activity receipt privacy", () => {
  test("reconstructs diagnostics and strips private extra payloads at every level", () => {
    const receipt = buildActivityLearningBatch(selection(), history(), start + 100_000).receipt;
    receipt.validation = { kind: "squared-error", modelLoss: 0.1, baselineLoss: 0.25, passed: true };
    receipt.predictedScores = [{ attempt: 1, score: 0.2 }, { attempt: 2, score: 0.8 }];
    const stuffed = { ...receipt, private: "PRIVATE TOP LEVEL", counts: { ...receipt.counts, private: "PRIVATE COUNTS" },
      validation: { ...receipt.validation, private: "PRIVATE LOSS" }, predictedScores: receipt.predictedScores.map(row => ({ ...row, private: "PRIVATE SCORE" })) };
    const projected = projectActivitySelectionReceipt(stuffed);
    expect(projected).toEqual(receipt);
    expect(JSON.stringify(projected)).not.toContain("PRIVATE");
    expect(projected).not.toBe(stuffed);
    expect(projected?.counts).not.toBe(stuffed.counts);
    expect(projectActivitySelectionReceipt({ ...stuffed, reasons: ["PRIVATE LEARNER PROSE"] })).toBeNull();
  });
  test("rejects unbounded attempts, counts, invalid literals, timestamps and scores", () => {
    const receipt = buildActivityLearningBatch(selection(), history(), start + 100_000).receipt;
    for (const changes of [{ baselineAttempt: 0 }, { selectedAttempt: 9 }, { asOf: Infinity }, { model: "other" }, { causal: true },
      { counts: { ...receipt.counts, exposures: 501 } }, { predictedScores: [{ attempt: 1, score: NaN }] },
      { validation: { kind: "squared-error", modelLoss: -0.1, baselineLoss: 0.25, passed: true } }]) {
      expect(projectActivitySelectionReceipt({ ...receipt, ...changes })).toBeNull();
    }
  });
});

describe("objective outcome attribution", () => {
  test("links one first recorded automatic check to an exact source in the same session", () => {
    expect(linkActivityOutcomes([exposure()], [outcome()], start + 1000)[0].outcome?.score).toBe(0);
  });
  test.each([
    { sessionId: "another-session" }, { source: undefined }, { source: { documentId: "private-document", revision: 8, nodeId: "private-question-node" } },
    { grading: "model" as const }, { grading: "pending" as const }, { score: undefined }, { attemptStatus: "unknown" as const }, { attemptStatus: "repeat" as const },
    { createdAt: start }, { createdAt: start + 1000 }, { createdAt: start + 86_400_001 },
  ])("censors unlinked, unknown, late or future outcomes %j", changes => {
    expect(linkActivityOutcomes([exposure()], [{ ...outcome(), ...changes }], start + 1000)[0].outcome).toBeUndefined();
  });
  test("does not cross the next exposure or any other published reply boundary", () => {
    const late = { ...outcome(), createdAt: start + 1500 };
    expect(linkActivityOutcomes([exposure(), exposure(1)], [late], start + 2000)[0].outcome).toBeUndefined();
    expect(linkActivityOutcomes([exposure()], [late], start + 2000, [{ sessionId: "private-session", createdAt: start + 1000 }])[0].outcome).toBeUndefined();
  });
  test("earlier model/pending attempts prevent a later retry from becoming a first attempt", () => {
    const earlier = { ...outcome(), id: "earlier-model", grading: "model" as const, createdAt: start - 100 };
    expect(linkActivityOutcomes([exposure()], [earlier, outcome()], start + 1000)[0].outcome).toBeUndefined();
  });
  test("ambiguous simultaneous attempts and repeated first checks are not cherry-picked", () => {
    const simultaneous = { ...outcome(), id: "simultaneous" };
    expect(linkActivityOutcomes([exposure()], [outcome(), simultaneous], start + 1000)[0].outcome).toBeUndefined();
    const repeated = { ...outcome(), attemptStatus: "repeat" as const };
    expect(linkActivityOutcomes([exposure()], [repeated, { ...outcome(1), createdAt: start + 200 }], start + 1000)[0].outcome).toBeUndefined();
  });
  test("reconstruction clears stale labels and missing outcomes stay unlabelled", () => {
    const labelled = { ...exposure(), outcome: outcome() };
    expect(linkActivityOutcomes([labelled], [], start + 1000)[0].outcome).toBeUndefined();
  });
});

describe("chronological activity comparison", () => {
  test("builds 30 numeric columns and never sends holdout labels, IDs, or prose", () => {
    const rows = history();
    for (const row of rows.slice(32)) row.outcome = { ...row.outcome!, score: 0.87 };
    const batch = buildActivityLearningBatch(selection(), rows, start + 100_000);
    expect(batch.receipt.counts).toEqual({ exposures: 40, labelled: 40, train: 32, validation: 8, candidates: 2 });
    expect(batch.request?.featureNames).toHaveLength(30);
    expect(batch.request?.trainTargets.every(value => value === 0 || value === 1)).toBe(true);
    expect(batch.request?.testFeatures).toHaveLength(10);
    expect(JSON.stringify(batch.request)).not.toContain("private");
    expect(JSON.stringify(batch.request)).not.toContain("judge-model");
    expect(batch.request?.trainFeatures.flat().every(Number.isFinite)).toBe(true);
  });
  test("unknown judgments differ from observed zero without rounding probabilities", () => {
    const input = selection();
    const known = { ...input, observations: { ...input.observations, inferred: { ...input.observations.inferred, learner_stuck: 0 } } };
    const uncertain = buildActivityLearningBatch(input, history(), start + 100_000).request!.testFeatures.at(-1)!;
    const zero = buildActivityLearningBatch(known, history(), start + 100_000).request!.testFeatures.at(-1)!;
    expect(uncertain[1]).toBe(0); expect(zero[1]).toBe(0);
    expect(uncertain[9]).toBe(0); expect(zero[9]).toBe(1);
    expect(uncertain[16]).toBe(-1);
  });
  test("does not use a delayed training label that arrived after validation began", () => {
    const rows = history().map((row, index) => ({ ...row, sessionId: `session-${index}`, outcome: { ...row.outcome!, sessionId: `session-${index}` } }));
    rows[31].outcome.createdAt = rows[32].createdAt + 10;
    const batch = buildActivityLearningBatch(selection(), rows, start + 100_000);
    expect(batch.train).toHaveLength(31);
    expect(batch.train.every(row => row.outcome!.createdAt < batch.validation[0].createdAt)).toBe(true);
  });
  test("keeps equal-time exposure groups together", () => {
    const rows = history().map((row, index) => ({ ...row, sessionId: `session-${index}`, outcome: { ...row.outcome!, sessionId: `session-${index}` } }));
    rows[31].createdAt = rows[32].createdAt;
    rows[31].outcome.createdAt = rows[32].createdAt + 100;
    const batch = buildActivityLearningBatch(selection(), rows, start + 100_000);
    expect(batch.validation).toHaveLength(9);
    expect(batch.train.every(row => row.createdAt < batch.validation[0].createdAt)).toBe(true);
  });
  test("retains baseline for scarce or different-judge history and oversized history", async () => {
    let dispatched = 0;
    for (const exposures of [history(10), history().map(row => ({ ...row, observations: { ...row.observations, judgeModel: "other" } })), Array.from({ length: 501 }, (_, index) => exposure(index))]) {
      const result = await selectActivityCandidate(selection(), { exposures, asOf: start + 100_000, transport: async () => { dispatched++; return {}; } });
      expect(result.attempt).toBe(1);
    }
    expect(dispatched).toBe(0);
  });
  test("does not rank unsupported candidate kinds or two indistinguishable kinds", () => {
    const input = selection();
    const sameKind = { ...input, candidates: [{ ...input.candidates[0] }, { ...input.candidates[1], reply: { ...prose, text: "A different explanation" } }] };
    expect(buildActivityLearningBatch(sameKind, history(), start + 100_000).request).toBeNull();
    const singleKind = history().map(row => ({ ...row, candidate: descriptor(prose)! }));
    expect(buildActivityLearningBatch(input, singleKind, start + 100_000).request).toBeNull();
  });
  test("selects only after independent chronological predictions beat the training baseline", async () => {
    const exposures = history(), input = selection();
    const batch = buildActivityLearningBatch(input, exposures, start + 100_000);
    const result = await selectActivityCandidate(input, { exposures, asOf: start + 100_000,
      transport: async () => ({ model: "v3.5_default", predictions: [...batch.validation.map(row => row.outcome!.score!), 0.2, 0.8] }) });
    expect(result.attempt).toBe(2);
    expect(result.receipt.status).toBe("active");
    expect(result.receipt.validation).toEqual({ kind: "squared-error", modelLoss: 0, baselineLoss: 0.25, passed: true });
    expect(validateActivityExposure({ ...exposure(), receipt: result.receipt })).toBe(true);
  });
  test("constant forecasts cannot pass the kind-mean baseline", async () => {
    const result = await selectActivityCandidate(selection(), { exposures: history(), asOf: start + 100_000,
      transport: async request => ({ model: "v3.5_default", predictions: request.testFeatures.map(() => 0.5) }) });
    expect(result.attempt).toBe(1); expect(result.receipt.validation?.passed).toBe(false);
  });
  test.each([{ model: "wrong", predictions: [] }, { model: "v3.5_default", predictions: [] }, { model: "v3.5_default", predictions: Array(10).fill(1.1) }])("malformed provider outputs never change the baseline %j", async response => {
    const result = await selectActivityCandidate(selection(), { exposures: history(), asOf: start + 100_000, transport: async () => response });
    expect(result.attempt).toBe(1); expect(result.receipt.status).toBe("invalid-response");
  });
  test("failure and cancellation retain the already approved reply", async () => {
    const failed = await selectActivityCandidate(selection(), { exposures: history(), asOf: start + 100_000, transport: async () => { throw new Error("private provider detail"); } });
    expect(failed.attempt).toBe(1); expect(JSON.stringify(failed)).not.toContain("private provider detail");
    const controller = new AbortController();
    const promise = selectActivityCandidate({ ...selection(), signal: controller.signal }, { exposures: history(), asOf: start + 100_000, transport: async () => new Promise(() => {}) });
    controller.abort(); const cancelled = await promise;
    expect(cancelled.attempt).toBe(1); expect(cancelled.receipt.status).toBe("cancelled");
  });
});
