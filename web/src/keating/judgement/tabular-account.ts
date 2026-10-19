import { DEFAULT_MODELS } from "@keating/runtime-config";
import { NotOrganicPublicClient, publicClientConfig, publicClientMaxCostMicrousd } from "../../notorganic-provider/public-client";
import type { OnlineDecisionRequest } from "../../../../packages/learner-contracts/src/judgement/online-decision-policy";

export const ONLINE_LEARNING_CHANGED = "keating-online-learning-changed";
const permission = "tabular:predict";
function client() { const config = publicClientConfig(); return config ? new NotOrganicPublicClient(config) : null; }
export function onlineLearningAccount() {
  try {
    const provider = client(), session = provider?.getSession();
    const scope = provider && session?.id && (session.expiresAt > Date.now() || session.refreshToken)
      ? JSON.stringify([provider.config.issuer, session.id]) : null;
    return { scope, authorized: !!scope && !!session?.scope.split(/\s+/u).includes(permission) };
  } catch { return { scope: null, authorized: false }; }
}
function requireOnlineLearningAccount(scope: string, signal?: AbortSignal): void {
  const account = onlineLearningAccount();
  if (!account.authorized || account.scope !== scope || signal?.aborted) throw new Error("Online prediction authorization changed.");
}
function accountBoundClient(scope: string, signal?: AbortSignal, current?: () => boolean): NotOrganicPublicClient {
  const config = publicClientConfig();
  if (!config) throw new Error("Online prediction authorization changed.");
  requireOnlineLearningAccount(scope, signal);
  if (current && !current()) throw new Error("Online prediction authorization changed.");
  // The account client may await token refresh and DPoP signing. Recheck at the
  // actual dispatch boundary so either await cannot substitute another account.
  const guardedFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requireOnlineLearningAccount(scope, signal);
    if (init?.signal?.aborted || current && !current()) throw new Error("Online prediction authorization changed.");
    return globalThis.fetch(input, { ...init, signal: signal ?? init?.signal });
  }) as typeof fetch;
  return new NotOrganicPublicClient(config, guardedFetch);
}
export type TabularModelPreference = "off" | typeof DEFAULT_MODELS.judgement.tabular;
export type ActivityLearningMode = "background" | "live";
/** Missing/older preferences always choose learning outside the reply's waiting path. */
export function onlineLearningChatMode(scope: string | null): ActivityLearningMode {
  try { return scope && localStorage.getItem(`keating.tabular-chat-mode.v1:${scope}`) === "live" ? "live" : "background"; } catch { return "background"; }
}
export function setOnlineLearningChatMode(scope: string, mode: ActivityLearningMode): void {
  localStorage.setItem(`keating.tabular-chat-mode.v1:${scope}`, mode);
  window.dispatchEvent(new Event(ONLINE_LEARNING_CHANGED));
}
export function onlineLearningModel(scope: string | null): TabularModelPreference {
  try { return scope && localStorage.getItem(`keating.tabular-model.v1:${scope}`) === DEFAULT_MODELS.judgement.tabular ? DEFAULT_MODELS.judgement.tabular : "off"; } catch { return "off"; }
}
export function onlineLearningEnabled(scope: string | null): boolean { return onlineLearningModel(scope) !== "off"; }
export function setOnlineLearningModel(scope: string, model: TabularModelPreference): void {
  localStorage.setItem(`keating.tabular-model.v1:${scope}`, model);
  window.dispatchEvent(new Event(ONLINE_LEARNING_CHANGED));
}
export interface TabularModelListing {
  id: typeof DEFAULT_MODELS.judgement.tabular; name: string; provider: string; available: boolean; priceMicrousd: number | null;
}
export async function onlineLearningModels(scope: string, signal?: AbortSignal): Promise<TabularModelListing[]> {
  const provider = accountBoundClient(scope, signal);
  const response = await provider.request("/v1/tabular/models", { method: "GET", signal, redirect: "error" });
  if (!response.ok) throw new Error("The account service could not list tabular models yet.");
  const body: unknown = await response.json();
  requireOnlineLearningAccount(scope, signal);
  if (!body || typeof body !== "object" || !("models" in body) || !Array.isArray(body.models)) throw new Error("Invalid model catalogue.");
  return body.models.filter((row): row is TabularModelListing => !!row && row.id === DEFAULT_MODELS.judgement.tabular && typeof row.name === "string"
    && typeof row.provider === "string" && typeof row.available === "boolean"
    && (row.priceMicrousd === null || (Number.isSafeInteger(row.priceMicrousd) && row.priceMicrousd > 0)));
}
export async function connectOnlineLearning(returnTo: string): Promise<string> {
  const config = publicClientConfig();
  if (!config) throw new Error("Account connection is not configured.");
  const existing = new NotOrganicPublicClient(config).getSession()?.scope ?? "";
  const scope = [...new Set([...config.scope.split(/\s+/u), ...existing.split(/\s+/u), permission].filter(Boolean))].join(" ");
  return new NotOrganicPublicClient({ ...config, scope }).authorizationUrl(returnTo);
}
/** DPoP and the existing per-request spending ceiling are provided by the account client. */
export async function requestOnlinePredictions(request: OnlineDecisionRequest, scope: string, signal?: AbortSignal, current?: () => boolean): Promise<unknown> {
  const provider = accountBoundClient(scope, signal, current);
  const response = await provider.request("/v1/tabular/predict", { method: "POST", signal, redirect: "error",
    headers: { "content-type": "application/json", "idempotency-key": `keating-tabular-${crypto.randomUUID()}`,
      "x-notorganic-max-cost-microusd": String(publicClientMaxCostMicrousd()) }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error(response.status === 402 ? "Online predictions need account credit or a higher request budget."
    : response.status === 503 ? "Online predictions are not enabled by the account service yet." : "Online predictions are temporarily unavailable.");
  requireOnlineLearningAccount(scope, signal);
  if (Number(response.headers.get("content-length")) > 32_768) throw new Error("Invalid prediction response.");
  const text = await response.text();
  requireOnlineLearningAccount(scope, signal);
  if (current && !current()) throw new Error("Online prediction authorization changed.");
  if (text.length > 32_768) throw new Error("Invalid prediction response.");
  return JSON.parse(text);
}
