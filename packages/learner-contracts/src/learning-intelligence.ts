import { isContractTimestamp, isRecord } from "./validation.js";

/** Immutable message revision used to verify every navigable passage. Offsets are UTF-16. */
export interface LearningEvidenceSource {
  readonly sessionId: string;
  readonly messageId: string;
  readonly text: string;
  readonly role?: string;
}
export interface LearningEvidenceCandidate {
  readonly quote: string;
  readonly start?: number;
  readonly end?: number;
  readonly sourceHash?: string;
}
export interface LearningEvidenceAnchor {
  readonly sessionId: string;
  readonly messageId: string;
  readonly quote: string;
  readonly start: number;
  readonly end: number;
  readonly sourceHash: string;
}
export type LearningEvidenceAbstention = "invalid-source" | "missing-passage" | "invalid-range" | "ambiguous-passage" | "passage-mismatch" | "source-changed";
export type LearningEvidenceGrounding = { status: "grounded"; anchor: LearningEvidenceAnchor }
  | { status: "abstained"; reason: LearningEvidenceAbstention };
export const LEARNING_EXTRACTION_KINDS = ["answer-step", "lesson-fact", "learning-constraint", "memory", "important-question"] as const;
export type LearningExtractionKind = typeof LEARNING_EXTRACTION_KINDS[number];
export interface LearningExtractionCandidate extends LearningEvidenceCandidate { readonly kind: LearningExtractionKind }
export interface GroundedLearningExtraction { readonly kind: LearningExtractionKind; readonly evidence: LearningEvidenceAnchor }

/** Non-security FNV-1a revision fingerprint over the entire UTF-16 source, not just the quote. */
export function learningSourceHash(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit & 255)) * 0x100000001b3n);
    hash = BigInt.asUintN(64, (hash ^ BigInt(unit >>> 8)) * 0x100000001b3n);
  }
  return `fnv1a64-utf16-v1:${text.length}:${hash.toString(16).padStart(16, "0")}`;
}

