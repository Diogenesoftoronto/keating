import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libsql } from "@flue/libsql";
import { defineStoreContractTests, defineConversationStreamStoreContractTests, defineAttachmentStoreContractTests } from "@flue/runtime/test-utils";
import { openNodepodSqlRunner, nodepodPersistence } from "../src/nodepod-persistence.ts";

function backend() {
  let close: (() => void | Promise<void>) | undefined;
  return { async create() {
    const adapter = libsql(await openNodepodSqlRunner());
    close = adapter.close;
    await adapter.migrate?.();
    return adapter.connect();
  }, async cleanup() { await close?.(); } };
}
const submissions = backend(), streams = backend(), attachments = backend();
defineStoreContractTests("NodePod SQL submission store", {
  create: async () => (await submissions.create()).submissionStore, cleanup: submissions.cleanup,
  formatVersion: { open: async () => {
    const runner = await openNodepodSqlRunner(); const adapter = libsql(runner);
    await runner.query("CREATE TABLE flue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    return { migrate: async () => { await adapter.migrate?.(); },
      readStamp: async key => (await runner.query("SELECT value FROM flue_meta WHERE key = ?", [key]))[0]?.value as string | undefined,
      writeStamp: async (key, value) => { await runner.query("INSERT INTO flue_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]); },
      deleteStamp: async key => { await runner.query("DELETE FROM flue_meta WHERE key = ?", [key]); }, cleanup: runner.close };
  } },
});
defineConversationStreamStoreContractTests("NodePod SQL conversation store", {
  create: async () => { const stores = await streams.create(); return { stream: stores.conversationStreamStore, submissionStore: stores.submissionStore }; }, cleanup: streams.cleanup,
});
defineAttachmentStoreContractTests("NodePod SQL attachment store", { create: async () => (await attachments.create()).attachmentStore, cleanup: attachments.cleanup });

test("file state reopens, failed transactions roll back, and a second owner is refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "keating-sql-runner-"));
  const path = join(dir, "state.sqlite");
  let runner = await openNodepodSqlRunner(path);
  try {
    await runner.query("CREATE TABLE proof (value TEXT)");
    await runner.query("INSERT INTO proof VALUES (?)", ["retained"]);
    await expect(openNodepodSqlRunner(path)).rejects.toThrow();
    await expect(runner.transaction(async tx => { await tx.query("INSERT INTO proof VALUES (?)", ["rollback"]); throw Error("failed"); })).rejects.toThrow("failed");
    await runner.close();
    runner = await openNodepodSqlRunner(path);
    expect(await runner.query("SELECT value FROM proof")).toEqual([{ value: "retained" }]);
    await runner.close();
    const adapter = await nodepodPersistence(path);
    try { await adapter.migrate?.(); expect(await adapter.connect()).toHaveProperty("submissionStore"); }
    finally { await adapter.close?.(); }
  } finally { await runner.close(); await rm(dir, { recursive: true, force: true }); }
});
