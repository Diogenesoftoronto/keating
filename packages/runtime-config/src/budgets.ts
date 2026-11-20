import { MODEL_PREFERENCES } from "./models.js";

/** Public reservation ceilings in micro-USD, not prices or server authorization. */
export const SPENDING_LIMITS = {
  notorganicRequestMicrousd: 100_000,
  // Deployment policy intentionally reserves less than direct browser/CLI calls.
  notorganicServerRequestMicrousd: 50_000,
} as const;

/** Default Jev limits without TypeSafe's optional long-context header. https://docs.typesafe.ai/models#context-length */
export const JEV_REQUEST_TOKEN_LIMIT = 64_000;
export const JEV_STATE_QUESTION_TOKEN_LIMIT = 32_000;

export function hostedJudgementTokenLimits(model: string, provider: "notorganic" | "typesafe") {
  const id = provider === "notorganic" ? model.replace(/^judgement-jev\//, "") : model;
  const known = provider === "notorganic" && model === "judgement"
    || MODEL_PREFERENCES.judgement.aliases.some(alias => alias === id)
    || /^jev-\d+(?:\.\d+)+$/.test(id);
  return { requestTokens: known ? JEV_REQUEST_TOKEN_LIMIT : null, stateQuestionTokens: known ? JEV_STATE_QUESTION_TOKEN_LIMIT : null };
}
