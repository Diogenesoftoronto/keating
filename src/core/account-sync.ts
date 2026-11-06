import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { ChatRecordSyncController, type ChatRecordSyncCheckpoint } from "../../shared/account-sync/chat-record-sync-controller.js";
import { ChatSyncRecordsClient } from "../../shared/account-sync/chat-sync-records.js";
import { deriveAccountSyncNamespace } from "../../shared/account-sync/device-identity.js";
import { createAccountSyncRequester, loadAccountSyncCredential, readAccountSyncJson, writeAccountSyncJson } from "./account-sync-auth.js";
import { accountSyncDirectory, accountSyncSessionPath, CliAccountSyncLocal, isCurrentAccountSyncDirectory, withAccountSyncLease } from "./account-sync-local.js";
import { unlockCliAccountSyncKey } from "./account-sync-key.js";

export async function currentCliAccountSyncLocal(cwd: string): Promise<CliAccountSyncLocal> {
  const credential = await loadAccountSyncCredential(cwd);
  if (!credential) throw new Error("Run `keating sync login` to connect this terminal.");
  const directory = accountSyncDirectory(cwd, credential.issuer, credential.did);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!isCurrentAccountSyncDirectory(cwd, directory)) throw new Error("Account sync storage must stay inside this project's learner profile without symlinks.");
  return new CliAccountSyncLocal(directory, cwd);
}

/** Caller holds the account lease for the entire sync/refresh transaction. */
export async function syncCliAccount(cwd: string, progress: (message: string) => void = () => {}, options: { fetch?: typeof fetch } = {}): Promise<number> {
  const requester = await createAccountSyncRequester(cwd, options);
  const local = await currentCliAccountSyncLocal(cwd);
  const key = await unlockCliAccountSyncKey(requester);
  const checkpoint = join(local.directory, "checkpoint.json");
  let failure: unknown;
  const controller = new ChatRecordSyncController({
    remote: new ChatSyncRecordsClient(requester), key, keys: { get: async id => id === key.keyId ? key : null },
    namespace: await deriveAccountSyncNamespace(requester.did), local,
    loadCheckpoint: () => readAccountSyncJson<ChatRecordSyncCheckpoint>(checkpoint),
    saveCheckpoint: value => writeAccountSyncJson(checkpoint, value),
    isCurrent: () => true,
    onStatus: (status, error) => { if (status === "error") failure = error ?? new Error("Account sync failed."); else if (status === "syncing") progress("Syncing encrypted conversations…"); },
  });
  try { await controller.request(); if (failure) throw failure; }
  finally { controller.dispose(); }
  const count = (await local.list()).length;
  progress(`Account sync complete: ${count} conversation${count === 1 ? "" : "s"}.`);
  return count;
}

/** Every new signed-in shell gets an account-isolated conversation file. */
export async function launchAccountSyncedShell<T>(cwd: string, args: string[], launch: (cwd: string, args: string[]) => Promise<T>, progress: (message: string) => void = message => console.error(message)): Promise<T> {
  const credential = await loadAccountSyncCredential(cwd);
  if (!credential) return launch(cwd, args);
  return withAccountSyncLease(cwd, async () => {
    const local = await currentCliAccountSyncLocal(cwd);
    // Explicit legacy files are never silently reassigned to the current account.
    const sessionFlag = args.findIndex(arg => arg === "--session" || arg.startsWith("--session="));
    const explicit = sessionFlag < 0 ? undefined : args[sessionFlag]!.startsWith("--session=") ? args[sessionFlag]!.slice(10) : args[sessionFlag + 1];
    if (explicit && dirname(resolve(cwd, explicit)) !== resolve(local.directory)
      || args.some(arg => ["--continue", "-c", "--resume", "-r", "--session-dir"].includes(arg) || arg.startsWith("--resume=") || arg.startsWith("--session-dir="))) {
      progress("This explicit local-session selection is not account synced. Use `keating sync add <file>` and `keating sync open <id>` to connect it.");
      return launch(cwd, args);
    }
    try { await syncCliAccount(cwd, progress); }
    catch (error) { progress(`Account sync is offline: ${error instanceof Error ? error.message : "try again later"}. Your conversation stays on this device.`); }
    let path = explicit;
    if (!path) {
      const id = randomUUID();
      path = accountSyncSessionPath(local.directory, id);
      await mkdir(local.directory, { recursive: true, mode: 0o700 });
      await writeFile(path, JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd }) + "\n", { mode: 0o600, flag: "wx" });
    }
    let result: T;
    try { result = await launch(cwd, [...args, ...(explicit ? [] : ["--session", path]), "--session-dir", local.directory]); }
    finally {
      try { await syncCliAccount(cwd, progress); }
      catch (error) { progress(`Conversation saved locally; account sync will retry with \`keating sync\`: ${error instanceof Error ? error.message : "sync unavailable"}`); }
    }
    return result;
  });
}
