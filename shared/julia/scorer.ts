import type { LocalLabelScorer } from "../../packages/learner-contracts/src/judgement/local-backend.js";
import type { JuliaDecisionRequest } from "./encoder.js";

/** Keeps descriptive poles and criterion order intact; identifiers are never the rubric. */
export function juliaRow(input: Parameters<LocalLabelScorer>[0]): JuliaDecisionRequest {
  const { question, labels, state } = input;
  const options = juliaQuestionOptions(question, labels);
  return { state, question: question.instructions, type: question.type, options };
}

export function juliaQuestionOptions(question: Parameters<LocalLabelScorer>[0]["question"], labels: readonly string[]): string[] {
  return question.type === "noul" ? [question.criteria?.false ?? "false", question.criteria?.true ?? "true"]
    : question.type === "choice" ? labels.map(label => question.criteria[label] ?? label) : [...question.criteria];
}

/** Actual probabilities, without upstream presentation rounding or invented certainty. */
export function juliaWeights(logits: ArrayLike<number>): number[] {
  const values = Array.from(logits);
  if (values.length < 2 || values.length > 20 || values.some(value => !Number.isFinite(value))) throw new Error("Invalid Julia logits.");
  const maximum = Math.max(...values);
  const weights = values.map(value => Math.exp(value - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map(value => value / total);
}
export const weightsFromLogits = juliaWeights;

export function createJuliaLabelScorer(runtime: { weights(rows: readonly JuliaDecisionRequest[], signal?: AbortSignal): Promise<number[][]> }): LocalLabelScorer {
  return async input => {
    try { return (await runtime.weights([juliaRow(input)], input.signal))[0] ?? null; }
    catch { return null; }
  };
}
