/**
 * Memory extraction, local search, and reranking.
 *
 * The organising idea is that the on-device model proposes and code disposes.
 * A small model is good at finding candidate spans and at producing embeddings;
 * it is not good at deciding what matters. So it shortlists, a judgement ranks,
 * and every write is gated by rules that live here rather than in a prompt.
 *
 * Shortlisting first is also the mitigation for the hosted model's documented
 * decline on large, mostly-irrelevant state: filter in code, then judge.
 */
import { type ChoiceQuestion, type NoulQuestion, type ScoreQuestion, type ScoreAnswer } from "./contracts.js";
import { normalizedScore } from "./projections.js";

/* -------------------------------------------------------------------------
 * Embedding similarity
 * ---------------------------------------------------------------------- */

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export interface SimilarityCalibration {
  readonly mean: number;
  readonly standardDeviation: number;
  readonly sampleSize: number;
}

/**
 * Measure where this corpus actually sits.
 *
 * The embedding space is strongly anisotropic: observed pairwise cosines fall
 * in roughly [0.93, 0.96] with a standard deviation near 0.007. A raw threshold
 * like "similar if cosine > 0.8" therefore matches *everything*, which is why
 * every comparison below is expressed in standard deviations from this mean
 * rather than in raw cosine.
 */
export function calibrateSimilarity(cosines: readonly number[]): SimilarityCalibration | null {
  const usable = cosines.filter((value) => Number.isFinite(value));
  if (usable.length < 2) return null;
  const mean = usable.reduce((total, value) => total + value, 0) / usable.length;
  const variance = usable.reduce((total, value) => total + (value - mean) ** 2, 0) / (usable.length - 1);
  return { mean, standardDeviation: Math.sqrt(variance), sampleSize: usable.length };
}

/**
 * Express a cosine as standard deviations above the corpus mean. Returns null
 * for a degenerate corpus rather than a large z-score, since dividing by a
 * vanishing spread manufactures significance that is not there.
 */
export function similarityZScore(cosine: number, calibration: SimilarityCalibration): number | null {
  if (calibration.standardDeviation <= 0) return null;
  return (cosine - calibration.mean) / calibration.standardDeviation;
}

export interface RankedCandidate<T> {
  readonly item: T;
  readonly cosine: number;
  /** Standard deviations above the corpus mean; null when uncalibratable. */
  readonly zScore: number | null;
  /**
   * Distance to the next candidate in standard deviations. A shortlist whose
   * top two are indistinguishable is a weak shortlist regardless of how high
   * the raw cosines are, so this is a better feature than the score itself.
   */
  readonly marginToNext: number | null;
}

/**
 * Rank by embedding similarity, best first, in calibrated units.
 *
 * A `minimumZScore` of 0 keeps only what is above average for this corpus,
 * which is the weakest defensible filter; raw cosine is never thresholded.
 */
export function rankBySimilarity<T>(
  queryEmbedding: readonly number[],
  candidates: ReadonlyArray<{ readonly item: T; readonly embedding: readonly number[] }>,
  options: { readonly minimumZScore?: number; readonly limit?: number } = {},
): Array<RankedCandidate<T>> {
  const scored: Array<{ item: T; cosine: number }> = [];
  for (const candidate of candidates) {
    const cosine = cosineSimilarity(queryEmbedding, candidate.embedding);
    if (cosine === null) continue;
    scored.push({ item: candidate.item, cosine });
  }
  if (scored.length === 0) return [];

  const calibration = calibrateSimilarity(scored.map((entry) => entry.cosine));
  scored.sort((left, right) => right.cosine - left.cosine);

  const ranked: Array<RankedCandidate<T>> = scored.map((entry, index) => {
    const zScore = calibration ? similarityZScore(entry.cosine, calibration) : null;
    const next = scored[index + 1];
    const marginToNext = next && calibration && calibration.standardDeviation > 0
      ? (entry.cosine - next.cosine) / calibration.standardDeviation
      : null;
    return { item: entry.item, cosine: entry.cosine, zScore, marginToNext };
  });

  const floor = options.minimumZScore;
  const filtered = floor === undefined
    ? ranked
    // A null z-score means the corpus could not be calibrated, so the filter is
    // not meaningful and the candidate is kept rather than silently dropped.
    : ranked.filter((entry) => entry.zScore === null || entry.zScore >= floor);
  return options.limit === undefined ? filtered : filtered.slice(0, Math.max(0, options.limit));
}

/* -------------------------------------------------------------------------
 * Reranking
 * ---------------------------------------------------------------------- */

export function relevanceQuestion(query: string): ScoreQuestion {
  return {
    type: "score",
    instructions:
      `How well does the candidate in the state answer this query?\n\nQuery: ${query}`,
    criteria: [
      "Unrelated to the query.",
      "Same general area, but does not address the query.",
      "Touches the query indirectly or partially.",
      "Addresses the query with a gap or a caveat.",
      "Directly and completely answers the query.",
    ],
  };
}

export interface RerankedItem<T> {
  readonly item: T;
  readonly relevance: number;
  readonly confidence: number;
  /** True when the deterministic order was kept because no judgement applied. */
  readonly fellBack: boolean;
}

