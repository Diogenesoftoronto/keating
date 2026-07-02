/**
 * Storage abstraction shared by every Keating storage backend
 * (IndexedDB in the browser, P2P/Hyperbee in the Electron desktop app).
 *
 * Keeping the React app coded against this interface — rather than against
 * IndexedDB directly — is what lets the desktop build swap in a peer-to-peer
 * backing store transparently. See docs/p2p-electron-plan.md.
 */

/** A single object store (table) inside a backend. */
export interface StoreIndexConfig {
	name: string;
	keyPath: string | string[];
	unique?: boolean;
}

export interface StoreConfig {
	name: string;
	keyPath?: string;
	autoIncrement?: boolean;
	indices?: StoreIndexConfig[];
}

/** Configuration for the IndexedDB backend. */
export interface IndexedDBConfig {
	dbName: string;
	version: number;
	stores: StoreConfig[];
}

/**
 * The handle handed to a {@link StorageBackend.transaction} callback. All
 * operations execute inside the same underlying transaction.
 */
export interface StorageTransaction {
	get<T = unknown>(storeName: string, key: string): Promise<T | null>;
	set<T = unknown>(storeName: string, key: string, value: T): Promise<void>;
	delete(storeName: string, key: string): Promise<void>;
}

export interface QuotaInfo {
	usage: number;
	quota: number;
	percent: number;
}

/**
 * Pluggable storage backend. Implemented by `IndexedDBStorageBackend`
 * (browser) and `P2PStorageBackend` (Electron, over IPC to packages/p2p-core).
 */
export interface StorageBackend {
	get<T = unknown>(storeName: string, key: string): Promise<T | null>;
	set<T = unknown>(storeName: string, key: string, value: T): Promise<void>;
	delete(storeName: string, key: string): Promise<void>;
	keys(storeName: string, prefix?: string): Promise<string[]>;
	getAllFromIndex<T = unknown>(
		storeName: string,
		indexName: string,
		direction?: "asc" | "desc",
	): Promise<T[]>;
	clear(storeName: string): Promise<void>;
	has(storeName: string, key: string): Promise<boolean>;
	transaction<T>(
		storeNames: string[],
		mode: "readonly" | "readwrite",
		operation: (tx: StorageTransaction) => Promise<T>,
	): Promise<T>;
	getQuotaInfo(): Promise<QuotaInfo>;
	requestPersistence(): Promise<boolean>;
}
