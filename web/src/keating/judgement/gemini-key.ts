import { createGeminiDecisionCaller, GEMINI_DECISION_MODEL, type JudgementTier } from "@keating/learner-contracts";
import { getAppStorage } from "../app-storage";

/** A user opts in separately to sending review evidence to Google. */
export const GEMINI_DECISION_KEY_ID = "google-decisions-judgement";
export const GEMINI_DECISION_INPUT_LIMIT = 262_144;

export function createStoredGeminiDecisionBackend(): JudgementTier {
  return {
    key: Object.freeze({ backend: "system-one", model: GEMINI_DECISION_MODEL, calibrationSha256: null }),
    call: async (request, signal) => {
      if (signal?.aborted) return { ok: false, error: { code: "cancelled", retryable: false } };
      const deadline = AbortSignal.timeout(30_000);
      const operation = signal ? AbortSignal.any([signal, deadline]) : deadline;
      try {
        const apiKey = (await getAppStorage().providerKeys.get(GEMINI_DECISION_KEY_ID))?.trim();
        if (signal?.aborted) return { ok: false, error: { code: "cancelled", retryable: false } };
        if (!apiKey || /\s/.test(apiKey)) return { ok: false, error: { code: "backend-unauthorized", retryable: false } };
        const caller = createGeminiDecisionCaller({ apiKey, fetch: (url, init) => fetch(url, init) });
        const outcome = await caller(request, operation);
        if (deadline.aborted && !signal?.aborted) return { ok: false, error: { code: "backend-timeout", retryable: false } };
        return outcome;
      } catch {
        return { ok: false, error: { code: "backend-unavailable", retryable: false } };
      }
    },
  };
}
