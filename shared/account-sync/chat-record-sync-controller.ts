import { webSyncCrypto, type SyncCrypto } from "./crypto.js";
import { chatSyncCanonical, emptyChatSyncState, parseChatSyncState, type ChatSyncState } from "./chat-sync-state.js";
import type { AccountSyncKey, AccountSyncKeyStore } from "./device-identity.js";
import {
	ChatSyncRecordConflictError,
	decodeChatSyncManifest,
	encodeChatSyncEntry,
	type ChatSyncEncryptedRecord,
	type ChatSyncRecordsClient,
	type ChatSyncRemoteRecord,
} from "./chat-sync-records.js";

export interface ChatRecordSyncPendingWrite {
	record: ChatSyncEncryptedRecord;
	expectedRevision: number;
	mutationId: string;
}

/** Store this atomically per authenticated account, separately from local chat state. */
export interface ChatRecordSyncCheckpoint {
	schemaVersion: 1;
	/** Only a completed delta-page read may advance this cursor. */
	cursor: string;
	records: Record<string, ChatSyncRemoteRecord>;
	/** Exact ciphertext and mutation IDs survive uncertain HTTP delivery. */
	outbox: ChatRecordSyncPendingWrite[];
}

export interface ChatRecordSyncControllerOptions {
	crypto?: SyncCrypto;
	remote: Pick<ChatSyncRecordsClient, "pull" | "put">;
	key: AccountSyncKey;
	keys: Pick<AccountSyncKeyStore, "get">;
	namespace: string;
	local: { reconcile(remote: ChatSyncState | null): Promise<ChatSyncState> };
	loadCheckpoint(): Promise<ChatRecordSyncCheckpoint | null>;
	saveCheckpoint(checkpoint: ChatRecordSyncCheckpoint): Promise<void>;
	isCurrent(): boolean;
	onStatus(status: "syncing" | "synced" | "error", error?: unknown): void;
}

function initialCheckpoint(): ChatRecordSyncCheckpoint {
	return { schemaVersion: 1, cursor: "0", records: {}, outbox: [] };
}

function loadCheckpoint(value: ChatRecordSyncCheckpoint | null): ChatRecordSyncCheckpoint {
	if (!value) return initialCheckpoint();
	if (value.schemaVersion !== 1 || typeof value.cursor !== "string" || !value.records || Array.isArray(value.records)
		|| !Array.isArray(value.outbox)) throw new Error("The saved chat sync checkpoint is invalid.");
	return structuredClone(value);
}

function cacheRecord(checkpoint: ChatRecordSyncCheckpoint, incoming: ChatSyncRemoteRecord): void {
	const current = checkpoint.records[incoming.id];
	if (current && current.revision > incoming.revision) return;
	if (current && current.revision === incoming.revision
		&& chatSyncCanonical(current.encrypted) !== chatSyncCanonical(incoming.encrypted)) {
		throw new Error("The chat service returned conflicting contents for one revision.");
	}
	checkpoint.records[incoming.id] = incoming;
}

class CancelledChatSync extends Error {}

/** Incremental account API reconciliation, with per-record CAS and a durable outbox. */
export class ChatRecordSyncController {
	private running: Promise<void> | null = null;
	private requested = false;
	private disposed = false;
	private readonly abort = new AbortController();

	constructor(private readonly options: ChatRecordSyncControllerOptions) {}

	private current(): boolean { return !this.disposed && this.options.isCurrent(); }
	private check(): void { if (!this.current()) throw new CancelledChatSync(); }

	request(): Promise<void> {
		if (!this.current()) return Promise.resolve();
		this.requested = true;
		if (!this.running) {
			this.running = Promise.resolve().then(() => this.run()).finally(() => {
				this.running = null;
				if (this.requested && this.current()) void this.request();
			});
		}
		return this.running;
	}

	private async persist(checkpoint: ChatRecordSyncCheckpoint): Promise<void> {
		this.check();
		await this.options.saveCheckpoint(structuredClone(checkpoint));
		this.check();
	}

