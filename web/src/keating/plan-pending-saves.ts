import type { StorageLike } from "./event-store";

/**
 * Plan writes that the browser refused (quota, blocked site data). They stay in
 * memory, layered over localStorage, so the learner keeps seeing the change and
 * later revisions build on it, until a retry stores them or the learner
 * dismisses them. Nothing here is persisted: a reload drops unsaved changes,
 * which the workspace says while one is pending.
 */
export const PLAN_SAVE_STATUS_EVENT = "keating:plan-save-status";

export type PlanStorage = Pick<StorageLike, "getItem" | "setItem">;

export interface PendingPlanSave {
	documentId: string;
	/** Ordered key -> value writes; a newer failure for the same key replaces the older value. */
	writes: Record<string, string>;
	/** Runs once the writes land (announces the revision). */
	onSaved?: () => Promise<void> | void;
	error: string;
	failedAt: number;
	attempts: number;
}

const pending = new Map<string, PendingPlanSave>();

function announce(documentId: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new window.CustomEvent(PLAN_SAVE_STATUS_EVENT, { detail: { documentId } }));
}

function messageOf(cause: unknown): string {
	if (cause instanceof Error && cause.name === "QuotaExceededError") return "This browser is out of storage space for Keating.";
	if (cause instanceof Error && cause.message) return cause.message;
	return "This browser refused to save the change.";
}

/** Read through unsaved writes first, so pending changes stay visible. */
export function overlayPlanStorage<T extends Pick<StorageLike, "getItem"> & Partial<Pick<StorageLike, "setItem">>>(storage: T | null): (Pick<StorageLike, "getItem"> & Partial<Pick<StorageLike, "setItem">>) | null {
	if (!storage) return null;
	return {
		getItem: (key) => pendingValue(key) ?? storage.getItem(key),
		...(storage.setItem ? { setItem: (key: string, value: string) => storage.setItem!(key, value) } : {}),
	};
}

export function pendingValue(key: string): string | null {
	let value: string | null = null;
	for (const save of pending.values()) if (key in save.writes) value = save.writes[key]!;
	return value;
}

function attempt(storage: PlanStorage, writes: Record<string, string>): string | null {
	try {
		for (const [key, value] of Object.entries(writes)) storage.setItem(key, value);
		return null;
	} catch (cause) {
		return messageOf(cause);
	}
}

/**
 * Write all `writes` for one plan. On success runs `onSaved`; on failure keeps
 * them in memory (merged with any earlier unsaved writes for the plan) and
 * fires PLAN_SAVE_STATUS_EVENT. Returns whether the writes are stored.
 */
export async function savePlanWrites(storage: PlanStorage, documentId: string, writes: Record<string, string>, onSaved?: () => Promise<void> | void, now: () => number = Date.now): Promise<boolean> {
	const earlier = pending.get(documentId);
	const merged = { ...(earlier?.writes ?? {}), ...writes };
	const error = attempt(storage, merged);
	if (error) {
		// Re-insert so the newest failure wins overlay reads of shared keys.
		pending.delete(documentId);
		pending.set(documentId, { documentId, writes: merged, onSaved: chain(earlier?.onSaved, onSaved), error, failedAt: now(), attempts: (earlier?.attempts ?? 0) + 1 });
		announce(documentId);
		return false;
	}
	if (earlier) {
		pending.delete(documentId);
		announce(documentId);
	}
	await earlier?.onSaved?.();
	await onSaved?.();
	return true;
}

function chain(a?: () => Promise<void> | void, b?: () => Promise<void> | void): (() => Promise<void>) | undefined {
	if (!a && !b) return undefined;
	return async () => { await a?.(); await b?.(); };
}

export function getPendingPlanSave(documentId: string): PendingPlanSave | null {
	return pending.get(documentId) ?? null;
}

export function listPendingPlanSaves(): PendingPlanSave[] {
	return [...pending.values()];
}

/** Try the unsaved writes again. Returns true once they are stored. */
export async function retryPendingPlanSave(documentId: string, storage: PlanStorage | null, now: () => number = Date.now): Promise<boolean> {
	const save = pending.get(documentId);
	if (!save) return true;
	if (!storage) {
		pending.set(documentId, { ...save, error: "Site storage is unavailable in this browser.", failedAt: now(), attempts: save.attempts + 1 });
		announce(documentId);
		return false;
	}
	const error = attempt(storage, save.writes);
	if (error) {
		pending.set(documentId, { ...save, error, failedAt: now(), attempts: save.attempts + 1 });
		announce(documentId);
		return false;
	}
	pending.delete(documentId);
	announce(documentId);
	await save.onSaved?.();
	return true;
}

/** Drop the unsaved change; the plan returns to its last stored revision. */
export function dismissPendingPlanSave(documentId: string): void {
	if (!pending.delete(documentId)) return;
	announce(documentId);
}

/** Test-only reset. */
export function __resetPendingPlanSaves(): void {
	pending.clear();
}
