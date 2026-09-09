import { afterEach, beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { type CustomProvider, AppStorage, CustomProvidersStore, ProviderKeysStore, SessionsStore, SettingsStore } from "../keating/app-storage";
import { IndexedDBStorageBackend } from "../lib/cloud-storage-backend";
import { P2PStorageBackend } from "../lib/p2p-storage-backend";
import type { StorageBackend, StoreConfig } from "../types";
import type { SessionData, SessionMetadata } from "../types/session";

let original: PropertyDescriptor | undefined;
beforeEach(() => {
	original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
	Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
});
afterEach(() => {
	if (original) Object.defineProperty(globalThis, "indexedDB", original);
	else Reflect.deleteProperty(globalThis, "indexedDB");
});

// Persisted schema predates this module: keep this fixture independent of its configs.
const legacyStores: StoreConfig[] = [
	{ name: "settings" }, { name: "provider-keys" }, { name: "custom-providers" },
	{ name: "sessions", keyPath: "id", indices: [{ name: "lastModified", keyPath: "lastModified" }] },
	{ name: "sessions-metadata", keyPath: "id", indices: [{ name: "lastModified", keyPath: "lastModified" }] },
];
function storage(backend: StorageBackend): AppStorage {
	const stores = [new SettingsStore(), new ProviderKeysStore(), new SessionsStore(), new CustomProvidersStore()] as const;
	for (const store of stores) store.setBackend(backend);
	return new AppStorage(...stores, backend);
}
function backend(): IndexedDBStorageBackend {
	return new IndexedDBStorageBackend({ dbName: "keating", version: 2, stores: legacyStores });
}

test("existing settings, serialized OAuth credentials and custom providers survive reopening", async () => {
	const previous = backend();
	const oauth = JSON.stringify({ type: "oauth", access: "fixture-access", refresh: "fixture-refresh", expires: 123 });
	const provider: CustomProvider = { id: "local", name: "Local", type: "ollama", baseUrl: "http://localhost:11434" };
	await previous.set("settings", "theme", "dark");
	await previous.set("settings", "oauth-state", { state: "fixture-state" });
	await previous.set("provider-keys", "openai-codex", oauth);
	await previous.set("custom-providers", "local", provider);
	const app = storage(backend());
	expect(await app.settings.get<string>("theme")).toBe("dark");
	expect(await app.settings.get<{ state: string }>("oauth-state")).toEqual({ state: "fixture-state" });
	expect(await app.providerKeys.get("openai-codex")).toBe(oauth);
	expect(await app.customProviders.getAll()).toEqual([provider]);
	await app.settings.set("theme", "light");
	await app.providerKeys.set("openai-codex", "updated-fixture");
	expect(await previous.get<string>("settings", "theme")).toBe("light");
	expect(await previous.get<string>("provider-keys", "openai-codex")).toBe("updated-fixture");
});

test("legacy session fields survive reads, rename, save and paired deletion", async () => {
	const previous = backend();
	const data = { id: "fork", title: "Before", messages: [], lastModified: "2026-09-08", parentSessionId: "source", generatedAlternative: true } as unknown as SessionData;
	const metadata = { id: "fork", title: "Before", lastModified: "2026-09-08", hiddenAlternative: true, searchText: "preserve corpus" } as SessionMetadata;
	await previous.set("sessions", "fork", data);
	await previous.set("sessions-metadata", "fork", metadata);
	await previous.set("sessions-metadata", "older", { ...metadata, id: "older", lastModified: "2026-09-07" });
	const app = storage(backend());
	expect(await app.sessions.loadSession("fork")).toEqual(data);
	expect((await app.sessions.getAllMetadata()).map((entry) => entry.id)).toEqual(["fork", "older"]);
	expect(await app.sessions.getLatestSessionId()).toBe("fork");
	await app.sessions.updateTitle("fork", "After");
	expect(await app.sessions.get("fork")).toEqual({ ...data, title: "After" });
	expect(await app.sessions.getMetadata("fork")).toEqual({ ...metadata, title: "After" });
	await app.sessions.save({ ...data, title: "Saved" }, { ...metadata, title: "Saved" });
	expect(await previous.get<SessionMetadata>("sessions-metadata", "fork")).toEqual({ ...metadata, title: "Saved" });
	await app.sessions.deleteSession("fork");
	expect(await previous.get("sessions", "fork")).toBeNull();
	expect(await previous.get<SessionMetadata>("sessions-metadata", "fork")).toBeNull();
});

test("desktop provider credentials remain on the secure bridge, outside replicated storage", async () => {
	const credentials = new Map<string, string>([["openai-codex", "existing-fixture"]]);
	const calls: string[] = [];
	const app = storage(new P2PStorageBackend({
		async call<T>(method: string): Promise<T> { calls.push(method); throw new Error("Credentials must not reach P2P"); },
		onPeerStats: () => () => {},
	}, {
		get: async (id) => credentials.get(id) ?? null,
		set: async (id, value) => { credentials.set(id, value); },
		delete: async (id) => { credentials.delete(id); },
		keys: async () => [...credentials.keys()],
		has: async (id) => credentials.has(id),
		clear: async () => { credentials.clear(); },
	}));
	expect(await app.providerKeys.get("openai-codex")).toBe("existing-fixture");
	await app.providerKeys.set("openai-codex", "renewed-fixture");
	expect(await app.providerKeys.list()).toEqual(["openai-codex"]);
	expect(await app.providerKeys.has("openai-codex")).toBe(true);
	await app.providerKeys.delete("openai-codex");
	expect(credentials.size).toBe(0);
	expect(calls).toEqual([]);
});
