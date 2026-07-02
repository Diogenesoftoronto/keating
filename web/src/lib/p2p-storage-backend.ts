import type {
	QuotaInfo,
	StorageBackend,
	StorageTransaction,
} from "../types.js";

/**
 * The narrow API the Electron preload exposes on `window.keatingP2P`. Mirror of
 * KeatingP2PBridge in desktop/src/preload.ts (kept structural so web/ has no
 * dependency on the desktop package).
 */
export interface KeatingP2PBridge {
	call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
	): Promise<T>;
	onPeerStats(listener: (stats: unknown) => void): () => void;
}

declare global {
	interface Window {
		keatingP2P?: KeatingP2PBridge;
	}
}

/** True when running inside the Electron desktop shell. */
export function hasP2PBackend(): boolean {
	return typeof window !== "undefined" && !!window.keatingP2P;
}

/**
 * StorageBackend implementation that proxies every operation to the Electron
 * main process (which owns the Hyperbee/Hyperswarm P2PStore) over the preload
 * IPC bridge. Drop-in replacement for IndexedDBStorageBackend.
 *
 * The transaction adapter buffers reads (live, via `get`) and writes (into a
 * single `batch` call applied on commit) so the whole operation is atomic on
 * the main-process side.
 *
 * Methods map directly onto the main-process rpc.ts contract:
 *   get → call("get", { storeName, key })
 *   set → call("set", { storeName, key, value })
 *   delete → call("delete", { storeName, key })
 *   keys → call("keys", { storeName, prefix })
 *   getAllFromIndex → call("getAllFromIndex", { storeName, indexName, direction })
 *   clear → call("clear", { storeName })
 *   has → call("has", { storeName, key })
 *   getQuotaInfo → call("quota")
 *   requestPersistence → call("requestPersistence")
 *   transaction → collect mutations from the operation callback, then
 *     call("batch", { mutations }); reads inside go straight through `get`.
 */
export class P2PStorageBackend implements StorageBackend {
	constructor(private readonly bridge: KeatingP2PBridge) {}

	get<T = unknown>(storeName: string, key: string): Promise<T | null> {
		return this.bridge.call<T | null>("get", { storeName, key });
	}

	set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
		return this.bridge.call<void>("set", { storeName, key, value });
	}

	delete(storeName: string, key: string): Promise<void> {
		return this.bridge.call<void>("delete", { storeName, key });
	}

	keys(storeName: string, prefix?: string): Promise<string[]> {
		return this.bridge.call<string[]>("keys", { storeName, prefix });
	}

	getAllFromIndex<T = unknown>(
		storeName: string,
		indexName: string,
		direction: "asc" | "desc" = "asc",
	): Promise<T[]> {
		return this.bridge.call<T[]>("getAllFromIndex", {
			storeName,
			indexName,
			direction,
		});
	}

	clear(storeName: string): Promise<void> {
		return this.bridge.call<void>("clear", { storeName });
	}

	has(storeName: string, key: string): Promise<boolean> {
		return this.bridge.call<boolean>("has", { storeName, key });
	}

	async transaction<T>(
		_storeNames: string[],
		mode: "readonly" | "readwrite",
		operation: (tx: StorageTransaction) => Promise<T>,
	): Promise<T> {
		const mutations: Array<
			| { type: "put"; store: string; key: string; value: unknown }
			| { type: "del"; store: string; key: string }
		> = [];
		const tx: StorageTransaction = {
			get: <T2 = unknown>(storeName: string, key: string) => this.get<T2>(storeName, key),
			set: async <T2 = unknown>(storeName: string, key: string, value: T2) => {
				if (mode !== "readwrite") {
					throw new Error("P2PStorageBackend: cannot write in readonly transaction");
				}
				mutations.push({ type: "put", store: storeName, key, value });
			},
			delete: async (storeName: string, key: string) => {
				if (mode !== "readwrite") {
					throw new Error("P2PStorageBackend: cannot delete in readonly transaction");
				}
				mutations.push({ type: "del", store: storeName, key });
			},
		};
		const result = await operation(tx);
		if (mode === "readwrite" && mutations.length > 0) {
			await this.bridge.call<void>("batch", { mutations });
		}
		return result;
	}

	getQuotaInfo(): Promise<QuotaInfo> {
		return this.bridge.call<QuotaInfo>("quota");
	}

	requestPersistence(): Promise<boolean> {
		return this.bridge.call<boolean>("requestPersistence");
	}
}
