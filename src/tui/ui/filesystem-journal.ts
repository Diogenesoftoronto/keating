import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { validateUiActionJournal, type UiActionJournal } from "../learner-contracts.js";

import { stateDir } from "../../core/paths.js";
import type { UiActionJournalStorage } from "./journal.js";

const MAX_JOURNAL_BYTES = 2 * 1024 * 1024;
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 10_000;

export function tuiUiActionJournalDir(cwd: string): string {
  return join(stateDir(cwd), "tui-ui-actions");
}

export function tuiUiActionReceiverJournalDir(cwd: string): string {
  return join(stateDir(cwd), "tui-ui-receiver-actions");
}

function journalFileName(documentId: string): string {
  return `${createHash("sha256").update(documentId).digest("hex")}.json`;
}

function ownerUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function assertOwned(metadata: { uid: number }, label: string): void {
  const uid = ownerUid();
  if (uid !== undefined && metadata.uid !== uid) {
    throw new Error(`${label} is not owned by the current user.`);
  }
}

/**
 * Owner-only, atomic filesystem persistence for terminal OpenUI receipts.
 * The model-authored document id is hashed before it reaches a path, and the
 * journal still has to validate and match that id when it is read back.
 */
export class FileUiActionJournalStorage implements UiActionJournalStorage {
  private readonly directory: string;

  constructor(cwd: string, lane: "delivery" | "receiver" = "delivery") {
    this.directory = lane === "receiver" ? tuiUiActionReceiverJournalDir(cwd) : tuiUiActionJournalDir(cwd);
  }

  private path(documentId: string): string {
    return join(this.directory, journalFileName(documentId));
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("The terminal UI action journal directory must be a real directory.");
    }
    assertOwned(metadata, "The terminal UI action journal directory");
    if (process.platform !== "win32") await chmod(this.directory, 0o700);
  }

  async withDocumentLock<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    await this.ensureDirectory();
    const lockPath = join(this.directory, `.${journalFileName(documentId)}.lock`);
    const startedAt = Date.now();
    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const metadata = await lstat(lockPath);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new Error("The terminal UI action lock is not a safe directory.");
        }
        assertOwned(metadata, "The terminal UI action lock");
        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
          throw new Error("Timed out waiting for the terminal UI action lock.");
        }
        await delay(LOCK_RETRY_MS);
      }
    }
    try {
      return await operation();
    } finally {
      await rmdir(lockPath);
    }
  }

  async load(documentId: string): Promise<UiActionJournal | undefined> {
    await this.ensureDirectory();
    const path = this.path(documentId);
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let raw: string;
    try {
      const metadata = await handle.stat();
      assertOwned(metadata, "The terminal UI action journal");
      if (!metadata.isFile() || metadata.size > MAX_JOURNAL_BYTES) {
        throw new Error("The terminal UI action journal is not a bounded regular file.");
      }
      if (process.platform !== "win32") await handle.chmod(0o600);
      raw = await handle.readFile({ encoding: "utf8" });
      if (Buffer.byteLength(raw, "utf8") > MAX_JOURNAL_BYTES) {
        throw new Error("The terminal UI action journal exceeds its persistence limit.");
      }
    } finally {
      await handle.close();
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      throw new Error("The terminal UI action journal contains invalid JSON.");
    }
    if (!validateUiActionJournal(candidate) || candidate.documentId !== documentId) {
      throw new Error("The terminal UI action journal does not match the requested document.");
    }
    return candidate;
  }

  async save(journal: UiActionJournal): Promise<void> {
    if (!validateUiActionJournal(journal)) throw new Error("Refusing to persist an invalid terminal UI action journal.");
    const payload = `${JSON.stringify(journal)}\n`;
    if (Buffer.byteLength(payload, "utf8") > MAX_JOURNAL_BYTES) {
      throw new Error("The terminal UI action journal exceeds its persistence limit.");
    }
    await this.ensureDirectory();
    const target = this.path(journal.documentId);
    const temporary = join(this.directory, `.${journalFileName(journal.documentId)}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(payload, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, target);
      const directoryHandle = await open(this.directory, constants.O_RDONLY);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
