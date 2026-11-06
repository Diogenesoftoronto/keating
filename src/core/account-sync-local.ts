import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { FileAuthStorageBackend, SessionManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MODELS } from "@keating/runtime-config";
import { sessionsDir, configDir } from "./paths.js";
import { accountSyncAuthPath, readAccountSyncJson, writeAccountSyncJson } from "./account-sync-auth.js";
import { chatSyncCanonical, emptyChatSyncState, mergeChatSyncStates, parseChatSyncState, updateChatSyncState, type ChatSyncState } from "../../shared/account-sync/chat-sync-state.js";
import type { KeatingPortableSession, NativeSessionTree } from "../../shared/account-sync/types.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
export function accountSyncDirectory(cwd: string, issuer: string, did: string): string {
  return join(sessionsDir(cwd), "account-sync", hash(`${issuer}\n${did}`));
}
export function accountSyncSessionPath(directory: string, id: string): string { return join(directory, `${hash(id)}.jsonl`); }

export function isCurrentAccountSyncDirectory(cwd: string, directory: string): boolean {
  try {
    const credential = JSON.parse(readFileSync(accountSyncAuthPath(cwd), "utf8")) as { issuer: string; did: string };
    const expected = accountSyncDirectory(cwd, credential.issuer, credential.did);
    if (resolve(directory) !== resolve(expected)) return false;
    const inside = relative(realpathSync(cwd), realpathSync(expected));
    if (!inside || isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`)) return false;
    let path = resolve(cwd);
    for (const part of relative(path, expected).split(sep)) { path = join(path, part); if (lstatSync(path).isSymbolicLink()) return false; }
    return true;
  } catch { return false; }
}

/** One process may rotate credentials or reconcile files at a time. */
export async function withAccountSyncLease<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
  // Pi's public storage backend already uses a heartbeat, stale-lock recovery,
  // and restrictive permissions. A killed terminal must not strand sync forever.
  const lease = new FileAuthStorageBackend(join(configDir(cwd), "account-sync-lease.json"));
  return lease.withLockAsync(async () => ({ result: await operation() }));
}

interface Journal { version: 1; writer: string; state: ChatSyncState; baseline: KeatingPortableSession[]; fileHashes: Record<string, string> }
function journal(): Journal { return { version: 1, writer: randomUUID(), state: emptyChatSyncState(), baseline: [], fileHashes: {} }; }

function validateNativeEntries(values: unknown[]): void {
  const entries = new Map<string, Record<string, unknown>>();
  if (values.length > 100_000) throw new Error("The native conversation has too many entries.");
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native conversation tree.");
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || entries.has(row.id) || typeof row.type !== "string"
      || !(row.parentId === null || typeof row.parentId === "string")) throw new Error("Invalid native conversation tree.");
    entries.set(row.id, row);
  }
  const complete = new Set<string>();
  for (const key of entries.keys()) {
    const chain = new Set<string>(); let id: string | null = key;
    while (id !== null && !complete.has(id)) {
      if (chain.has(id) || !entries.has(id)) throw new Error("The native conversation tree has a cycle or missing parent.");
      chain.add(id); id = entries.get(id)!.parentId as string | null;
    }
    for (const id of chain) complete.add(id);
  }
}

export async function captureNativeSession(path: string, previous?: KeatingPortableSession): Promise<KeatingPortableSession> {
  const text = await readFile(path, "utf8");
  const rows = text.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
  const header = rows[0];
  if (!header || header.type !== "session" || header.version !== 3 || typeof header.id !== "string" || typeof header.timestamp !== "string") throw new Error("Only current Pi session JSONL files can be added to account sync.");
  validateNativeEntries(rows.slice(1));
  const session = SessionManager.open(path);
  const context = session.buildSessionContext();
  const id = previous?.data.id ?? header.id;
  const entries = rows.slice(1);
  const lastModified = [...entries].reverse().find(row => typeof row.timestamp === "string")?.timestamp as string | undefined ?? header.timestamp;
  const firstUser = context.messages.find(message => message.role === "user") as { content?: unknown } | undefined;
  const firstText = typeof firstUser?.content === "string" ? firstUser.content
    : Array.isArray(firstUser?.content) ? firstUser.content.flatMap(part => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? [part.text] : []).join(" ") : "";
  const title = session.getSessionName() ?? previous?.data.title ?? (firstText.trim().slice(0, 120) || basename(path, ".jsonl"));
  const model = previous?.data.model && (!context.model || (context.model.provider === previous.data.model.provider && context.model.modelId === previous.data.model.id))
    ? previous.data.model : { id: context.model?.modelId ?? DEFAULT_MODELS.cli.notorganic, provider: context.model?.provider ?? "notorganic" };
  const thinkingLevel = context.thinkingLevel;
  const data = { ...previous?.data, id, title, model, thinkingLevel, messages: context.messages, createdAt: previous?.data.createdAt ?? header.timestamp, lastModified,
    nativeSession: { header, entries, leafId: session.getLeafId() } };
  return { data, metadata: { ...previous?.metadata, id, title, createdAt: data.createdAt, lastModified, messageCount: data.messages.length, thinkingLevel, usage: previous?.metadata.usage ?? zeroUsage(), preview: title } };
}

/** Keep all original branches; a browser edit becomes an additional branch. */
export function materializeNativeSession(session: KeatingPortableSession, cwd: string): string {
  const native = session.data.nativeSession;
  if (native) validateNativeEntries(native.entries);
  const header = native ? { ...native.header, id: session.data.id } : { type: "session", version: 3, id: session.data.id, timestamp: session.data.createdAt, cwd };
  const entries = native ? structuredClone(native.entries) as Record<string, unknown>[] : [];
  // A portable transcript can change on web/mobile while retaining its native
  // sidecar. Preserve the raw tree and record that transcript on a new branch.
  const nativeMessages = native ? selectedMessages(native) : [];
  if (!native || chatSyncCanonical(nativeMessages) !== chatSyncCanonical(session.data.messages)) {
    let parentId: string | null = null;
    const append = (row: Record<string, unknown>) => { const id = randomUUID(); entries.push({ id, parentId, timestamp: session.data.lastModified, ...row }); parentId = id; };
    append({ type: "model_change", provider: session.data.model.provider, modelId: session.data.model.id });
    append({ type: "thinking_level_change", thinkingLevel: session.data.thinkingLevel });
    for (const message of session.data.messages) append({ type: "message", message });
    append({ type: "session_info", name: session.data.title });
  } else if (native.leafId !== null && entries.at(-1)?.id !== native.leafId) {
    entries.push({ type: "custom", customType: "keating-account-sync-resume", id: randomUUID(), parentId: native.leafId, timestamp: session.data.lastModified });
  }
  return [header, ...entries].map(row => JSON.stringify(row)).join("\n") + "\n";
}

function selectedMessages(native: NativeSessionTree): unknown[] {
  // SessionManager context also handles compaction and custom entries. This
  // check uses raw message ancestry conservatively; complex contexts fork.
  const entries = new Map((native.entries as Record<string, unknown>[]).map(row => [row.id, row]));
  const path: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  let id: unknown = native.leafId;
  while (id !== null && entries.has(id) && !seen.has(id)) { seen.add(id); const row = entries.get(id)!; path.unshift(row); id = row.parentId; }
  return path.filter(row => row.type === "message").map(row => row.message);
}

async function writeSession(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text, { mode: 0o600, flag: "wx" }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

export class CliAccountSyncLocal {
  constructor(readonly directory: string, private readonly cwd: string) {}
  private async load(): Promise<Journal> {
    const value = await readAccountSyncJson<Journal>(join(this.directory, "journal.json")) ?? journal();
    if (value.version !== 1 || !Array.isArray(value.baseline) || !value.fileHashes) throw new Error("The local account sync journal is invalid.");
    value.state = parseChatSyncState(value.state); return value;
  }
  async list(): Promise<KeatingPortableSession[]> { return (await this.load()).baseline; }
  async adopt(path: string): Promise<string> {
    const session = await captureNativeSession(resolve(this.cwd, path));
    const target = accountSyncSessionPath(this.directory, session.data.id);
    try { await stat(target); throw new Error("This conversation is already present. Sync it before adding another copy."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeSession(target, await readFile(resolve(this.cwd, path), "utf8"));
    return session.data.id;
  }
  async reconcile(remote: ChatSyncState | null): Promise<ChatSyncState> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const saved = await this.load();
    const baseline = new Map(saved.baseline.map(session => [accountSyncSessionPath(this.directory, session.data.id), session]));
    const current: KeatingPortableSession[] = [];
    for (const file of await readdir(this.directory)) {
      if (!file.endsWith(".jsonl")) continue;
      let path = join(this.directory, file);
      if (lstatSync(path).isSymbolicLink()) throw new Error("Account sync refuses symlinked session files.");
      const old = baseline.get(path);
      const fingerprint = hash(await readFile(path, "utf8"));
      const session = old && saved.fileHashes[old.data.id] === fingerprint ? old : await captureNativeSession(path, old);
      const canonical = accountSyncSessionPath(this.directory, session.data.id);
      if (path !== canonical) {
        try { await stat(canonical); throw new Error("Duplicate account conversation files need reconciliation before syncing."); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await rename(path, canonical); path = canonical;
      }
      current.push(session);
    }
    let state = updateChatSyncState(saved.state, current, saved.writer, saved.baseline);
    if (remote) state = mergeChatSyncStates(state, remote);
    const sessions = state.entries.flatMap(entry => entry.session ? [entry.session] : []);
    const hashes: Record<string, string> = {};
    for (const entry of state.entries) {
      const path = accountSyncSessionPath(this.directory, entry.id);
      if (!entry.session) { await rm(path, { force: true }); continue; }
      const local = current.find(session => session.data.id === entry.id);
      if (chatSyncCanonical(local) !== chatSyncCanonical(entry.session)) await writeSession(path, materializeNativeSession(entry.session, this.cwd));
      hashes[entry.id] = hash(await readFile(path, "utf8"));
    }
    await writeAccountSyncJson(join(this.directory, "journal.json"), { version: 1, writer: saved.writer, state, baseline: sessions, fileHashes: hashes } satisfies Journal);
    return state;
  }
}
