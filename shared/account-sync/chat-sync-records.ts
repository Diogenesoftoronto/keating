import { webSyncCrypto, type SyncCrypto } from "./crypto.js";
export interface SyncRequester { request(path: string, init?: RequestInit): Promise<Response> }
import { sessionSearchText } from "./search-text.js";
import type { AccountSyncKey, AccountSyncKeyStore } from "./device-identity.js";
import { chatSyncCanonical, parseChatSyncState, type ChatSyncEntry } from "./chat-sync-state.js";

export const CHAT_SYNC_RECORD_PLAINTEXT_LIMIT = 32 * 1024;
// Leave room for the base64 and JSON wrapper when compression does not help.
export const CHAT_SYNC_MESSAGE_CHUNK_BYTES = 24 * 1024 - 128;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_CONVERSATION_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const RECORD_ID = /^[bc]-[a-f0-9]{64}$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface ChatSyncEncryptedPayload { key_id: string; iv: string; ciphertext: string }
export interface ChatSyncEncryptedRecord { id: string; encrypted: ChatSyncEncryptedPayload | null }
export interface ChatSyncRemoteRecord extends ChatSyncEncryptedRecord {
	revision: number;
	sequence: number;
	mutation_id: string;
}
export interface ChatSyncRecordPage { records: ChatSyncRemoteRecord[]; cursor: string; has_more: boolean }
interface MessageReference { parts: string[]; sha256: string }
type RecordLookup = (id: string) => ChatSyncEncryptedRecord | null | Promise<ChatSyncEncryptedRecord | null>;

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function buffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function unbase64url(value: unknown, maximum: number): Uint8Array {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length > Math.ceil(maximum * 4 / 3)) throw new Error("Invalid encrypted chat record encoding.");
	let decoded: string;
	try { decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)); }
	catch { throw new Error("Invalid encrypted chat record encoding."); }
	if (decoded.length > maximum) throw new Error("Encrypted chat record exceeds its byte limit.");
	return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
