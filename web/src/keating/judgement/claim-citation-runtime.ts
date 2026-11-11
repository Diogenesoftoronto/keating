/**
 * Production wiring for the post-release claim check: Clairic for extraction,
 * the configured web search without interactive prompts, and the draft gate's
 * judgement router. Each adapter returns null when its service is unavailable.
 */
import { LEARNING_EXTRACTION_NULL_THRESHOLD } from "../../../../packages/learner-contracts/src/learning-extraction-contract.js";
import { parseWebSearchResult } from "../../components/web-search-result";
import { resolveAuxiliaryWebSearchModel, searchWithConfiguredProvider } from "../../hooks/keating-stream";
import { isNotOrganicFeatureEnabled, notOrganicPublicClient } from "../../notorganic-provider";
import { searchNotOrganicWeb } from "../../notorganic-provider/web";
import { learningIntelligenceAccount, learningIntelligenceEnabled } from "../learning-intelligence/account";
import { requestLearningExtraction } from "../learning-intelligence/provider";
import { CLAIM_EXTRACTION_FIELDS, type ClaimCheckDependencies } from "./claim-citations";
import { createDraftGateJudgementCaller } from "./draft-gate";

export async function extractReplyClaims(reply: string, signal: AbortSignal): Promise<readonly string[] | null> {
  if (!learningIntelligenceEnabled()) return null;
  const account = learningIntelligenceAccount();
  if (!account.authorized || !account.scope) return null;
  const result = await requestLearningExtraction({
    state: reply.slice(0, 12_000),
    fields: Object.fromEntries(Object.entries(CLAIM_EXTRACTION_FIELDS).map(([id, instructions]) =>
      [id, { type: "text" as const, instructions, null_threshold: LEARNING_EXTRACTION_NULL_THRESHOLD }])),
    reference_date: new Date().toISOString().slice(0, 10),
  }, account.scope, signal);
  if (!result.ok) return null;
  return Object.keys(CLAIM_EXTRACTION_FIELDS).flatMap(id => {
    const answer = result.answers[id];
    return answer && typeof answer.value === "string" && typeof answer.p_null === "number" && answer.p_null <= LEARNING_EXTRACTION_NULL_THRESHOLD
      ? [answer.value] : [];
  });
}

/** Never opens a sign-in or permission prompt: a background check must not interrupt the learner. */
export async function searchClaim(query: string, signal: AbortSignal) {
  const hosted = isNotOrganicFeatureEnabled() ? notOrganicPublicClient() : null;
  let text: string;
  if (hosted) {
    if (!hosted.getSession()?.scope.split(/\s+/).includes("web:search")) return null;
    text = await searchNotOrganicWeb(hosted, query, signal, undefined, async () => false);
  } else {
    if (!await resolveAuxiliaryWebSearchModel()) return null;
    text = await searchWithConfiguredProvider(query, signal);
  }
  return { text, sites: parseWebSearchResult(text, { query }).sites.map(site => ({ url: site.url, ...(site.title ? { title: site.title } : {}) })) };
}

export function claimCheckDependencies(): ClaimCheckDependencies {
  return { extract: extractReplyClaims, search: searchClaim, judge: createDraftGateJudgementCaller() };
}
