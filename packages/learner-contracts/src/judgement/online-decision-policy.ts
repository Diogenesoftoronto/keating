/** Online adaptation uses observed local outcomes as context, without updating model weights. */
import { validatePortableLearnerData, type PortableLearnerData } from "../portable.js";
import {
  buildDecisionPolicyDatasets, compareDecisionPolicyUrgency, compareDecisionPolicyWebUrgency,
  DECISION_POLICY_FEATURES, decisionPolicyFeatures, decisionPolicySnapshot,
  normalizeDecisionPolicyTopic, type DecisionPolicyBaseline, type DecisionPolicyRow, type DecisionPolicyTarget,
} from "./decision-policy-data.js";

/** Practical product gates, not a statistical claim of generalization or causal identification. */
export const ONLINE_DECISION_POLICY = {
  minTrainRows: 20, minValidationRows: 5, maxTrainRows: 500, maxValidationRows: 32,
  maxTestRows: 64, minRankingPairs: 3, minRankingCohorts: 2,
  clockBucketMs: 3_600_000, maxAgeMs: 86_400_000, model: "v3.5_default",
} as const;

/** Only this numerical payload crosses the transport boundary. Identifiers and prose stay local. */
export interface OnlineDecisionRequest {
  schemaVersion: 1; task: "regression"; model: "v3.5_default"; featureNames: string[];
  trainFeatures: number[][]; trainTargets: number[]; testFeatures: number[][];
}
export interface OnlineDecisionResponse { model: "v3.5_default"; predictions: number[] }
export interface OnlineDecisionCandidate { key: string; topic: string; deckId?: string; cardId?: string }
export interface OnlineDecisionPrediction extends OnlineDecisionCandidate { value: number }
export interface OnlineDecisionValidation {
  kind: "brier" | "classification-error" | "paired-ranking-error";
  modelLoss: number; baselineLoss: number; webBaselineLoss?: number; mobileBaselineLoss?: number;
  pairedComparisons?: number; rankingCohorts?: number; passed: boolean;
  scope: "chronological-within-learner";
}
export type OnlineDecisionStatus = "ready" | "active" | "insufficient-history" | "insufficient-validation"
  | "no-candidates" | "baseline-retained" | "failed" | "invalid-response" | "stale";
export interface OnlineDecisionReceipt {
  status: OnlineDecisionStatus; target: DecisionPolicyTarget; model: "v3.5_default";
  evidenceId: string; requestId: string; asOf: number; updatedAt: number | null; expiresAt: number;
  counts: { observedRows: number; trainRows: number; validationRows: number; candidateCount: number; omittedCandidates: number };
  validation: OnlineDecisionValidation | null; reasons: string[];
  evidence: "observed-local-outcomes"; validationScope: "chronological-within-learner";
}
export interface OnlineDecisionBatch {
  target: DecisionPolicyTarget; asOf: number; evidenceId: string; requestId: string;
  request: OnlineDecisionRequest | null; candidates: OnlineDecisionCandidate[];
  validation: DecisionPolicyRow[]; fitAsOf: number[]; receipt: OnlineDecisionReceipt;
}
export interface OnlineDecisionResult { predictions: OnlineDecisionPrediction[]; receipt: OnlineDecisionReceipt }
export type OnlineDecisionTransport = (request: OnlineDecisionRequest, signal?: AbortSignal) => Promise<unknown>;

// Two independent integer hashes provide a compact local change key. This is not a signature or authentication.
function identity(value: unknown): string {
  const text = JSON.stringify(value); let a = 2166136261, b = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ code, 2246822519);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
const order = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const time = (value: string) => Date.parse(value);
const probability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** Stable across re-exports and input ordering; new outcomes and hourly clock changes invalidate cached results. */
export function onlineDecisionEvidenceId(data: PortableLearnerData, target: DecisionPolicyTarget, asOf: number): string {
  const exportedAt = time(data.generatedAt);
  const prior = <T extends { id: string; createdAt: string }>(rows: readonly T[]) => rows
    .filter(row => time(row.createdAt) < asOf && time(row.createdAt) <= exportedAt).map(row => ({ ...row })).sort((a, b) => order(a.id, b.id));
  return identity({ target, hour: Math.floor(asOf / ONLINE_DECISION_POLICY.clockBucketMs),
    checks: prior(data.questionChecks), quizzes: prior(data.quizResults), reviews: prior(data.cardReviews),
    decks: prior(data.decks).map(deck => ({ id: deck.id, topic: deck.topic, title: deck.title, createdAt: deck.createdAt,
      cards: deck.cards.map(card => card.id).sort(order) })),
  });
}

