import { describe, expect, test } from "bun:test";
import { joinPerformanceObservation, toPerformanceCalibrationObservation, type PerformancePredictionReceipt, type PerformanceObservedOutcome } from "../src/judgement/performance-evidence.js";
import { prepareJudgementCalibrationArtifact } from "../src/judgement/calibration-artifact.js";

function prediction(): PerformancePredictionReceipt {
  return { schemaVersion: 1, id: "prediction-1", attemptId: "attempt-1", itemId: "item-1", itemSha256: "a".repeat(64),
    createdAt: 1000, backend: { backend: "system-one", model: "jev-1.13.0", calibrationSha256: null },
    question: { type: "noul", instructions: "Will the learner answer this item correctly without a hint?", criteria: { true: "Correct without a hint", false: "Incorrect or needs a hint" } },
    probability: 0.83, source: "proxy" };
}
function outcome(): PerformanceObservedOutcome {
  return { predictionId: "prediction-1", attemptId: "attempt-1", itemId: "item-1", itemSha256: "a".repeat(64),
    submittedAt: 2000, correct: true, hintUsed: false, grading: "deterministic", sourceId: "submission-1" };
}

describe("pre-answer performance evidence", () => {
  test("observed label follows correctness and hints, never model probability", () => {
    for (const probability of [0, 0.83, 1]) for (const correct of [false, true]) for (const hintUsed of [false, true]) {
      const joined = joinPerformanceObservation({ ...prediction(), probability }, { ...outcome(), correct, hintUsed });
      expect(joined.status).toBe("accepted");
      if (joined.status === "accepted") expect(joined.observed).toBe(correct && !hintUsed ? 1 : 0);
    }
    expect(joinPerformanceObservation(prediction(), { ...outcome(), grading: "human-reviewed" }).status).toBe("accepted");
  });

  test("binds prediction, attempt, item content, and strictly earlier time", () => {
    for (const field of ["predictionId", "attemptId", "itemId"] as const) {
      expect(joinPerformanceObservation(prediction(), { ...outcome(), [field]: "other" }))
        .toEqual({ status: "rejected", reason: "identity-mismatch" });
    }
    expect(joinPerformanceObservation(prediction(), { ...outcome(), itemSha256: "b".repeat(64) }))
      .toEqual({ status: "rejected", reason: "identity-mismatch" });
    for (const submittedAt of [999, 1000]) expect(joinPerformanceObservation(prediction(), { ...outcome(), submittedAt }))
      .toEqual({ status: "rejected", reason: "prediction-not-before-submission" });
  });

  test("does not promote pending, self reported, or model grading", () => {
    for (const grading of ["model", "pending", "self-reported"]) expect(joinPerformanceObservation(prediction(), { ...outcome(), grading }))
      .toEqual({ status: "rejected", reason: "unobserved-grading" });
    for (const grading of ["proxy", "synthetic", "unknown", { toString: () => "deterministic" }]) {
      expect(joinPerformanceObservation(prediction(), { ...outcome(), grading }))
        .toEqual({ status: "rejected", reason: "invalid-outcome" });
    }
    for (const hintUsed of [false, true, null]) expect(joinPerformanceObservation(prediction(), { ...outcome(), correct: null, hintUsed }))
      .toEqual({ status: "rejected", reason: "unknown-correctness" });
    expect(joinPerformanceObservation(prediction(), { ...outcome(), hintUsed: null }))
      .toEqual({ status: "rejected", reason: "unknown-hint-usage" });
  });

  test("requires concrete production backend and complete validated receipt", () => {
    for (const backend of [{ ...prediction().backend, backend: "fixture" }, ...["jev-latest", "judgement", "default", "auto"].map(model => ({ ...prediction().backend, model }))]) {
      expect(joinPerformanceObservation({ ...prediction(), backend }, outcome())).toEqual({ status: "rejected", reason: "unsupported-backend" });
    }
    for (const patch of [
      { source: "observed" }, { schemaVersion: 2 }, { probability: NaN }, { probability: Infinity }, { probability: -0.1 }, { probability: 1.1 },
      { itemSha256: "wrong" }, { createdAt: -1 }, { createdAt: 1.5 }, { createdAt: Infinity }, { createdAt: 8_640_000_000_000_001 },
      { id: "" }, { id: "x\n" }, { id: "x".repeat(257) }, { unexpected: true }, { question: { type: "choice", instructions: "pick", criteria: { yes: null, no: null } } },
      { question: { type: "noul", instructions: "" } }, { question: { type: "noul", instructions: "yes", criteria: { true: "yes" } } },
      { backend: { ...prediction().backend, backend: { toString: () => "system-one" } } }, { backend: { ...prediction().backend, calibrationSha256: "wrong" } },
    ]) expect(joinPerformanceObservation({ ...prediction(), ...patch }, outcome())).toEqual({ status: "rejected", reason: "invalid-prediction" });
    for (const value of [null, false, [], "receipt", {}]) expect(joinPerformanceObservation(value, outcome())).toEqual({ status: "rejected", reason: "invalid-prediction" });
    for (const patch of [{ correct: 1 }, { hintUsed: "false" }, { submittedAt: NaN }, { submittedAt: -1 }, { submittedAt: 1.5 }, { sourceId: "" }, { probability: 0.9 }]) {
      expect(joinPerformanceObservation(prediction(), { ...outcome(), ...patch })).toEqual({ status: "rejected", reason: "invalid-outcome" });
    }
  });

  test("accepted receipts and exports are detached and deeply immutable", () => {
    const p = structuredClone(prediction()), o = structuredClone(outcome());
    const result = toPerformanceCalibrationObservation(p, o, { groupId: "learner-independent-family-1", split: "fit" });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("unexpected rejection");
    (p.backend as { model: string }).model = "changed";
    (p.question.criteria as { true: string }).true = "changed";
    (o as { correct: boolean | null }).correct = false;
    expect(result.prediction.backend.model).toBe("jev-1.13.0");
    expect(result.prediction.question.criteria?.true).toBe("Correct without a hint");
    expect(result.observation.label).toBe(1);
    for (const value of [result, result.prediction, result.prediction.backend, result.prediction.question, result.prediction.question.criteria, result.outcome, result.observation]) expect(Object.isFrozen(value)).toBe(true);
  });

  test("exports exact source and observed label only with explicit independence assignment", () => {
    const result = toPerformanceCalibrationObservation(prediction(), { ...outcome(), correct: false }, { groupId: "learner-independent-family-1", split: "validation" });
    if (result.status !== "accepted") throw new Error("unexpected rejection");
    expect(result.observation).toEqual({ observationId: "prediction-1", sourceId: "submission-1", groupId: "learner-independent-family-1", split: "validation", evidence: "observed", backend: prediction().backend,
      question: prediction().question, metricKind: "noul-probability", value: 0.83, label: 0 });
    for (const assignment of [null, {}, { groupId: "", split: "fit" }, { groupId: "a", split: "random" }, { groupId: "a", split: "fit", auto: true }]) {
      expect(toPerformanceCalibrationObservation(prediction(), outcome(), assignment)).toEqual({ status: "rejected", reason: "invalid-assignment" });
    }
    const policy = { maxFalsePositiveRate: 0.1, maxActionErrorRate: 0.1, minSamples: 20, minActions: 20, minNegatives: 20 };
    const prepared = prepareJudgementCalibrationArtifact({ schemaVersion: 1, policy, observations: [result.observation] });
    expect(prepared.complete("c".repeat(64)).groups[0]?.status).toBe("insufficient-fit");
    expect(() => prepareJudgementCalibrationArtifact({ schemaVersion: 1, policy, observations: [result.observation, result.observation] })).toThrow("Invalid judgement calibration artifact");
    expect(() => prepareJudgementCalibrationArtifact({ schemaVersion: 1, policy, observations: [result.observation, { ...result.observation, observationId: "p2", sourceId: "s2" }] })).toThrow("Invalid judgement calibration artifact");
  });
});
