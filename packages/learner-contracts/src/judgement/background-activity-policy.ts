/** Background prediction research distilled into a bounded, synchronously served policy.
 * Scores predict a later recorded objective answer; they do not establish causal learning gain.
 */
import { DEFAULT_MODELS } from "../../../runtime-config/src/index.js";
import { ACTIVITY_KINDS, linkActivityOutcomes, validateActivityExposure,
  type ActivityExposure, type ActivityKind } from "./activity-learning.js";
import { ACTIVITY_OBSERVATION_FEATURES, ACTIVITY_SIGNALS, ACTIVITY_QUESTION_FINGERPRINT, activityObservationFeatures,
  type ActivityObservations } from "./activity-observations.js";
import type { OnlineDecisionRequest, OnlineDecisionTransport } from "./online-decision-policy.js";

export const BACKGROUND_ACTIVITY_POLICY = Object.freeze({
  featureVersion: "activity-observations-v1-kind-v1", model: DEFAULT_MODELS.judgement.tabular, maxExposures: 500,
  minTrainRows: 20, minValidationRows: 5, maxValidationRows: 32, minKindRows: 5,
  maxPrototypes: 8, maxTestRows: 64, radius: 0.25, ttlMs: 86_400_000, timeoutMs: 60_000,
} as const);
export const BACKGROUND_ACTIVITY_FEATURES: readonly string[] = [
  ...ACTIVITY_OBSERVATION_FEATURES, ...ACTIVITY_KINDS.map(kind => `activity_${kind}`),
];
export const BACKGROUND_ACTIVITY_QUESTION_FINGERPRINT = ACTIVITY_QUESTION_FINGERPRINT;
interface PolicyValidation {
  kind: "squared-error"; modelLoss: number; localLoss: number; baselineLoss: number;
  rows: number; coveredRows: number; passed: boolean;
}
export interface BackgroundActivityPolicy {
  version: 1; featureVersion: typeof BACKGROUND_ACTIVITY_POLICY.featureVersion;
  questionFingerprint: string;
  model: typeof DEFAULT_MODELS.judgement.tabular; judgeModel: string; createdAt: number; expiresAt: number;
  kinds: ActivityKind[];
  /** Raw observation bounds and centers come exclusively from training rows. */
  bounds: { min: number[]; max: number[] };
  prototypes: { features: number[]; scores: number[] }[];
  trainRows: number; validation: PolicyValidation;
  target: "next-linked-objective-score"; scope: "chronological-within-learner"; causal: false;
}
export type BackgroundActivityStatus = "active" | "insufficient-history" | "insufficient-validation"
  | "unsupported-history" | "invalid-response" | "baseline-retained" | "failed" | "cancelled";
export type BackgroundActivityReason = "invalid-or-unattributed-history" | "fewer-than-20-linked-training-outcomes"
  | "requires-5-to-32-chronological-validation-outcomes" | "training-outcomes-have-no-variation"
  | "requires-two-observed-kinds-with-five-training-outcomes" | "no-supported-training-contexts"
  | "invalid-provider-predictions" | "model-holdout-does-not-beat-baseline" | "local-policy-holdout-does-not-beat-baseline"
  | "local-policy-has-insufficient-holdout-coverage" | "held-out-model-and-local-predictions-improved"
  | "research-cancelled" | "research-unavailable-or-timed-out";
