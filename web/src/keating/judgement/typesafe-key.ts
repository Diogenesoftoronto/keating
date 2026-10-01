import type { JudgementTier } from "@keating/learner-contracts";
import { getAppStorage } from "../app-storage";
import { createCustomJudgementBackend } from "./custom-backend";

export const TYPESAFE_JUDGEMENT_KEY_ID = "typesafe-judgement";

/** Load the user's credential only at dispatch, never from public settings or build variables. */
export function createStoredTypesafeJudgementBackend(model: string): JudgementTier {
  return {
    key: Object.freeze({ backend: "system-one", model, calibrationSha256: null }),
    call: async (request, signal) => {
      if (signal?.aborted) return { ok: false, error: { code: "cancelled", retryable: false } };
      try {
        const apiKey = await getAppStorage().providerKeys.get(TYPESAFE_JUDGEMENT_KEY_ID);
        if (signal?.aborted) return { ok: false, error: { code: "cancelled", retryable: false } };
        const tier = createCustomJudgementBackend({ model, apiKey: apiKey ?? "" });
        return tier ? tier.call(request, signal) : { ok: false, error: { code: "backend-unauthorized", retryable: false } };
      } catch {
        return { ok: false, error: { code: "backend-unavailable", retryable: false } };
      }
    },
  };
}
