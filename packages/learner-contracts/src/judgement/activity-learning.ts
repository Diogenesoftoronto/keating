/** Predicts proximal recorded performance after released replies; it makes no causal claim. */
import { tryCompileOpenUISourceToSharedDocument } from "../openui-source.js";
import { validateUiDocument, type UiDocument } from "../ui.js";
import { ACTIVITY_OBSERVATION_FEATURES, ACTIVITY_SIGNALS, activityObservationFeatures,
  type ActivityObservations, type ActivitySelection, type ActivitySelectionInput } from "./activity-observations.js";
import type { OnlineDecisionRequest, OnlineDecisionTransport } from "./online-decision-policy.js";
import type { TeachingPolicyReply } from "./teaching-policy-types.js";

export const ACTIVITY_LEARNING_POLICY = Object.freeze({ maxExposures: 500, minTrainRows: 20, minValidationRows: 5,
  maxValidationRows: 32, minKindRows: 5, maxCandidates: 8, maxOutcomeDelayMs: 86_400_000, timeoutMs: 20_000 });
export const ACTIVITY_KINDS = ["prose", "question", "recall", "simulation", "visual", "practice", "mixed"] as const;
export type ActivityKind = typeof ACTIVITY_KINDS[number];
export const ACTIVITY_DESCRIPTOR_FEATURES = [...ACTIVITY_KINDS.map(kind => `reply_${kind}`), "reply_length_log1p"] as const;
export interface ActivityDescriptor { kind: ActivityKind; features: readonly number[] }
export interface ActivitySource { documentId: string; revision: number; nodeId: string; questionId?: string }
export interface ActivityBoundary { sessionId: string; createdAt: number }
export interface ActivityObjectiveOutcome {
  id: string; sessionId: string; createdAt: number; grading: "auto" | "model" | "pending"; score?: number;
  source?: ActivitySource; questionKey: string;
  /** This is deduplication of recorded attempts, not evidence that work was unaided. */
  attemptStatus: "first-recorded" | "repeat" | "unknown";
}
export interface ActivityExposure extends ActivityBoundary {
  id: string; observations: ActivityObservations; candidate: ActivityDescriptor; sources: readonly ActivitySource[];
  receipt?: ActivitySelectionReceipt; outcome?: ActivityObjectiveOutcome;
}
export interface ActivitySelectionReceipt {
  version: 1;
  status: "active" | "baseline-retained" | "insufficient-history" | "insufficient-validation" | "unsupported-candidates" | "invalid-response" | "failed" | "cancelled";
  target: "next-linked-objective-score"; model: "v3.5_default"; asOf: number;
  baselineAttempt: number; selectedAttempt: number;
  counts: { exposures: number; labelled: number; train: number; validation: number; candidates: number };
  validation: { kind: "squared-error"; modelLoss: number; baselineLoss: number; passed: boolean } | null;
  predictedScores: { attempt: number; score: number }[];
  reasons: string[];
  scope: "chronological-within-learner"; causal: false; unaidedLearning: "unknown";
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const probability = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
function validSource(value: unknown): value is ActivitySource {
  return record(value) && identifier(value.documentId) && identifier(value.nodeId) && Number.isSafeInteger(value.revision)
    && (value.revision as number) >= 0 && (value.questionId === undefined || identifier(value.questionId));
}
function validDescriptor(value: unknown): value is ActivityDescriptor {
  if (!record(value) || !ACTIVITY_KINDS.includes(value.kind as ActivityKind) || !Array.isArray(value.features)) return false;
  const features = value.features;
  return features.length === 8 && features.every(finite)
    && ACTIVITY_KINDS.every((kind, index) => features[index] === Number(kind === value.kind))
    && features[7] >= 0 && features[7] <= Math.log1p(100_000);
}
function validObservations(value: unknown): value is ActivityObservations {
  if (!record(value) || value.version !== 1 || value.judgeModel !== null && !identifier(value.judgeModel) || !record(value.inferred) || !record(value.observed)) return false;
  const inferred = value.inferred;
  if (!ACTIVITY_SIGNALS.every(signal => inferred[signal] === null || probability(inferred[signal]))) return false;
  return ["focusPresented", "focusAttempted", "focusCorrect", "focusIncorrect", "pendingGrades", "priorLearnerTurns"].every(name => {
    const count = (value.observed as Record<string, unknown>)[name];
    return count === null && name !== "pendingGrades" && name !== "priorLearnerTurns" || Number.isSafeInteger(count) && (count as number) >= 0 && (count as number) <= 1e9;
  });
}
function validOutcome(value: unknown): value is ActivityObjectiveOutcome {
  return record(value) && identifier(value.id) && identifier(value.sessionId) && instant(value.createdAt) && identifier(value.questionKey)
    && ["auto", "model", "pending"].includes(value.grading as string) && ["first-recorded", "repeat", "unknown"].includes(value.attemptStatus as string)
    && (value.score === undefined || probability(value.score)) && (value.source === undefined || validSource(value.source));
}
const receiptReasons = new Set([
  "invalid-or-unattributed-history", "fewer-than-20-linked-training-outcomes", "requires-5-to-32-chronological-validation-outcomes",
  "training-outcomes-have-no-variation", "requires-two-to-eight-distinct-approved-attempts",
  "baseline-and-two-reply-kinds-require-five-observed-training-outcomes-each", "selection-cancelled", "invalid-provider-predictions",
  "holdout-does-not-beat-training-kind-mean", "baseline-has-best-predicted-score", "held-out-prediction-error-improved",
  "selection-unavailable-or-timed-out",
]);
const validAttempt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 8;
function validReceipt(value: unknown): value is ActivitySelectionReceipt {
  if (!record(value) || value.version !== 1 || !["active", "baseline-retained", "insufficient-history", "insufficient-validation", "unsupported-candidates", "invalid-response", "failed", "cancelled"].includes(value.status as string)
    || value.target !== "next-linked-objective-score" || value.model !== "v3.5_default" || !instant(value.asOf) || value.asOf > 8_640_000_000_000_000
    || !validAttempt(value.baselineAttempt) || !validAttempt(value.selectedAttempt)
    || !record(value.counts) || !Array.isArray(value.reasons) || value.reasons.length > 16 || value.reasons.some(reason => typeof reason !== "string" || !receiptReasons.has(reason))
    || value.scope !== "chronological-within-learner" || value.causal !== false || value.unaidedLearning !== "unknown") return false;
  const counts = value.counts;
  if (!["exposures", "labelled", "train", "validation", "candidates"].every(key => Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0 && (counts[key] as number) <= (key === "candidates" ? 8 : 500))) return false;
  if (!Array.isArray(value.predictedScores) || value.predictedScores.length > 8 || value.predictedScores.some(row => !record(row) || !validAttempt(row.attempt) || !probability(row.score))) return false;
  return value.validation === null || record(value.validation) && value.validation.kind === "squared-error" && probability(value.validation.modelLoss)
    && probability(value.validation.baselineLoss) && typeof value.validation.passed === "boolean";
}
/** Diagnostics contain only this bounded projection; extensions must not copy arbitrary callback data. */
export function projectActivitySelectionReceipt(value: unknown): ActivitySelectionReceipt | null {
  if (!validReceipt(value)) return null;
  return {
    version: 1, status: value.status, target: "next-linked-objective-score", model: "v3.5_default", asOf: value.asOf,
    baselineAttempt: value.baselineAttempt, selectedAttempt: value.selectedAttempt,
    counts: { exposures: value.counts.exposures, labelled: value.counts.labelled, train: value.counts.train,
      validation: value.counts.validation, candidates: value.counts.candidates },
    validation: value.validation === null ? null : { kind: "squared-error", modelLoss: value.validation.modelLoss,
      baselineLoss: value.validation.baselineLoss, passed: value.validation.passed },
    predictedScores: value.predictedScores.map(row => ({ attempt: row.attempt, score: row.score })), reasons: [...value.reasons],
    scope: "chronological-within-learner", causal: false, unaidedLearning: "unknown",
  };
}
/** Validate persisted local history before it can form numerical model input. */
export function validateActivityExposure(value: unknown): value is ActivityExposure {
  return record(value) && identifier(value.id) && identifier(value.sessionId) && instant(value.createdAt)
    && validObservations(value.observations) && validDescriptor(value.candidate) && Array.isArray(value.sources)
    && value.sources.length <= 64 && value.sources.every(validSource)
    && (value.outcome === undefined || validOutcome(value.outcome)) && (value.receipt === undefined || validReceipt(value.receipt));
}

/** Use actual published document identities; parser-generated draft IDs are never used for joins. */
export function activitySourcesFromDocuments(documents: readonly UiDocument[]): ActivitySource[] {
  if (documents.length > 64 || documents.some(document => !validateUiDocument(document))) return [];
  const sources = documents.flatMap(document => document.nodes.map(node => ({ documentId: document.id, revision: document.revision, nodeId: node.id })));
  return sources.length <= 64 ? sources : [];
}

/** Recognizes only complete inert OpenUI / canonical UI fences; tool replies cannot be ranked. */
export function descriptor(reply: TeachingPolicyReply): ActivityDescriptor | null {
  if (!reply || typeof reply.text !== "string" || reply.text.length > 100_000 || !Array.isArray(reply.toolCalls) || reply.toolCalls.length) return null;
  const documents: UiDocument[] = [];
  let fence: { marker: string; length: number; language: string; body: string } | null = null;
  for (const line of reply.text.split(/(?<=\n)/)) {
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
        if (fence.language === "keating-ui") {
          try { const document: unknown = JSON.parse(fence.body); if (!validateUiDocument(document)) return null; documents.push(document); } catch { return null; }
        } else if (fence.language === "openui") {
          const compiled = tryCompileOpenUISourceToSharedDocument(fence.body, { documentId: `descriptor-${documents.length}`, createdAt: "2026-01-01T00:00:00.000Z" });
          if (!compiled.ok) return null;
          documents.push(compiled.document);
        }
        fence = null;
      } else fence.body += line;
    } else {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)\n?$/);
      if (opening) fence = { marker: opening[1][0], length: opening[1].length, language: opening[2].trim().split(/\s+/, 1)[0], body: "" };
    }
  }
  if (fence?.language === "openui" || fence?.language === "keating-ui") return null;
  const kinds = new Set<ActivityKind>();
  for (const node of documents.flatMap(document => document.nodes)) {
    if (["markdown", "text", "callout", "rows"].includes(node.type)) continue;
    if (["question", "question-group", "quiz"].includes(node.type)) kinds.add("question");
    else if (node.type === "deck") kinds.add("recall");
    else if (node.type === "simulation") kinds.add("simulation");
    else if (["image", "concept-map", "media"].includes(node.type)) kinds.add("visual");
    else if (["language-practice", "coding-challenge", "music-lab", "task"].includes(node.type)) kinds.add("practice");
    else kinds.add("mixed");
  }
  const kind = kinds.size > 1 ? "mixed" : [...kinds][0] ?? "prose";
  return { kind, features: [...ACTIVITY_KINDS.map(value => Number(value === kind)), Math.log1p(reply.text.length)] };
}
export const describeActivityCandidate = descriptor;