function numericalFeatures(features: Record<string, number>, names: readonly string[]): number[] {
  // Explicit presence flags distinguish an unknown objective mean from an observed mean of zero.
  return [...names.map(name => features[name] ?? 0), ...names.map(name => Number(features[name] !== undefined))];
}

function candidatesFor(data: PortableLearnerData, target: DecisionPolicyTarget, asOf: number) {
  const exportedAt = time(data.generatedAt);
  // Imported exports may contain future-dated observations; they cannot enter current prediction inputs either.
  data = { ...data, questionChecks: data.questionChecks.filter(row => time(row.createdAt) <= exportedAt),
    quizResults: data.quizResults.filter(row => time(row.createdAt) <= exportedAt), cardReviews: data.cardReviews.filter(row => time(row.createdAt) <= exportedAt) };
  const topics = [...new Set([...data.decks.map(row => row.topic), ...data.questionChecks.map(row => row.topic)]
    .map(normalizeDecisionPolicyTopic))].sort(order);
  const candidates: Array<{ candidate: OnlineDecisionCandidate; features: Record<string, number> }> = [];
  for (const topic of topics) {
    const snapshot = decisionPolicySnapshot(data, topic, asOf);
    const selections = target === "mastery" ? [{}] : target === "retention"
      ? snapshot.cards.map(card => ({ deckId: card.deckId, cardId: card.cardId }))
      : snapshot.decks.map(deck => ({ deckId: deck.deckId }));
    for (const selection of selections) {
      const features = decisionPolicyFeatures(snapshot, target, selection);
      if (features) candidates.push({ candidate: { key: JSON.stringify([target, topic, ...("deckId" in selection ? [selection.deckId] : []),
        ...("cardId" in selection ? [selection.cardId] : [])]), topic, ...selection }, features });
    }
  }
  return candidates.sort((a, b) => order(a.candidate.key, b.candidate.key));
}

function rankingPairs(rows: readonly DecisionPolicyRow[]) {
  const pairs: Array<{ left: number; right: number; cohortId: string }> = [];
  for (let left = 0; left < rows.length; left++) for (let right = left + 1; right < rows.length; right++) {
    const a = rows[left]!, b = rows[right]!;
    if (a.cohortId && a.cohortId === b.cohortId && a.label !== b.label && a.baseline.kind === "ordering" && b.baseline.kind === "ordering") {
      pairs.push({ left, right, cohortId: a.cohortId });
    }
  }
  return pairs;
}

