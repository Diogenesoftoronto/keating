/** Shared configuration + value types for the Keating P2P core. */

/**
 * Identifies one logical replication group. Every device belonging to the same
 * user — plus that user's cloud seeder — joins the same topic and replicates.
 *
 * Derive the topic from a per-user secret (see {@link deriveTopic}); never use a
 * guessable plaintext string, or unrelated peers could join.
 */
export type Topic = Uint8Array; // 32 bytes

export interface P2PCoreConfig {
  /**
   * Directory where Corestore persists Hypercore data (the primary on-disk
   * store). For Electron use `app.getPath('userData')`; for the seeder a stable
   * volume path.
   *
   * Optional: in the browser there is no filesystem path, so pass a
   * {@link P2PCoreConfig.createStore} factory instead (which builds a Corestore
   * over browser storage such as IndexedDB). Exactly one of `storageDir` or
   * `createStore` must be supplied.
   */
  storageDir?: string;
  /**
   * 32-byte secret used ONLY to derive the swarm topic. Same secret across a
   * user's devices = same replication group.
   *
   * IMPORTANT: the secret must NOT be used to derive this node's writable
   * Hypercore keypair. Hyperbee/Hypercore is single-writer per core, so every
   * device owning the same keypair would fork/corrupt the log. Each device
   * gets its own persistent writer identity from its local Corestore seed
   * (v1: "single-writer per device"). See the Autobase seam in `store.ts` for
   * true multi-writer.
   */
  userSecret: Uint8Array;
  /** Optional human label for logs (e.g. "desktop:macbook", "seeder:fly-iad"). */
  label?: string;
  /** When true this node only seeds/replicates and never writes (the cloud node). */
  seedOnly?: boolean;
  /**
   * Name of this node's writable core inside the Corestore. Defaults to
   * `"keating-bee"`. The writer *identity* comes from the local Corestore seed
   * (per device), NOT from this name — so a stable name is fine and keeps the
   * store durable across restarts.
   */
  deviceName?: string;
  /**
   * Optional factory that builds the underlying Corestore. When omitted, the
   * Node default is used (`new Corestore(storageDir)`, dynamically imported so
   * browser bundles that inject their own store never pull the Node-only
   * `corestore`/`rocksdb-native` dependency).
   *
   * The browser supplies this to back Corestore with browser storage (e.g.
   * `random-access-idb` / a `hypercore-storage` IndexedDB engine).
   */
  createStore?: CreateStore;
  /**
   * Optional swarm factory used to join the replication topic. When omitted,
   * the Node default (`hyperswarm`, dynamically imported) is used. The browser
   * supplies a relay-based transport here (raw UDP/DHT is unavailable in the
   * browser), e.g. `hyperswarm-web` or `@hyperswarm/dht-relay` over WebSocket.
   */
  joinSwarm?: import("./swarm.js").SwarmFactory;
}

/**
 * The minimal Corestore surface {@link P2PStore} depends on. Both the Node
 * `corestore` and any browser-backed equivalent must satisfy this so the writer
 * is environment-agnostic.
 */
export interface CorestoreLike {
  ready(): Promise<void>;
  get(opts: { name?: string; key?: Uint8Array }): {
    ready(): Promise<void>;
  };
  replicate(socket: unknown): unknown;
  close(): Promise<void>;
}

/** Builds the Corestore used by {@link P2PStore.open}. May be async. */
export type CreateStore = (
  config: P2PCoreConfig,
) => CorestoreLike | Promise<CorestoreLike>;

/** Connection/replication stats surfaced to the UI. */
export interface PeerStats {
  topicHex: string;
  peers: number;
  /** Hypercore length of this node's writable bee. */
  writableLength: number;
  /** True once at least one peer (incl. seeder) has been seen. */
  connected: boolean;
}

/** A single put/del mutation, used by batch + transaction paths. */
export type Mutation =
  | { type: "put"; store: string; key: string; value: unknown }
  | { type: "del"; store: string; key: string };
