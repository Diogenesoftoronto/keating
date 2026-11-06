import type { AsyncSqlDatabase } from "../learner-repository/database";
import type { ChatRecordSyncCheckpoint } from "../../../../shared/account-sync/chat-record-sync-controller";
import { emptyChatSyncState, parseChatSyncState, type ChatSyncState } from "../../../../shared/account-sync/chat-sync-state";
import type { KeatingPortableSession } from "../../../../shared/account-sync/types";

export interface NativeChatSyncState { state: ChatSyncState; baseline: KeatingPortableSession[]; writer: string }

/** Stored in the same durable SQLite database, but partitioned by verified account namespace. */
export class NativeChatSyncStorage {
  constructor(private readonly database: AsyncSqlDatabase, private readonly namespace: string, private readonly current: () => boolean) {
    if (!/^account-[a-f0-9]{64}$/u.test(namespace)) throw new Error("Invalid account sync namespace.");
  }
  async initialize(): Promise<void> {
    await this.database.execAsync("CREATE TABLE IF NOT EXISTS account_chat_sync (namespace TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace, kind)); CREATE TABLE IF NOT EXISTS account_chat_owners (session_id TEXT PRIMARY KEY NOT NULL, namespace TEXT NOT NULL);");
  }
  private assertCurrent(): void { if (!this.current()) throw new Error("The sync account changed."); }
  private async read<T>(kind: string): Promise<T | null> {
    this.assertCurrent();
    const row = await this.database.getFirstAsync<{ value: string }>("SELECT value FROM account_chat_sync WHERE namespace = ? AND kind = ?", this.namespace, kind);
    this.assertCurrent();
    return row ? JSON.parse(row.value) as T : null;
  }
  private async write(kind: string, value: unknown): Promise<void> {
    this.assertCurrent();
    await this.database.runAsync("INSERT INTO account_chat_sync(namespace, kind, value) VALUES (?, ?, ?) ON CONFLICT(namespace, kind) DO UPDATE SET value = excluded.value", this.namespace, kind, JSON.stringify(value));
    this.assertCurrent();
  }
  loadCheckpoint(): Promise<ChatRecordSyncCheckpoint | null> { return this.read("checkpoint"); }
  saveCheckpoint(checkpoint: ChatRecordSyncCheckpoint): Promise<void> { return this.write("checkpoint", checkpoint); }
  async loadLocal(writer: () => string): Promise<NativeChatSyncState> {
    const stored = await this.read<NativeChatSyncState>("local");
    if (!stored) return { state: emptyChatSyncState(), baseline: [], writer: writer() };
    return { state: parseChatSyncState(stored.state), baseline: parseChatSyncState({ schemaVersion: 1, kind: "keating-chat-sync", entries: stored.baseline.map(session => ({ id: session.data.id, version: 1, writer: stored.writer, session })) }).entries.map(entry => entry.session!), writer: stored.writer };
  }
  saveLocal(state: NativeChatSyncState): Promise<void> { return this.write("local", state); }
  /** Adopt pre-account history only on the first connection on this device. */
  async migrateFirstConnection(ids: string[]): Promise<void> {
    this.assertCurrent();
    await this.database.withExclusiveTransactionAsync(async transaction => {
      await transaction.execAsync("CREATE TABLE IF NOT EXISTS account_chat_migration (id INTEGER PRIMARY KEY NOT NULL, namespace TEXT NOT NULL);");
      const prior = await transaction.getFirstAsync<{ namespace: string }>("SELECT namespace FROM account_chat_migration WHERE id = 1");
      if (prior) return;
      const persisted = new Set((await transaction.getAllAsync<{ id: string }>("SELECT id FROM learner_records WHERE kind = ?", "session")).map(row => row.id));
      for (const id of ids) {
        this.assertCurrent();
        if (persisted.has(id)) await transaction.runAsync("INSERT OR IGNORE INTO account_chat_owners(session_id, namespace) VALUES (?, ?)", id, this.namespace);
      }
      this.assertCurrent();
      await transaction.runAsync("INSERT INTO account_chat_migration(id, namespace) VALUES (1, ?)", this.namespace);
    });
  }
  async claim(ids: string[]): Promise<Set<string>> {
    this.assertCurrent();
    await this.database.withExclusiveTransactionAsync(async transaction => {
      for (const id of ids) {
        this.assertCurrent();
        await transaction.runAsync("INSERT OR IGNORE INTO account_chat_owners(session_id, namespace) VALUES (?, ?)", id, this.namespace);
      }
    });
    const rows = await this.database.getAllAsync<{ session_id: string }>("SELECT session_id FROM account_chat_owners WHERE namespace = ?", this.namespace);
    this.assertCurrent();
    return new Set(rows.map(row => row.session_id));
  }
}
