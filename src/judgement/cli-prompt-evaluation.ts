import { evaluatePromptRubric, type PromptEvaluationReview } from "../../shared/pedagogy/prompt-judgement.js";
import { createCliJudgementBackend, JUDGEMENT_MODEL_ENV, type CliJudgementOptions } from "./transport.js";

export const PROMPT_JUDGE_ENV = "KEATING_PROMPT_JUDGE";
export interface CliPromptEvaluationOptions {
  env?: Readonly<Record<string, string | undefined>>;
  transport?: Pick<CliJudgementOptions, "fetch" | "loadCredential" | "now" | "retry" | "sleep">;
  signal?: AbortSignal;
}

/** Independent account opt-in. Direct-provider credentials and tutor selection are not inherited. */
export async function evaluateCliPrompt(cwd: string, prompt: string, options: CliPromptEvaluationOptions = {}): Promise<PromptEvaluationReview> {
  const env = options.env ?? process.env;
  const mode = env[PROMPT_JUDGE_ENV]?.trim() || "off";
  if (mode !== "off" && mode !== "legacy" && mode !== "notorganic") throw new Error("prompt_judgement_invalid_mode");
  if (mode !== "notorganic") return evaluatePromptRubric(prompt, null, options.signal);
  let backend: ReturnType<typeof createCliJudgementBackend> = null;
  try { backend = createCliJudgementBackend({ ...options.transport, cwd, env: { [JUDGEMENT_MODEL_ENV]: env[JUDGEMENT_MODEL_ENV] } }); } catch { /* Missing account stays unavailable. */ }
  const call = backend?.call ?? (async () => ({ ok: false as const, error: { code: "backend-unavailable" as const, retryable: false } }));
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return evaluatePromptRubric(prompt, call, signal);
}
