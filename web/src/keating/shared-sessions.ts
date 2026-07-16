import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionData, SessionMetadata } from "../types/session";
import { createSessionId, sessionModelMetadata, sessionPreview, sessionSearchText, sessionTitle, sessionUsage } from "../hooks/session-metadata";
import { sessions } from "../hooks/keating-storage";
import { DEFAULT_MODEL } from "../hooks/keating-stream";
import { loadKeatingUiSettings, shareModeExposesDataPublicly, type ShareLinkMode } from "./ui-settings";
import { decodeSharedSessionPayload, encodeSharedSession } from "./share-codec";

const SHARE_INDEX_KEY = "keating_shared_sessions";
const SHARE_KEY_PREFIX = "keating_shared_session:";
const SHARE_HASH_PARAM = "session";

export interface SharedModelInfo {
	provider: string;
	id: string;
	name?: string;
	api?: string;
	baseUrl?: string;
}

export interface SharedSession {
	id: string;
	schemaVersion?: 2;
	title: string;
	createdAt: string;
	sharedAt: string;
	messageCount: number;
	model?: SharedModelInfo;
	thinkingLevel?: SessionMetadata["thinkingLevel"];
	messages: AgentMessage[];
}

export interface SaveSharedSessionOptions {
	model?: Model<any>;
	thinkingLevel?: SessionMetadata["thinkingLevel"];
}

export interface SharedSessionUrlResult {
	url: string;
	mode: ShareLinkMode;
	fallback: boolean;
}

export type SharedSessionLoadResult =
	| { ok: true; session: SharedSession; source: "hash" | "cache" | "server" }
	| { ok: false; reason: "not-found" | "invalid-link" | "mismatch" | "server-error" | "network"; message: string; status?: number };

// Whether the caller should warn the user that a share exposes the transcript
// publicly before creating the link. Returns false once the user has
// acknowledged the warning (so it is a one-time prompt, not a nag) and for
// modes that keep the data on-device (`local-short`).
export function shouldWarnBeforePublicShare(
	mode: ShareLinkMode = loadKeatingUiSettings().shareLinkMode,
	acknowledged: boolean = loadKeatingUiSettings().shareWarningAcknowledged,
): boolean {
	return shareModeExposesDataPublicly(mode) && !acknowledged;
}

function serializeModel(model: Model<any> | undefined): SharedModelInfo {
	const fallback = model ?? DEFAULT_MODEL;
	const api = "api" in fallback && typeof fallback.api === "string" ? fallback.api : undefined;
	const baseUrl = "baseUrl" in fallback && typeof fallback.baseUrl === "string" ? fallback.baseUrl : undefined;
	return {
		provider: fallback.provider,
		id: fallback.id,
		name: fallback.name,
		api,
		baseUrl,
	};
}

function normalizeSharedSession(parsed: Partial<SharedSession> | null): SharedSession | null {
	if (!parsed?.id || !Array.isArray(parsed.messages)) return null;
	const messages = sanitizeMessagesForShare(parsed.messages);
	return {
		...parsed,
		schemaVersion: 2,
		title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : sessionTitle(messages),
		createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
		sharedAt: typeof parsed.sharedAt === "string" ? parsed.sharedAt : new Date().toISOString(),
		messageCount: messages.length,
		model: parsed.model?.provider && parsed.model?.id ? parsed.model : undefined,
		thinkingLevel: parsed.thinkingLevel ?? "medium",
		messages,
	} as SharedSession;
}

function decodeSharedSession(value: string): SharedSession | null {
	return normalizeSharedSession(decodeSharedSessionPayload(value));
}

