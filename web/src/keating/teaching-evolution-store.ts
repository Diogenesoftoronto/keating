import type { EvolutionState, EvolutionStore } from "../../../shared/evolution/loop";

/** Browser-local experiment records. Account synchronization belongs to the account runner API. */
export class BrowserEvolutionStore implements EvolutionStore {
  private database?: Promise<IDBDatabase>;
  private db(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("keating-teaching-evolution", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("records");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  private validateKey(key: string): void {
    if (!/^(state|(?:revisions|raw|experiments|suites)\/[a-zA-Z0-9-]+)$/.test(key)) throw new Error("invalid_evolution_storage_key");
  }
  async read<T>(key: string): Promise<T | null> {
    this.validateKey(key);
    const database = await this.db();
    return new Promise((resolve, reject) => {
      const request = database.transaction("records", "readonly").objectStore("records").get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  }
  private async write(key: string, value: unknown, immutable: boolean): Promise<void> {
    this.validateKey(key);
    const database = await this.db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("records", "readwrite");
      const records = transaction.objectStore("records");
      let conflict = false;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(new Error(conflict ? "immutable_evolution_record_conflict" : "evolution_write_aborted"));
      const request = records.get(key);
      request.onsuccess = () => {
        const comparable = (item: unknown) => {
          if (key.startsWith("revisions/") && item && typeof item === "object") {
            const { createdAt: _createdAt, ...content } = item as Record<string, unknown>; return content;
          }
          return item;
        };
        if (immutable && request.result !== undefined) {
          if (JSON.stringify(comparable(request.result)) !== JSON.stringify(comparable(value))) { conflict = true; transaction.abort(); }
          return;
        }
        records.put(value, key);
      };
    });
  }
  put(key: string, value: unknown): Promise<void> {
    if (key === "state") throw new Error("use_atomic_state_write");
    return this.write(key, value, true);
  }
  writeState(state: EvolutionState): Promise<void> { return this.write("state", state, false); }
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (!globalThis.navigator?.locks) throw new Error("browser_experiment_lock_unavailable");
    return navigator.locks.request("keating-teaching-evolution", { ifAvailable: true }, (lock) => {
      if (!lock) throw new Error("teaching_experiment_already_running");
      return operation();
    });
  }
}

export const browserEvolutionStore = new BrowserEvolutionStore();
