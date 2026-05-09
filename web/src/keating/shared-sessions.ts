import {
	type AgentMessage,
	type SessionData,
	type SessionMetadata,
} from "@mariozechner/pi-web-ui";
import { createSessionId, sessionPreview, sessionTitle, sessionUsage } from "../hooks/session-metadata";
import { sessions } from "../hooks/keating-storage";
import { DEFAULT_MODEL } from "../hooks/keating-stream";

const SHARE_INDEX_KEY = "keating_shared_sessions";
const SHARE_KEY_PREFIX = "keating_shared_session:";

export interface SharedSession {
	id: string;
	title: string;
	createdAt: string;
	sharedAt: string;
	messageCount: number;
	messages: AgentMessage[];
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

function encodeSharedSession(shared: SharedSession) {
	return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(shared)));
}

function decodeSharedSession(value: string): SharedSession | null {
	try {
		const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as SharedSession;
		if (!parsed?.id || !Array.isArray(parsed.messages)) return null;
		return {
			...parsed,
			messages: sanitizeMessagesForShare(parsed.messages),
			messageCount: parsed.messages.length,
		};
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

export function saveSharedSession(messages: AgentMessage[], createdAt: string): SharedSession {
	const sanitizedMessages = sanitizeMessagesForShare(messages);
	if (sanitizedMessages.length === 0) {
		throw new Error("There is no shareable text in this session yet");
	}

	const id = createSessionId();
	const shared: SharedSession = {
		id,
		title: sessionTitle(sanitizedMessages),
		createdAt,
		sharedAt: new Date().toISOString(),
		messageCount: sanitizedMessages.length,
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
		if (!parsed || parsed.id !== id || !Array.isArray(parsed.messages)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function sharedSessionUrl(shared: SharedSession, origin: string) {
	const url = new URL(`/s/${encodeURIComponent(shared.id)}`, origin);
	url.hash = `session=${encodeSharedSession(shared)}`;
	return url.toString();
}

export function loadSharedSessionFromUrl(id: string, hash: string): SharedSession | null {
	const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
	const encoded = params.get("session");
	if (!encoded) return loadSharedSession(id);

	const shared = decodeSharedSession(encoded);
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
		thinkingLevel: "medium",
		preview: sessionPreview(messages),
	};
	const data: SessionData = {
		id,
		title,
		model: DEFAULT_MODEL,
		thinkingLevel: "medium",
		messages,
		createdAt: now,
		lastModified: now,
	};

	await sessions.save(data, metadata);
	return id;
}