export interface BackgroundActivityReceipt {
  version: 1; status: BackgroundActivityStatus; model: typeof DEFAULT_MODELS.judgement.tabular; asOf: number;
  target: "next-linked-objective-score";
  counts: { exposures: number; labelled: number; train: number; validation: number; kinds: number; prototypes: number };
  validation: PolicyValidation | null; reasons: BackgroundActivityReason[];
  scope: "chronological-within-learner"; causal: false; unaidedLearning: "unknown";
}
interface ResearchBatch {
  request: OnlineDecisionRequest | null; receipt: BackgroundActivityReceipt;
  train: ActivityExposure[]; validation: ActivityExposure[]; kinds: ActivityKind[];
  bounds: BackgroundActivityPolicy["bounds"]; prototypes: number[][]; baselinePredictions: number[];
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const probability = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 8_640_000_000_000_000 - BACKGROUND_ACTIVITY_POLICY.ttlMs;
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
const count = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const improvement = (loss: number, baseline: number) => loss + 1e-6 < baseline;
const featureWidth = ACTIVITY_OBSERVATION_FEATURES.length;
const maxCountFeature = Math.log1p(1e9);

function validObservationFeatures(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== featureWidth || !value.every(finite)) return false;
  return value.every((number, index) => index < 8 ? probability(number) && (value[index + 8] !== 0 || number === 0)
    : index < 16 ? number === 0 || number === 1 : (index < 20 && number === -1 || number >= 0 && number <= maxCountFeature));
}
function validObservations(value: unknown): value is ActivityObservations {
  if (!record(value) || value.version !== 1 || value.questionFingerprint !== ACTIVITY_QUESTION_FINGERPRINT || !identifier(value.judgeModel) || !record(value.inferred) || !record(value.observed)) return false;
  const inferred = value.inferred, observed = value.observed;
  return ACTIVITY_SIGNALS.every(signal => inferred[signal] === null || probability(inferred[signal]))
    && ["focusPresented", "focusAttempted", "focusCorrect", "focusIncorrect", "pendingGrades", "priorLearnerTurns"].every((name, index) =>
      index < 4 && observed[name] === null || count(observed[name], 0, 1e9));
}

/** Chebyshev distance prevents many constant features from hiding one large extrapolation.
 * Missing values are categorical: known observations never borrow an unknown context or vice versa.
 */
function distance(left: readonly number[], right: readonly number[], bounds: BackgroundActivityPolicy["bounds"]): number {
  let result = 0;
  for (let index = 0; index < featureWidth; index++) {
    if (index >= 8 && index < 16 && left[index] !== right[index]
      || index >= 16 && (left[index] === -1) !== (right[index] === -1)) return Infinity;
    const range = bounds.max[index] - bounds.min[index];
    if (!range && left[index] !== right[index]) return Infinity;
    result = Math.max(result, range ? Math.abs(left[index] - right[index]) / range : 0);
  }
  return result;
}
function localScores(policy: Pick<BackgroundActivityPolicy, "bounds" | "prototypes">, features: readonly number[]): readonly number[] | null {
  if (features.some((value, index) => value < policy.bounds.min[index] || value > policy.bounds.max[index])) return null;
  const nearest = policy.prototypes.map(prototype => ({ prototype, distance: distance(features, prototype.features, policy.bounds) }))
    .sort((a, b) => a.distance - b.distance);
  if (!nearest.length || nearest[0].distance > BACKGROUND_ACTIVITY_POLICY.radius) return null;
  // Equidistant centers are combined deterministically, not picked by accidental record order.
  const tied = nearest.filter(row => Math.abs(row.distance - nearest[0].distance) < 1e-9);
  return tied[0].prototype.scores.map((_, index) => mean(tied.map(row => row.prototype.scores[index])));
}

/** Strict storage validation rejects unbounded or text-bearing extensions. */
export function validateBackgroundActivityPolicy(value: unknown): value is BackgroundActivityPolicy {
  if (!record(value) || !onlyKeys(value, ["version", "featureVersion", "questionFingerprint", "model", "judgeModel", "createdAt", "expiresAt", "kinds", "bounds", "prototypes", "trainRows", "validation", "target", "scope", "causal"])
    || value.version !== 1 || value.featureVersion !== BACKGROUND_ACTIVITY_POLICY.featureVersion || value.model !== BACKGROUND_ACTIVITY_POLICY.model
    || value.questionFingerprint !== BACKGROUND_ACTIVITY_QUESTION_FINGERPRINT
    || !identifier(value.judgeModel) || !instant(value.createdAt) || value.expiresAt !== value.createdAt + BACKGROUND_ACTIVITY_POLICY.ttlMs
    || !Array.isArray(value.kinds) || value.kinds.length < 2 || value.kinds.length > ACTIVITY_KINDS.length
    || new Set(value.kinds).size !== value.kinds.length || value.kinds.some(kind => !ACTIVITY_KINDS.includes(kind as ActivityKind))
    || !count(value.trainRows, 20, 500) || value.target !== "next-linked-objective-score" || value.scope !== "chronological-within-learner" || value.causal !== false
    || !record(value.bounds) || !onlyKeys(value.bounds, ["min", "max"]) || !validObservationFeatures(value.bounds.min) || !validObservationFeatures(value.bounds.max)) return false;
  const bounds = value.bounds as unknown as BackgroundActivityPolicy["bounds"], kinds = value.kinds;
  // A coordinate-wise maximum may pair a known score with known=1, while a minimum pairs unknown=0.
  if (bounds.min.some((low, index) => low > bounds.max[index])) return false;
  if (!Array.isArray(value.prototypes) || !value.prototypes.length || value.prototypes.length > BACKGROUND_ACTIVITY_POLICY.maxPrototypes
    || value.prototypes.some(row => !record(row) || !onlyKeys(row, ["features", "scores"]) || !validObservationFeatures(row.features)
      || row.features.some((number, index) => number < bounds.min[index] || number > bounds.max[index])
      || !Array.isArray(row.scores) || row.scores.length !== kinds.length || !row.scores.every(probability))) return false;
  const validation = value.validation;
  return record(validation) && onlyKeys(validation, ["kind", "modelLoss", "localLoss", "baselineLoss", "rows", "coveredRows", "passed"])
    && validation.kind === "squared-error" && probability(validation.modelLoss) && probability(validation.localLoss) && probability(validation.baselineLoss)
    && count(validation.rows, 5, 32) && count(validation.coveredRows, 5, validation.rows) && validation.coveredRows >= Math.ceil(validation.rows / 2)
    && validation.passed === true && improvement(validation.modelLoss, validation.baselineLoss) && improvement(validation.localLoss, validation.baselineLoss);
}