/** Build one bounded batch; holdout targets never leave the device. No fitted model or synthetic seed is required. */
export function buildOnlineDecisionBatch(data: PortableLearnerData, target: DecisionPolicyTarget, asOf: number): OnlineDecisionBatch {
  if (!validatePortableLearnerData(data) || !Number.isSafeInteger(asOf) || asOf < 1 || !(target in DECISION_POLICY_FEATURES)) {
    throw new Error("online_decision_source_invalid");
  }
  const evidenceId = onlineDecisionEvidenceId(data, target, asOf);
  const receipt: OnlineDecisionReceipt = { status: "insufficient-history", target, model: ONLINE_DECISION_POLICY.model,
    evidenceId, requestId: "", asOf, updatedAt: null, expiresAt: asOf + ONLINE_DECISION_POLICY.maxAgeMs,
    counts: { observedRows: 0, trainRows: 0, validationRows: 0, candidateCount: 0, omittedCandidates: 0 },
    validation: null, reasons: [], evidence: "observed-local-outcomes", validationScope: "chronological-within-learner" };
  const batch: OnlineDecisionBatch = { target, asOf, evidenceId, requestId: "", request: null, candidates: [], validation: [], fitAsOf: [], receipt };
  let rows: DecisionPolicyRow[];
  try {
    // The shared extractor preserves strict-prior history, canonical schedules and censored outcomes.
    const boundedExport = { ...data, generatedAt: new Date(Math.min(time(data.generatedAt), asOf - 1)).toISOString() };
    rows = buildDecisionPolicyDatasets([{ sourceId: "local-observations", learnerId: "local-learner", groupId: "local-learner",
      split: "fit", data: boundedExport }])[target].rows.sort((a, b) => a.asOf - b.asOf || order(a.rowId, b.rowId));
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "decision_policy_source_too_large") throw error;
    receipt.reasons = ["local-history-exceeds-reconstruction-limit"]; return batch;
  }
  receipt.counts.observedRows = rows.length;
  // Keep equal-time groups (and entire urgency UTC-day cohorts) together at the chronological boundary.
  const desired = Math.min(ONLINE_DECISION_POLICY.maxValidationRows, Math.max(ONLINE_DECISION_POLICY.minValidationRows, Math.ceil(rows.length * .2)));
  let boundary = rows.length;
  while (boundary > 0 && rows.length - boundary < desired) {
    const timestamp = rows[boundary - 1]!.asOf; let start = boundary - 1;
    while (start > 0 && rows[start - 1]!.asOf === timestamp) start--;
    if (rows.length - start > ONLINE_DECISION_POLICY.maxValidationRows) break;
    boundary = start;
  }
  const fit = rows.slice(Math.max(0, boundary - ONLINE_DECISION_POLICY.maxTrainRows), boundary);
  batch.validation = rows.slice(boundary); batch.fitAsOf = fit.map(row => row.asOf);
  receipt.counts.trainRows = fit.length; receipt.counts.validationRows = batch.validation.length;
  if (fit.length < ONLINE_DECISION_POLICY.minTrainRows) receipt.reasons.push("fewer-than-20-training-observations");
  if (batch.validation.length < ONLINE_DECISION_POLICY.minValidationRows) receipt.reasons.push("fewer-than-5-chronological-validation-observations");
  if (new Set(fit.map(row => row.label)).size < 2) receipt.reasons.push("training-needs-both-outcomes");
  if (new Set(batch.validation.map(row => row.label)).size < 2) receipt.reasons.push("validation-needs-both-outcomes");
  if (target === "urgency") {
    const pairs = rankingPairs(batch.validation);
    if (pairs.length < ONLINE_DECISION_POLICY.minRankingPairs || new Set(pairs.map(pair => pair.cohortId)).size < ONLINE_DECISION_POLICY.minRankingCohorts) {
      receipt.reasons.push("validation-needs-comparable-observed-deck-cohorts");
    }
  }
  if (receipt.reasons.length) {
    receipt.status = fit.length < ONLINE_DECISION_POLICY.minTrainRows ? "insufficient-history" : "insufficient-validation";
    return batch;
  }
  const allCandidates = candidatesFor(data, target, asOf), selected = allCandidates.slice(0, ONLINE_DECISION_POLICY.maxTestRows - batch.validation.length);
  batch.candidates = selected.map(row => row.candidate);
  receipt.counts.candidateCount = selected.length; receipt.counts.omittedCandidates = allCandidates.length - selected.length;
  if (!selected.length) { receipt.status = "no-candidates"; receipt.reasons = ["no-current-target-with-sufficient-known-history"]; return batch; }
  const names = DECISION_POLICY_FEATURES[target];
  batch.request = { schemaVersion: 1, task: "regression", model: ONLINE_DECISION_POLICY.model,
    featureNames: [...names, ...names.map(name => `${name}Known`)],
    trainFeatures: fit.map(row => numericalFeatures(row.features, names)), trainTargets: fit.map(row => row.label),
    testFeatures: [...batch.validation.map(row => numericalFeatures(row.features, names)), ...selected.map(row => numericalFeatures(row.features, names))] };
  batch.requestId = identity({ evidenceId, request: batch.request, candidates: batch.candidates });
  receipt.requestId = batch.requestId; receipt.status = "ready";
  return batch;
}