const sameSource = (binding: ActivitySource, observed: ActivitySource) => binding.documentId === observed.documentId
  && binding.revision === observed.revision && binding.nodeId === observed.nodeId
  && (binding.questionId === undefined || binding.questionId === observed.questionId);
function eligible(exposure: ActivityExposure, outcome: ActivityObjectiveOutcome, asOf: number, boundary: number): boolean {
  return outcome.sessionId === exposure.sessionId && outcome.createdAt > exposure.createdAt && outcome.createdAt < asOf
    && outcome.createdAt < boundary && outcome.createdAt - exposure.createdAt <= ACTIVITY_LEARNING_POLICY.maxOutcomeDelayMs
    && outcome.grading === "auto" && probability(outcome.score) && outcome.attemptStatus === "first-recorded"
    && !!outcome.source && exposure.sources.some(source => sameSource(source, outcome.source!));
}

/** Reconstruct labels, never turn missing / late / model-graded work into failures. */
export function linkActivityOutcomes(exposures: readonly ActivityExposure[], outcomes: readonly ActivityObjectiveOutcome[], asOf: number,
  boundaries: readonly ActivityBoundary[] = []): ActivityExposure[] {
  if (!instant(asOf) || exposures.length > 500 || outcomes.length > 20_000 || boundaries.length > 20_000
    || !exposures.every(validateActivityExposure) || !outcomes.every(validOutcome)
    || boundaries.some(value => !value || !identifier(value.sessionId) || !instant(value.createdAt))) return [];
  if (new Set(exposures.map(row => row.id)).size !== exposures.length || new Set(outcomes.map(row => row.id)).size !== outcomes.length) return [];
  const ordered = [...exposures].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const attempts = [...outcomes].filter(row => row.createdAt < asOf).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const first = new Map<string, ActivityObjectiveOutcome | null>();
  for (const outcome of attempts) {
    if (!first.has(outcome.questionKey)) first.set(outcome.questionKey, outcome);
    else if (first.get(outcome.questionKey)?.createdAt === outcome.createdAt && first.get(outcome.questionKey)?.id !== outcome.id) first.set(outcome.questionKey, null);
  }
  const used = new Set<string>();
  return ordered.filter(exposure => exposure.createdAt < asOf).map(exposure => {
    const { outcome: _, ...unlabelled } = exposure;
    const next = [...ordered, ...boundaries].filter(row => row.sessionId === exposure.sessionId && row.createdAt > exposure.createdAt)
      .reduce((at, row) => Math.min(at, row.createdAt), Infinity);
    // Equal-time exposures are ambiguous; do not invent ordering within a publication instant.
    if (ordered.some(row => row.id !== exposure.id && row.sessionId === exposure.sessionId && row.createdAt === exposure.createdAt)) return unlabelled;
    const outcome = attempts.find(row => row.sessionId === exposure.sessionId && row.createdAt > exposure.createdAt && row.createdAt < next
      && row.createdAt - exposure.createdAt <= ACTIVITY_LEARNING_POLICY.maxOutcomeDelayMs && row.grading === "auto"
      && !!row.source && exposure.sources.some(source => sameSource(source, row.source!)));
    if (!outcome || !eligible(exposure, outcome, asOf, next) || first.get(outcome.questionKey)?.id !== outcome.id || used.has(outcome.id)) return unlabelled;
    used.add(outcome.id);
    return { ...unlabelled, outcome: { ...outcome } };
  });
}

