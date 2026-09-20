/**
 * Pure projections over cached judgement answers.
 *
 * Everything here is synchronous and side-effect free by design: a caller must
 * be able to re-weight, re-threshold, or re-render a judgement without touching
 * the network. That is why the raw distribution is what gets stored, and only
 * the raw distribution.
 */
import {
  type ChoiceAnswer,
  type JudgementAnswer,
  type JudgementBackendKey,
  type NoulAnswer,
  type ScoreAnswer,
  MAX_CHOICE_OPTIONS,
} from "./contracts.js";

/**
 * Choice and Score carry confidence; Noul does not. Null is returned rather
 * than a stand-in so a caller cannot accidentally threshold a number the model
 * never produced.
 */
export function confidenceOf(answer: JudgementAnswer): number | null {
  return answer.type === "noul" ? null : answer.confidence;
}

/** Level probabilities in level order, independent of key insertion order. */
export function orderedLevelProbabilities(answer: ScoreAnswer): number[] {
  return Object.entries(answer.probabilities)
    .map(([level, probability]) => [Number(level), probability] as const)
    .filter(([level]) => Number.isFinite(level))
    .sort((left, right) => left[0] - right[0])
    .map(([, probability]) => probability);
}

/**
 * The level that actually carries the most mass. Decisions read this rather
 * than `score`, because the weighted mean can name a level nobody chose.
 */
export function modalLevel(answer: ScoreAnswer): number {
  const probabilities = orderedLevelProbabilities(answer);
  let best = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[best]) best = index;
  }
  return best;
}

export function levelCount(answer: ScoreAnswer): number {
  return Math.max(Object.keys(answer.legend).length, orderedLevelProbabilities(answer).length);
}

/**
 * Rescale the weighted mean onto an arbitrary ceiling. Presentation only —
 * never feed the result back in as a magnitude.
 */
export function scoreOutOf(answer: ScoreAnswer, outOf: number): number {
  const levels = levelCount(answer);
  if (levels < 2 || outOf <= 0) return 0;
  return (answer.score / (levels - 1)) * outOf;
}

/** The weighted mean on 0..1, for composition against other dimensions. */
export function normalizedScore(answer: ScoreAnswer): number {
  return scoreOutOf(answer, 1);
}

/**
 * A weighted mean can settle in the trough between two peaks, which is the one
 * case where the scalar describes a level nobody voted for. Find the two
 * highest levels: if they are non-adjacent and the best probability strictly
 * between them sits well under the smaller peak, the mean is not a consensus
 * and no threshold should be read off it.
 */
export function isBimodal(answer: ScoreAnswer, troughRatio = 0.5): boolean {
  const probabilities = orderedLevelProbabilities(answer);
  if (probabilities.length < 3) return false;
  const ranked = probabilities
    .map((probability, index) => ({ probability, index }))
    .sort((left, right) => right.probability - left.probability);
  const [first, second] = ranked;
  if (!first || !second || second.probability <= 0) return false;
  const low = Math.min(first.index, second.index);
  const high = Math.max(first.index, second.index);
  if (high - low < 2) return false;
  let trough = Number.POSITIVE_INFINITY;
  for (let index = low + 1; index < high; index += 1) {
    trough = Math.min(trough, probabilities[index]);
  }
  return trough <= troughRatio * second.probability;
}

export function modalOption(answer: ChoiceAnswer): string {
  let best = answer.choice;
  let bestProbability = answer.probabilities[answer.choice] ?? -1;
  for (const [option, probability] of Object.entries(answer.probabilities)) {
    if (probability > bestProbability) {
      best = option;
      bestProbability = probability;
    }
  }
  return best;
}

/** Distance from the runner-up, which is often a better act/defer signal than confidence. */
export function choiceMargin(answer: ChoiceAnswer): number {
  const sorted = Object.values(answer.probabilities).sort((left, right) => right - left);
  if (sorted.length === 0) return 0;
  return sorted[0] - (sorted[1] ?? 0);
}

