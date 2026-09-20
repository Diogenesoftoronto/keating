import { evaluatePromptRubric, projectPromptRubric, type PromptEvaluationReview } from "../../../../shared/pedagogy/prompt-judgement";
import { browserEvolutionStore } from "../teaching-evolution-store";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "./runtime";
import { createJudgementOperationCaller } from "./operation";
import type { JudgementOutcome } from "@keating/learner-contracts";

export interface BrowserPromptEvaluationOptions {
  runtime?: WebJudgementRuntime;
  store?: { put(key: string, value: unknown): Promise<void> };
}

/** Called only by explicit prompt_eval; the stored receipt never enters learner or activation evidence. */
export async function evaluateBrowserPrompt(prompt: string, options: BrowserPromptEvaluationOptions = {}, signal?: AbortSignal): Promise<PromptEvaluationReview & { receiptKey: string | null; attempts: JudgementOutcome[] }> {
  const runtime = options.runtime ?? createWebJudgementRuntime();
  const attempts: JudgementOutcome[] = [];
  const recorded: WebJudgementRuntime = { ...runtime, policy: { ...runtime.policy, tiers: runtime.policy.tiers.map((tier) => ({ ...tier,
    call: async (request, abort) => { const outcome = await tier.call(request, abort); attempts.push(structuredClone(outcome)); return outcome; },
  })) } };
  const call = runtime.settings.backend === "off" ? null : createJudgementOperationCaller({ runtime: recorded,
    diagnostics: { origin: "prompt-evaluation", application: "Evaluation only; source prompt unchanged" },
    accept: (response) => projectPromptRubric(prompt, response) !== null });
  const result = await evaluatePromptRubric(prompt, call, signal);
  const retainedAttempts = structuredClone(attempts);
  const receiptKey = `raw/prompt-evaluation-${crypto.randomUUID()}`;
  try {
    await (options.store ?? browserEvolutionStore).put(receiptKey, { ...result, attempts: retainedAttempts });
    return { ...result, receiptKey, attempts: retainedAttempts };
  } catch {
    return { ...result, receiptKey: null, attempts: retainedAttempts };
  }
}