export interface ActivityLearningBatch {
  request: OnlineDecisionRequest | null;
  train: readonly ActivityExposure[]; validation: readonly ActivityExposure[];
  candidates: readonly { attempt: number; descriptor: ActivityDescriptor }[];
  baselinePredictions: readonly number[];
  receipt: ActivitySelectionReceipt;
}
export function buildActivityLearningBatch(input: ActivitySelectionInput, exposures: readonly ActivityExposure[], asOf: number): ActivityLearningBatch {
  const receipt: ActivitySelectionReceipt = { version: 1, status: "insufficient-history", target: "next-linked-objective-score", model: "v3.5_default", asOf,
    baselineAttempt: input.baselineAttempt, selectedAttempt: input.baselineAttempt, counts: { exposures: exposures.length, labelled: 0, train: 0, validation: 0, candidates: 0 },
    validation: null, predictedScores: [], reasons: [], scope: "chronological-within-learner", causal: false, unaidedLearning: "unknown" };
  const batch: ActivityLearningBatch = { request: null, train: [], validation: [], candidates: [], baselinePredictions: [], receipt };
  if (!instant(asOf) || !validObservations(input.observations) || !input.observations.judgeModel || exposures.length > 500 || !exposures.every(validateActivityExposure)
    || new Set(exposures.map(row => row.id)).size !== exposures.length) { receipt.reasons = ["invalid-or-unattributed-history"]; return batch; }
  const ordered = [...exposures].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const seenOutcomes = new Set<string>(), seenQuestions = new Set<string>();
  const labelled = ordered.filter(exposure => {
    const outcome = exposure.outcome;
    const next = ordered.filter(row => row.sessionId === exposure.sessionId && row.createdAt > exposure.createdAt).reduce((at, row) => Math.min(at, row.createdAt), Infinity);
    if (!outcome || exposure.observations.judgeModel !== input.observations.judgeModel || !eligible(exposure, outcome, asOf, next)
      || seenOutcomes.has(outcome.id) || seenQuestions.has(outcome.questionKey)) return false;
    seenOutcomes.add(outcome.id); seenQuestions.add(outcome.questionKey); return true;
  });
  receipt.counts.labelled = labelled.length;
  const desired = Math.min(32, Math.max(5, Math.ceil(labelled.length * 0.2)));
  let cut = Math.max(0, labelled.length - desired);
  while (cut > 0 && labelled[cut - 1].createdAt === labelled[cut]?.createdAt) cut--;
  const validation = labelled.slice(cut);
  const firstValidationAt = validation[0]?.createdAt ?? asOf;
  // Training labels must already have existed at the first validation exposure.
  const train = labelled.slice(0, cut).filter(row => row.outcome!.createdAt < firstValidationAt);
  batch.train = train; batch.validation = validation;
  receipt.counts.train = train.length; receipt.counts.validation = validation.length;
  if (train.length < 20) { receipt.reasons = ["fewer-than-20-linked-training-outcomes"]; return batch; }
  if (validation.length < 5 || validation.length > 32) { receipt.status = "insufficient-validation"; receipt.reasons = ["requires-5-to-32-chronological-validation-outcomes"]; return batch; }
  if (new Set(train.map(row => row.outcome!.score)).size < 2) { receipt.reasons = ["training-outcomes-have-no-variation"]; return batch; }
  if (input.candidates.length > 8 || input.candidates.length < 2 || new Set(input.candidates.map(row => row.attempt)).size !== input.candidates.length
    || input.candidates.some(row => !Number.isSafeInteger(row.attempt) || row.attempt < 1)) {
    receipt.status = "unsupported-candidates"; receipt.reasons = ["requires-two-to-eight-distinct-approved-attempts"]; return batch;
  }
  const candidates = input.candidates.flatMap(candidate => {
    const value = descriptor(candidate.reply);
    return value && train.filter(row => row.candidate.kind === value.kind).length >= 5 ? [{ attempt: candidate.attempt, descriptor: value }] : [];
  });
  batch.candidates = candidates; receipt.counts.candidates = candidates.length;
  if (!candidates.some(row => row.attempt === input.baselineAttempt) || new Set(candidates.map(row => row.descriptor.kind)).size < 2) {
    receipt.status = "unsupported-candidates"; receipt.reasons = ["baseline-and-two-reply-kinds-require-five-observed-training-outcomes-each"]; return batch;
  }
  const globalMean = mean(train.map(row => row.outcome!.score!));
  batch.baselinePredictions = validation.map(exposure => {
    const matching = train.filter(row => row.candidate.kind === exposure.candidate.kind);
    return matching.length >= 5 ? mean(matching.map(row => row.outcome!.score!)) : globalMean;
  });
  const features = (observations: ActivityObservations, value: ActivityDescriptor) => [...activityObservationFeatures(observations), ...value.features];
  batch.request = { schemaVersion: 1, task: "regression", model: "v3.5_default", featureNames: [...ACTIVITY_OBSERVATION_FEATURES, ...ACTIVITY_DESCRIPTOR_FEATURES],
    trainFeatures: train.map(row => features(row.observations, row.candidate)), trainTargets: train.map(row => row.outcome!.score!),
    testFeatures: [...validation.map(row => features(row.observations, row.candidate)), ...candidates.map(row => features(input.observations, row.descriptor))] };
  receipt.status = "baseline-retained";
  return batch;
}