export interface NoulBand {
  readonly yesAtOrAbove: number;
  readonly noAtOrBelow: number;
}

export type NoulDecision = "yes" | "no" | "uncertain";

/**
 * A Noul gets its own reader with a deliberate uncertain middle. Around 0.5 the
 * model is saying yes and no are equally likely, which is a refusal to commit —
 * not a half-strength yes.
 */
export function noulDecision(answer: NoulAnswer, band: NoulBand): NoulDecision {
  if (answer.noul >= band.yesAtOrAbove) return "yes";
  if (answer.noul <= band.noAtOrBelow) return "no";
  return "uncertain";
}

export interface JudgementThresholds {
  /** Below this, do not act on the answer at all. */
  readonly deferBelow: number;
  /** At or above this, the answer may drive an automatic action. */
  readonly actAtOrAbove: number;
}

/**
 * Conservative on purpose. The guidance is to start strict and loosen against
 * your own measured data, so an unfitted system errs toward asking.
 */
export const CONSERVATIVE_THRESHOLDS: JudgementThresholds = {
  deferBelow: 0.5,
  actAtOrAbove: 0.9,
};

export type ConfidenceBand = "act" | "review" | "defer";

/**
 * Confidence measures how concentrated the distribution is. It is not a
 * correctness estimate and not permission to act — it is a good escalation
 * trigger and a poor action trigger, so the middle band routes to review.
 */
export function confidenceBand(
  confidence: number | null,
  thresholds: JudgementThresholds = CONSERVATIVE_THRESHOLDS,
): ConfidenceBand {
  if (confidence === null || !Number.isFinite(confidence)) return "defer";
  if (confidence >= thresholds.actAtOrAbove) return "act";
  if (confidence < thresholds.deferBelow) return "defer";
  return "review";
}

/** Thresholds are filed per backend *and* per question; neither alone is enough. */
export function thresholdKey(backend: JudgementBackendKey, digest: string): string {
  return `${backend.backend}\u0000${backend.model}\u0000${backend.calibrationSha256 ?? ""}\u0000${digest}`;
}

export interface CalibrationTable {
  readonly entries: Readonly<Record<string, JudgementThresholds>>;
}

/**
 * Returns null rather than a neighbouring backend's numbers.
 *
 * Thresholds fitted on one backend do not transfer to another, the same way a
 * Noul-tuned threshold does not transfer to a Choice. A missing entry is an
 * abstention, not an invitation to reuse whatever is closest.
 */
export function resolveThresholds(
  table: CalibrationTable,
  backend: JudgementBackendKey,
  digest: string,
): JudgementThresholds | null {
  if (backend.calibrationSha256 === null) return null;
  return table.entries[thresholdKey(backend, digest)] ?? null;
}

/**
 * `source` is the literal "proxy", so writing a judgement into an evidence
 * record marked "observed" is a type error rather than a review note.
 */
export interface JudgementProvenance {
  readonly source: "proxy";
  readonly backend: JudgementBackendKey;
  readonly questionDigest: string;
}

export function judgementProvenance(
  backend: JudgementBackendKey,
  questionDigest: string,
): JudgementProvenance {
  return { source: "proxy", backend, questionDigest };
}

export type AbstentionReason =
  | "below-confidence-floor"
  | "bimodal-distribution"
  | "no-calibration"
  | "no-candidate-selected"
  | "backend-error";

/**
 * An abstention escalates or defers. It must never be collapsed into a low
 * score, which is the failure mode that would quietly turn "we don't know" into
 * "the learner did badly".
 */
export type JudgementVerdict<T> =
  | {
    readonly status: "decided";
    readonly value: T;
    readonly confidence: number | null;
    readonly provenance: JudgementProvenance;
  }
  | {
    readonly status: "abstained";
    readonly reason: AbstentionReason;
    readonly provenance: JudgementProvenance;
  };

