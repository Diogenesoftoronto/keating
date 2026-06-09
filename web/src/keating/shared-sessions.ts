import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionData, SessionMetadata } from "../types/session";
import { createSessionId, sessionPreview, sessionTitle, sessionUsage } from "../hooks/session-metadata";
import { sessions } from "../hooks/keating-storage";
import { DEFAULT_MODEL } from "../hooks/keating-stream";
import { loadKeatingUiSettings, type ShareLinkMode } from "./ui-settings";

const SHARE_INDEX_KEY = "keating_shared_sessions";
const SHARE_KEY_PREFIX = "keating_shared_session:";
const SHARE_HASH_PARAM = "session";
const COMPRESSED_PREFIX = "gz.";
const JSON_PREFIX = "json.";

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

function bytesToBase64Url(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(base64);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
	const Compression = globalThis.CompressionStream;
	if (!Compression) return bytes;
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	const stream = new Blob([buffer]).stream().pipeThrough(new Compression("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
	const Decompression = globalThis.DecompressionStream;
	if (!Decompression) return bytes;
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	const stream = new Blob([buffer]).stream().pipeThrough(new Decompression("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeSharedSession(shared: SharedSession) {
	const bytes = new TextEncoder().encode(JSON.stringify(shared));
	try {
		const compressed = await gzipBytes(bytes);
		if (compressed.length < bytes.length) return `${COMPRESSED_PREFIX}${bytesToBase64Url(compressed)}`;
	} catch {
		// Fall through to uncompressed JSON encoding.
	}
	return `${JSON_PREFIX}${bytesToBase64Url(bytes)}`;
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

async function decodeSharedSession(value: string): Promise<SharedSession | null> {
	try {
		const isCompressed = value.startsWith(COMPRESSED_PREFIX);
		const isJson = value.startsWith(JSON_PREFIX);
		const encoded = isCompressed || isJson ? value.slice(value.indexOf(".") + 1) : value;
		const bytes = base64UrlToBytes(encoded);
		const decoded = isCompressed ? await gunzipBytes(bytes) : bytes;
		return normalizeSharedSession(JSON.parse(new TextDecoder().decode(decoded)) as SharedSession);
	} catch {
		return null;
	}
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
	const response = await fetch("/api/share", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(shared),
	});
	if (!response.ok) throw new Error(`Share storage returned ${response.status}`);
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
		url.hash = `${SHARE_HASH_PARAM}=${await encodeSharedSession(shared)}`;
		return { url: url.toString(), mode, fallback: false };
	}

	try {
		const published = await publishSharedSession(shared);
		cacheSharedSession(published);
		return { url: sharedSessionPath(published.id, origin), mode, fallback: false };
	} catch (error) {
		console.warn("Portable share storage failed; falling back to snapshot link:", error);
		const url = new URL(`/s/${encodeURIComponent(shared.id)}`, origin);
		url.hash = `${SHARE_HASH_PARAM}=${await encodeSharedSession(shared)}`;
		return { url: url.toString(), mode: "compressed-hash", fallback: true };
	}
}

async function fetchSharedSession(id: string): Promise<SharedSession | null> {
	try {
		const response = await fetch(`/api/share/${encodeURIComponent(id)}`);
		if (!response.ok) return null;
		const shared = normalizeSharedSession(await response.json() as SharedSession);
		if (!shared || shared.id !== id) return null;
		cacheSharedSession(shared);
		return shared;
	} catch {
		return null;
	}
}

export async function loadSharedSessionFromUrl(id: string, hash: string): Promise<SharedSession | null> {
	const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
	const encoded = params.get(SHARE_HASH_PARAM);
	if (!encoded) return loadSharedSession(id) ?? await fetchSharedSession(id);

	const shared = await decodeSharedSession(encoded);
	if (!shared || shared.id !== id) return loadSharedSession(id);
	cacheSharedSession(shared);
	return shared;
}

export async function forkSharedSession(shared: SharedSession): Promise<string> {
	const id = createSessionId();
	const now = new Date().toISOString();
	const title = `${shared.title} (fork)`;
	const messages = sanitizeMessagesForShare(shared.messages);

	const metadata: SessionMetadata = {
		id,
		title,
		createdAt: now,
		lastModified: now,
		messageCount: messages.length,
		usage: sessionUsage(messages),
		thinkingLevel: shared.thinkingLevel ?? "medium",
		preview: sessionPreview(messages),
	};
	const data: SessionData = {
		id,
		title,
		model: shared.model ? {
			...DEFAULT_MODEL,
			...shared.model,
			provider: shared.model.provider as any,
			api: (shared.model.api ?? DEFAULT_MODEL.api) as any,
		} : DEFAULT_MODEL,
		thinkingLevel: shared.thinkingLevel ?? "medium",
		messages,
		createdAt: now,
		lastModified: now,
	};

	await sessions.save(data, metadata);
	return id;
}