/** Synchronous serving; neither this function nor its dependencies invoke a provider. */
export function rankBackgroundActivityKinds(policy: BackgroundActivityPolicy | null | undefined, observations: ActivityObservations,
  allowedKinds: readonly ActivityKind[], now = Date.now()): ActivityKind[] {
  if (!validateBackgroundActivityPolicy(policy) || !validObservations(observations) || !instant(now)
    || observations.judgeModel !== policy.judgeModel || now < policy.createdAt || now >= policy.expiresAt
    || !Array.isArray(allowedKinds) || allowedKinds.length > ACTIVITY_KINDS.length) return [];
  const scores = localScores(policy, activityObservationFeatures(observations));
  if (!scores) return [];
  const allowed = [...new Set(allowedKinds)].filter(kind => ACTIVITY_KINDS.includes(kind) && policy.kinds.includes(kind))
    .map(kind => ({ kind, score: scores[policy.kinds.indexOf(kind)] })).sort((a, b) => b.score - a.score);
  if (allowed.length < 2 || allowed[0].score - allowed[1].score <= 1e-6) return [];
  return allowed.map(row => row.kind);
}

/** Builds the batch before any held-out label is examined for model or prototype selection. */
export function buildBackgroundActivityBatch(exposures: readonly ActivityExposure[], judgeModel: string, asOf: number): ResearchBatch {
  const receipt: BackgroundActivityReceipt = { version: 1, status: "insufficient-history", model: DEFAULT_MODELS.judgement.tabular, asOf,
    target: "next-linked-objective-score", counts: { exposures: Math.min(exposures.length, 500), labelled: 0, train: 0, validation: 0, kinds: 0, prototypes: 0 },
    validation: null, reasons: [], scope: "chronological-within-learner", causal: false, unaidedLearning: "unknown" };
  const batch: ResearchBatch = { request: null, receipt, train: [], validation: [], kinds: [], bounds: { min: [], max: [] }, prototypes: [], baselinePredictions: [] };
  if (!instant(asOf) || !identifier(judgeModel) || exposures.length > 500 || !exposures.every(validateActivityExposure)
    || new Set(exposures.map(row => row.id)).size !== exposures.length) { receipt.reasons = ["invalid-or-unattributed-history"]; return batch; }
  // Recheck source joins, first-attempt identity, publication boundaries, timestamps, and objective labels.
  const labelled = linkActivityOutcomes(exposures, exposures.flatMap(row => row.outcome ? [row.outcome] : []), asOf)
    .filter(row => row.outcome && row.observations.judgeModel === judgeModel
      && row.observations.questionFingerprint === ACTIVITY_QUESTION_FINGERPRINT);
  receipt.counts.labelled = labelled.length;
  const desired = Math.min(32, Math.max(5, Math.ceil(labelled.length * .2)));
  let cut = Math.max(0, labelled.length - desired);
  while (cut > 0 && labelled[cut - 1].createdAt === labelled[cut]?.createdAt) cut--;
  batch.validation = labelled.slice(cut);
  batch.train = labelled.slice(0, cut).filter(row => row.outcome!.createdAt < (batch.validation[0]?.createdAt ?? asOf));
  receipt.counts.train = batch.train.length; receipt.counts.validation = batch.validation.length;
  if (batch.train.length < 20) { receipt.reasons = ["fewer-than-20-linked-training-outcomes"]; return batch; }
  if (batch.validation.length < 5 || batch.validation.length > 32) {
    receipt.status = "insufficient-validation"; receipt.reasons = ["requires-5-to-32-chronological-validation-outcomes"]; return batch;
  }
  if (new Set(batch.train.map(row => row.outcome!.score)).size < 2) { receipt.reasons = ["training-outcomes-have-no-variation"]; return batch; }
  batch.kinds = ACTIVITY_KINDS.filter(kind => batch.train.filter(row => row.candidate.kind === kind).length >= 5);
  receipt.counts.kinds = batch.kinds.length;
  if (batch.kinds.length < 2) { receipt.status = "unsupported-history"; receipt.reasons = ["requires-two-observed-kinds-with-five-training-outcomes"]; return batch; }
  const trainFeatures = batch.train.map(row => activityObservationFeatures(row.observations));
  batch.bounds = { min: Array.from({ length: featureWidth }, (_, index) => Math.min(...trainFeatures.map(row => row[index]))),
    max: Array.from({ length: featureWidth }, (_, index) => Math.max(...trainFeatures.map(row => row[index]))) };
  // Every exported prototype has at least five observed training outcomes for every compared kind nearby.
  const candidates = trainFeatures.filter((features, index) => trainFeatures.findIndex(row => row.every((value, column) => value === features[column])) === index)
    .filter(features => batch.kinds.every(kind => batch.train.filter((row, index) => row.candidate.kind === kind
      && distance(features, trainFeatures[index], batch.bounds) <= BACKGROUND_ACTIVITY_POLICY.radius).length >= 5));
  const limit = Math.min(BACKGROUND_ACTIVITY_POLICY.maxPrototypes, Math.floor((64 - batch.validation.length) / batch.kinds.length));
  // Deterministic farthest-first coverage; centers and count are selected using training features alone.
  while (candidates.length && batch.prototypes.length < limit) {
    let selected = 0, farthest = -1;
    if (batch.prototypes.length) for (let index = 0; index < candidates.length; index++) {
      const separation = Math.min(...batch.prototypes.map(center => distance(candidates[index], center, batch.bounds)));
      if (separation > farthest) { selected = index; farthest = separation; }
    }
    batch.prototypes.push(candidates.splice(selected, 1)[0]);
  }
  receipt.counts.prototypes = batch.prototypes.length;
  if (!batch.prototypes.length) { receipt.status = "unsupported-history"; receipt.reasons = ["no-supported-training-contexts"]; return batch; }
  const globalMean = mean(batch.train.map(row => row.outcome!.score!));
  batch.baselinePredictions = batch.validation.map(row => {
    const matching = batch.train.filter(example => example.candidate.kind === row.candidate.kind);
    return matching.length >= 5 ? mean(matching.map(example => example.outcome!.score!)) : globalMean;
  });
  const features = (observations: readonly number[], kind: ActivityKind) => [...observations, ...ACTIVITY_KINDS.map(value => Number(value === kind))];
  batch.request = { schemaVersion: 1, model: DEFAULT_MODELS.judgement.tabular, task: "regression", featureNames: [...BACKGROUND_ACTIVITY_FEATURES],
    trainFeatures: batch.train.map((row, index) => features(trainFeatures[index], row.candidate.kind)), trainTargets: batch.train.map(row => row.outcome!.score!),
    testFeatures: [...batch.validation.map(row => features(activityObservationFeatures(row.observations), row.candidate.kind)),
      ...batch.prototypes.flatMap(center => batch.kinds.map(kind => features(center, kind)))] };
  receipt.status = "baseline-retained";
  return batch;
}