function validSource(source: LearningEvidenceSource): boolean {
  return typeof source.sessionId === "string" && source.sessionId.length > 0 && source.sessionId.length <= 256
    && typeof source.messageId === "string" && source.messageId.length > 0 && source.messageId.length <= 256
    && typeof source.text === "string" && source.text.length <= 100_000;
}
function splitsSurrogate(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Exact spans only. A unique verbatim quote can supply omitted offsets; partial offsets never can. */
export function groundLearningEvidence(source: LearningEvidenceSource, candidate: LearningEvidenceCandidate): LearningEvidenceGrounding {
  if (!validSource(source)) return { status: "abstained", reason: "invalid-source" };
  const sourceHash = learningSourceHash(source.text);
  if (candidate.sourceHash !== undefined && candidate.sourceHash !== sourceHash) return { status: "abstained", reason: "source-changed" };
  if (typeof candidate.quote !== "string" || !candidate.quote.trim() || candidate.quote.length > 4_000) {
    return { status: "abstained", reason: "missing-passage" };
  }
  let { start, end } = candidate;
  if (start === undefined && end === undefined) {
    start = source.text.indexOf(candidate.quote);
    if (start < 0) return { status: "abstained", reason: "passage-mismatch" };
    if (source.text.indexOf(candidate.quote, start + 1) >= 0) return { status: "abstained", reason: "ambiguous-passage" };
    end = start + candidate.quote.length;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start! < 0 || end! <= start! || end! > source.text.length
    || splitsSurrogate(source.text, start!) || splitsSurrogate(source.text, end!)) {
    return { status: "abstained", reason: "invalid-range" };
  }
  if (source.text.slice(start, end) !== candidate.quote) return { status: "abstained", reason: "passage-mismatch" };
  return { status: "grounded", anchor: Object.freeze({ sessionId: source.sessionId, messageId: source.messageId,
    quote: candidate.quote, start: start!, end: end!, sourceHash }) };
}

/** Recheck at navigation time: edits anywhere in the source invalidate the old revision. */
export function verifyLearningEvidence(source: LearningEvidenceSource, anchor: LearningEvidenceAnchor): boolean {
  return source.sessionId === anchor.sessionId && source.messageId === anchor.messageId
    && typeof anchor.sourceHash === "string" && Number.isSafeInteger(anchor.start) && Number.isSafeInteger(anchor.end)
    && groundLearningEvidence(source, anchor).status === "grounded";
}

export function groundLearningExtractions(source: LearningEvidenceSource, candidates: readonly LearningExtractionCandidate[]): {
  items: GroundedLearningExtraction[];
  abstentions: { index: number; kind: LearningExtractionKind; reason: LearningEvidenceAbstention | "invalid-kind" | "extraction-limit" }[];
} {
  const items: GroundedLearningExtraction[] = [], abstentions: ReturnType<typeof groundLearningExtractions>["abstentions"] = [];
  candidates.forEach((candidate, index) => {
    const result = index >= 32 ? { status: "abstained" as const, reason: "extraction-limit" as const }
      : !LEARNING_EXTRACTION_KINDS.includes(candidate.kind) ? { status: "abstained" as const, reason: "invalid-kind" as const }
      : groundLearningEvidence(source, candidate);
    if (result.status === "grounded") items.push({ kind: candidate.kind, evidence: result.anchor });
    else abstentions.push({ index, kind: candidate.kind, reason: result.reason });
  });
  return { items, abstentions };
}

export interface LearningForecastInterval { p10: number; median: number; p90: number }
/** Validation never sorts, clamps, or fills in a model's missing quantiles. */
export function isLearningForecastInterval(value: unknown, minimum = 0, maximum = 1): value is LearningForecastInterval {
  if (!isRecord(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) return false;
  const { p10, median, p90 } = value;
  return typeof p10 === "number" && Number.isFinite(p10) && typeof median === "number" && Number.isFinite(median)
    && typeof p90 === "number" && Number.isFinite(p90) && minimum <= p10 && p10 <= median && median <= p90 && p90 <= maximum;
}
export type LearningOutcomeKind = "quiz" | "card";
/** Quiz values are actual earned fractions; card values are the original subjective 0..3 rating. */
export interface LearningOutcomePoint { id: string; targetId: string; kind: LearningOutcomeKind; at: string; value: number }
export interface LearningSuccessForecast {
  kind: "success";
  status: "estimate" | "unknown";
  reason?: "insufficient-history" | "invalid-history";
  targetId: string;
  observedCount: number;
  p10: number | null;
  median: number | null;
  p90: number | null;
  measure: "quiz-score" | "card-rating";
  baseline: "empirical-outcomes";
  provenance: "local-baseline";
}

function observedOutcomes(points: readonly LearningOutcomePoint[], input: { targetId: string; kind: LearningOutcomeKind; now: string }): LearningOutcomePoint[] | null {
  if (!isContractTimestamp(input.now) || !input.targetId || (input.kind !== "quiz" && input.kind !== "card") || points.length > 10_000) return null;
  const selected = points.filter(point => point.targetId === input.targetId && point.kind === input.kind);
  if (selected.some(point => !point.id || !isContractTimestamp(point.at) || !Number.isFinite(point.value)
    || point.value < 0 || point.value > (input.kind === "quiz" ? 1 : 3)
    || (input.kind === "card" && !Number.isInteger(point.value)))) return null;
  const seen = new Map<string, LearningOutcomePoint>();
  for (const point of selected) {
    if (Date.parse(point.at) > Date.parse(input.now)) continue;
    const previous = seen.get(point.id);
    if (previous && (previous.at !== point.at || previous.value !== point.value)) return null;
    seen.set(point.id, point);
  }
  return [...seen.values()].sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id)).slice(-64);
}
function quantile(values: number[], probability: number): number {
  const position = probability * (values.length - 1), lower = Math.floor(position), weight = position - lower;
  return values[lower]! * (1 - weight) + values[Math.ceil(position)]! * weight;
}

