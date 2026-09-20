import { basename } from "node:path";
import type { PromptEvaluator, PromptGenerator } from "../core/prompt-evolution.js";
import { evaluatePromptRubric, type PromptEvaluationReview } from "../../shared/pedagogy/prompt-judgement.js";
import type { JudgementBackendKey } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { evaluateCliPrompt, type CliPromptEvaluationOptions } from "./cli-prompt-evaluation.js";
import { JUDGEMENT_MODEL_ENV } from "./transport.js";

export interface CliPromptEvolutionOptions extends CliPromptEvaluationOptions {
  iterations?: number;
  generator?: PromptGenerator;
}

/** One comparison uses one scoring source and one concrete model. A later failure cannot become a heuristic winner. */
export function createCliPromptEvolutionEvaluator(cwd: string, options: CliPromptEvaluationOptions = {}) {
  const env = { ...(options.env ?? process.env) };
  const evaluations: Array<{ promptPath: string; prompt: string; review: PromptEvaluationReview }> = [];
  let source: "heuristic" | "proxy" | null = null;
  let backend: JudgementBackendKey | null = null;
  let aborted = false;
  let reason: "cancelled" | "judgement-abstained" | "identity-changed" | null = null;

  const evaluator: PromptEvaluator = async (_cwd, promptPath, prompt) => {
    const review = source === "heuristic"
      ? await evaluatePromptRubric(prompt, null, options.signal)
      : await evaluateCliPrompt(cwd, prompt, { ...options, env: { ...env, ...(backend ? { [JUDGEMENT_MODEL_ENV]: backend.model } : {}) } });
    evaluations.push({ promptPath, prompt, review: structuredClone(review) });
    if (options.signal?.aborted || review.judgement.reason === "cancelled") {
      aborted = true; reason = "cancelled";
      throw new Error("prompt_evolution_cancelled");
    }
    if (source === null) {
      source = review.source;
      backend = review.source === "proxy" ? review.judgement.backend : null;
    } else if (source === "proxy") {
      const actual = review.judgement.backend;
      if (review.source !== "proxy" || !actual) {
        aborted = true; reason = "judgement-abstained";
      } else if (actual.backend !== backend!.backend || actual.model !== backend!.model || actual.calibrationSha256 !== backend!.calibrationSha256) {
        aborted = true; reason = "identity-changed";
      }
      if (aborted) throw new Error("prompt_evolution_judgement_abstained");
    }
    return { promptPath, promptName: basename(promptPath, ".md"), score: review.score, objectives: review.objectives, feedback: review.feedback };
  };

  return {
    evaluator,
    receipt: () => structuredClone({ schemaVersion: 1 as const, operation: "prompt_evolution" as const,
      source, backend, calibration: "uncalibrated" as const, humanLearning: "unmeasured" as const, aborted, reason, evaluations }),
  };
}
