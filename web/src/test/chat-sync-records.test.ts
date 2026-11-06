import { describe, expect, it } from "bun:test";
import { webSyncCrypto, type SyncCrypto } from "../../../shared/account-sync/crypto";
import type { ChatSyncEntry } from "../keating/sync/chat-sync-state";
import { chatSyncCanonical } from "../keating/sync/chat-sync-state";
import { deriveAccountSyncNamespace, generateAccountSyncKey, importAccountSyncRecoveryCode } from "../keating/sync/device-identity";
import { CHAT_SYNC_RECORD_PLAINTEXT_LIMIT, ChatSyncRecordConflictError, ChatSyncRecordsClient, decodeChatSyncManifest, encodeChatSyncEntry, type ChatSyncEncryptedRecord, type ChatSyncRemoteRecord } from "../keating/sync/chat-sync-records";

function entry(texts = ["Teach me calculus"], id = "chat-one"): ChatSyncEntry {
	const at = "2026-11-06T00:00:00.000Z";
	return { id, version: 1, writer: "device-a", session: {
		data: { id, title: id, createdAt: at, lastModified: at, thinkingLevel: "off",
			parentSessionId: "parent-chat", forkedAt: at,
			model: { id: "balanced", name: "Balanced", api: "openai-completions", provider: "notorganic", baseUrl: "https://api.notorganic.info/v1",
				reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4_096 },
			messages: texts.map((text, index) => ({ role: "user", content: text, timestamp: index })) },
		metadata: { id, title: id, createdAt: at, lastModified: at, thinkingLevel: "off", messageCount: texts.length,
			preview: texts.join("\n").slice(0, 8192), searchText: texts.join("\n"),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
	} };
}
async function fixture() {
	const key = await generateAccountSyncKey();
	const namespace = await deriveAccountSyncNamespace("did:plc:alice");
	const keys = { get: async (id: string) => id === key.keyId ? key : null };
	const decode = async (encoded: Awaited<ReturnType<typeof encodeChatSyncEntry>>) => {
		const map = new Map(encoded.records.map(record => [record.id, record]));
		return decodeChatSyncManifest(map.get(encoded.manifestId)!, id => map.get(id) ?? null, keys, namespace);
	};
	return { key, namespace, keys, decode };
}
function encodedBytes(record: ChatSyncEncryptedRecord): number { return Buffer.from(record.encrypted!.ciphertext, "base64url").byteLength; }
async function rewriteRecord(record: ChatSyncEncryptedRecord, key: Awaited<ReturnType<typeof generateAccountSyncKey>>, namespace: string, change: (value: any) => Promise<unknown> | unknown): Promise<ChatSyncEncryptedRecord> {
	const encrypted = record.encrypted!;
	const additionalData = new TextEncoder().encode(`keating-chat-record-v1:${namespace}:${record.id}:${key.keyId}`);
	const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(encrypted.iv, "base64url"), additionalData }, key.key, Buffer.from(encrypted.ciphertext, "base64url"));
	const value = await change(JSON.parse(new TextDecoder().decode(plaintext)));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key.key, new TextEncoder().encode(JSON.stringify(value)));
	return { ...record, encrypted: { key_id: key.keyId, iv: Buffer.from(iv).toString("base64url"), ciphertext: Buffer.from(ciphertext).toString("base64url") } };
}

