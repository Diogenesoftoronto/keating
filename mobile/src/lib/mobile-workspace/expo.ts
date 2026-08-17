import * as Crypto from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import type { AsyncSqlDatabase, AsyncSqlExecutor, SqlBindValue } from "../learner-repository/database";
import { MobileWorkspaceEngine } from "./engine";
import { SqliteMobileWorkspaceRepository } from "./repository";

function adaptExecutor(database: SQLiteDatabase): AsyncSqlExecutor {
  return {
    execAsync: (source) => database.execAsync(source),
    runAsync: (source: string, ...params: SqlBindValue[]) => database.runAsync(source, ...params),
    getFirstAsync: <T>(source: string, ...params: SqlBindValue[]) => database.getFirstAsync<T>(source, ...params),
    getAllAsync: <T>(source: string, ...params: SqlBindValue[]) => database.getAllAsync<T>(source, ...params),
  };
}

function adaptDatabase(database: SQLiteDatabase): AsyncSqlDatabase {
  return {
    ...adaptExecutor(database),
    withExclusiveTransactionAsync: async (task) => database.withExclusiveTransactionAsync(async (transaction) => task(adaptExecutor(transaction))),
    closeAsync: () => database.closeAsync(),
  };
}

export async function openExpoMobileWorkspace(): Promise<{ engine: MobileWorkspaceEngine; repository: SqliteMobileWorkspaceRepository }> {
  const SQLite = await import("expo-sqlite");
  const repository = new SqliteMobileWorkspaceRepository(adaptDatabase(await SQLite.openDatabaseAsync("keating-workspace.sqlite")));
  await repository.initialize();
  const engine = new MobileWorkspaceEngine(repository, {
    sha256: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  });
  await engine.initialize();
  return { engine, repository };
}
