import { describe, expect, it } from "bun:test";
import type { KeatingPortableSession } from "../../../shared/account-sync/types";
import { ChatRecordSyncController, type ChatRecordSyncCheckpoint } from "../keating/sync/chat-record-sync-controller";
import { ChatSyncRecordConflictError, encodeChatSyncEntry, type ChatSyncEncryptedRecord, type ChatSyncRemoteRecord } from "../keating/sync/chat-sync-records";
import { chatSyncCanonical, emptyChatSyncState, mergeChatSyncStates, updateChatSyncState, type ChatSyncState } from "../keating/sync/chat-sync-state";
import { deriveAccountSyncNamespace, generateAccountSyncKey, type AccountSyncKey } from "../keating/sync/device-identity";

function fixture(id: string, texts = ["Teach me calculus"]): KeatingPortableSession {
	const date = "2026-11-06T00:00:00.000Z";
	return {
		data: { id, title: id, createdAt: date, lastModified: date, thinkingLevel: "off",
			model: { id: "balanced", name: "Balanced", api: "openai-completions", provider: "notorganic", baseUrl: "https://api.notorganic.info/v1",
				reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4_096 },
			messages: texts.map((content, timestamp) => ({ role: "user", content, timestamp })) },
		metadata: { id, title: id, createdAt: date, lastModified: date, thinkingLevel: "off", messageCount: texts.length, preview: texts.join("\n"),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
	};
}

class RecordApi {
	readonly records = new Map<string, ChatSyncRemoteRecord>();
	readonly receipts = new Map<string, { request: string; response: ChatSyncRemoteRecord }>();
	readonly sent: Array<{ record: ChatSyncEncryptedRecord; expectedRevision: number; mutationId: string }> = [];
	readonly reads: string[] = [];
	sequence = 0;
	pageSize = 50;
	failPullAt: string | null = null;
	loseNextReceipt = false;
	beforePut: ((record: ChatSyncEncryptedRecord) => Promise<void>) | null = null;
	async pull(cursor = "0") {
		this.reads.push(cursor);
		if (cursor === this.failPullAt) throw new Error("Network unavailable");
		const pending = [...this.records.values()].filter(record => record.sequence > Number(cursor)).sort((a, b) => a.sequence - b.sequence);
		const records = pending.slice(0, this.pageSize);
		return { records: structuredClone(records), cursor: String(records.at(-1)?.sequence ?? Number(cursor)), has_more: pending.length > records.length };
	}
	async put(record: ChatSyncEncryptedRecord, expectedRevision: number, mutationId: string): Promise<ChatSyncRemoteRecord> {
		this.sent.push(structuredClone({ record, expectedRevision, mutationId }));
		await this.beforePut?.(record);
		const request = chatSyncCanonical({ record, expectedRevision });
		const receipt = this.receipts.get(mutationId);
		if (receipt) {
			if (receipt.request !== request) throw new ChatSyncRecordConflictError(this.records.get(record.id) ?? null, "sync_mutation_conflict");
			return structuredClone(receipt.response);
		}
		const current = this.records.get(record.id);
		if ((current?.revision ?? 0) !== expectedRevision) throw new ChatSyncRecordConflictError(current ?? null);
		const saved = { ...structuredClone(record), revision: expectedRevision + 1, sequence: ++this.sequence, mutation_id: mutationId };
		this.records.set(record.id, saved);
		this.receipts.set(mutationId, { request, response: structuredClone(saved) });
		if (this.loseNextReceipt) { this.loseNextReceipt = false; throw new Error("Response lost after server commit"); }
		return structuredClone(saved);
	}
}

class LocalChats {
	state = emptyChatSyncState();
	baseline: KeatingPortableSession[] = [];
	sessions: KeatingPortableSession[] = [];
	failImport = false;
	constructor(readonly writer: string) {}
	async reconcile(remote: ChatSyncState | null) {
		if (remote && this.failImport) throw new Error("Local storage full");
		this.state = updateChatSyncState(this.state, this.sessions, this.writer, this.baseline);
		if (remote) this.state = mergeChatSyncStates(this.state, remote);
		this.sessions = this.state.entries.flatMap(entry => entry.session ? [structuredClone(entry.session)] : []);
		this.baseline = structuredClone(this.sessions);
		return structuredClone(this.state);
	}
}

function device(api: RecordApi, key: AccountSyncKey, namespace: string, writer: string) {
	const local = new LocalChats(writer);
	let checkpoint: ChatRecordSyncCheckpoint | null = null;
	let current = true;
	const statuses: string[] = [];
	const errors: unknown[] = [];
	const options = {
		remote: api, key, keys: { get: async (id: string) => id === key.keyId ? key : null }, namespace, local,
		loadCheckpoint: async () => structuredClone(checkpoint),
		saveCheckpoint: async (value: ChatRecordSyncCheckpoint) => { checkpoint = structuredClone(value); },
		isCurrent: () => current,
		onStatus: (status: "syncing" | "synced" | "error", error?: unknown) => { statuses.push(status); if (error) errors.push(error); },
	};
	let controller = new ChatRecordSyncController(options);
	return { local, statuses, errors, options,
		get controller() { return controller; },
		get checkpoint() { return checkpoint; },
		restart: () => { controller.dispose(); controller = new ChatRecordSyncController(options); },
		logout: () => { current = false; controller.dispose(); },
	};
}

async function setup() {
	const api = new RecordApi();
	const key = await generateAccountSyncKey();
	const namespace = await deriveAccountSyncNamespace("did:plc:alice");
	return { api, key, namespace, a: device(api, key, namespace, "device-a"), b: device(api, key, namespace, "device-b") };
}

describe("incremental chat record synchronization", () => {
	it("syncs two devices while append sends only a new message and manifest, rename only a manifest, idle no writes", async () => {
		const { api, a, b } = await setup();
		a.local.sessions = [fixture("chat", ["first message"])];
		await a.controller.request();
		expect(a.errors).toEqual([]);
		expect(api.sent.map(write => write.record.id[0]).sort()).toEqual(["b", "c"]);
		await b.controller.request();
		expect(b.local.sessions[0]?.data.messages).toHaveLength(1);
		const writes = api.sent.length;
		await a.controller.request();
		await b.controller.request();
		expect(api.sent).toHaveLength(writes);
		b.local.sessions = [fixture("chat", ["first message", "new message"])];
		await b.controller.request();
		expect(b.errors).toEqual([]);
		expect(api.sent.slice(writes).map(write => write.record.id[0]).sort()).toEqual(["b", "c"]);
		await a.controller.request();
		expect(a.local.sessions[0]?.data.messages).toHaveLength(2);
		const appended = api.sent.length;
		a.local.sessions[0]!.data.title = "New title";
		a.local.sessions[0]!.metadata.title = "New title";
		await a.controller.request();
		expect(api.sent.slice(appended).map(write => write.record.id[0])).toEqual(["c"]);
		await b.controller.request();
		expect(b.local.sessions[0]?.data.title).toBe("New title");
		const renamed = api.sent.length;
		a.local.sessions = [];
		await a.controller.request();
		expect(api.sent.slice(renamed).map(write => write.record.id[0])).toEqual(["c"]);
		await b.controller.request();
		expect(b.local.sessions).toEqual([]);
		expect(JSON.stringify([...api.records.values()])).not.toContain("first message");
	});

	it("replays exact ciphertext and mutation IDs after an uncertain write and restart", async () => {
		const { api, a } = await setup();
		a.local.sessions = [fixture("chat")];
		api.loseNextReceipt = true;
		await a.controller.request();
		expect(a.statuses.at(-1)).toBe("error");
		expect(a.checkpoint?.outbox.length).toBe(2);
		const sent = structuredClone(api.sent[0]);
		a.restart();
		await a.controller.request();
		expect(api.sent[1]).toEqual(sent);
		expect(api.records.size).toBe(2);
		expect(a.checkpoint?.outbox).toEqual([]);
		expect(a.statuses.at(-1)).toBe("synced");
	});

	it("retries an uncertain manifest unchanged before uploading a newer local edit", async () => {
		const { api, a, b } = await setup();
		a.local.sessions = [fixture("chat", ["first"])];
		let lost = false;
		api.beforePut = async record => {
			if (!lost && record.id.startsWith("c-")) { lost = true; api.loseNextReceipt = true; }
		};
		await a.controller.request();
		expect(a.checkpoint?.outbox).toHaveLength(1);
		const pending = structuredClone(api.sent.at(-1)!);
		a.local.sessions = [fixture("chat", ["first", "edited before retry"])];
		a.restart();
		const before = api.sent.length;
		await a.controller.request();
		expect(a.statuses.at(-1)).toBe("synced");
		expect(api.sent[before]).toEqual(pending);
		await b.controller.request();
		expect(b.local.sessions[0]?.data.messages).toHaveLength(2);
	});

	it("deduplicates a message chunk raced by two devices without losing either conversation", async () => {
		const { api, a, b } = await setup();
		a.local.sessions = [fixture("from-a", ["identical message"])];
		b.local.sessions = [fixture("from-b", ["identical message"])];
		await Promise.all([a.controller.request(), b.controller.request()]);
		await Promise.all([a.controller.request(), b.controller.request()]);
		expect(a.errors).toEqual([]);
		expect(b.errors).toEqual([]);
		expect([...api.records.keys()].filter(id => id.startsWith("b-"))).toHaveLength(1);
		expect([...api.records.keys()].filter(id => id.startsWith("c-"))).toHaveLength(2);
		expect(a.local.sessions.map(session => session.data.id).sort()).toEqual(["from-a", "from-b"]);
		expect(b.local.sessions.map(session => session.data.id).sort()).toEqual(["from-a", "from-b"]);
	});

	it("does not move the cursor past a failed page or failed local import", async () => {
		const { api, a, b } = await setup();
		a.local.sessions = [fixture("chat", ["one", "two"])];
		await a.controller.request();
		api.pageSize = 1;
		api.failPullAt = "1";
		await b.controller.request();
		expect(b.statuses.at(-1)).toBe("error");
		expect(b.checkpoint).toBeNull();
		expect(b.local.sessions).toEqual([]);
		api.failPullAt = null;
		b.local.failImport = true;
		await b.controller.request();
		expect(b.checkpoint).toBeNull();
		b.local.failImport = false;
		await b.controller.request();
		expect(b.checkpoint?.cursor).toBe("3");
		expect(b.local.sessions[0]?.data.messages).toHaveLength(2);
	});

	it("does not acknowledge a cursor containing ciphertext that cannot be authenticated", async () => {
		const { api, a, b } = await setup();
		a.local.sessions = [fixture("chat")];
		await a.controller.request();
		const record = [...api.records.values()].find(value => value.id.startsWith("b-"))!;
		const ciphertext = record.encrypted!.ciphertext;
		record.encrypted!.ciphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
		await b.controller.request();
		expect(b.statuses.at(-1)).toBe("error");
		expect(b.checkpoint).toBeNull();
		expect(b.local.sessions).toEqual([]);
		record.encrypted!.ciphertext = ciphertext;
		await b.controller.request();
		expect(b.statuses.at(-1)).toBe("synced");
		expect(b.local.sessions[0]?.data.id).toBe("chat");
	});

	it("does not advance the read cursor to its own write sequence and miss another device's record", async () => {
		const { api, a, b } = await setup();
		a.local.sessions = [fixture("from-a")];
		await a.controller.request();
		expect(a.checkpoint?.cursor).toBe("0");
		b.local.sessions = [fixture("from-b")];
		await b.controller.request();
		await a.controller.request();
		expect(a.local.sessions.map(session => session.data.id).sort()).toEqual(["from-a", "from-b"]);
		expect(Number(a.checkpoint?.cursor)).toBe(api.sequence);
	});

	it("reconciles a manifest CAS conflict and preserves concurrent transcripts as a fork", async () => {
		const { api, key, namespace, a, b } = await setup();
		a.local.sessions = [fixture("chat", ["base"])];
		await a.controller.request();
		await b.controller.request();
		a.local.sessions = [fixture("chat", ["base", "device a continuation"])];
		b.local.sessions = [fixture("chat", ["base", "device b continuation"])];
		const changed = await b.local.reconcile(null);
		const encoded = await encodeChatSyncEntry(changed.entries[0]!, key, namespace);
		let injected = false;
		api.beforePut = async record => {
			if (injected || !record.id.startsWith("c-")) return;
			injected = true;
			for (const part of encoded.records) {
				if (part.id.startsWith("b-") && api.records.has(part.id)) continue;
				await api.put(part, api.records.get(part.id)?.revision ?? 0, crypto.randomUUID());
			}
		};
		await a.controller.request();
		expect(a.errors).toEqual([]);
		await b.controller.request();
		expect(b.errors).toEqual([]);
		const transcripts = b.local.sessions.map(session => chatSyncCanonical(session.data.messages));
		expect(transcripts).toHaveLength(2);
		expect(transcripts.some(text => text.includes("device a continuation"))).toBe(true);
		expect(transcripts.some(text => text.includes("device b continuation"))).toBe(true);
		expect(a.checkpoint?.outbox).toEqual([]);
	});

	it("keeps local edits after a failed pull without overwriting remote data", async () => {
		const { api, a, b } = await setup();
		a.local.sessions = [fixture("remote")];
		await a.controller.request();
		b.local.sessions = [fixture("offline")];
		api.failPullAt = "0";
		const before = api.sent.length;
		await b.controller.request();
		expect(api.sent).toHaveLength(before);
		expect(b.local.state.entries[0]?.id).toBe("offline");
		api.failPullAt = null;
		await b.controller.request();
		expect(b.local.sessions.map(session => session.data.id).sort()).toEqual(["offline", "remote"]);
	});

	it("ignores a late read after logout and retains the previous cursor", async () => {
		const { api, a, b } = await setup();
		a.local.sessions = [fixture("remote")];
		await a.controller.request();
		const originalPull = api.pull.bind(api);
		let release!: () => void;
		let entered!: () => void;
		const reading = new Promise<void>(resolve => { entered = resolve; });
		const gate = new Promise<void>(resolve => { release = resolve; });
		api.pull = async cursor => { entered(); await gate; return originalPull(cursor); };
		const request = b.controller.request();
		await reading;
		b.logout();
		release();
		await request;
		expect(b.checkpoint).toBeNull();
		expect(b.local.sessions).toEqual([]);
		expect(b.statuses).toEqual(["syncing"]);
	});
});
