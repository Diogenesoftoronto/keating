import { gzipSync, gunzipSync } from "fflate";
import type { SharedModelInfo, SharedSession } from "./shared-sessions";
import {
	projectSharedSessionPayload,
	SHARE_MAX_BYTES,
} from "./share-contract";

// Hash-embedded share links carry the whole session in the URL fragment. To keep
// those links short the payload is gzip-compressed and base64url-encoded. This
// module is intentionally dependency-light (only `fflate` plus type-only
// imports) so the encode/decode path is pure and unit-testable without pulling
// in the storage/runtime side of `shared-sessions.ts`.

export const COMPRESSED_PREFIX = "gz.";
export const JSON_PREFIX = "json.";

export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid base64url payload");
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(base64);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// Gzip via the bundled `fflate` codec rather than the optional `CompressionStream`
// Web API. `CompressionStream` is unavailable in several shipping browsers and
// webviews (older Safari/Firefox, some embedded/non-secure contexts), and the
// previous implementation silently returned the input uncompressed there — which
// is why share links were long and "not compressed at all". fflate is
// deterministic, synchronous, and produces/consumes standard gzip, so links
// compress the same way everywhere and stay backward-compatible with existing
// `gz.` gzip links created by `CompressionStream`.
function gzipBytes(bytes: Uint8Array): Uint8Array {
	return gzipSync(bytes, { level: 9 });
}

function gunzipBytes(bytes: Uint8Array, outputSize: number): Uint8Array {
	return gunzipSync(bytes, { out: new Uint8Array(outputSize) });
}

export function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

// Only the fields the shared view and fork flow actually need. Assistant
// messages otherwise carry large provider/model/usage/diagnostics metadata that
// never renders in a shared session, so we drop it before encoding to keep the
// pre-compression payload (and therefore the URL) as small as possible.
interface MinimalSharedMessage {
	role: string;
	content: [{ type: "text"; text: string }];
}

interface MinimalSharedSession {
	id: string;
	schemaVersion: 2 | 3;
	title: string;
	createdAt: string;
	sharedAt: string;
	messageCount: number;
	model?: SharedModelInfo;
	thinkingLevel?: SharedSession["thinkingLevel"];
	messages: MinimalSharedMessage[];
	trajectory?: SharedSession["trajectory"];
}

export function minifySharedSession(shared: SharedSession): MinimalSharedSession {
	const projected = projectSharedSessionPayload(shared);
	if (!projected || typeof projected.id !== "string") throw new Error("Shared session cannot be projected onto the public wire contract.");
	return projected as unknown as MinimalSharedSession;
}

export function encodeSharedSession(shared: SharedSession): string {
	const bytes = new TextEncoder().encode(JSON.stringify(minifySharedSession(shared)));
	if (bytes.length > SHARE_MAX_BYTES) throw new Error("Shared session is too large");
	try {
		const compressed = gzipBytes(bytes);
		if (compressed.length < bytes.length) return `${COMPRESSED_PREFIX}${bytesToBase64Url(compressed)}`;
	} catch {
		// Fall through to uncompressed JSON encoding (e.g. unexpected codec failure).
	}
	return `${JSON_PREFIX}${bytesToBase64Url(bytes)}`;
}

// Returns the parsed (but not normalized) shared-session payload, or null if the
// value cannot be decoded. Supports `gz.` (gzip), `json.` (uncompressed), and
// bare/legacy base64url payloads.
export function decodeSharedSessionPayload(value: string): Partial<SharedSession> | null {
	try {
		if (value.length > Math.ceil(SHARE_MAX_BYTES * 4 / 3) + 16) return null;
		const isCompressed = value.startsWith(COMPRESSED_PREFIX);
		const isJson = value.startsWith(JSON_PREFIX);
		const encoded = isCompressed || isJson ? value.slice(value.indexOf(".") + 1) : value;
		const bytes = base64UrlToBytes(encoded);
		if (bytes.length > SHARE_MAX_BYTES || (isCompressed && bytes.length < 4)) return null;
		const outputSize = isCompressed
			? (bytes[bytes.length - 4] | bytes[bytes.length - 3] << 8 | bytes[bytes.length - 2] << 16 | bytes[bytes.length - 1] << 24) >>> 0
			: bytes.length;
		if (outputSize > SHARE_MAX_BYTES) return null;
		const decoded = isCompressed ? gunzipBytes(bytes, outputSize) : bytes;
		if (decoded.length > SHARE_MAX_BYTES) return null;
		const parsed = JSON.parse(new TextDecoder().decode(decoded));
		return projectSharedSessionPayload(parsed) as Partial<SharedSession> | null;
	} catch {
		return null;
	}
}