/** A host schedules this independently of conversation completion and persists only a validated result. */
export async function learnBackgroundActivityPolicy(options: { exposures: readonly ActivityExposure[]; judgeModel: string; asOf: number;
  signal: AbortSignal; transport: OnlineDecisionTransport }): Promise<{ policy: BackgroundActivityPolicy | null; receipt: BackgroundActivityReceipt }> {
  const batch = buildBackgroundActivityBatch(options.exposures, options.judgeModel, options.asOf), receipt = batch.receipt;
  const result = (policy: BackgroundActivityPolicy | null = null) => ({ policy, receipt });
  if (options.signal.aborted) { receipt.status = "cancelled"; receipt.reasons = ["research-cancelled"]; return result(); }
  if (!batch.request) return result();
  const controller = new AbortController();
  const validationRows = batch.validation.map(row => ({ features: activityObservationFeatures(row.observations), kind: row.candidate.kind, score: row.outcome!.score! }));
  let rejectCancelled!: (reason: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const cancel = () => { controller.abort(); rejectCancelled(new Error("background_activity_cancelled")); };
  options.signal.addEventListener("abort", cancel, { once: true });
  if (options.signal.aborted) cancel();
  const timeout = setTimeout(cancel, BACKGROUND_ACTIVITY_POLICY.timeoutMs);
  try {
    if (controller.signal.aborted) { await cancelled; return result(); }
    const response = await Promise.race([options.transport(batch.request, controller.signal), cancelled]);
    if (controller.signal.aborted || options.signal.aborted) throw new Error("background_activity_cancelled");
    if (!record(response) || response.model !== DEFAULT_MODELS.judgement.tabular || !Array.isArray(response.predictions)
      || response.predictions.length !== batch.request.testFeatures.length || !response.predictions.every(probability)) {
      receipt.status = "invalid-response"; receipt.reasons = ["invalid-provider-predictions"]; return result();
    }
    const predictions = response.predictions as number[];
    const policy: BackgroundActivityPolicy = { version: 1, featureVersion: BACKGROUND_ACTIVITY_POLICY.featureVersion,
      questionFingerprint: BACKGROUND_ACTIVITY_QUESTION_FINGERPRINT,
      model: DEFAULT_MODELS.judgement.tabular, judgeModel: options.judgeModel, createdAt: options.asOf, expiresAt: options.asOf + BACKGROUND_ACTIVITY_POLICY.ttlMs,
      kinds: [...batch.kinds], bounds: batch.bounds, trainRows: batch.train.length,
      prototypes: batch.prototypes.map((features, index) => ({ features, scores: predictions.slice(batch.validation.length + index * batch.kinds.length,
        batch.validation.length + (index + 1) * batch.kinds.length) })),
      validation: { kind: "squared-error", modelLoss: 0, localLoss: 0, baselineLoss: 0, rows: batch.validation.length, coveredRows: 0, passed: false },
      target: "next-linked-objective-score", scope: "chronological-within-learner", causal: false };
    const squaredError = (values: readonly number[]) => mean(validationRows.map((row, index) => (row.score - values[index]) ** 2));
    const local = validationRows.map((row, index) => {
      const scores = localScores(policy, row.features), kind = policy.kinds.indexOf(row.kind);
      if (!scores || kind < 0) return batch.baselinePredictions[index];
      policy.validation.coveredRows++;
      return scores[kind];
    });
    policy.validation.modelLoss = squaredError(predictions);
    policy.validation.localLoss = squaredError(local);
    policy.validation.baselineLoss = squaredError(batch.baselinePredictions);
    receipt.validation = policy.validation;
    if (!improvement(policy.validation.modelLoss, policy.validation.baselineLoss)) receipt.reasons = ["model-holdout-does-not-beat-baseline"];
    else if (policy.validation.coveredRows < 5 || policy.validation.coveredRows < Math.ceil(batch.validation.length / 2)) receipt.reasons = ["local-policy-has-insufficient-holdout-coverage"];
    else if (!improvement(policy.validation.localLoss, policy.validation.baselineLoss)) receipt.reasons = ["local-policy-holdout-does-not-beat-baseline"];
    else {
      policy.validation.passed = true;
      if (!validateBackgroundActivityPolicy(policy)) { receipt.status = "invalid-response"; receipt.reasons = ["invalid-provider-predictions"]; return result(); }
      receipt.status = "active"; receipt.reasons = ["held-out-model-and-local-predictions-improved"];
      return result(policy);
    }
    return result();
  } catch {
    receipt.status = options.signal.aborted ? "cancelled" : "failed";
    receipt.reasons = [options.signal.aborted ? "research-cancelled" : "research-unavailable-or-timed-out"];
    return result();
  } finally { clearTimeout(timeout); options.signal.removeEventListener("abort", cancel); controller.abort(); }
}