/**
 * Conservative next-outcome reference, separate from mastery/retention models.
 * Quantiles describe observed outcomes, not a calibrated success probability or forgetting date.
 */
export function forecastLearningSuccess(points: readonly LearningOutcomePoint[], input: {
  targetId: string; kind: LearningOutcomeKind; now: string;
}): LearningSuccessForecast {
  const outcomes = observedOutcomes(points, input);
  const base: LearningSuccessForecast = { kind: "success", status: "unknown", targetId: input.targetId,
    observedCount: outcomes?.length ?? 0, p10: null, median: null, p90: null,
    measure: input.kind === "quiz" ? "quiz-score" : "card-rating", baseline: "empirical-outcomes", provenance: "local-baseline" };
  if (!outcomes) return { ...base, reason: "invalid-history" };
  if (outcomes.length < 8 || Date.parse(outcomes[0]!.at) === Date.parse(outcomes.at(-1)!.at)) return { ...base, reason: "insufficient-history" };
  const values = outcomes.map(point => point.value).sort((left, right) => left - right);
  return { ...base, status: "estimate", p10: quantile(values, 0.1), median: quantile(values, 0.5), p90: quantile(values, 0.9) };
}

export interface LearningReviewForecast extends Omit<LearningSuccessForecast, "kind" | "baseline"> {
  kind: "review";
  baseline: "srs-schedule";
  dueAt: string;
  due: boolean | null;
}
/** The existing schedule stays authoritative; ratings never become objective recall probabilities. */
export function forecastLearningReview(points: readonly LearningOutcomePoint[], input: {
  targetId: string; now: string; dueAt: string;
}): LearningReviewForecast {
  const success = forecastLearningSuccess(points, { ...input, kind: "card" });
  const validSchedule = isContractTimestamp(input.dueAt) && isContractTimestamp(input.now);
  return { ...success, kind: "review", baseline: "srs-schedule", dueAt: input.dueAt,
    due: validSchedule ? Date.parse(input.dueAt) <= Date.parse(input.now) : null,
    ...(!validSchedule ? { status: "unknown" as const, reason: "invalid-history" as const, p10: null, median: null, p90: null } : {}) };
}

export interface ImportantLearningQuestion {
  id: string;
  targetId: string;
  evidence: LearningEvidenceAnchor;
  outcomeKind?: LearningOutcomeKind;
}
export interface RankedImportantLearningQuestion extends ImportantLearningQuestion {
  kind: "importance";
  observedCount: number;
  challengeCount: number;
  reason: "observed-difficulty" | "insufficient-history" | "invalid-history";
  provenance: "local-baseline";
}
/** Rank already-grounded questions by recorded difficulty; this does not predict exam importance. */
export function rankImportantLearningQuestions(candidates: readonly ImportantLearningQuestion[], points: readonly LearningOutcomePoint[], input: {
  now: string;
}): RankedImportantLearningQuestion[] {
  return candidates.slice(0, 32).map(candidate => {
    const outcomeKind = candidate.outcomeKind ?? "quiz";
    const outcomes = observedOutcomes(points, { targetId: candidate.targetId, kind: outcomeKind, now: input.now });
    const challengeCount = outcomes?.filter(point => point.value < (outcomeKind === "quiz" ? 0.7 : 2)).length ?? 0;
    return { ...candidate, kind: "importance" as const, observedCount: outcomes?.length ?? 0, challengeCount,
      reason: !outcomes ? "invalid-history" as const : outcomes.length < 3 ? "insufficient-history" as const : "observed-difficulty" as const,
      provenance: "local-baseline" as const };
  }).sort((left, right) => Number(right.reason === "observed-difficulty") - Number(left.reason === "observed-difficulty")
    || right.challengeCount - left.challengeCount || left.id.localeCompare(right.id));
}
