import initSql from "sql.js/dist/sql-asm.js";
import { libsql, type LibsqlRunner } from "@flue/libsql";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Single owner, serialized SQL, with atomic snapshots on NodePod's filesystem. */
export async function openNodepodSqlRunner(path?: string): Promise<LibsqlRunner> {
  const SQL = await initSql();
  const file = path ? resolve(path) : undefined;
  const lock = file ? `${file}.lock` : undefined;
  if (file && lock) {
    await mkdir(dirname(file), { recursive: true });
    await mkdir(lock); // Refuse a second process/adapter; never steal a live lock.
  }
  let bytes: Uint8Array | undefined;
  try {
    if (file) {
      try { bytes = await readFile(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  } catch (error) { if (lock) await rm(lock, { recursive: true }); throw error; }
  let db: InstanceType<typeof SQL.Database>;
  try { db = new SQL.Database(bytes); }
  catch (error) { if (lock) await rm(lock, { recursive: true }); throw error; }
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(async () => {
      if (closed) throw new Error("nodepod_database_closed");
      return fn();
    });
    tail = next.catch(() => {});
    return next;
  };
  const query: LibsqlRunner["query"] = async (sql, params = []) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params.map(p => p instanceof ArrayBuffer ? new Uint8Array(p) : typeof p === "boolean" ? Number(p) : p));
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally { statement.free(); }
  };
  const persist = async () => {
    if (!file) return;
    const temp = `${file}.pending`;
    try {
      await writeFile(temp, db.export(), { mode: 0o600 });
      await rename(temp, file);
    } finally { await rm(temp, { force: true }); }
  };
  const atomic = async <T>(fn: () => Promise<T>): Promise<T> => {
    const before = db.export();
    try { const result = await fn(); await persist(); return result; }
    catch (error) {
      // Includes failed persistence after SQL commit: future reads must not see an unacknowledged write.
      db.close(); db = new SQL.Database(before); throw error;
    }
  };
  return {
    query: (sql, params) => serialize(() => atomic(() => query(sql, params))),
    transaction: fn => serialize(() => atomic(async () => {
      db.run("BEGIN IMMEDIATE");
      try { const result = await fn({ query }); db.run("COMMIT"); return result; }
      catch (error) { db.run("ROLLBACK"); throw error; }
    })),
    close: async () => {
      await tail;
      if (closed) return;
      closed = true;
      db.close();
      if (lock) await rm(lock, { recursive: true });
    },
  };
}

export async function nodepodPersistence(path: string) {
  return libsql(await openNodepodSqlRunner(path));
}
