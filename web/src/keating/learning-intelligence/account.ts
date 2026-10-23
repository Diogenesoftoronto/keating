import { NotOrganicPublicClient, publicClientConfig, publicClientMaxCostMicrousd } from "../../notorganic-provider/public-client";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../model-prefs";

export const LEARNING_INTELLIGENCE_CHANGED = "keating-learning-intelligence-changed";
const preferenceKey = "keating.learning-intelligence.enabled.v1";
const permission = "extraction:run";

/** A local opt-in; account capabilities still determine whether a call may run. */
export function learningIntelligenceEnabled(): boolean {
  try { return localStorage.getItem(preferenceKey) === "true"; } catch { return false; }
}
export function setLearningIntelligenceEnabled(enabled: boolean): void {
  localStorage.setItem(preferenceKey, enabled ? "true" : "false");
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LEARNING_INTELLIGENCE_CHANGED));
}
export function subscribeLearningIntelligence(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = [LEARNING_INTELLIGENCE_CHANGED, PROVIDER_CREDENTIALS_CHANGED_EVENT, "storage", "focus"];
  for (const event of events) window.addEventListener(event, listener);
  return () => { for (const event of events) window.removeEventListener(event, listener); };
}

/** Scope contains only issuer and stable sign-in ID, never a bearer credential. */
export function learningIntelligenceAccount(): { scope: string | null; authorized: boolean; configured: boolean } {
  try {
    const config = publicClientConfig();
    if (!config) return { scope: null, authorized: false, configured: false };
    const provider = new NotOrganicPublicClient(config), session = provider.getSession();
    const scope = typeof session?.id === "string" && session.id
      ? JSON.stringify([config.issuer, session.id]) : null;
    return { scope, authorized: !!scope && !!session?.scope.split(/\s+/u).includes(permission), configured: true };
  } catch { return { scope: null, authorized: false, configured: false }; }
}
export async function connectLearningIntelligence(returnTo: string): Promise<string> {
  const config = publicClientConfig();
  if (!config) throw new Error("Account connection is not configured.");
  const existing = new NotOrganicPublicClient(config).getSession()?.scope ?? "";
  const scope = [...new Set([...config.scope.split(/\s+/u), ...existing.split(/\s+/u), permission].filter(Boolean))].join(" ");
  return new NotOrganicPublicClient({ ...config, scope }).authorizationUrl(returnTo);
}

/** Transport only: validation and fail-soft errors belong to the provider adapter. */
export async function requestAccountLearningExtraction(body: string, scope: string, signal?: AbortSignal, current?: () => boolean): Promise<Response> {
  const config = publicClientConfig();
  const requireCurrent = () => {
    const account = learningIntelligenceAccount();
    if (!learningIntelligenceEnabled() || !account.authorized || account.scope !== scope || signal?.aborted || current && !current()) {
      throw new Error("Learning extraction authorization changed.");
    }
  };
  if (!config) throw new Error("Account connection is not configured.");
  requireCurrent();
  // request() awaits token refresh and DPoP signing. Guard the real fetch boundary
  // as well, so a replacement session cannot spend the previous account's job.
  const guardedFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requireCurrent();
    if (init?.signal?.aborted) throw new Error("Learning extraction authorization changed.");
    return globalThis.fetch(input, { ...init, signal: signal ?? init?.signal });
  }) as typeof fetch;
  const response = await new NotOrganicPublicClient(config, guardedFetch).request("/v1/extraction", {
    method: "POST", signal, redirect: "error", headers: {
      "content-type": "application/json", "idempotency-key": `keating-extraction-${crypto.randomUUID()}`,
      "x-notorganic-max-cost-microusd": String(publicClientMaxCostMicrousd()),
    }, body,
  });
  requireCurrent();
  return response;
}
