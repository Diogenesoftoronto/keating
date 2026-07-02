import b4a from "b4a";
import type Hyperbee from "hyperbee";
import type { CorestoreLike, P2PCoreConfig, PeerStats } from "./types.js";
import {
	deriveTopic,
	joinSwarm,
	type SwarmFactory,
	type SwarmHandle,
} from "./swarm.js";

/** Default writable-core name inside the Corestore. */
const DEFAULT_DEVICE_NAME = "keating-bee";

/**
 * Default (Node/desktop/seeder) Corestore factory. Dynamically imports
 * `corestore` so browser bundles that inject their own store never pull the
 * Node-only `corestore`/`rocksdb-native` dependency into the graph.
 *
 * NOTE: we intentionally do NOT pass `primaryKey` derived from the user secret.
 * Corestore persists its own per-device seed (random on first run), which gives
 * each device a distinct writer identity — the single-writer-per-device model.
 */
async function defaultCreateStore(
	config: P2PCoreConfig,
): Promise<CorestoreLike> {
	if (!config.storageDir) {
		throw new Error(
			"P2PStore.open: config.storageDir is required unless config.createStore is provided",
		);
	}
	const { default: Corestore } = await import("corestore");
	const CorestoreCtor = Corestore as unknown as new (
		storage: string,
	) => CorestoreLike;
	return new CorestoreCtor(config.storageDir);
}

/**
 * One synced key/value entry. Keys are namespaced by store as
 * `${store}\x00${key}` so a single Hyperbee can back many logical stores while
 * keeping prefix scans (per-store `keys()`) cheap.
 */
export const STORE_KEY_SEP = "\x00";

export function encodeKey(store: string, key: string): string {
	return `${store}${STORE_KEY_SEP}${key}`;
}

export function decodeKey(encoded: string): { store: string; key: string } {
	const i = encoded.indexOf(STORE_KEY_SEP);
	if (i === -1) return { store: "", key: encoded };
	return { store: encoded.slice(0, i), key: encoded.slice(i + 1) };
}

/**
 * P2PStore: a Hyperbee-backed KV store that replicates over Hyperswarm.
 *
 * v1 is single-writer per device: each device (and the seeder) owns its OWN
 * writable Hypercore, whose keypair comes from that node's local Corestore seed
 * — NOT from the shared user secret. The user secret only derives the swarm
 * topic, so all of a user's devices join the same replication group while each
 * appends to its own core (no forked/corrupted single-writer log).
 *
 * Environment-agnostic: the underlying Corestore and swarm transport are
 * injectable via `config.createStore` / `config.joinSwarm`, so the identical
 * writer runs in the Node/Electron main process, the headless seeder, AND the
 * browser (IndexedDB-backed store + relay transport). When those factories are
 * omitted, Node defaults are used and the Node-only deps are imported lazily.
 *
 * TODO(crush) — Autobase seam: to support multiple devices writing the SAME
 * logical store, replace the single writable bee with an Autobase whose inputs
 * are each device's core, linearized into one view bee. Keep this class's public
 * surface identical so storage-adapter.ts and IPC don't change.
 */
export class P2PStore {
	private swarm: SwarmHandle | null = null;
	private readonly statsListeners = new Set<(stats: PeerStats) => void>();

	// Internal state populated by P2PStore.open.
	private coreStore: unknown = null;
	private bee: unknown = null;
	private topic: Uint8Array | null = null;
	private seedOnly: boolean;
	private everConnected: boolean = false;

	private constructor(private readonly config: P2PCoreConfig) {
		this.seedOnly = !!config.seedOnly;
	}

	private requireBee(): Hyperbee {
		if (!this.bee || !this.topic) {
			throw new Error("P2PStore: store not open");
		}
		return this.bee as Hyperbee;
	}

	private requireCoreStore(): CorestoreLike {
		if (!this.coreStore) {
			throw new Error("P2PStore: store not open");
		}
		return this.coreStore as CorestoreLike;
	}

	private assertWritable(action: string): void {
		if (this.seedOnly) {
			throw new Error(`P2PStore: ${action} rejected - seedOnly mode`);
		}
	}

	private emitStats(): void {
		const stats = this.stats();
		for (const listener of this.statsListeners) {
			try {
				listener(stats);
			} catch {
				// ignore listener failures
			}
		}
	}

