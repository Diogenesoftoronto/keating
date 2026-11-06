import type { KeatingPortableSession } from "./types.js";
import { sessionSearchText } from "./search-text.js";

export interface ChatSyncEntry {
	id: string;
	version: number;
	writer: string;
	/** Deletions remain in the account history so an offline device cannot resurrect them. */
	session: KeatingPortableSession | null;
}

export interface ChatSyncState {
	schemaVersion: 1;
	kind: "keating-chat-sync";
	entries: ChatSyncEntry[];
}

const MAX_ENTRIES = 20_000;
const MAX_ID_LENGTH = 2_048;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f]/u.test(value);
}

function validWriter(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

/** Stable across property order and JSON round trips; undefined fields are omitted. */
export function chatSyncCanonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(item => chatSyncCanonical(item ?? null)).join(",")}]`;
	if (record(value)) return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
		.map(key => `${JSON.stringify(key)}:${chatSyncCanonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value) ?? "null";
}

function validDate(value: unknown): boolean {
	return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

/** Model connection credentials are device settings, never conversation data. */
function sanitizeSession(value: KeatingPortableSession): KeatingPortableSession {
	const session = structuredClone(value);
	// This is a derived local index, not separately authored content. Normalize
	// it so rebuilding it after incremental download cannot create sync churn.
	if (typeof session.metadata.searchText === "string") session.metadata.searchText = sessionSearchText(session.data.messages);
	const source = session.data.model as unknown as Record<string, unknown>;
	const model: Record<string, unknown> = {};
	for (const key of ["id", "name", "api", "provider", "reasoning", "input", "cost", "contextWindow", "maxTokens", "compat"]) {
		if (source[key] !== undefined) model[key] = source[key];
	}
	if (typeof source.baseUrl === "string") {
		try {
			const url = new URL(source.baseUrl);
			url.username = "";
			url.password = "";
			url.search = "";
			url.hash = "";
			model.baseUrl = url.toString();
		} catch { /* An invalid connection address is not needed to preserve the transcript. */ }
	}
	session.data.model = model as unknown as KeatingPortableSession["data"]["model"];
	return session;
}

function parseSession(value: unknown, id: string): KeatingPortableSession {
	if (!record(value) || !record(value.data) || !record(value.metadata)) throw new Error("Invalid synced conversation.");
	const { data, metadata } = value;
	if (data.id !== id || metadata.id !== id || typeof data.title !== "string" || data.title.length > 16_384
		|| typeof metadata.title !== "string" || !validDate(data.createdAt) || !validDate(data.lastModified)
		|| !validDate(metadata.createdAt) || !validDate(metadata.lastModified)
		|| !Array.isArray(data.messages) || data.messages.length > 100_000
		|| !data.messages.every(message => record(message) && typeof message.role === "string")
		|| !record(data.model) || typeof data.model.id !== "string" || typeof data.model.provider !== "string"
		|| typeof data.thinkingLevel !== "string" || typeof metadata.thinkingLevel !== "string"
		|| !Number.isSafeInteger(metadata.messageCount) || (metadata.messageCount as number) < 0
		|| typeof metadata.preview !== "string" || !record(metadata.usage) || !record(metadata.usage.cost)) {
		throw new Error("Invalid synced conversation.");
	}
	if (data.nativeSession !== undefined && (!record(data.nativeSession) || !record(data.nativeSession.header)
		|| !Array.isArray(data.nativeSession.entries) || data.nativeSession.entries.length > 100_000
		|| !(data.nativeSession.leafId === null || validId(data.nativeSession.leafId)))) {
		throw new Error("Invalid synced native conversation tree.");
	}
	return sanitizeSession(value as unknown as KeatingPortableSession);
}

export function emptyChatSyncState(): ChatSyncState {
	return { schemaVersion: 1, kind: "keating-chat-sync", entries: [] };
}

export function parseChatSyncState(value: unknown): ChatSyncState {
	if (!record(value) || value.schemaVersion !== 1 || value.kind !== "keating-chat-sync"
		|| !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) throw new Error("Invalid chat sync state.");
	const ids = new Set<string>();
	const entries = value.entries.map((entry): ChatSyncEntry => {
		if (!record(entry) || !validId(entry.id) || ids.has(entry.id) || !validWriter(entry.writer)
			|| !Number.isSafeInteger(entry.version) || (entry.version as number) < 1) throw new Error("Invalid chat sync entry.");
		ids.add(entry.id);
		return { id: entry.id, version: entry.version as number, writer: entry.writer,
			session: entry.session === null ? null : parseSession(entry.session, entry.id) };
	});
	return { schemaVersion: 1, kind: "keating-chat-sync", entries: entries.sort((a, b) => compareText(a.id, b.id)) };
}

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function compareEntries(a: ChatSyncEntry, b: ChatSyncEntry): number {
	return a.version - b.version || compareText(a.writer, b.writer) || compareText(chatSyncCanonical(a.session), chatSyncCanonical(b.session));
}

function isPrefix(a: KeatingPortableSession, b: KeatingPortableSession): boolean {
	if (a.data.nativeSession) {
		if (!b.data.nativeSession) return false;
		const entries = new Set(b.data.nativeSession.entries.map(chatSyncCanonical));
		if (!a.data.nativeSession.entries.every(entry => entries.has(chatSyncCanonical(entry)))) return false;
	}
	return a.data.messages.length <= b.data.messages.length
		&& a.data.messages.every((message, index) => chatSyncCanonical(message) === chatSyncCanonical(b.data.messages[index]));
}

function conflictFork(loser: ChatSyncEntry): ChatSyncEntry {
	const session = structuredClone(loser.session!);
	const id = `${loser.id}~sync-${loser.writer}-${loser.version}`;
	if (!validId(id)) throw new Error("The conversation conflict history is too deeply nested to sync.");
	const title = `${session.data.title} (from another device)`;
	const shared = { id, title, parentSessionId: loser.id, forkedAt: session.data.lastModified,
		aiGeneratedTitle: false, generatedAlternative: false, hiddenAlternative: false };
	session.data = { ...session.data, ...shared };
	session.metadata = { ...session.metadata, ...shared };
	return { ...loser, id, session };
}

/** Set reconciliation: a new/empty device cannot replace another device's library. */
export function mergeChatSyncStates(left: ChatSyncState, right: ChatSyncState): ChatSyncState {
	const entries = new Map(parseChatSyncState(left).entries.map(entry => [entry.id, entry]));
	const forks: ChatSyncEntry[] = [];
	for (const incoming of parseChatSyncState(right).entries) {
		const current = entries.get(incoming.id);
		if (!current) { entries.set(incoming.id, incoming); continue; }
		const [winner, loser] = compareEntries(current, incoming) >= 0 ? [current, incoming] : [incoming, current];
		entries.set(winner.id, winner);
		// A continuation includes all earlier turns. Divergent transcripts from
		// different writers remain accessible as a fork, never silently discarded.
		if (winner.session && loser.session && winner.writer !== loser.writer
			&& !isPrefix(loser.session, winner.session)) forks.push(conflictFork(loser));
	}
	for (const fork of forks) {
		const existing = entries.get(fork.id);
		if (!existing || compareEntries(existing, fork) < 0) entries.set(fork.id, fork);
	}
	return parseChatSyncState({ schemaVersion: 1, kind: "keating-chat-sync", entries: [...entries.values()] });
}

/**
 * Compare against what this device last materialized, before merging remote
 * state. Missing remote-only IDs are not deletions. Persist the next baseline
 * only after local application succeeds.
 */
export function updateChatSyncState(
	state: ChatSyncState,
	currentSessions: KeatingPortableSession[],
	writer: string,
	baselineSessions: KeatingPortableSession[],
): ChatSyncState {
	if (!validWriter(writer)) throw new Error("Invalid chat sync writer.");
	const entries = new Map(parseChatSyncState(state).entries.map(entry => [entry.id, entry]));
	const baseline = new Map(baselineSessions.map(session => [session.data.id, parseSession(session, session.data.id)]));
	const current = new Map(currentSessions.map(session => [session.data.id, parseSession(session, session.data.id)]));
	let version = Math.max(0, ...[...entries.values()].map(entry => entry.version));
	const set = (id: string, session: KeatingPortableSession | null) => {
		version += 1;
		if (!Number.isSafeInteger(version)) throw new Error("Chat sync version limit reached.");
		entries.set(id, { id, session, version, writer });
	};
	for (const [id, session] of [...current].sort(([a], [b]) => compareText(a, b))) {
		if (chatSyncCanonical(session) === chatSyncCanonical(baseline.get(id))) continue;
		if (chatSyncCanonical(session) === chatSyncCanonical(entries.get(id)?.session)) continue;
		set(id, session);
	}
	for (const id of [...baseline.keys()].sort(compareText)) {
		if (!current.has(id) && entries.get(id)?.session !== null) set(id, null);
	}
	return parseChatSyncState({ schemaVersion: 1, kind: "keating-chat-sync", entries: [...entries.values()] });
}

export function chatSyncStateEqual(left: ChatSyncState, right: ChatSyncState): boolean {
	return chatSyncCanonical(left) === chatSyncCanonical(right);
}
