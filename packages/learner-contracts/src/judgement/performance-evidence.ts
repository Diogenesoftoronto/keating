/** Joins a saved, pre-answer estimate with independently observed performance.
 * Storage, item hashing, grading authority and independence groups belong to callers.
 */
import { judgementRequestProblem, type JudgementBackendKey, type NoulQuestion } from "./contracts.js";
import type { CalibrationObservation } from "./calibration-artifact.js";

export interface PerformancePredictionReceipt {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly attemptId: string;
  readonly itemId: string;
  readonly itemSha256: string;
  readonly createdAt: number;
  readonly backend: JudgementBackendKey;
  readonly question: NoulQuestion;
  readonly probability: number;
  readonly source: "proxy";
}

export interface PerformanceObservedOutcome {
  readonly predictionId: string;
  readonly attemptId: string;
  readonly itemId: string;
  readonly itemSha256: string;
  readonly submittedAt: number;
  readonly correct: boolean | null;
  readonly hintUsed: boolean | null;
  readonly grading: "deterministic" | "human-reviewed" | "model" | "pending" | "self-reported";
  readonly sourceId: string;
}

export type PerformanceEvidenceRejection = "invalid-prediction" | "invalid-outcome"
  | "unsupported-backend" | "identity-mismatch" | "prediction-not-before-submission"
  | "unobserved-grading" | "unknown-correctness" | "unknown-hint-usage" | "invalid-assignment";
export interface RejectedPerformanceObservation {
  readonly status: "rejected";
  readonly reason: PerformanceEvidenceRejection;
}
export interface AcceptedPerformanceObservation {
  readonly status: "accepted";
  readonly prediction: PerformancePredictionReceipt;
  readonly outcome: PerformanceObservedOutcome;
  /** Observed success means a correct answer without a hint. Never the estimate. */
  readonly observed: 0 | 1;
}
export type PerformanceObservationResult = AcceptedPerformanceObservation | RejectedPerformanceObservation;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function text(value: unknown, max = 256, multiline = false): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u : /[\u0000-\u001f]/u).test(value);
}
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}
function validQuestion(value: unknown): value is NoulQuestion {
  if (!object(value) || value.type !== "noul" || !text(value.instructions, 32_000, true)
    || !keys(value, Object.hasOwn(value, "criteria") ? ["type", "instructions", "criteria"] : ["type", "instructions"])) return false;
  if (Object.hasOwn(value, "criteria") && (!object(value.criteria) || !keys(value.criteria, ["true", "false"])
    || !text(value.criteria.true, 16_000, true) || !text(value.criteria.false, 16_000, true))) return false;
  return judgementRequestProblem({ state: "", questions: { check: value as unknown as NoulQuestion } }) === null;
}
function validPrediction(value: unknown): value is PerformancePredictionReceipt {
  if (!object(value) || !keys(value, ["schemaVersion", "id", "attemptId", "itemId", "itemSha256", "createdAt", "backend", "question", "probability", "source"])) return false;
  if (value.schemaVersion !== 1 || value.source !== "proxy" || !text(value.id) || !text(value.attemptId) || !text(value.itemId)
    || !digest(value.itemSha256) || !timestamp(value.createdAt) || typeof value.probability !== "number"
    || !Number.isFinite(value.probability) || value.probability < 0 || value.probability > 1 || !validQuestion(value.question)) return false;
  return object(value.backend) && keys(value.backend, ["backend", "model", "calibrationSha256"])
    && typeof value.backend.backend === "string" && ["local", "system-one", "fixture"].includes(value.backend.backend) && text(value.backend.model)
    && (value.backend.calibrationSha256 === null || digest(value.backend.calibrationSha256));
}
function validOutcome(value: unknown): value is PerformanceObservedOutcome {
  return object(value) && keys(value, ["predictionId", "attemptId", "itemId", "itemSha256", "submittedAt", "correct", "hintUsed", "grading", "sourceId"])
    && text(value.predictionId) && text(value.attemptId) && text(value.itemId) && digest(value.itemSha256)
    && timestamp(value.submittedAt) && (typeof value.correct === "boolean" || value.correct === null)
    && (typeof value.hintUsed === "boolean" || value.hintUsed === null)
    && typeof value.grading === "string" && ["deterministic", "human-reviewed", "model", "pending", "self-reported"].includes(value.grading) && text(value.sourceId);
}
function rejected(reason: PerformanceEvidenceRejection): RejectedPerformanceObservation { return Object.freeze({ status: "rejected", reason }); }
function immutablePrediction(value: PerformancePredictionReceipt): PerformancePredictionReceipt {
  const question: NoulQuestion = value.question.criteria
    ? Object.freeze({ ...value.question, criteria: Object.freeze({ ...value.question.criteria }) })
    : Object.freeze({ ...value.question });
  return Object.freeze({ ...value, backend: Object.freeze({ ...value.backend }), question });
}

/** Unknown inputs permit safe use at a storage/import boundary. This verifies the
 * linkage, not the truth of a caller's claimed grading authority or timestamps.
 */
export function joinPerformanceObservation(prediction: unknown, outcome: unknown): PerformanceObservationResult {
  if (!validPrediction(prediction)) return rejected("invalid-prediction");
  if (!validOutcome(outcome)) return rejected("invalid-outcome");
  if (prediction.backend.backend === "fixture" || /(?:latest|^judgement$|^auto$|^default$)/iu.test(prediction.backend.model)) return rejected("unsupported-backend");
  if (prediction.id !== outcome.predictionId || prediction.attemptId !== outcome.attemptId
    || prediction.itemId !== outcome.itemId || prediction.itemSha256 !== outcome.itemSha256) return rejected("identity-mismatch");
  if (prediction.createdAt >= outcome.submittedAt) return rejected("prediction-not-before-submission");
  if (outcome.grading !== "deterministic" && outcome.grading !== "human-reviewed") return rejected("unobserved-grading");
  if (outcome.correct === null) return rejected("unknown-correctness");
  if (outcome.hintUsed === null) return rejected("unknown-hint-usage");
  return Object.freeze({ status: "accepted", prediction: immutablePrediction(prediction),
    outcome: Object.freeze({ ...outcome }), observed: outcome.correct && !outcome.hintUsed ? 1 : 0 });
}

/** No inferred independence or random split. The fitter additionally enforces
 * unique observation/source IDs and one group/backend/question observation.
 */
export function toPerformanceCalibrationObservation(
  prediction: unknown, outcome: unknown, assignment: unknown,
): (AcceptedPerformanceObservation & { readonly observation: CalibrationObservation }) | RejectedPerformanceObservation {
  const linked = joinPerformanceObservation(prediction, outcome);
  if (linked.status === "rejected") return linked;
  if (!object(assignment) || !keys(assignment, ["groupId", "split"]) || !text(assignment.groupId)
    || (assignment.split !== "fit" && assignment.split !== "validation")) return rejected("invalid-assignment");
  const observation: CalibrationObservation = Object.freeze({ observationId: linked.prediction.id,
    sourceId: linked.outcome.sourceId, groupId: assignment.groupId, split: assignment.split, evidence: "observed",
    backend: linked.prediction.backend, question: linked.prediction.question, metricKind: "noul-probability",
    value: linked.prediction.probability, label: linked.observed });
  return Object.freeze({ ...linked, observation });
}