export async function selectActivityCandidate(input: ActivitySelectionInput, options: { exposures: readonly ActivityExposure[]; transport: OnlineDecisionTransport; asOf?: number }): Promise<ActivitySelection> {
  const batch = buildActivityLearningBatch(input, options.exposures, options.asOf ?? Date.now());
  const baseline = () => ({ attempt: input.baselineAttempt, receipt: batch.receipt });
  if (input.signal.aborted) { batch.receipt.status = "cancelled"; batch.receipt.reasons = ["selection-cancelled"]; return baseline(); }
  if (!batch.request) return baseline();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    const stopped = new Promise<never>((_, reject) => {
      cancel = () => { controller.abort(); reject(new Error("activity_selection_cancelled")); };
      input.signal.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new Error("activity_selection_timeout")); }, ACTIVITY_LEARNING_POLICY.timeoutMs);
    });
    const response = await Promise.race([options.transport(batch.request, controller.signal), stopped]);
    if (input.signal.aborted) throw new Error("activity_selection_cancelled");
    if (!record(response) || response.model !== "v3.5_default" || !Array.isArray(response.predictions)
      || response.predictions.length !== batch.request.testFeatures.length || !response.predictions.every(probability)) {
      batch.receipt.status = "invalid-response"; batch.receipt.reasons = ["invalid-provider-predictions"]; return baseline();
    }
    const predictions = response.predictions as number[];
    const modelLoss = mean(batch.validation.map((row, index) => (predictions[index] - row.outcome!.score!) ** 2));
    const baselineLoss = mean(batch.validation.map((row, index) => (batch.baselinePredictions[index] - row.outcome!.score!) ** 2));
    batch.receipt.validation = { kind: "squared-error", modelLoss, baselineLoss, passed: modelLoss + 1e-6 < baselineLoss };
    if (!batch.receipt.validation.passed) { batch.receipt.reasons = ["holdout-does-not-beat-training-kind-mean"]; return baseline(); }
    batch.receipt.predictedScores = batch.candidates.map((candidate, index) => ({ attempt: candidate.attempt, score: predictions[batch.validation.length + index] }));
    const baseScore = batch.receipt.predictedScores.find(row => row.attempt === input.baselineAttempt)!.score;
    const winner = [...batch.receipt.predictedScores].sort((a, b) => b.score - a.score || Number(b.attempt === input.baselineAttempt) - Number(a.attempt === input.baselineAttempt) || a.attempt - b.attempt)[0];
    if (winner.score <= baseScore + 1e-6) { batch.receipt.reasons = ["baseline-has-best-predicted-score"]; return baseline(); }
    batch.receipt.status = "active"; batch.receipt.selectedAttempt = winner.attempt;
    batch.receipt.reasons = ["held-out-prediction-error-improved"];
    return { attempt: winner.attempt, receipt: batch.receipt };
  } catch {
    batch.receipt.status = input.signal.aborted ? "cancelled" : "failed";
    batch.receipt.reasons = [input.signal.aborted ? "selection-cancelled" : "selection-unavailable-or-timed-out"];
    return baseline();
  } finally { controller.abort(); if (timer) clearTimeout(timer); if (cancel) input.signal.removeEventListener("abort", cancel); }
}
