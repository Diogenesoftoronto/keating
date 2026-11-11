/**
 * Claim-check results per reply, kept beside the conversation rather than in
 * it: the published reply text and the model's history never change after
 * release. Keyed by the learning message id the chat already maps to rows.
 */
import type { ClaimCheckResult, ClaimSource } from "./claim-citations";

export const CLAIM_CHECKS_CHANGED = "keating:claim-checks-changed";
const MAX_ENTRIES = 100;

export interface StoredClaimCheck {
  readonly status: ClaimCheckResult["status"];
  readonly sources: readonly ClaimSource[];
  /** Claims no source supported, shown in the unverified tooltip. */
  readonly unsupported: readonly string[];
  readonly checkedAt: number;
}

const key = (sessionId: string) => `keating:claim-checks:v1:${sessionId}`;
const cache = new Map<string, Record<string, StoredClaimCheck>>();

function storage(): Storage | null { try { return localStorage; } catch { return null; } }

function read(sessionId: string): Record<string, StoredClaimCheck> {
  const cached = cache.get(sessionId);
  if (cached) return cached;
  let value: Record<string, StoredClaimCheck> = {};
  try {
    const text = storage()?.getItem(key(sessionId));
    const parsed: unknown = text && text.length <= 200_000 ? JSON.parse(text) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed as Record<string, StoredClaimCheck>;
  } catch { /* A corrupt derived cache is discarded. */ }
  cache.set(sessionId, value);
  return value;
}

export function getClaimCheck(sessionId: string | undefined, messageIds: readonly string[] | undefined): StoredClaimCheck | null {
  if (!sessionId || !messageIds?.length) return null;
  const entries = read(sessionId);
  for (const id of messageIds) if (entries[id]) return entries[id];
  return null;
}

export function saveClaimCheck(sessionId: string, messageId: string, result: ClaimCheckResult, now = Date.now()): void {
  const entries = { ...read(sessionId), [messageId]: {
    status: result.status, sources: result.sources,
    unsupported: result.claims.filter(claim => claim.verdict === "unsupported").map(claim => claim.quote),
    checkedAt: now,
  } satisfies StoredClaimCheck };
  const trimmed = Object.fromEntries(Object.entries(entries).sort(([, a], [, b]) => a.checkedAt - b.checkedAt).slice(-MAX_ENTRIES));
  cache.set(sessionId, trimmed);
  try { storage()?.setItem(key(sessionId), JSON.stringify(trimmed)); } catch { /* The open chat still shows the result. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLAIM_CHECKS_CHANGED));
}

export function subscribeClaimChecks(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => { if (event.key?.startsWith("keating:claim-checks:v1:")) { cache.clear(); listener(); } };
  window.addEventListener(CLAIM_CHECKS_CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(CLAIM_CHECKS_CHANGED, listener); window.removeEventListener("storage", onStorage); };
}

/** Test seam. */
export function clearClaimCheckCache(): void { cache.clear(); }