async function sha256(bytes: Uint8Array, crypto: SyncCrypto): Promise<string> {
	return Array.from(await crypto.sha256(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function requireIndexingKey(key: AccountSyncKey): unknown {
	if (!key.indexingKey) throw new Error("Reconnect Not Organic to unlock private chat content indexing.");
	return key.indexingKey;
}
async function blobId(bytes: Uint8Array, key: AccountSyncKey, crypto: SyncCrypto): Promise<string> {
	const mac = await crypto.hmac(requireIndexingKey(key), bytes);
	return `b-${Array.from(mac, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
function aad(namespace: string, id: string, keyId: string): Uint8Array {
	if (!/^account-[a-f0-9]{64}$/u.test(namespace) || !RECORD_ID.test(id) || !/^[a-f0-9]{32}$/u.test(keyId)) throw new Error("Invalid chat sync record identity.");
	return encoder.encode(`keating-chat-record-v1:${namespace}:${id}:${keyId}`);
}
function jsonBytes(value: unknown): Uint8Array { return encoder.encode(chatSyncCanonical(value)); }
function parseJson(bytes: Uint8Array): unknown {
	try { return JSON.parse(decoder.decode(bytes)); } catch { throw new Error("Invalid decrypted chat record."); }
}
function parseEntry(entry: unknown): ChatSyncEntry {
	return parseChatSyncState({ schemaVersion: 1, kind: "keating-chat-sync", entries: [entry] }).entries[0]!;
}
function parseEncrypted(value: unknown): ChatSyncEncryptedPayload | null {
	if (value === null) return null;
	if (!object(value) || typeof value.key_id !== "string" || !/^[a-f0-9]{32}$/u.test(value.key_id)
		|| unbase64url(value.iv, 12).byteLength !== 12
		|| unbase64url(value.ciphertext, CHAT_SYNC_RECORD_PLAINTEXT_LIMIT + 16).byteLength < 16) throw new Error("Invalid encrypted chat record.");
	return { key_id: value.key_id, iv: value.iv as string, ciphertext: value.ciphertext as string };
}
async function encryptRecord(id: string, value: unknown, key: AccountSyncKey, namespace: string, crypto: SyncCrypto): Promise<ChatSyncEncryptedRecord> {
	const bytes = jsonBytes(value);
	if (bytes.byteLength > CHAT_SYNC_RECORD_PLAINTEXT_LIMIT) throw new Error("Chat sync record exceeds its byte limit.");
	const iv = crypto.randomBytes(12);
	const ciphertext = await crypto.encrypt(key.key, iv, aad(namespace, id, key.keyId), bytes);
	return { id, encrypted: { key_id: key.keyId, iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)) } };
}
async function decryptRecord(record: ChatSyncEncryptedRecord, keys: Pick<AccountSyncKeyStore, "get">, namespace: string, crypto: SyncCrypto): Promise<unknown> {
	const encrypted = parseEncrypted(record.encrypted);
	if (!encrypted) throw new Error("A required encrypted chat record was deleted.");
	const key = await keys.get(encrypted.key_id);
	if (!key || key.keyId !== encrypted.key_id) throw new Error("This device cannot unlock a synced conversation key.");
	let bytes: Uint8Array;
	try {
		bytes = await crypto.decrypt(key.key, unbase64url(encrypted.iv, 12), aad(namespace, record.id, encrypted.key_id), unbase64url(encrypted.ciphertext, CHAT_SYNC_RECORD_PLAINTEXT_LIMIT + 16));
	} catch { throw new Error("The encrypted chat record could not be authenticated."); }
	if (bytes.byteLength > CHAT_SYNC_RECORD_PLAINTEXT_LIMIT) throw new Error("Decrypted chat record exceeds its byte limit.");
	return parseJson(new Uint8Array(bytes));
}
async function compressed(bytes: Uint8Array, crypto: SyncCrypto): Promise<{ encoding: "identity" | "gzip"; bytes: Uint8Array }> {
	if (crypto.gzip) {
		const packed = await crypto.gzip(bytes);
		if (packed.byteLength < bytes.byteLength) return { encoding: "gzip", bytes: packed };
		return { encoding: "identity", bytes };
	}
	if (typeof CompressionStream !== "undefined") {
		const packed = new Uint8Array(await new Response(new Blob([buffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
		if (packed.byteLength < bytes.byteLength) return { encoding: "gzip", bytes: packed };
	}
	return { encoding: "identity", bytes };
}
async function unpack(bytes: Uint8Array, encoding: unknown, crypto: SyncCrypto): Promise<Uint8Array> {
	if (encoding === "identity") return bytes;
	if (encoding === "gzip" && crypto.gunzip) {
		const unpacked = await crypto.gunzip(bytes, CHAT_SYNC_MESSAGE_CHUNK_BYTES);
		if (unpacked.byteLength > CHAT_SYNC_MESSAGE_CHUNK_BYTES) throw new Error("Decompressed chat chunk exceeds its byte limit.");
		return unpacked;
	}
	if (encoding !== "gzip" || typeof DecompressionStream === "undefined") throw new Error("This device cannot decode the synced chat compression format.");
	const reader = new Blob([buffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > CHAT_SYNC_MESSAGE_CHUNK_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw new Error("Decompressed chat chunk exceeds its byte limit.");
			}
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}

/** Immutable per-message chunks are reused across appends, edits and forked chats. */
export async function encodeChatSyncEntry(entry: ChatSyncEntry, key: AccountSyncKey, namespace: string, crypto: SyncCrypto = webSyncCrypto): Promise<{ manifestId: string; records: ChatSyncEncryptedRecord[] }> {
	requireIndexingKey(key);
	const clean = parseEntry(entry);
	const records = new Map<string, ChatSyncEncryptedRecord>();
	let totalBytes = 0;
	const encodeBytes = async (bytes: Uint8Array, limit: number): Promise<MessageReference> => {
		totalBytes += bytes.byteLength;
		if (bytes.byteLength > limit || totalBytes > MAX_CONVERSATION_BYTES) throw new Error("This conversation exceeds the chat sync byte limit.");
		const parts: string[] = [];
		for (let offset = 0; offset < bytes.byteLength; offset += CHAT_SYNC_MESSAGE_CHUNK_BYTES) {
			const chunk = bytes.slice(offset, offset + CHAT_SYNC_MESSAGE_CHUNK_BYTES);
			const id = await blobId(chunk, key, crypto);
			parts.push(id);
			if (records.has(id)) continue;
			const packed = await compressed(chunk, crypto);
			records.set(id, await encryptRecord(id, { kind: "chat-message-chunk", encoding: packed.encoding, bytes: base64url(packed.bytes) }, key, namespace, crypto));
		}
		return { parts, sha256: await sha256(bytes, crypto) };
	};
	const messages: MessageReference[] = [];
	const nativeEntries: MessageReference[] = [];
	const manifestEntry = structuredClone(clean) as unknown as Record<string, unknown>;
	let rebuildSearchText = false;
	if (clean.session) {
		for (const message of clean.session.data.messages) messages.push(await encodeBytes(jsonBytes(message), MAX_MESSAGE_BYTES));
		const session = manifestEntry.session as { data: Record<string, unknown>; metadata: Record<string, unknown> };
		delete session.data.messages;
		if (clean.session.data.nativeSession) {
			for (const entry of clean.session.data.nativeSession.entries) nativeEntries.push(await encodeBytes(jsonBytes(entry), MAX_MESSAGE_BYTES));
			delete (session.data.nativeSession as Record<string, unknown>).entries;
		}
		// This derived index duplicates the entire conversation and would turn
		// every append back into a full transcript upload.
		rebuildSearchText = typeof session.metadata.searchText === "string";
		delete session.metadata.searchText;
	}
	const manifestId = `c-${await sha256(encoder.encode(clean.id), crypto)}`;
	const manifest = { kind: "chat-manifest", schemaVersion: 1, entry: manifestEntry, messages, rebuildSearchText,
		...(clean.session?.data.nativeSession ? { nativeEntries } : {}) };
	const manifestBytes = jsonBytes(manifest);
	// Long chats still have a small mutable head. Their message-reference index
	// is itself content-addressed, so no record exceeds the transport bound.
	const head = manifestBytes.byteLength <= CHAT_SYNC_RECORD_PLAINTEXT_LIMIT ? manifest : {
		kind: "chat-manifest-ref", schemaVersion: 1, manifest: await encodeBytes(manifestBytes, MAX_MANIFEST_BYTES),
	};
	records.set(manifestId, await encryptRecord(manifestId, head, key, namespace, crypto));
	return { manifestId, records: [...records.values()] };
}

/** Missing/corrupt chunks fail the whole conversation; never publish partial messages. */
export async function decodeChatSyncManifest(manifestRecord: ChatSyncEncryptedRecord, lookup: RecordLookup, keys: Pick<AccountSyncKeyStore, "get">, namespace: string, crypto: SyncCrypto = webSyncCrypto): Promise<ChatSyncEntry> {
	if (!/^c-[a-f0-9]{64}$/u.test(manifestRecord.id)) throw new Error("Invalid chat manifest identity.");
	const cache = new Map<string, Promise<Uint8Array>>();
	let totalBytes = 0;
	const decodeBytes = async (reference: unknown, limit: number): Promise<Uint8Array> => {
		if (!object(reference) || !Array.isArray(reference.parts) || reference.parts.length === 0
			|| reference.parts.length > Math.ceil(limit / CHAT_SYNC_MESSAGE_CHUNK_BYTES)
			|| typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(reference.sha256)) throw new Error("Invalid chat message reference.");
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (const id of reference.parts) {
			if (typeof id !== "string" || !/^b-[a-f0-9]{64}$/u.test(id)) throw new Error("Invalid chat chunk identity.");
			let pending = cache.get(id);
			if (!pending) {
				pending = (async () => {
					const record = await lookup(id);
					if (!record || record.id !== id) throw new Error("A synced conversation is waiting for a message chunk.");
					const decoded = await decryptRecord(record, keys, namespace, crypto);
					if (!object(decoded) || decoded.kind !== "chat-message-chunk") throw new Error("Invalid chat message chunk.");
					const raw = await unpack(unbase64url(decoded.bytes, CHAT_SYNC_MESSAGE_CHUNK_BYTES), decoded.encoding, crypto);
					const chunkKey = record.encrypted && await keys.get(record.encrypted.key_id);
					if (!chunkKey) throw new Error("This device cannot unlock a synced conversation key.");
					if (raw.byteLength > CHAT_SYNC_MESSAGE_CHUNK_BYTES || await blobId(raw, chunkKey, crypto) !== id) throw new Error("The synced chat chunk digest does not match.");
					return raw;
				})();
				cache.set(id, pending);
			}
			const chunk = await pending;
			size += chunk.byteLength;
			totalBytes += chunk.byteLength;
			if (size > limit || totalBytes > MAX_CONVERSATION_BYTES) throw new Error("The synced conversation exceeds its byte limit.");
			chunks.push(chunk);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		if (await sha256(bytes, crypto) !== reference.sha256) throw new Error("The synced chat message digest does not match.");
		return bytes;
	};
	let manifest = await decryptRecord(manifestRecord, keys, namespace, crypto);
	if (object(manifest) && manifest.kind === "chat-manifest-ref" && manifest.schemaVersion === 1) {
		manifest = parseJson(await decodeBytes(manifest.manifest, MAX_MANIFEST_BYTES));
	}
	if (!object(manifest) || manifest.kind !== "chat-manifest" || manifest.schemaVersion !== 1 || !object(manifest.entry)
		|| !Array.isArray(manifest.messages) || manifest.messages.length > 100_000) throw new Error("Invalid chat manifest.");
	const entry = structuredClone(manifest.entry);
	if (entry.session === null) {
		if (manifest.messages.length !== 0) throw new Error("Invalid deleted chat manifest.");
	} else {
		if (!object(entry.session) || !object(entry.session.data) || !object(entry.session.metadata)) throw new Error("Invalid chat manifest session.");
		const messages: unknown[] = [];
		for (const reference of manifest.messages) messages.push(parseJson(await decodeBytes(reference, MAX_MESSAGE_BYTES)));
		entry.session.data.messages = messages;
		if (entry.session.data.nativeSession !== undefined) {
			if (!object(entry.session.data.nativeSession) || !Array.isArray(manifest.nativeEntries)
				|| manifest.nativeEntries.length > 100_000) throw new Error("Invalid native session manifest.");
			const entries: unknown[] = [];
			for (const reference of manifest.nativeEntries) entries.push(parseJson(await decodeBytes(reference, MAX_MESSAGE_BYTES)));
			entry.session.data.nativeSession.entries = entries;
		}
		if (manifest.rebuildSearchText === true) entry.session.metadata.searchText = sessionSearchText(messages as never);
	}
	const clean = parseEntry(entry);
	if (`c-${await sha256(encoder.encode(clean.id), crypto)}` !== manifestRecord.id) throw new Error("The synced conversation identity does not match its manifest.");
	return clean;
}

function parseRemoteRecord(value: unknown): ChatSyncRemoteRecord {
	if (!object(value) || typeof value.id !== "string" || !RECORD_ID.test(value.id)
		|| !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
		|| !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1
		|| typeof value.mutation_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.mutation_id)) throw new Error("Invalid chat sync record response.");
	return { id: value.id, revision: value.revision as number, sequence: value.sequence as number, mutation_id: value.mutation_id, encrypted: parseEncrypted(value.encrypted) };
}

export class ChatSyncRecordConflictError extends Error {
	constructor(readonly current: ChatSyncRemoteRecord | null, readonly code = "sync_revision_conflict") {
		super("The synced chat record changed on another device.");
	}
}

/** Account namespace comes exclusively from the provider's DPoP session. */
export class ChatSyncRecordsClient {
	constructor(private readonly requester: SyncRequester) {}
	async pull(cursor = "0", signal?: AbortSignal): Promise<ChatSyncRecordPage> {
		if (!/^\d+$/u.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new Error("Invalid chat sync cursor.");
		const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
		const response = await this.requester.request(`/v1/sync/records?after=${encodeURIComponent(cursor)}&limit=50`, { signal: requestSignal, cache: "no-store" });
		if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Reconnect Not Organic to sync your chats." : "Chat sync is temporarily unavailable.");
		const value: unknown = await response.json();
		if (!object(value) || !Array.isArray(value.records) || value.records.length > 50 || typeof value.cursor !== "string"
			|| !/^\d+$/u.test(value.cursor) || !Number.isSafeInteger(Number(value.cursor)) || Number(value.cursor) < Number(cursor)
			|| typeof value.has_more !== "boolean") throw new Error("Invalid chat sync page.");
		const records = value.records.map(parseRemoteRecord);
		let previous = Number(cursor);
		for (const record of records) {
			if (record.sequence <= previous || record.sequence > Number(value.cursor)) throw new Error("Invalid chat sync sequence.");
			previous = record.sequence;
		}
		if (value.has_more && Number(value.cursor) === Number(cursor)) throw new Error("Chat sync cursor did not advance.");
		return { records, cursor: value.cursor, has_more: value.has_more };
	}
	async put(record: ChatSyncEncryptedRecord, expectedRevision: number, mutationId: string, signal?: AbortSignal): Promise<ChatSyncRemoteRecord> {
		if (!RECORD_ID.test(record.id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[A-Za-z0-9_-]{1,128}$/u.test(mutationId)) throw new Error("Invalid chat sync mutation.");
		const encrypted = parseEncrypted(record.encrypted);
		const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
		const response = await this.requester.request(`/v1/sync/records/${encodeURIComponent(record.id)}`, {
			method: "PUT", headers: { "content-type": "application/json" }, signal: requestSignal,
			body: JSON.stringify({ expected_revision: expectedRevision, mutation_id: mutationId, encrypted }),
		});
		const value: unknown = await response.json();
		if (response.status === 409 && object(value) && object(value.error)
			&& (value.error.code === "sync_revision_conflict" || value.error.code === "sync_mutation_conflict") && "record" in value) {
			const current = value.record === null ? null : parseRemoteRecord(value.record);
			if (current && current.id !== record.id) throw new Error("Invalid chat sync conflict identity.");
			throw new ChatSyncRecordConflictError(current, value.error.code);
		}
		if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Reconnect Not Organic to sync your chats." : "Your chat changes could not be uploaded.");
		const saved = parseRemoteRecord(object(value) ? value.record : null);
		if (saved.id !== record.id || saved.mutation_id !== mutationId || saved.revision !== expectedRevision + 1
			|| chatSyncCanonical(saved.encrypted) !== chatSyncCanonical(encrypted)) throw new Error("The chat sync acknowledgement does not match this change.");
		return saved;
	}
}
