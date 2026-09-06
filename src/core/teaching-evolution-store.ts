import { mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { EvolutionState, EvolutionStore } from "../../shared/evolution/loop.js";

/** Durable project/account data stays outside disposable episode workspaces. */
export class FileEvolutionStore implements EvolutionStore {
  readonly directory: string;
  constructor(cwd: string) { this.directory = join(cwd, ".keating", "state", "teaching-evolution"); }
  private path(key: string): string {
    if (!/^(state|(?:revisions|raw|experiments|suites)\/[a-zA-Z0-9-]+)$/.test(key)) throw new Error("invalid_evolution_storage_key");
    return join(this.directory, `${key}.json`);
  }
  async read<T>(key: string): Promise<T | null> {
    try { return JSON.parse(await readFile(this.path(key), "utf8")) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async put(key: string, value: unknown): Promise<void> {
    if (key === "state") throw new Error("use_atomic_state_write");
    const path = this.path(key);
    await mkdir(join(path, ".."), { recursive: true });
    try { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await this.read<Record<string, unknown>>(key);
      // Revisions are addressed by content; creation time is not part of that content.
      const comparable = (item: unknown) => {
        if (key.startsWith("revisions/") && item && typeof item === "object") {
          const { createdAt: _createdAt, ...rest } = item as Record<string, unknown>; return rest;
        }
        return item;
      };
      if (JSON.stringify(comparable(existing)) !== JSON.stringify(comparable(value))) throw new Error("immutable_evolution_record_conflict");
    }
  }
  async writeState(state: EvolutionState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `.state-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, this.path("state"));
    } finally { await rm(temporary, { force: true }); }
  }

  private async removeLockOwner(lockPath: string, ownerName: string): Promise<void> {
    try { await unlink(join(lockPath, ownerName)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // Another contender may already have published its nonempty directory here.
    // Never remove recursively: its distinct owner file must protect its lock.
    try { await rmdir(lockPath); }
    catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }

  private async reapAbandonedLock(lockPath: string): Promise<boolean> {
    let names: string[];
    try { names = await readdir(lockPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      // Legacy lock files and unfamiliar lock formats require explicit recovery.
      return false;
    }
    if (names.length === 0) return true;
    if (names.length !== 1 || !/^owner-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(names[0]!)) return false;
    let owner: { schemaVersion?: number; pid?: number; host?: string; startedAt?: string };
    try { owner = JSON.parse(await readFile(join(lockPath, names[0]!), "utf8")); }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
    if (!owner || owner.schemaVersion !== 1 || !Number.isInteger(owner.pid) || owner.pid! < 1
      || owner.host !== hostname() || typeof owner.startedAt !== "string" || !Number.isFinite(Date.parse(owner.startedAt))) return false;
    try {
      process.kill(owner.pid!, 0);
      // A live PID may have been reused; never infer staleness from age alone.
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
    }
    await this.removeLockOwner(lockPath, names[0]!);
    return true;
  }

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = join(this.directory, "experiment.lock");
    const token = randomUUID();
    const ownerName = `owner-${token}.json`;
    const prepared = join(this.directory, `.experiment-lock-${token}`);
    await mkdir(prepared, { mode: 0o700 });
    let acquired = false;
    try {
      await writeFile(join(prepared, ownerName), JSON.stringify({
        schemaVersion: 1, pid: process.pid, host: hostname(), startedAt: new Date().toISOString(),
      }), { flag: "wx", mode: 0o600 });
      // Publish owner metadata and the lock atomically, without an empty-owner
      // window. Concurrent reapers can unlink only the old unique owner name.
      for (let attempt = 0; attempt < 3 && !acquired; attempt += 1) {
        try { await rename(prepared, lockPath); acquired = true; }
        catch (error) {
          if (!["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          if (!await this.reapAbandonedLock(lockPath)) throw new Error("teaching_experiment_already_running");
        }
      }
      if (!acquired) throw new Error("teaching_experiment_already_running");
      return await operation();
    } finally {
      try { if (acquired) await this.removeLockOwner(lockPath, ownerName); }
      finally { await rm(prepared, { recursive: true, force: true }); }
    }
  }
}