describe("incremental encrypted chat records", () => {
	it("preserves a native session tree and uploads only its added entry", async () => {
		const { key, namespace, decode } = await fixture();
		const original = entry();
		original.session!.data.nativeSession = { header: { type: "session", version: 3, id: "native-id" }, leafId: "two",
			entries: [{ id: "one", type: "message", parentId: null, message: { role: "user", content: "hello" } },
				{ id: "two", type: "custom", parentId: "one", payload: { hiddenBranch: true } }] };
		const encoded = await encodeChatSyncEntry(original, key, namespace);
		expect(await decode(encoded)).toEqual(original);
		const next = structuredClone(original);
		next.version++;
		next.session!.data.nativeSession!.entries.push({ id: "three", parentId: "one", type: "message", message: { role: "assistant", content: "a branch" } });
		next.session!.data.nativeSession!.leafId = "three";
		const changed = await encodeChatSyncEntry(next, key, namespace);
		const known = new Set(encoded.records.map(record => record.id));
		expect(changed.records.filter(record => !known.has(record.id))).toHaveLength(1);
		expect(await decode(changed)).toEqual(next);
	});
	it("interoperates with an opaque native-key adapter without exporting keys", async () => {
		const { key, namespace, keys, decode } = await fixture();
		const encryptionHandle = { nativeHandle: "key" };
		const indexHandle = { nativeHandle: "index" };
		const native: SyncCrypto = {
			...webSyncCrypto,
			encrypt: (handle, iv, aad, bytes) => { expect(handle).toBe(encryptionHandle); return webSyncCrypto.encrypt(key.key, iv, aad, bytes); },
			decrypt: (handle, iv, aad, bytes) => { expect(handle).toBe(encryptionHandle); return webSyncCrypto.decrypt(key.key, iv, aad, bytes); },
			hmac: (handle, bytes) => { expect(handle).toBe(indexHandle); return webSyncCrypto.hmac(key.indexingKey, bytes); },
		};
		const opaque = { keyId: key.keyId, createdAt: key.createdAt, key: encryptionHandle, indexingKey: indexHandle };
		const original = entry();
		const fromNative = await encodeChatSyncEntry(original, opaque, namespace, native);
		expect(await decode(fromNative)).toEqual(original);
		const fromWeb = await encodeChatSyncEntry(original, key, namespace);
		const map = new Map(fromWeb.records.map(record => [record.id, record]));
		expect(await decodeChatSyncManifest(map.get(fromWeb.manifestId)!, id => map.get(id) ?? null,
			{ get: async id => await keys.get(id) ? opaque : null }, namespace, native)).toEqual(original);
	});
	it("round-trips chat identity, fork metadata, UTF-8 messages and derived search text", async () => {
		const { key, namespace, decode } = await fixture();
		const original = entry(["你好 — calculus 🦉", "Continue with integrals"]);
		const encoded = await encodeChatSyncEntry(original, key, namespace);
		expect(encoded.records.at(-1)?.id).toBe(encoded.manifestId);
		expect(await decode(encoded)).toEqual(original);
		expect(JSON.stringify(encoded)).not.toContain("calculus");
	});

	it("appending a message only introduces that message's chunks and changes the small manifest", async () => {
		const { key, namespace } = await fixture();
		const first = await encodeChatSyncEntry(entry(["hello"]), key, namespace);
		const second = await encodeChatSyncEntry({ ...entry(["hello", "next"]), version: 2 }, key, namespace);
		const known = new Set(first.records.map(record => record.id));
		expect(second.records.filter(record => !known.has(record.id))).toHaveLength(1);
		expect(second.manifestId).toBe(first.manifestId);
		expect(encodedBytes(second.records.at(-1)!)).toBeLessThan(2_000);
	});

	it("keeps blob IDs stable across repeated encoding and compression availability", async () => {
		const { key, namespace, decode } = await fixture();
		const original = entry(["repeated teaching detail ".repeat(3_000)]);
		const gzip = await encodeChatSyncEntry(original, key, namespace);
		const again = await encodeChatSyncEntry(original, key, namespace);
		expect(gzip.records.map(record => record.id)).toEqual(again.records.map(record => record.id));
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, "CompressionStream");
		let identity: Awaited<ReturnType<typeof encodeChatSyncEntry>>;
		try {
			Object.defineProperty(globalThis, "CompressionStream", { configurable: true, value: undefined });
			identity = await encodeChatSyncEntry(original, key, namespace);
		} finally { if (descriptor) Object.defineProperty(globalThis, "CompressionStream", descriptor); }
		expect(gzip.records.map(record => record.id)).toEqual(identity!.records.map(record => record.id));
		const blobSize = (records: ChatSyncEncryptedRecord[]) => records.filter(record => record.id.startsWith("b-")).reduce((sum, record) => sum + encodedBytes(record), 0);
		expect(blobSize(gzip.records)).toBeLessThan(blobSize(identity!.records) / 10);
		for (const record of identity!.records) expect(encodedBytes(record)).toBeLessThanOrEqual(CHAT_SYNC_RECORD_PLAINTEXT_LIMIT + 16);
		expect(await decode(identity!)).toEqual(original);
		expect(await decode(gzip)).toEqual(original);
	});

	it("uses account-keyed blob IDs, preventing plaintext guesses and cross-account correlation", async () => {
		const { key, namespace } = await fixture();
		const original = entry(["hello"]);
		const first = await encodeChatSyncEntry(original, key, namespace);
		const anotherDevice = await encodeChatSyncEntry(original, await importAccountSyncRecoveryCode(key.recoveryCode), namespace);
		const anotherKey = await generateAccountSyncKey();
		const other = await encodeChatSyncEntry(original, anotherKey, await deriveAccountSyncNamespace("did:plc:bob"));
		const blobs = (records: ChatSyncEncryptedRecord[]) => records.filter(record => record.id.startsWith("b-")).map(record => record.id);
		expect(blobs(first.records)).toEqual(blobs(anotherDevice.records));
		expect(blobs(first.records)).not.toEqual(blobs(other.records));
		const raw = new TextEncoder().encode(chatSyncCanonical(original.session!.data.messages[0]));
		const dictionaryGuess = `b-${Buffer.from(await crypto.subtle.digest("SHA-256", raw)).toString("hex")}`;
		expect(blobs(first.records)).not.toContain(dictionaryGuess);
		const { indexingKey: _missing, ...legacy } = key;
		await expect(encodeChatSyncEntry(original, legacy, namespace)).rejects.toThrow("Reconnect Not Organic");
	});

	it("pages a long conversation manifest without making an oversized record", async () => {
		const { key, namespace, decode } = await fixture();
		const original = entry(Array.from({ length: 500 }, (_, index) => `message-${index}`));
		const encoded = await encodeChatSyncEntry(original, key, namespace);
		for (const record of encoded.records) expect(encodedBytes(record)).toBeLessThanOrEqual(CHAT_SYNC_RECORD_PLAINTEXT_LIMIT + 16);
		expect(encodedBytes(encoded.records.at(-1)!)).toBeLessThan(2_000);
		expect(await decode(encoded)).toEqual(original);
	});

	it("sanitizes model credentials and preserves deletion as a manifest tombstone", async () => {
		const { key, namespace, decode } = await fixture();
		const original = entry();
		Object.assign(original.session!.data.model, { apiKey: "do-not-upload", headers: { authorization: "do-not-upload" }, baseUrl: "https://user:password@example.test/v1?token=secret" });
		const decoded = await decode(await encodeChatSyncEntry(original, key, namespace));
		expect(chatSyncCanonical(decoded)).not.toContain("do-not-upload");
		expect(chatSyncCanonical(decoded)).not.toContain("password");
		expect(chatSyncCanonical(decoded)).not.toContain("token=secret");
		const tombstone = { id: original.id, version: 2, writer: "device-a", session: null };
		const encoded = await encodeChatSyncEntry(tombstone, key, namespace);
		expect(encoded.records).toHaveLength(1);
		expect(await decode(encoded)).toEqual(tombstone);
	});

	it("fails closed on missing chunks, different accounts, swapped IDs and tampering", async () => {
		const { key, namespace, keys } = await fixture();
		const encoded = await encodeChatSyncEntry(entry(), key, namespace);
		const map = new Map(encoded.records.map(record => [record.id, record]));
		const manifest = map.get(encoded.manifestId)!;
		await expect(decodeChatSyncManifest(manifest, () => null, keys, namespace)).rejects.toThrow("waiting for a message chunk");
		await expect(decodeChatSyncManifest(manifest, id => map.get(id) ?? null, keys, await deriveAccountSyncNamespace("did:plc:bob"))).rejects.toThrow("authenticated");
		await expect(decodeChatSyncManifest({ ...manifest, id: `c-${"f".repeat(64)}` }, id => map.get(id) ?? null, keys, namespace)).rejects.toThrow("authenticated");
		const corrupt = structuredClone(manifest);
		corrupt.encrypted!.ciphertext = `${corrupt.encrypted!.ciphertext[0] === "a" ? "b" : "a"}${corrupt.encrypted!.ciphertext.slice(1)}`;
		await expect(decodeChatSyncManifest(corrupt, id => map.get(id) ?? null, keys, namespace)).rejects.toThrow("authenticated");
		await expect(decodeChatSyncManifest(manifest, id => map.get(id) ?? null, { get: async () => null }, namespace)).rejects.toThrow("cannot unlock");
	});

	it("validates message digests and bounds decompression before trusting encrypted contents", async () => {
		const { key, namespace, keys } = await fixture();
		const encoded = await encodeChatSyncEntry(entry(), key, namespace);
		const map = new Map(encoded.records.map(record => [record.id, record]));
		const manifest = map.get(encoded.manifestId)!;
		const wrongDigest = await rewriteRecord(manifest, key, namespace, value => { value.messages[0].sha256 = "0".repeat(64); return value; });
		await expect(decodeChatSyncManifest(wrongDigest, id => map.get(id) ?? null, keys, namespace)).rejects.toThrow("message digest");
		const blob = encoded.records.find(record => record.id.startsWith("b-"))!;
		map.set(blob.id, await rewriteRecord(blob, key, namespace, async value => {
			const packed = await new Response(new Blob(["x".repeat(40_000)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
			return { ...value, encoding: "gzip", bytes: Buffer.from(packed).toString("base64url") };
		}));
		await expect(decodeChatSyncManifest(manifest, id => map.get(id) ?? null, keys, namespace)).rejects.toThrow("Decompressed chat chunk exceeds");
	});
});

describe("account-relative sync record requests", () => {
	const encrypted = { key_id: "a".repeat(32), iv: Buffer.alloc(12).toString("base64url"), ciphertext: Buffer.alloc(16).toString("base64url") };
	const record: ChatSyncRemoteRecord = { id: `c-${"b".repeat(64)}`, revision: 1, sequence: 1, mutation_id: "mutation-one", encrypted };
	it("uses a bounded incremental cursor and writes without a claimed account identity", async () => {
		const requests: Array<{ path: string; init?: RequestInit }> = [];
		const client = new ChatSyncRecordsClient({ request: async (path, init) => {
			requests.push({ path, init });
			return Response.json(init?.method === "PUT" ? { record } : { records: [record], cursor: "1", has_more: false });
		} });
		expect((await client.pull()).records).toEqual([record]);
		expect(await client.put(record, 0, "mutation-one")).toEqual(record);
		expect(requests[0]?.path).toBe("/v1/sync/records?after=0&limit=50");
		expect(JSON.parse(requests[1]?.init?.body as string)).toEqual({ expected_revision: 0, mutation_id: "mutation-one", encrypted });
	});
	it("returns typed revision and idempotency conflicts with the current server record", async () => {
		for (const code of ["sync_revision_conflict", "sync_mutation_conflict"]) {
			const client = new ChatSyncRecordsClient({ request: async () => Response.json({ error: { code }, record }, { status: 409 }) });
			try { await client.put(record, 0, "mutation-two"); throw new Error("Expected conflict"); }
			catch (error) { expect(error).toBeInstanceOf(ChatSyncRecordConflictError); expect((error as ChatSyncRecordConflictError).current).toEqual(record); }
		}
	});
	it("rejects regressing/nonadvancing cursors and mismatched acknowledgements", async () => {
		const stalled = new ChatSyncRecordsClient({ request: async () => Response.json({ records: [], cursor: "0", has_more: true }) });
		await expect(stalled.pull()).rejects.toThrow("did not advance");
		const mismatch = new ChatSyncRecordsClient({ request: async () => Response.json({ record: { ...record, mutation_id: "wrong" } }) });
		await expect(mismatch.put(record, 0, "mutation-one")).rejects.toThrow("does not match");
		const unauthorized = new ChatSyncRecordsClient({ request: async () => Response.json({}, { status: 403 }) });
		await expect(unauthorized.pull()).rejects.toThrow("Reconnect Not Organic");
	});
});