	/** Returns false only for a definite manifest CAS rejection. */
	private async flushOutbox(checkpoint: ChatRecordSyncCheckpoint): Promise<boolean> {
		while (checkpoint.outbox.length) {
			this.check();
			const pending = checkpoint.outbox[0]!;
			try {
				if (pending.record.id.startsWith("c-")) {
					// Authenticate all referenced chunks before making a manifest
					// visible, including blobs accepted after a racing upload.
					await decodeChatSyncManifest(pending.record, id => checkpoint.records[id] ?? null, this.options.keys, this.options.namespace, this.options.crypto);
					this.check();
				}
				const stored = await this.options.remote.put(pending.record, pending.expectedRevision, pending.mutationId, this.abort.signal);
				this.check();
				if (stored.id !== pending.record.id || stored.revision !== pending.expectedRevision + 1
					|| chatSyncCanonical(stored.encrypted) !== chatSyncCanonical(pending.record.encrypted)) {
					throw new Error("The chat service returned an invalid write receipt.");
				}
				cacheRecord(checkpoint, stored);
				checkpoint.outbox.shift();
				await this.persist(checkpoint);
			} catch (error) {
				this.check();
				if (!(error instanceof ChatSyncRecordConflictError)) throw error;
				if (error.current) cacheRecord(checkpoint, error.current);
				if (pending.record.id.startsWith("b-") && error.current?.encrypted) {
					// Content-addressed blobs are immutable. Another device may have
					// uploaded the same plaintext using its own random encryption IV.
					checkpoint.outbox.shift();
					await this.persist(checkpoint);
					continue;
				}
				// 409 proves this operation was rejected. Discard only that rejected
				// plan and re-read/merge before generating a new CAS request.
				checkpoint.outbox = [];
				await this.persist(checkpoint);
				return false;
			}
		}
		return true;
	}

	private async decode(checkpoint: ChatRecordSyncCheckpoint): Promise<ChatSyncState> {
		const entries = [];
		for (const record of Object.values(checkpoint.records).sort((a, b) => a.id.localeCompare(b.id))) {
			this.check();
			if (!record.id.startsWith("c-")) continue;
			if (!record.encrypted) throw new Error("A conversation record is missing its encrypted deletion history.");
			const entry = await decodeChatSyncManifest(record, id => checkpoint.records[id] ?? null, this.options.keys, this.options.namespace, this.options.crypto);
			this.check();
			entries.push(entry);
		}
		return parseChatSyncState({ ...emptyChatSyncState(), entries });
	}

	private async pull(checkpoint: ChatRecordSyncCheckpoint): Promise<{ checkpoint: ChatRecordSyncCheckpoint; remote: ChatSyncState; merged: ChatSyncState }> {
		const next = structuredClone(checkpoint);
		let complete = false;
		for (let page = 0; page < 1_000; page += 1) {
			this.check();
			const response = await this.options.remote.pull(next.cursor, this.abort.signal);
			this.check();
			for (const record of response.records) cacheRecord(next, record);
			if (response.has_more && response.cursor === next.cursor) throw new Error("The chat sync cursor did not advance.");
			next.cursor = response.cursor;
			if (!response.has_more) { complete = true; break; }
		}
		if (!complete) throw new Error("There are too many pending chat sync pages. Try syncing again later.");
		const remote = await this.decode(next);
		this.check();
		const merged = await this.options.local.reconcile(remote);
		this.check();
		// A cursor never outruns verified decryption or local application. Failed
		// pages/imports are replayed safely from the previous durable checkpoint.
		await this.persist(next);
		return { checkpoint: next, remote, merged };
	}

	private async cycle(): Promise<void> {
		this.check();
		await this.options.local.reconcile(null);
		this.check();
		let checkpoint = loadCheckpoint(await this.options.loadCheckpoint());
		this.check();
		for (let attempt = 0; attempt < 4; attempt += 1) {
			// Replay uncertain sends byte-for-byte before considering newer local
			// edits. Successful old writes are then reconciled with those edits.
			if (!await this.flushOutbox(checkpoint)) continue;
			this.check();
			const pulled = await this.pull(checkpoint);
			this.check();
			checkpoint = pulled.checkpoint;
			const remoteEntries = new Map(pulled.remote.entries.map(entry => [entry.id, entry]));
			let conflict = false;
			for (const entry of pulled.merged.entries) {
				this.check();
				if (chatSyncCanonical(entry) === chatSyncCanonical(remoteEntries.get(entry.id))) continue;
				const encoded = await encodeChatSyncEntry(entry, this.options.key, this.options.namespace, this.options.crypto);
				this.check();
				checkpoint.outbox = encoded.records.filter(record => record.id === encoded.manifestId || !checkpoint.records[record.id]?.encrypted)
					.map(record => ({ record, expectedRevision: checkpoint.records[record.id]?.revision ?? 0, mutationId: (this.options.crypto ?? webSyncCrypto).randomUUID() }));
				// Save before sending even the first chunk. A lost HTTP response must
				// reuse the original mutation ID and ciphertext after a restart.
				await this.persist(checkpoint);
				if (!await this.flushOutbox(checkpoint)) { conflict = true; break; }
			}
			if (!conflict) return;
		}
		throw new Error("Chats changed on another device while syncing. Keating will retry without replacing that work.");
	}

	private async run(): Promise<void> {
		while (this.requested && this.current()) {
			this.requested = false;
			this.options.onStatus("syncing");
			try {
				await this.cycle();
				if (this.current()) this.options.onStatus("synced");
			} catch (error) {
				if (this.current() && !(error instanceof CancelledChatSync)) this.options.onStatus("error", error);
				this.requested = false;
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		this.requested = false;
		this.abort.abort();
	}
}
