import type { P2PStore } from "./store.js";
import type { Mutation } from "./types.js";

/**
 * Minimal structural copy of web/src/types.ts `StorageBackend`. Duplicated here
 * (rather than imported) so this Node package has no dependency on the web app.
 * Keep the two in sync.
 */
export interface StorageBackendLike {
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
		operation: (tx: {
			get<T2 = unknown>(storeName: string, key: string): Promise<T2 | null>;
			set<T2 = unknown>(storeName: string, key: string, value: T2): Promise<void>;
			delete(storeName: string, key: string): Promise<void>;
		}) => Promise<T>,
	): Promise<T>;
	getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }>;
	requestPersistence(): Promise<boolean>;
}

/**
 * Adapt a {@link P2PStore} to the Keating `StorageBackend` interface so the
 * existing app code can use the P2P store unchanged.
 *
 * Notes on the mapping:
 *  - `getAllFromIndex` has no native Hyperbee secondary index, so we materialize
 *    the store values and sort them by the requested field.
 *  - `transaction` buffers reads via the live store and collects writes into a
 *    single `P2PStore.batch` applied after the operation callback resolves
 *    (readwrite) — giving atomicity on commit.
 *  - `getQuotaInfo` reports on-disk usage; `requestPersistence` is a no-op true
 *    on the desktop (data is already persisted to disk).
 */
export function createP2PStorageBackend(store: P2PStore): StorageBackendLike {
	async function dirUsageBytes(dir: string): Promise<number> {
		try {
			const { statfs } = await import("node:fs/promises");
			const { stat, readdir } = await import("node:fs/promises");
			const { join } = await import("node:path");

			let total = 0;
			const stack: string[] = [dir];
			while (stack.length) {
				const current = stack.pop() as string;
				let entries: string[];
				try {
					entries = await readdir(current);
				} catch {
					continue;
				}
				for (const name of entries) {
					const p = join(current, name);
					try {
						const s = await stat(p);
						if (s.isDirectory()) stack.push(p);
						else if (s.isFile()) total += s.size;
					} catch {
						// ignore
					}
				}
			}
			void statfs;
			return total;
		} catch {
			return 0;
		}
	}

	// Resolve the on-disk root once; best-effort. Falls back to 0 bytes when
	// the platform hides the directory or it does not exist yet.
	let storageRoot: string | null = null;
	try {
		// P2PStore keeps storageDir private; we don't expose it, so attempt to
		// infer from the corestore. If unreachable, quota is reported as zero.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cs = (store as unknown as { coreStore?: { _path?: string; directory?: string } })
			.coreStore;
		storageRoot =
			cs && (cs.directory || cs._path) ? (cs.directory || cs._path) || null : null;
	} catch {
		storageRoot = null;
	}

	const backend: StorageBackendLike = {
		async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
			return store.get<T>(storeName, key);
		},

		async set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
			await store.set<T>(storeName, key, value);
		},

		async delete(storeName: string, key: string): Promise<void> {
			await store.del(storeName, key);
		},

		async keys(storeName: string, prefix?: string): Promise<string[]> {
			return store.keys(storeName, prefix);
		},

		async getAllFromIndex<T = unknown>(
			storeName: string,
			indexName: string,
			direction: "asc" | "desc" = "asc",
		): Promise<T[]> {
			const keys = await store.keys(storeName);
			const values: T[] = [];
			for (const key of keys) {
				const v = await store.get<T>(storeName, key);
				if (v !== null) values.push(v);
			}
			const sorted = values.sort((left, right) => {
				const a =
					left && typeof left === "object"
						? (left as Record<string, unknown>)[indexName]
						: undefined;
				const b =
					right && typeof right === "object"
						? (right as Record<string, unknown>)[indexName]
						: undefined;
				if (a === b) return 0;
				if (a === undefined) return 1;
				if (b === undefined) return -1;
				const leftKey = typeof a === "string" || typeof a === "number" ? a : String(a);
				const rightKey =
					typeof b === "string" || typeof b === "number" ? b : String(b);
				return leftKey < rightKey ? -1 : 1;
			});
			if (direction === "desc") {
				sorted.reverse();
			}
			return sorted;
		},

		async clear(storeName: string): Promise<void> {
			await store.clear(storeName);
		},

		async has(storeName: string, key: string): Promise<boolean> {
			const v = await store.get(storeName, key);
			return v !== null;
		},

		async transaction<T>(
			_storeNames: string[],
			mode: "readonly" | "readwrite",
			operation: (tx: {
				get<T2 = unknown>(storeName: string, key: string): Promise<T2 | null>;
				set<T2 = unknown>(storeName: string, key: string, value: T2): Promise<void>;
				delete(storeName: string, key: string): Promise<void>;
			}) => Promise<T>,
		): Promise<T> {
			const pending: Mutation[] = [];
			const tx = {
				async get<T2 = unknown>(storeName: string, key: string): Promise<T2 | null> {
					return store.get<T2>(storeName, key);
				},
				async set<T2 = unknown>(storeName: string, key: string, value: T2): Promise<void> {
					if (mode !== "readwrite") {
						throw new Error("P2PStorageBackend: cannot write in a readonly transaction");
					}
					pending.push({ type: "put", store: storeName, key, value });
				},
				async delete(storeName: string, key: string): Promise<void> {
					if (mode !== "readwrite") {
						throw new Error("P2PStorageBackend: cannot delete in a readonly transaction");
					}
					pending.push({ type: "del", store: storeName, key });
				},
			};

			let result: T;
			try {
				result = await operation(tx);
			} catch (err) {
				// Drop pending mutations on error so we don't apply a partial batch.
				pending.length = 0;
				throw err;
			}

			if (mode === "readwrite" && pending.length > 0) {
				await store.batch(pending);
			}
			return result;
		},

		async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
			let usage = 0;
			if (storageRoot) usage = await dirUsageBytes(storageRoot);
			// Pick a generous desktop quota. StorageBackend doesn't surface a way
			// for the renderer to override this; we pick something reasonable.
			const quota = 50 * 1024 * 1024 * 1024; // 50 GiB
			const percent = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;
			return { usage, quota, percent };
		},

		async requestPersistence(): Promise<boolean> {
			// On the desktop, data is already persisted to disk; nothing to ask.
			return true;
		},
	};

	return backend;
}