function isShareableRole(role: unknown) {
	return role === "user" || role === "user-with-attachments" || role === "assistant";
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

export function sanitizeMessagesForShare(messages: AgentMessage[]): AgentMessage[] {
	return messages.flatMap((message) => {
		const role = (message as any).role;
		if (!isShareableRole(role)) return [];

		const text = textFromContent((message as any).content).trim();
		if (!text) return [];

		return [{
			...message,
			role,
			content: [{ type: "text", text }],
		} as AgentMessage];
	});
}

function readShareIndex(): string[] {
	try {
		const raw = localStorage.getItem(SHARE_INDEX_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function writeShareIndex(ids: string[]) {
	localStorage.setItem(SHARE_INDEX_KEY, JSON.stringify(Array.from(new Set(ids))));
}

export function saveSharedSession(messages: AgentMessage[], createdAt: string, options: SaveSharedSessionOptions = {}): SharedSession {
	const sanitizedMessages = sanitizeMessagesForShare(messages);
	if (sanitizedMessages.length === 0) {
		throw new Error("There is no shareable text in this session yet");
	}

	const id = createSessionId();
	const shared: SharedSession = {
		id,
		schemaVersion: 2,
		title: sessionTitle(sanitizedMessages),
		createdAt,
		sharedAt: new Date().toISOString(),
		messageCount: sanitizedMessages.length,
		model: serializeModel(options.model),
		thinkingLevel: options.thinkingLevel ?? "medium",
		messages: sanitizedMessages,
	};

	cacheSharedSession(shared);
	return shared;
}

function cacheSharedSession(shared: SharedSession) {
	localStorage.setItem(`${SHARE_KEY_PREFIX}${shared.id}`, JSON.stringify(shared));
	writeShareIndex([shared.id, ...readShareIndex()]);
}

export function loadSharedSession(id: string): SharedSession | null {
	const raw = localStorage.getItem(`${SHARE_KEY_PREFIX}${id}`);
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as SharedSession;
		if (parsed?.id !== id) return null;
		return normalizeSharedSession(parsed);
	} catch {
		return null;
	}
}

export function listCachedSharedSessions(): SharedSession[] {
	return readShareIndex()
		.map((id) => loadSharedSession(id))
		.filter((session): session is SharedSession => Boolean(session));
}

function sharedSessionPath(id: string, origin: string) {
	const url = new URL(`/s/${encodeURIComponent(id)}`, origin);
	return url.toString();
}

async function publishSharedSession(shared: SharedSession): Promise<SharedSession> {
	// The server assigns its own compact share id and validates any client id
	// against /^[A-Za-z0-9_-]{8,32}$/. `shared.id` is a 36-char UUID from
	// createSessionId(), which fails that check and 400s. Drop it before upload
	// and let the server mint the id it returns.
	const { id: _localId, ...payload } = shared;
	const response = await fetch("/api/share", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`Share storage returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
	}
	const result = await response.json() as { id?: unknown };
	if (typeof result.id !== "string" || !result.id) throw new Error("Share storage did not return an id");
	return { ...shared, id: result.id };
}

export async function sharedSessionUrl(
	shared: SharedSession,
	origin: string,
	mode: ShareLinkMode = loadKeatingUiSettings().shareLinkMode,
): Promise<SharedSessionUrlResult> {
	if (mode === "local-short") {
		cacheSharedSession(shared);
		return { url: sharedSessionPath(shared.id, origin), mode, fallback: false };
	}

	if (mode === "compressed-hash") {
		const url = new URL(`/s/${encodeURIComponent(shared.id)}`, origin);
		url.hash = `${SHARE_HASH_PARAM}=${encodeSharedSession(shared)}`;
		return { url: url.toString(), mode, fallback: false };
	}

	try {
		const published = await publishSharedSession(shared);
		cacheSharedSession(published);
		return { url: sharedSessionPath(published.id, origin), mode, fallback: false };
	} catch (error) {
		console.warn("Portable share storage failed:", error);
		throw new Error("Could not save the session to the share server. Try again, or switch Settings → Share Links to Compressed snapshot if you explicitly want a long self-contained link.");
	}
}

async function fetchSharedSessionResult(id: string): Promise<SharedSessionLoadResult> {
	try {
		const response = await fetch(`/api/share/${encodeURIComponent(id)}`);
		if (response.status === 404) {
			return { ok: false, reason: "not-found", status: response.status, message: "Shared session was not found on the share server." };
		}
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			return {
				ok: false,
				reason: "server-error",
				status: response.status,
				message: `Share server returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`,
			};
		}
		const shared = normalizeSharedSession(await response.json() as SharedSession);
		if (!shared) {
			return { ok: false, reason: "invalid-link", message: "Share server returned an invalid shared session payload." };
		}
		if (shared.id !== id) {
			return { ok: false, reason: "mismatch", message: "Share server returned a different session id than the link requested." };
		}
		cacheSharedSession(shared);
		return { ok: true, session: shared, source: "server" };
	} catch (error) {
		return {
			ok: false,
			reason: "network",
			message: error instanceof Error ? error.message : "Could not reach the share server.",
		};
	}
}

export async function loadSharedSessionResultFromUrl(id: string, hash: string): Promise<SharedSessionLoadResult> {
	const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
	const encoded = params.get(SHARE_HASH_PARAM);
	if (!encoded) {
		const cached = loadSharedSession(id);
		if (cached) return { ok: true, session: cached, source: "cache" };
		return await fetchSharedSessionResult(id);
	}

	const shared = decodeSharedSession(encoded);
	if (!shared) {
		const cached = loadSharedSession(id);
		if (cached) return { ok: true, session: cached, source: "cache" };
		return { ok: false, reason: "invalid-link", message: "This share link contains an unreadable session snapshot." };
	}
	if (shared.id !== id) {
		const cached = loadSharedSession(id);
		if (cached) return { ok: true, session: cached, source: "cache" };
		return { ok: false, reason: "mismatch", message: "This share link snapshot does not match the session id in the URL." };
	}
	cacheSharedSession(shared);
	return { ok: true, session: shared, source: "hash" };
}

export async function loadSharedSessionFromUrl(id: string, hash: string): Promise<SharedSession | null> {
	const result = await loadSharedSessionResultFromUrl(id, hash);
	return result.ok ? result.session : null;
}

export async function forkSharedSession(shared: SharedSession): Promise<string> {
	const id = createSessionId();
	const now = new Date().toISOString();
	const title = `${shared.title} (fork)`;
	const messages = sanitizeMessagesForShare(shared.messages);
	const model = shared.model ? {
		...DEFAULT_MODEL,
		...shared.model,
		provider: shared.model.provider as any,
		api: (shared.model.api ?? DEFAULT_MODEL.api) as any,
	} : DEFAULT_MODEL;

	const metadata: SessionMetadata = {
		id,
		title,
		createdAt: now,
		lastModified: now,
		messageCount: messages.length,
		usage: sessionUsage(messages),
		thinkingLevel: shared.thinkingLevel ?? "medium",
		...sessionModelMetadata(model),
		preview: sessionPreview(messages),
		searchText: sessionSearchText(messages),
	};
	const data: SessionData = {
		id,
		title,
		model,
		thinkingLevel: shared.thinkingLevel ?? "medium",
		messages,
		createdAt: now,
		lastModified: now,
	};

	await sessions.save(data, metadata);
	return id;
}
