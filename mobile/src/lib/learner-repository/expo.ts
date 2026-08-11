import type { SQLiteDatabase } from "expo-sqlite";
import type { AsyncSqlDatabase, AsyncSqlExecutor, SqlBindValue } from "./database";
import {
  openLearnerRepository,
  type LearnerRepository,
  type OpenLearnerRepositoryOptions,
} from "./index";

function adaptExpoExecutor(database: SQLiteDatabase): AsyncSqlExecutor {
  return {
    execAsync: (source) => database.execAsync(source),
    runAsync: (source: string, ...params: SqlBindValue[]) => database.runAsync(source, ...params),
    getFirstAsync: <T>(source: string, ...params: SqlBindValue[]) => database.getFirstAsync<T>(source, ...params),
    getAllAsync: <T>(source: string, ...params: SqlBindValue[]) => database.getAllAsync<T>(source, ...params),
  };
}

function adaptExpoDatabase(database: SQLiteDatabase): AsyncSqlDatabase {
  return {
    ...adaptExpoExecutor(database),
    withExclusiveTransactionAsync: async (task) => {
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await task(adaptExpoExecutor(transaction));
      });
    },
    closeAsync: () => database.closeAsync(),
  };
}

/** Production Expo seam. Tests use `openLearnerRepository` with a fake driver. */
export async function openExpoLearnerRepository(
  options: OpenLearnerRepositoryOptions = {},
): Promise<LearnerRepository> {
  const sqlite = await import("expo-sqlite");
  return openLearnerRepository({
    openDatabaseAsync: async (name) => adaptExpoDatabase(await sqlite.openDatabaseAsync(name)),
  }, options);
}