/**
 * Rerank a shortlist, keeping the deterministic order as the fallback.
 *
 * Items the judgement could not score, or scored below the confidence floor,
 * keep their original relative position instead of being pushed to the bottom.
 * An unavailable judgement must degrade search to "as good as before", never to
 * "worse than before".
 */
export function rerank<T>(
  shortlist: readonly T[],
  scores: ReadonlyMap<number, ScoreAnswer>,
  minimumConfidence: number,
): Array<RerankedItem<T>> {
  const entries = shortlist.map((item, index) => {
    const answer = scores.get(index);
    const usable = answer !== undefined && answer.confidence >= minimumConfidence;
    return {
      item,
      index,
      relevance: usable ? normalizedScore(answer) : 0,
      confidence: answer?.confidence ?? 0,
      fellBack: !usable,
    };
  });

  return entries
    .slice()
    .sort((left, right) => {
      // Judged items rank above unjudged ones; within each group the original
      // deterministic order breaks ties, so reranking is stable.
      if (left.fellBack !== right.fellBack) return left.fellBack ? 1 : -1;
      if (!left.fellBack && left.relevance !== right.relevance) return right.relevance - left.relevance;
      return left.index - right.index;
    })
    .map(({ item, relevance, confidence, fellBack }) => ({ item, relevance, confidence, fellBack }));
}

/* -------------------------------------------------------------------------
 * Memory extraction
 * ---------------------------------------------------------------------- */

/** Mirrors `LEARNER_MEMORY_CATEGORIES` in `src/core/learner-memory.ts`. */
export const MEMORY_CATEGORIES = [
  "motivation", "communication-preference", "learning-preference", "interest", "study-context",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export function memoryCategoryQuestion(): ChoiceQuestion {
  const criteria: Record<string, string | null> = {};
  for (const category of MEMORY_CATEGORIES) criteria[category] = null;
  return {
    type: "choice",
    instructions: "Which category does the candidate fact in the state belong to?",
    criteria,
  };
}

export function worthRememberingQuestion(): NoulQuestion {
  return {
    type: "noul",
    instructions:
      "Would remembering the candidate fact in the state help teach this learner in a future, unrelated session?",
    criteria: {
      true: "It is a durable fact about the learner.",
      false: "It is incidental to this session, or not about the learner.",
    },
  };
}

/**
 * A judgement never claims the confidence reserved for something the learner
 * stated outright. The memory store caps `observed` facts here, so clamping at
 * the source keeps a proposal from being rejected on arrival.
 */
export const OBSERVED_CONFIDENCE_CEILING = 0.65;

/** The store's own cap. Exceeding it forces eviction, so ranking is mandatory. */
export const MEMORY_FACT_CAP = 128;

export interface MemoryProposal {
  readonly category: MemoryCategory;
  readonly value: string;
  /**
   * Must be an exact substring of a real learner message. The store verifies
   * this and rejects anything else, so a paraphrase is not a lesser proposal —
   * it is an unusable one.
   */
  readonly evidence: string;
  readonly confidence: number;
  readonly source: "observed";
}

/**
 * Build a proposal, or null when it cannot be grounded.
 *
 * Evidence is checked against the learner's own messages here rather than
 * trusted and repaired later. Returning null for an ungrounded span is the
 * point: a fact that cannot be traced to something the learner actually wrote
 * must not be remembered at all.
 */
export function buildMemoryProposal(input: {
  readonly category: MemoryCategory;
  readonly value: string;
  readonly evidence: string;
  readonly noulProbability: number;
  readonly learnerMessages: readonly string[];
}): MemoryProposal | null {
  const evidence = input.evidence.trim();
  if (evidence.length === 0 || input.value.trim().length === 0) return null;
  if (!Number.isFinite(input.noulProbability) || input.noulProbability < 0) return null;
  if (!input.learnerMessages.some((message) => message.includes(evidence))) return null;
  return {
    category: input.category,
    value: input.value.trim(),
    evidence,
    confidence: Math.min(OBSERVED_CONFIDENCE_CEILING, input.noulProbability),
    source: "observed",
  };
}

export interface MemorySelection<T> {
  readonly kept: readonly T[];
  readonly evicted: readonly T[];
}

/**
 * Choose which facts survive the cap, highest confidence first.
 *
 * Ties keep the earlier item so the selection is deterministic and a re-run
 * does not churn the store.
 */
export function selectMemoryFacts<T extends { readonly confidence: number }>(
  existing: readonly T[],
  proposed: readonly T[],
  cap: number = MEMORY_FACT_CAP,
): MemorySelection<T> {
  const all = [...existing, ...proposed];
  const ordered = all
    .map((fact, index) => ({ fact, index }))
    .sort((left, right) => right.fact.confidence - left.fact.confidence || left.index - right.index);
  const limit = Math.max(0, cap);
  return {
    kept: ordered.slice(0, limit).map((entry) => entry.fact),
    evicted: ordered.slice(limit).map((entry) => entry.fact),
  };
}
