/**
 * Resumable state for interactive pages, kept in the host's localStorage (the
 * frame itself has an opaque origin and no storage). Keyed by page id, bounded
 * per page and in count, and honest about failure: a write that does not land
 * is returned to the caller so the UI can tell the learner.
 */

import { INTERACTIVE_PAGE_LIMITS, PAGE_ID_PATTERN, readBoundedJson, type JsonValue } from "./protocol";

const KEY_PREFIX = "keating.interactive-page.v1:";
const INDEX_KEY = "keating.interactive-page.v1.index";
export const INTERACTIVE_PAGE_MAX_STORED_PAGES = 200;

export type StateLoad =
	| { status: "restored"; state: JsonValue; savedAt: string }
	| { status: "empty" }
	| { status: "corrupt" }
	| { status: "unavailable" };

export type StateSave = { ok: true } | { ok: false; reason: "invalid-page" | "too-large" | "unavailable" | "write-failed" };

export interface InteractivePageStateStore {
	load(pageId: string): StateLoad;
	save(pageId: string, state: JsonValue): StateSave;
	clear(pageId: string): void;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function createInteractivePageStateStore(storage: StorageLike | null = browserStorage(), now: () => Date = () => new Date()): InteractivePageStateStore {
	const readIndex = (): string[] => {
		try {
			const parsed = JSON.parse(storage?.getItem(INDEX_KEY) ?? "[]");
			return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && PAGE_ID_PATTERN.test(id)) : [];
		} catch {
			return [];
		}
	};
	const touch = (pageId: string) => {
		if (!storage) return;
		const index = [...readIndex().filter((id) => id !== pageId), pageId];
		while (index.length > INTERACTIVE_PAGE_MAX_STORED_PAGES) {
			const evicted = index.shift()!;
			try { storage.removeItem(KEY_PREFIX + evicted); } catch { /* best effort */ }
		}
		try { storage.setItem(INDEX_KEY, JSON.stringify(index)); } catch { /* the page state itself already landed */ }
	};
	return {
		load(pageId) {
			if (!storage || !PAGE_ID_PATTERN.test(pageId)) return { status: "unavailable" };
			let raw: string | null;
			try {
				raw = storage.getItem(KEY_PREFIX + pageId);
			} catch {
				return { status: "unavailable" };
			}
			if (raw === null) return { status: "empty" };
			try {
				const envelope = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; state?: unknown };
				const json = envelope && envelope.v === 1 && typeof envelope.savedAt === "string" ? readBoundedJson(envelope.state, INTERACTIVE_PAGE_LIMITS.maxStateBytes) : null;
				if (json) return { status: "restored", state: json.value, savedAt: envelope.savedAt as string };
			} catch {
				// fall through: corrupt
			}
			try { storage.removeItem(KEY_PREFIX + pageId); } catch { /* best effort */ }
			return { status: "corrupt" };
		},
		save(pageId, state) {
			if (!PAGE_ID_PATTERN.test(pageId)) return { ok: false, reason: "invalid-page" };
			const json = readBoundedJson(state, INTERACTIVE_PAGE_LIMITS.maxStateBytes);
			if (!json) return { ok: false, reason: "too-large" };
			if (!storage) return { ok: false, reason: "unavailable" };
			try {
				storage.setItem(KEY_PREFIX + pageId, JSON.stringify({ v: 1, savedAt: now().toISOString(), state: json.value }));
			} catch {
				return { ok: false, reason: "write-failed" };
			}
			touch(pageId);
			return { ok: true };
		},
		clear(pageId) {
			if (!storage || !PAGE_ID_PATTERN.test(pageId)) return;
			try { storage.removeItem(KEY_PREFIX + pageId); } catch { /* best effort */ }
		},
	};
}
