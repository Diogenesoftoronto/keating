/**
 * The offline judgement backend.
 *
 * A local model cannot be trusted to emit well-formed JSON, so it is never
 * asked to. Instead every question is reduced to scoring a closed label set,
 * and this module turns those scores into the same typed answer the hosted
 * backend returns. The label set always comes from the question, so the local
 * backend is subject to exactly the same "selection cannot hallucinate"
 * property as the hosted one.
 *
 * Two runtimes plug in here: Needle where the label set is small and fixed,
 * and the user-selected local model (MiniCPM5 2B by default) for the rest.
 */
import {
  type JudgementAnswer,
  type JudgementCaller,
  type JudgementOutcome,
  type JudgementQuestion,
  type JudgementRequest,
  type JudgementState,
  judgementRequestProblem,
} from "./contracts.js";

/**
 * Score a closed label set against some state.
 *
 * Evaluate the full question, including its criteria, against the state.
 * Labels are answer identifiers: Choice keys, Score indices, or no/yes for
 * Noul (mapped to criteria.false/criteria.true when poles are supplied).
 *
 * Returns one finite non-negative weight per label, in the order given.
 * Weights need not sum to 1: probabilities, sample counts, and non-negative
 * similarity scores are acceptable. Convert logits/logprobs to weights in
 * the scorer (for example, exponentiate after subtracting their maximum);
 * this adapter does not interpret log-space values. Returning null is an honest
 * "cannot answer", which becomes an abstention rather than a guess.
 */
export type LocalLabelScorer = (input: {
  readonly state: JudgementState;
  /** Complete semantics; opaque answer identifiers alone are not a rubric. */
  readonly question: JudgementQuestion;
  /** Convenience alias of question.instructions. */
  readonly instructions: string;
  readonly labels: readonly string[];
  readonly signal?: AbortSignal;
}) => Promise<readonly number[] | null>;

export interface LocalJudgementOptions {
  readonly scoreLabels: LocalLabelScorer;
  readonly model: string;
  readonly calibrationSha256?: string | null;
}

/** Poles for a Noul, which the protocol treats as an ordinary two-label set. */
const NOUL_LABELS = ["no", "yes"] as const;

function labelsFor(question: JudgementQuestion): readonly string[] {
  if (question.type === "noul") return NOUL_LABELS;
  if (question.type === "choice") return Object.keys(question.criteria);
  return question.criteria.map((_, index) => String(index));
}

/**
 * Normalize arbitrary non-negative weights into a distribution.
 *
 * Returns null for a degenerate input rather than inventing a uniform
 * distribution: a uniform answer would read as genuine maximal uncertainty,
 * when in fact the scorer produced nothing usable at all.
 */
function normalize(weights: readonly number[], expected: number): number[] | null {
  if (weights.length !== expected) return null;
  let maximum = 0;
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) return null;
    maximum = Math.max(maximum, weight);
  }
  if (maximum <= 0) return null;
  // Scaling first prevents valid finite weights from overflowing their sum.
  const scaled = weights.map((weight) => weight / maximum);
  const total = scaled.reduce((sum, weight) => sum + weight, 0);
  return scaled.map((weight) => weight / total);
}

/**
 * Concentration of a distribution on 0..1, as normalized entropy subtracted
 * from one. A point mass scores 1 and a uniform spread scores 0, which matches
 * how confidence is meant to be read: how concentrated, not how correct.
 */
export function distributionConfidence(probabilities: readonly number[]): number {
  const supported = probabilities.filter((probability) => probability > 0);
  if (supported.length <= 1) return 1;
  let entropy = 0;
  for (const probability of supported) entropy -= probability * Math.log(probability);
  const maximum = Math.log(probabilities.length);
  if (maximum <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - entropy / maximum));
}

function buildAnswer(question: JudgementQuestion, probabilities: readonly number[]): JudgementAnswer {
  if (question.type === "noul") {
    // Index 1 is the "yes" pole; the protocol reports P(yes) and no confidence.
    return { type: "noul", noul: probabilities[1] };
  }
  if (question.type === "choice") {
    const options = Object.keys(question.criteria);
    const byOption: Record<string, number> = {};
    let best = options[0];
    options.forEach((option, index) => {
      byOption[option] = probabilities[index];
      if (probabilities[index] > byOption[best]) best = option;
    });
    return {
      type: "choice",
      choice: best,
      probabilities: byOption,
      confidence: distributionConfidence(probabilities),
    };
  }
  const byLevel: Record<string, number> = {};
  const legend: Record<string, string> = {};
  let score = 0;
  question.criteria.forEach((description, index) => {
    byLevel[String(index)] = probabilities[index];
    legend[String(index)] = description;
    score += index * probabilities[index];
  });
  return {
    type: "score",
    score,
    legend,
    probabilities: byLevel,
    confidence: distributionConfidence(probabilities),
  };
}

/**
 * Build a `JudgementCaller` backed by an on-device scorer.
 *
 * Questions are answered one at a time because a local runtime has no batch
 * endpoint; a question the scorer cannot handle is simply omitted from the
 * response, which the router already reads as "escalate this one".
 */
export function createLocalJudgementCaller(options: LocalJudgementOptions): JudgementCaller {
  const calibrationSha256 = options.calibrationSha256 ?? null;

  return async function callLocalJudgement(
    request: JudgementRequest,
    signal?: AbortSignal,
  ): Promise<JudgementOutcome> {
    if (judgementRequestProblem(request) !== null) {
      return { ok: false, error: { code: "request-invalid", retryable: false } };
    }
    if (signal?.aborted) return { ok: false, error: { code: "cancelled", retryable: false } };

    const answers: Record<string, JudgementAnswer> = {};
    for (const [key, question] of Object.entries(request.questions)) {
      if (signal?.aborted) return { ok: false, error: { code: "cancelled", retryable: false } };
      const labels = labelsFor(question);
      let weights: readonly number[] | null;
      try {
        weights = await options.scoreLabels({
          state: request.state,
          question,
          instructions: question.instructions,
          labels,
          signal,
        });
      } catch {
        if (signal?.aborted) return { ok: false, error: { code: "cancelled", retryable: false } };
        // One bad question must not lose the answers already gathered.
        continue;
      }
      // A scorer may settle after cancellation, including on the final question.
      // Never publish its late answer or the partial batch as a successful call.
      if (signal?.aborted) return { ok: false, error: { code: "cancelled", retryable: false } };
      if (weights === null) continue;
      const probabilities = normalize(weights, labels.length);
      if (probabilities === null) continue;
      answers[key] = buildAnswer(question, probabilities);
    }

    return {
      ok: true,
      response: {
        answers,
        backend: { backend: "local", model: options.model, calibrationSha256 },
      },
    };
  };
}
