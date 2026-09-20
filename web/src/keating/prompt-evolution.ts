import { evolvePromptTemplateWithEvaluator, type PromptEvolutionRun } from "./core";
import { browserEvolutionStore } from "./teaching-evolution-store";
import { subscribeJudgementModelSettings } from "./judgement-model";
import { createWebJudgementRuntime } from "./judgement/runtime";
import type { BrowserPromptEvaluationOptions } from "./judgement/prompt-evaluation";
import { createBrowserPromptEvolutionEvaluator } from "./judgement/prompt-evolution";

/** Explicit prompt_evolve action. Saved results are proposals, never activation evidence. */
export async function evolveBrowserPrompt(prompt: string, name: string, options: BrowserPromptEvaluationOptions = {}, signal?: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const unsubscribe = subscribeJudgementModelSettings(cancel);
  const timeout = setTimeout(cancel, 120_000);
  const evaluator = createBrowserPromptEvolutionEvaluator(options.runtime ?? createWebJudgementRuntime(), controller.signal);
  let run: PromptEvolutionRun | null = null;
  try { run = await evolvePromptTemplateWithEvaluator(prompt, name, evaluator.evaluate, controller.signal); }
  catch { /* Retain failed attempts before returning a stopped comparison, never a mixed-score winner. */ }
  finally { clearTimeout(timeout); unsubscribe(); signal?.removeEventListener("abort", cancel); }
  const receipt = evaluator.receipt();
  const key = `raw/prompt-evolution-${crypto.randomUUID()}`;
  let receiptKey: string | null = key;
  try { await (options.store ?? browserEvolutionStore).put(key, receipt); }
  catch { receiptKey = null; }
  if (signal?.aborted) run = null;
  return { run, receipt, receiptKey };
}