function validationMetrics(batch: OnlineDecisionBatch, predictions: readonly number[]): OnlineDecisionValidation {
  const rows = batch.validation, mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (batch.target === "urgency") {
    const pairs = rankingPairs(rows), losses: number[] = [], webLosses: number[] = [], mobileLosses: number[] = [];
    const pairLoss = (difference: number, labelDifference: number) => difference === 0 ? .5 : Math.sign(difference) === Math.sign(labelDifference) ? 0 : 1;
    for (const pair of pairs) {
      const a = rows[pair.left]!, b = rows[pair.right]!, difference = a.label - b.label;
      const left = a.baseline as Extract<DecisionPolicyBaseline, { kind: "ordering" }>, right = b.baseline as typeof left;
      losses.push(pairLoss(predictions[pair.left]! - predictions[pair.right]!, difference));
      webLosses.push(pairLoss(-compareDecisionPolicyWebUrgency(left, right), difference));
      mobileLosses.push(pairLoss(-compareDecisionPolicyUrgency(left, right), difference));
    }
    const modelLoss = mean(losses), webBaselineLoss = mean(webLosses), mobileBaselineLoss = mean(mobileLosses);
    return { kind: "paired-ranking-error", modelLoss, baselineLoss: Math.min(webBaselineLoss, mobileBaselineLoss),
      webBaselineLoss, mobileBaselineLoss, pairedComparisons: pairs.length, rankingCohorts: new Set(pairs.map(pair => pair.cohortId)).size,
      passed: modelLoss + 1e-6 < Math.min(webBaselineLoss, mobileBaselineLoss), scope: "chronological-within-learner" };
  }
  const losses = rows.map((row, index) => batch.target === "mastery" ? Number(Number(predictions[index]! >= .5) !== row.label) : (predictions[index]! - row.label) ** 2);
  const baselines = rows.map(row => row.baseline.kind === "classification" ? Number(row.baseline.predicted !== row.label)
    : row.baseline.kind === "probability" ? (row.baseline.value - row.label) ** 2 : NaN);
  const modelLoss = mean(losses), baselineLoss = mean(baselines);
  return { kind: batch.target === "mastery" ? "classification-error" : "brier", modelLoss, baselineLoss,
    passed: modelLoss + 1e-6 < baselineLoss, scope: "chronological-within-learner" };
}

function resultWith(batch: OnlineDecisionBatch, status: OnlineDecisionStatus, reason: string, now: number): OnlineDecisionResult {
  return { predictions: [], receipt: { ...batch.receipt, status, updatedAt: now, reasons: [reason] } };
}

/** A prediction receipt is advisory; it never overwrites a grade, SRS schedule or historical observation. */
export function evaluateOnlineDecisionBatch(batch: OnlineDecisionBatch, response: unknown, now = batch.asOf, currentEvidenceId = batch.evidenceId): OnlineDecisionResult {
  if (!batch.request) return { predictions: [], receipt: batch.receipt };
  if (!Number.isFinite(now) || now < batch.asOf || now >= batch.receipt.expiresAt || currentEvidenceId !== batch.evidenceId) {
    return resultWith(batch, "stale", "evidence-changed-or-prediction-expired", now);
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) return resultWith(batch, "invalid-response", "invalid-provider-response", now);
  const result = response as Partial<OnlineDecisionResponse>;
  if (result.model !== ONLINE_DECISION_POLICY.model || !Array.isArray(result.predictions) || result.predictions.length !== batch.request.testFeatures.length
    || !result.predictions.every(probability)) return resultWith(batch, "invalid-response", "invalid-provider-response", now);
  const validation = validationMetrics(batch, result.predictions.slice(0, batch.validation.length));
  const receipt: OnlineDecisionReceipt = { ...batch.receipt, updatedAt: now, validation,
    status: validation.passed ? "active" : "baseline-retained", reasons: validation.passed ? [] : ["chronological-validation-did-not-improve-baseline"] };
  return { receipt, predictions: validation.passed ? batch.candidates.map((candidate, index) => ({ ...candidate, value: result.predictions![batch.validation.length + index]! })) : [] };
}

/** Transport injection keeps hosted inference out of deterministic tests and secrets out of clients. */
export async function runOnlineDecisionBatch(batch: OnlineDecisionBatch, transport: OnlineDecisionTransport, options: {
  now?: () => number; currentEvidenceId?: () => string; signal?: AbortSignal;
} = {}): Promise<OnlineDecisionResult> {
  if (!batch.request) return { predictions: [], receipt: batch.receipt };
  const now = options.now ?? Date.now;
  if (options.signal?.aborted) return resultWith(batch, "failed", "request-cancelled", now());
  try {
    const response = await transport(batch.request, options.signal);
    if (options.signal?.aborted) return resultWith(batch, "failed", "request-cancelled", now());
    return evaluateOnlineDecisionBatch(batch, response, now(), options.currentEvidenceId?.() ?? batch.evidenceId);
  } catch {
    // Provider details can contain request data or credentials; keep the receipt deliberately generic.
    return resultWith(batch, "failed", "provider-unavailable", now());
  }
}