export function decided<T>(
  value: T,
  confidence: number | null,
  provenance: JudgementProvenance,
): JudgementVerdict<T> {
  return { status: "decided", value, confidence, provenance };
}

export function abstained<T>(
  reason: AbstentionReason,
  provenance: JudgementProvenance,
): JudgementVerdict<T> {
  return { status: "abstained", reason, provenance };
}

/**
 * Read a Score into a verdict under an explicit calibration. Refuses on a
 * bimodal distribution and on a missing calibration before it refuses on
 * confidence, because both mean the threshold itself is meaningless here.
 */
export function scoreVerdict(
  answer: ScoreAnswer,
  backend: JudgementBackendKey,
  digest: string,
  table: CalibrationTable,
): JudgementVerdict<number> {
  const provenance = judgementProvenance(backend, digest);
  const thresholds = resolveThresholds(table, backend, digest);
  if (thresholds === null) return abstained("no-calibration", provenance);
  if (isBimodal(answer)) return abstained("bimodal-distribution", provenance);
  if (confidenceBand(answer.confidence, thresholds) === "defer") {
    return abstained("below-confidence-floor", provenance);
  }
  return decided(modalLevel(answer), answer.confidence, provenance);
}

/**
 * Weights are applied here, over already-cached distributions. Moving a weight
 * must never trigger inference; only a change of state, instructions, criteria,
 * or dimension set does that.
 */
export function compositeScore(
  parts: ReadonlyArray<{ readonly answer: ScoreAnswer; readonly weight: number }>,
): number {
  let total = 0;
  let weighted = 0;
  for (const { answer, weight } of parts) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    total += weight;
    weighted += normalizedScore(answer) * weight;
  }
  return total === 0 ? 0 : weighted / total;
}

const NO_CANDIDATE_OPTION = "none";

export interface CandidateSelection {
  /** Ready to hand to a Choice question. */
  readonly criteria: Record<string, string | null>;
  /** Deduped, in document order. Index positions are stable. */
  readonly candidates: readonly string[];
  /** Guaranteed not to collide with any candidate. */
  readonly noMatchOption: string;
}

/**
 * Evidence by selection.
 *
 * Code finds the candidate spans; the model only picks a key. The recovered
 * span is therefore byte-identical to something that really appears in the
 * source, which is what removes the "model quoted text we cannot locate"
 * failure class rather than merely detecting it.
 */
export function candidateSelection(
  candidates: readonly string[],
  noMatchRubric: string | null = "None of these is the requested span.",
): CandidateSelection {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.length === 0 || seen.has(candidate)) continue;
    seen.add(candidate);
    deduped.push(candidate);
  }
  if (deduped.length + 1 > MAX_CHOICE_OPTIONS) {
    throw new Error(
      `A selection carries at most ${MAX_CHOICE_OPTIONS - 1} candidates; narrow in two stages.`,
    );
  }
  let noMatchOption = NO_CANDIDATE_OPTION;
  for (let suffix = 1; seen.has(noMatchOption); suffix += 1) {
    noMatchOption = `${NO_CANDIDATE_OPTION}-${suffix}`;
  }
  const criteria: Record<string, string | null> = {};
  for (const candidate of deduped) criteria[candidate] = null;
  criteria[noMatchOption] = noMatchRubric;
  return { criteria, candidates: deduped, noMatchOption };
}

/**
 * Resolve a Choice back to a span. Null means the model took the escape hatch
 * or returned something outside the declared set — both are abstentions, and
 * neither is repaired by guessing.
 */
export function resolveSelection(
  selection: CandidateSelection,
  answer: ChoiceAnswer,
): { readonly index: number; readonly text: string } | null {
  if (answer.choice === selection.noMatchOption) return null;
  const index = selection.candidates.indexOf(answer.choice);
  return index === -1 ? null : { index, text: selection.candidates[index] };
}
