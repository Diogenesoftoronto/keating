import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountSyncDirectory, accountSyncSessionPath, captureNativeSession, CliAccountSyncLocal, isCurrentAccountSyncDirectory, materializeNativeSession, withAccountSyncLease } from "../src/core/account-sync-local.js";
import { accountSyncAuthPath, writeAccountSyncJson } from "../src/core/account-sync-auth.js";
import { emptyChatSyncState } from "../shared/account-sync/chat-sync-state.js";

const at = "2026-11-06T00:00:00.000Z";
const header = { type: "session", version: 3, id: "native-session", timestamp: at, cwd: "/original/device" };
const entries = [
  { type: "message", id: "root", parentId: null, timestamp: at, message: { role: "user", content: "first", timestamp: 1 } },
  { type: "custom", id: "custom", parentId: "root", timestamp: at, customType: "learning-state", data: { score: 0.7 } },
  { type: "message", id: "branch-a", parentId: "custom", timestamp: at, message: { role: "user", content: "branch A", timestamp: 2 } },
  { type: "message", id: "branch-b", parentId: "root", timestamp: at, message: { role: "user", content: "branch B", timestamp: 3 } },
];
const jsonl = [header, ...entries].map(row => JSON.stringify(row)).join("\n") + "\n";

describe("terminal account sync local materialization", () => {
  test("recovers an abandoned lease and releases it after failure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-sync-local-"));
    try {
      const path = join(cwd, ".keating/pi-config/account-sync-lease.json");
      await mkdir(join(cwd, ".keating/pi-config"), { recursive: true }); await writeFile(path, "{}");
      await mkdir(path + ".lock"); const old = new Date(Date.now() - 60_000); await utimes(path + ".lock", old, old);
      expect(await withAccountSyncLease(cwd, async () => "recovered")).toBe("recovered");
      await expect(withAccountSyncLease(cwd, async () => { throw new Error("interrupted operation"); })).rejects.toThrow("interrupted");
      expect(await withAccountSyncLease(cwd, async () => "released")).toBe("released");
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  test("preserves complete native branches and custom state while exposing selected transcript", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-sync-local-"));
    try {
      const path = join(cwd, "fixture.jsonl"); await writeFile(path, jsonl);
      const portable = await captureNativeSession(path);
      expect(portable.data.nativeSession?.entries).toEqual(entries);
      expect(portable.data.messages.map(message => message.content)).toEqual(["first", "branch B"]);
      const restored = materializeNativeSession(portable, cwd).trim().split("\n").map(line => JSON.parse(line));
      expect(restored.slice(1)).toEqual(entries);
      portable.data.messages.push({ role: "user", content: "continued on browser", timestamp: 4 });
      const continued = materializeNativeSession(portable, cwd).trim().split("\n").map(line => JSON.parse(line));
      expect(continued.slice(1, 1 + entries.length)).toEqual(entries);
      expect(continued.some(row => row.message?.content === "continued on browser")).toBe(true);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  test("adoption is explicit, empty device pulls do not delete, and repeated materialization is stable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-sync-local-"));
    try {
      const source = join(cwd, "fixture.jsonl"); await writeFile(source, jsonl);
      const a = new CliAccountSyncLocal(join(cwd, "a"), cwd); const b = new CliAccountSyncLocal(join(cwd, "b"), cwd);
      expect((await a.reconcile(null)).entries).toHaveLength(0);
      await a.adopt(source);
      const state = await a.reconcile(null);
      const pulled = await b.reconcile(state);
      expect(pulled).toEqual(state);
      expect(await b.reconcile(emptyChatSyncState())).toEqual(state);
      expect(await b.reconcile(state)).toEqual(state);
      expect(await readFile(source, "utf8")).toBe(jsonl);
      await rm(accountSyncSessionPath(join(cwd, "a"), header.id));
      const deleted = await a.reconcile(null);
      expect(deleted.entries[0]?.session).toBeNull();
      expect((await b.reconcile(deleted)).entries[0]?.session).toBeNull();
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });

  test("partitions by issuer and DID, and rejects account directory symlink escapes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-sync-local-"));
    try {
      const issuer = "https://api.notorganic.info", did = "did:plc:first";
      const directory = accountSyncDirectory(cwd, issuer, did);
      expect(directory).not.toBe(accountSyncDirectory(cwd, issuer, "did:plc:second"));
      expect(directory).not.toBe(accountSyncDirectory(cwd, "https://other.example", did));
      await writeAccountSyncJson(accountSyncAuthPath(cwd), { issuer, did }); await mkdir(directory, { recursive: true });
      expect(isCurrentAccountSyncDirectory(cwd, directory)).toBe(true);
      await rm(directory, { recursive: true }); await symlink(tmpdir(), directory);
      expect(isCurrentAccountSyncDirectory(cwd, directory)).toBe(false);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
