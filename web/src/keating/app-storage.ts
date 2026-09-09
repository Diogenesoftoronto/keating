import type { Model } from "@earendil-works/pi-ai";
import type { StorageBackend, StoreConfig } from "../types";
import type { SessionData, SessionMetadata } from "../types/session";

export type AutoDiscoveryProviderType = "ollama" | "llama.cpp" | "vllm" | "lmstudio";
export type CustomProviderType = AutoDiscoveryProviderType | "openai-completions" | "openai-responses" | "anthropic-messages";
export interface CustomProvider {
	id: string;
	name: string;
	type: CustomProviderType;
	baseUrl: string;
	apiKey?: string;
	models?: Model<any>[];
}

/** Keating's existing IndexedDB and desktop stores share this domain API.
 * Store names, keys, and indices remain stable so existing installations need
 * no migration when the UI implementation changes.
 */
class KeyValueStore<T> {
	private backend: StorageBackend | undefined;
	constructor(protected readonly name: string) {}
	setBackend(backend: StorageBackend): void { this.backend = backend; }
	protected getBackend(): StorageBackend {
		if (!this.backend) throw new Error(`Backend not set on ${this.constructor.name}`);
		return this.backend;
	}
	getConfig(): StoreConfig { return { name: this.name }; }
	get(key: string): Promise<T | null> { return this.getBackend().get<T>(this.name, key); }
	delete(key: string): Promise<void> { return this.getBackend().delete(this.name, key); }
	has(key: string): Promise<boolean> { return this.getBackend().has(this.name, key); }
	list(): Promise<string[]> { return this.getBackend().keys(this.name); }
}

export class SettingsStore extends KeyValueStore<unknown> {
	constructor() { super("settings"); }
	override get<T = unknown>(key: string): Promise<T | null> { return this.getBackend().get<T>(this.name, key); }
	set<T>(key: string, value: T): Promise<void> { return this.getBackend().set(this.name, key, value); }
	clear(): Promise<void> { return this.getBackend().clear(this.name); }
}

export class ProviderKeysStore extends KeyValueStore<string> {
	constructor() { super("provider-keys"); }
	set(provider: string, key: string): Promise<void> { return this.getBackend().set(this.name, provider, key); }
}

export class CustomProvidersStore extends KeyValueStore<CustomProvider> {
	constructor() { super("custom-providers"); }
	set(provider: CustomProvider): Promise<void> { return this.getBackend().set(this.name, provider.id, provider); }
	async getAll(): Promise<CustomProvider[]> {
		const providers = await Promise.all((await this.list()).map((key) => this.get(key)));
		return providers.filter((provider): provider is CustomProvider => provider !== null);
	}
}

export class SessionsStore extends KeyValueStore<SessionData> {
	constructor() { super("sessions"); }
	override getConfig(): StoreConfig {
		return { name: this.name, keyPath: "id", indices: [{ name: "lastModified", keyPath: "lastModified" }] };
	}
	static getMetadataConfig(): StoreConfig {
		return { name: "sessions-metadata", keyPath: "id", indices: [{ name: "lastModified", keyPath: "lastModified" }] };
	}
	save(data: SessionData, metadata: SessionMetadata): Promise<void> {
		return this.getBackend().transaction([this.name, "sessions-metadata"], "readwrite", async (tx) => {
			await tx.set(this.name, data.id, data);
			await tx.set("sessions-metadata", metadata.id, metadata);
		});
	}
	loadSession(id: string): Promise<SessionData | null> { return this.get(id); }
	getMetadata(id: string): Promise<SessionMetadata | null> { return this.getBackend().get("sessions-metadata", id); }
	getAllMetadata(): Promise<SessionMetadata[]> {
		return this.getBackend().getAllFromIndex("sessions-metadata", "lastModified", "desc");
	}
	async getLatestSessionId(): Promise<string | null> { return (await this.getAllMetadata())[0]?.id ?? null; }
	override delete(id: string): Promise<void> {
		return this.getBackend().transaction([this.name, "sessions-metadata"], "readwrite", async (tx) => {
			await tx.delete(this.name, id);
			await tx.delete("sessions-metadata", id);
		});
	}
	deleteSession(id: string): Promise<void> { return this.delete(id); }
	updateTitle(id: string, title: string): Promise<void> {
		return this.getBackend().transaction([this.name, "sessions-metadata"], "readwrite", async (tx) => {
			const data = await tx.get<SessionData>(this.name, id);
			const metadata = await tx.get<SessionMetadata>("sessions-metadata", id);
			if (data) await tx.set(this.name, id, { ...data, title });
			if (metadata) await tx.set("sessions-metadata", id, { ...metadata, title });
		});
	}
	getQuotaInfo() { return this.getBackend().getQuotaInfo(); }
	requestPersistence() { return this.getBackend().requestPersistence(); }
}

export class AppStorage {
	constructor(
		readonly settings: SettingsStore,
		readonly providerKeys: ProviderKeysStore,
		readonly sessions: SessionsStore,
		readonly customProviders: CustomProvidersStore,
		readonly backend: StorageBackend,
	) {}
	getQuotaInfo() { return this.backend.getQuotaInfo(); }
	requestPersistence() { return this.backend.requestPersistence(); }
}

let appStorage: AppStorage | undefined;
export function getAppStorage(): AppStorage {
	if (!appStorage) throw new Error("AppStorage not initialized. Call setAppStorage() first.");
	return appStorage;
}
export function setAppStorage(storage: AppStorage): void { appStorage = storage; }
