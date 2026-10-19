/**
 * Epoch-guarded draft persistence shared by the composer and diagram stores.
 *
 * Each store owns one key prefix. Clearing bumps the store's deletion epoch, waits
 * for writes already in flight, then deletes every key under the prefix. A writer
 * remembers the epoch it was created under, so one that was live before a clear
 * (including its unmount or session-switch flush) cannot put deleted work back.
 */

/** The subset of AsyncStorage used by draft stores, so tests can supply an in-memory store. */
export interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export interface DraftWriter<T> {
  /** True while the latest edit has not reached storage. */
  readonly dirty: boolean;
  /** Record an edit; the draft is unsaved until `save` succeeds. */
  noteEdit(): void;
  /** Save now. Marks clean only if nothing was edited while the write ran. Resolves false when dropped. */
  save(content: T): Promise<boolean>;
  /** Teardown: save only genuinely unsaved edits. */
  flush(content: T): Promise<boolean>;
}

/** How one draft kind maps content to a storage write; `null` removes the key instead. */
export type DraftEncoder<T> = (content: T) => string | null;

export interface EpochDraftStore<T> {
  readonly prefix: string;
  currentEpoch(): number;
  /** Resolves true when written, false when dropped because the epoch is stale or a clear is running. */
  save(key: string, content: T, storage: DraftStorage, epoch?: number): Promise<boolean>;
  /** Invalidates every live writer, lets writes already started land, then deletes all drafts under the prefix. */
  clearAll(storage: DraftStorage): Promise<void>;
  /** One writer per mounted editor, bound to the epoch it was created under. */
  createWriter(key: string, storage: DraftStorage): DraftWriter<T>;
}

export function createEpochDraftStore<T>(prefix: string, encode: DraftEncoder<T>): EpochDraftStore<T> {
  let epoch = 0;
  let clearsRunning = 0;
  const writesInFlight = new Set<Promise<unknown>>();

  const store: EpochDraftStore<T> = {
    prefix,
    currentEpoch: () => epoch,
    async save(key, content, storage, writerEpoch = epoch) {
      if (writerEpoch !== epoch || clearsRunning > 0) return false;
      const encoded = encode(content);
      const write = encoded === null ? storage.removeItem(key) : storage.setItem(key, encoded);
      writesInFlight.add(write);
      try { await write; } finally { writesInFlight.delete(write); }
      return true;
    },
    async clearAll(storage) {
      epoch += 1;
      clearsRunning += 1;
      try {
        await Promise.allSettled([...writesInFlight]);
        const keys = (await storage.getAllKeys()).filter((key) => key.startsWith(`${prefix}.`));
        if (keys.length) await storage.multiRemove(keys);
      } finally {
        clearsRunning -= 1;
      }
    },
    createWriter(key, storage) {
      const writerEpoch = epoch;
      let version = 0;
      let savedVersion = 0;
      const writer: DraftWriter<T> = {
        get dirty() { return version !== savedVersion; },
        noteEdit() { version += 1; },
        async save(content) {
          const started = version;
          const written = await store.save(key, content, storage, writerEpoch);
          if (written) savedVersion = Math.max(savedVersion, started);
          return written;
        },
        async flush(content) {
          return writer.dirty ? writer.save(content) : false;
        },
      };
      return writer;
    },
  };
  return store;
}
