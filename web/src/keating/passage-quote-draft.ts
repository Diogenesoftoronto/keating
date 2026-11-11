/**
 * Quotes waiting in a chat composer, per session. Kept in sessionStorage so a
 * model switch, an auth prompt or a remount of the chat does not drop them;
 * cleared only once a turn carrying them has been admitted.
 */
import { useSyncExternalStore } from "react";
import { MAX_QUOTES_PER_TURN, createPassageQuote, type PassageQuote } from "./passage-quote";

const STORAGE_PREFIX = "keating:quote-draft:";
const DEFAULT_SCOPE = "default";

export interface DraftQuote extends PassageQuote {
	/** Local identity for list keys and removal. */
	draftId: string;
	truncated?: boolean;
}

const memory = new Map<string, DraftQuote[]>();
const listeners = new Set<() => void>();
const EMPTY: DraftQuote[] = [];

function scopeKey(sessionId?: string): string {
	return sessionId || DEFAULT_SCOPE;
}

function readStorage(scope: string): DraftQuote[] {
	try {
		const raw = globalThis.sessionStorage?.getItem(STORAGE_PREFIX + scope);
		if (!raw) return EMPTY;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return EMPTY;
		return parsed.slice(0, MAX_QUOTES_PER_TURN).flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const value = item as Partial<DraftQuote>;
			const created = createPassageQuote({
				source: (value.source ?? {}) as PassageQuote["source"],
				exact: typeof value.exact === "string" ? value.exact : "",
				prefix: typeof value.prefix === "string" ? value.prefix : undefined,
				suffix: typeof value.suffix === "string" ? value.suffix : undefined,
			});
			if (!created || typeof value.draftId !== "string") return [];
			return [{ ...created.quote, draftId: value.draftId, truncated: value.truncated === true || created.truncated }];
		});
	} catch {
		return EMPTY;
	}
}

function write(scope: string, quotes: DraftQuote[]): void {
	memory.set(scope, quotes);
	try {
		if (quotes.length) globalThis.sessionStorage?.setItem(STORAGE_PREFIX + scope, JSON.stringify(quotes));
		else globalThis.sessionStorage?.removeItem(STORAGE_PREFIX + scope);
	} catch {
		// Storage can be full or blocked; the in-memory draft still works.
	}
	for (const listener of listeners) listener();
}

export function getDraftQuotes(sessionId?: string): DraftQuote[] {
	const scope = scopeKey(sessionId);
	let quotes = memory.get(scope);
	if (!quotes) {
		quotes = readStorage(scope);
		memory.set(scope, quotes);
	}
	return quotes;
}

export type AddDraftQuoteResult = "added" | "duplicate" | "full";

export function addDraftQuote(sessionId: string | undefined, quote: PassageQuote, truncated = false): AddDraftQuoteResult {
	const scope = scopeKey(sessionId);
	const current = getDraftQuotes(sessionId);
	if (current.some((item) => item.source.kind === quote.source.kind && item.source.id === quote.source.id && item.exact === quote.exact)) return "duplicate";
	if (current.length >= MAX_QUOTES_PER_TURN) return "full";
	const draftId = globalThis.crypto?.randomUUID?.() ?? `quote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	write(scope, [...current, { ...quote, draftId, ...(truncated ? { truncated: true } : {}) }]);
	return "added";
}

export function removeDraftQuote(sessionId: string | undefined, draftId: string): void {
	const current = getDraftQuotes(sessionId);
	const next = current.filter((item) => item.draftId !== draftId);
	if (next.length !== current.length) write(scopeKey(sessionId), next);
}

export function clearDraftQuotes(sessionId?: string): void {
	if (getDraftQuotes(sessionId).length) write(scopeKey(sessionId), EMPTY);
}

export function subscribeDraftQuotes(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useDraftQuotes(sessionId?: string): DraftQuote[] {
	return useSyncExternalStore(
		subscribeDraftQuotes,
		() => getDraftQuotes(sessionId),
		() => EMPTY,
	);
}

/** Test seam: forget in-memory drafts so a "reload" re-reads storage. */
export function resetDraftQuoteMemory(): void {
	memory.clear();
}