	/**
	 * Open the Corestore at `config.storageDir`, create/load the writable bee,
	 * derive the topic, and join the swarm wiring replication.
	 *
	 * Environment-agnostic: pass `config.createStore` (browser IndexedDB-backed
	 * Corestore) and `config.joinSwarm` (browser relay transport) to run the
	 * exact same writer in the browser. When omitted, Node defaults are used
	 * (lazily imported so a browser bundle never pulls Node-only deps).
	 */
	static async open(config: P2PCoreConfig): Promise<P2PStore> {
		const self = new P2PStore(config);

		const createStore = config.createStore ?? defaultCreateStore;
		const store = await createStore(config);
		await store.ready();
		// Each device owns a distinct writable core. The core NAME is stable
		// ("keating-bee" by default) so the store is durable across restarts, but
		// the writer KEYPAIR is derived from the Corestore's own per-device seed,
		// NOT from the shared user secret. This preserves single-writer-per-core.
		const core = store.get({ name: config.deviceName ?? DEFAULT_DEVICE_NAME });
		await core.ready();

		const { default: Hyperbee } = await import("hyperbee");
		const bee = new Hyperbee(core, {
			keyEncoding: "utf-8",
			valueEncoding: "json",
		});
		await bee.ready();

		if (config.seedOnly) {
			// The cloud seeder never writes; prevent any accidental mutations.
			try {
				(bee as { readonly?: boolean }).readonly = true;
			} catch {
				// ignore if not writable
			}
		}

		// The user secret is used ONLY to derive the shared swarm topic.
		const topic = deriveTopic(config.userSecret);

		self.coreStore = store;
		self.bee = bee;
		self.topic = topic;
		const joinSwarmFactory: SwarmFactory = config.joinSwarm ?? joinSwarm;
		self.swarm = await joinSwarmFactory(topic, (socket) => {
			store.replicate(socket);
		});
		self.swarm.onPeerChange((count) => {
			if (count > 0) self.everConnected = true;
			self.emitStats();
		});

		await self.swarm.ready();
		self.emitStats();
		return self;
	}

	/** Read a value, or null if absent. */
	async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
		const bee = this.requireBee();
		const entry = await bee.get(encodeKey(storeName, key));
		if (!entry || entry.value === null || entry.value === undefined) {
			return null;
		}
		return entry.value as T;
	}

	/** Write a value. Rejects if config.seedOnly. */
	async set<T = unknown>(storeName: string, key: string, value: T): Promise<void> {
		this.assertWritable("write");
		const bee = this.requireBee();
		await bee.put(encodeKey(storeName, key), value as unknown);
		this.emitStats();
	}

	/** Delete a key. */
	async del(storeName: string, key: string): Promise<void> {
		this.assertWritable("delete");
		const bee = this.requireBee();
		const entry = await bee.get(encodeKey(storeName, key));
		if (!entry) return;
		await bee.del(encodeKey(storeName, key));
		this.emitStats();
	}

	/**
	 * List keys in a store, optionally filtered by `prefix`.
	 */
	async keys(storeName: string, prefix?: string): Promise<string[]> {
		const bee = this.requireBee();
		const lo = encodeKey(storeName, prefix ?? "");
		const hi = encodeKey(storeName, `${prefix ?? ""}\uffff`);
		const out: string[] = [];
		const stream = bee.createReadStream({ gte: lo, lt: hi });
		for await (const entry of stream as AsyncIterable<{ key: string }>) {
			out.push(decodeKey(entry.key).key);
		}
		return out;
	}

	/** Delete every key in a store. */
	async clear(storeName: string): Promise<void> {
		this.assertWritable("clear");
		const bee = this.requireBee();
		const lo = encodeKey(storeName, "");
		const hi = encodeKey(storeName, "\uffff");
		const b = bee.batch();
		const stream = bee.createReadStream({ gte: lo, lt: hi });
		for await (const entry of stream as AsyncIterable<{ key: string }>) {
			await b.del(entry.key);
		}
		await b.flush();
		this.emitStats();
	}

	/**
	 * Atomic batch.
	 */
	async batch(mutations: import("./types.js").Mutation[]): Promise<void> {
		this.assertWritable("batch");
		const bee = this.requireBee();
		const b = bee.batch();
		for (const m of mutations) {
			if (m.type === "put") {
				await b.put(encodeKey(m.store, m.key), m.value as unknown);
			} else {
				await b.del(encodeKey(m.store, m.key));
			}
		}
		await b.flush();
		this.emitStats();
	}

	/** Current replication/peer stats for the UI. */
	stats(): PeerStats {
		const bee = this.requireBee();
		const topicHex = this.topic ? b4a.toString(this.topic, "hex") : "";
		const writableLength = bee.core.length;
		const peers = this.swarm?.peerCount ?? 0;
		return {
			topicHex,
			peers,
			writableLength,
			connected: this.everConnected || peers > 0,
		};
	}

	onStats(listener: (stats: PeerStats) => void): () => void {
		this.statsListeners.add(listener);
		listener(this.stats());
		return () => {
			this.statsListeners.delete(listener);
		};
	}

	/** Flush + close the bee, corestore, and swarm. */
	async close(): Promise<void> {
		if (this.swarm) {
			await this.swarm.destroy();
			this.swarm = null;
		}
		if (this.bee) {
			await (this.bee as { close(): Promise<void> }).close();
			this.bee = null;
		}
		if (this.coreStore) {
			await this.requireCoreStore().close();
			this.coreStore = null;
		}
	}
}
