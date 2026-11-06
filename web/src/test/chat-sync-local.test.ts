import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { SessionsStore, SettingsStore } from "../keating/app-storage";
import type { KeatingPortableSession } from "../keating/portable-data";
import { BrowserChatSyncLocalStore } from "../keating/sync/chat-sync-local";
import { CHAT_SYNC_JOURNAL_KEY, type ChatSyncJournal } from "../keating/sync/chat-sync-journal";
import { emptyChatSyncState, updateChatSyncState } from "../keating/sync/chat-sync-state";
import { IndexedDBStorageBackend } from "../lib/cloud-storage-backend";
import type { StorageBackend } from "../types";

let originalIndexedDb: PropertyDescriptor | undefined;
beforeEach(() => {
	originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
	Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
});
afterEach(() => {
	if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
	else Reflect.deleteProperty(globalThis, "indexedDB");
});

function fixture(id: string, content = "Teach me calculus"): KeatingPortableSession {
	const date = "2026-11-06T00:00:00.000Z";
	return {
		data: { id, title: id, createdAt: date, lastModified: date, thinkingLevel: "off",
			model: { id: "balanced", name: "Balanced", api: "openai-completions", provider: "notorganic", baseUrl: "https://api.notorganic.info/v1",
				reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4_096 },
			messages: [{ role: "user", content, timestamp: 1 }] },
		metadata: { id, title: id, createdAt: date, lastModified: date, thinkingLevel: "off", messageCount: 1, preview: content,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
	};
}

function device() {
	const sessions = new SessionsStore();
	const backend = new IndexedDBStorageBackend({ dbName: crypto.randomUUID(), version: 1,
		stores: [new SettingsStore().getConfig(), sessions.getConfig(), SessionsStore.getMetadataConfig()] });
	sessions.setBackend(backend);
	return { backend, sessions, save: (value: KeatingPortableSession) => sessions.save(value.data, value.metadata) };
}

describe("account chat local storage", () => {
	it("adopts existing offline chats on the first account connection", async () => {
		const first = device();
		await first.save(fixture("offline"));
		const local = new BrowserChatSyncLocalStore(first.backend, "account-a", "device-a");
		await local.bind();
		expect((await local.reconcile(null)).entries.map(entry => entry.id)).toEqual(["offline"]);
		expect((await first.backend.get<ChatSyncJournal>("settings", CHAT_SYNC_JOURNAL_KEY))?.owners).toEqual({ offline: "account-a" });
	});

	it("records ownership for imported IDs that match object prototype properties", async () => {
		const first = device();
		await first.save(fixture("__proto__"));
		const a = new BrowserChatSyncLocalStore(first.backend, "account-a", "device-a");
		await a.bind();
		expect((await a.reconcile(null)).entries.map(entry => entry.id)).toEqual(["__proto__"]);
		const b = new BrowserChatSyncLocalStore(first.backend, "account-b", "device-a");
		await b.bind();
		expect((await b.reconcile(null)).entries).toEqual([]);
	});

	it("keeps account A chats out of account B uploads and restores A's checkpoint on return", async () => {
		const first = device();
		await first.save(fixture("a-history"));
		const a = new BrowserChatSyncLocalStore(first.backend, "account-a", "device-a");
		await a.bind();
		first.sessions.enableAccountSyncTracking("account-a");
		await a.reconcile(null);
		const b = new BrowserChatSyncLocalStore(first.backend, "account-b", "device-a");
		await b.bind();
		first.sessions.enableAccountSyncTracking("account-b");
		await first.save(fixture("b-history"));
		expect((await b.reconcile(null)).entries.map(entry => entry.id)).toEqual(["b-history"]);
		await a.bind();
		first.sessions.enableAccountSyncTracking("account-a");
		expect((await a.reconcile(null)).entries.map(entry => entry.id)).toEqual(["a-history"]);
		expect(await first.sessions.loadSession("a-history")).not.toBeNull();
		expect(await first.sessions.loadSession("b-history")).not.toBeNull();
	});

	it("retains local deletions as tombstones through reopening and stale remote replay", async () => {
		const first = device();
		const local = new BrowserChatSyncLocalStore(first.backend, "account-a", "device-a");
		await local.bind();
		first.sessions.enableAccountSyncTracking("account-a");
		await first.save(fixture("deleted"));
		const before = await local.reconcile(null);
		await first.sessions.deleteSession("deleted");
		const reopened = new BrowserChatSyncLocalStore(first.backend, "account-a", "device-a");
		await reopened.bind();
		const deleted = await reopened.reconcile(before);
		expect(deleted.entries).toHaveLength(1);
		expect(deleted.entries[0]?.session).toBeNull();
		expect(await first.sessions.loadSession("deleted")).toBeNull();
	});

	it("rejects another account's colliding remote ID without replacing local data", async () => {
		const first = device();
		await first.save(fixture("same-id", "Account A private transcript"));
		const a = new BrowserChatSyncLocalStore(first.backend, "account-a", "device-a");
		await a.bind();
		await a.reconcile(null);
		const b = new BrowserChatSyncLocalStore(first.backend, "account-b", "device-a");
		await b.bind();
		const remote = updateChatSyncState(emptyChatSyncState(), [fixture("same-id", "Account B remote transcript")], "device-b", []);
		await expect(b.reconcile(remote)).rejects.toThrow("another account");
		expect((await first.sessions.loadSession("same-id"))?.messages).toEqual(fixture("same-id", "Account A private transcript").data.messages);
	});

	it("aborts all downloaded writes if sign-out happens during materialization", async () => {
		const first = device();
		let current = true;
		let imported = 0;
		const baseTransaction = first.backend.transaction.bind(first.backend);
		const wrapped = new Proxy(first.backend, {
			get(target, property) {
				if (property === "transaction") return ((stores, mode, operation) => baseTransaction(stores, mode, tx => operation({
					...tx, set: async (store, key, value) => { await tx.set(store, key, value); if (store === "sessions") current = false; },
				}))) as StorageBackend["transaction"];
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const local = new BrowserChatSyncLocalStore(wrapped, "account-a", "device-a", () => current, () => { imported += 1; });
		await local.bind();
		const remote = updateChatSyncState(emptyChatSyncState(), [fixture("remote")], "device-b", []);
		await expect(local.reconcile(remote)).rejects.toThrow("account changed");
		expect(await first.sessions.loadSession("remote")).toBeNull();
		expect(await first.sessions.getMetadata("remote")).toBeNull();
		expect(imported).toBe(0);
	});

	it("attributes a save to the account active when the save began", async () => {
		const first = device();
		const local = new BrowserChatSyncLocalStore(first.backend, "account-a", "device-a");
		await local.bind();
		first.sessions.enableAccountSyncTracking("account-a");
		const baseTransaction = first.backend.transaction.bind(first.backend);
		const wrapped = new Proxy(first.backend, {
			get(target, property) {
				if (property === "transaction") return ((stores, mode, operation) => baseTransaction(stores, mode, tx => operation({
					...tx, set: async (store, key, value) => { await tx.set(store, key, value); if (store === "sessions") first.sessions.enableAccountSyncTracking("account-b"); },
				}))) as StorageBackend["transaction"];
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		first.sessions.setBackend(wrapped);
		await first.save(fixture("in-flight"));
		expect((await first.backend.get<ChatSyncJournal>("settings", CHAT_SYNC_JOURNAL_KEY))?.owners["in-flight"]).toBe("account-a");
	});
});
