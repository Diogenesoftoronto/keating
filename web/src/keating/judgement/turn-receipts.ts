/**
 * Released draft snapshots by published message, for the "how this reply was
 * made" summary under each tutor reply. Live receipts land here the moment the
 * gate publishes; older ones are read once per session from storage.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { TeachingDraftSnapshot } from "@keating/learner-contracts";

type Loader = (sessionId: string) => Promise<readonly { messageTimestamp: number; snapshot: TeachingDraftSnapshot }[]>;

const receipts = new Map<string, Map<number, TeachingDraftSnapshot>>();
const loaded = new Set<string>();
const pending = new Map<string, object>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version += 1; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function publishSession(sessionId: string, session: Map<number, TeachingDraftSnapshot>): void {
  receipts.delete(sessionId);
  receipts.set(sessionId, session);
  while (receipts.size > 20) {
    const oldest = receipts.keys().next().value!;
    receipts.delete(oldest);
    loaded.delete(oldest);
  }
  emit();
}

export function rememberTurnReceipt(sessionId: string, messageTimestamp: number, snapshot: TeachingDraftSnapshot): void {
  const session = receipts.get(sessionId) ?? new Map<number, TeachingDraftSnapshot>();
  session.set(messageTimestamp, snapshot);
  publishSession(sessionId, session);
}

export function getTurnReceipt(sessionId: string | null | undefined, messageTimestamp: number | undefined): TeachingDraftSnapshot | null {
  if (!sessionId || messageTimestamp === undefined) return null;
  return receipts.get(sessionId)?.get(messageTimestamp) ?? null;
}

/** Load a session's stored receipts once; live ones already in memory win. */
export async function loadTurnReceipts(sessionId: string, load: Loader): Promise<void> {
  if (loaded.has(sessionId) || pending.has(sessionId)) return;
  const request = {};
  pending.set(sessionId, request);
  try {
    const records = await load(sessionId);
    if (pending.get(sessionId) !== request) return;
    const session = receipts.get(sessionId) ?? new Map<number, TeachingDraftSnapshot>();
    for (const record of records) if (!session.has(record.messageTimestamp)) session.set(record.messageTimestamp, record.snapshot);
    loaded.add(sessionId);
    publishSession(sessionId, session);
  } catch {
    // A later visit can retry a failed storage read.
  } finally {
    if (pending.get(sessionId) === request) pending.delete(sessionId);
  }
}

export function useTurnReceipt(sessionId: string | null | undefined, timestamps: readonly number[], load?: Loader): TeachingDraftSnapshot | null {
  useEffect(() => { if (sessionId && load) void loadTurnReceipts(sessionId, load); }, [sessionId, load]);
  useSyncExternalStore(subscribe, () => version, () => version);
  for (const timestamp of [...timestamps].reverse()) {
    const receipt = getTurnReceipt(sessionId, timestamp);
    if (receipt) return receipt;
  }
  return null;
}

/** Test seam. */
export function resetTurnReceipts(): void { receipts.clear(); loaded.clear(); pending.clear(); emit(); }
