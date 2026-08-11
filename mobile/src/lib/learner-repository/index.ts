import type { AsyncSqlDatabase, AsyncSqliteDriver } from "./database";
import { MigrationJournal, type MigrationClock } from "./migration-journal";
import {
  initializeRepositorySchema,
  LEARNER_REPOSITORY_DATABASE_NAME,
} from "./schema";
import { LearnerRecordStore, UiActionStore, type RepositoryClock } from "./records";

export * from "./database";
export * from "./legacy-migration";
export * from "./migration-journal";
export * from "./records";
export * from "./schema";

export interface LearnerRepository {
  readonly database: AsyncSqlDatabase;
  readonly migrations: MigrationJournal;
  readonly records: LearnerRecordStore;
  readonly uiActions: UiActionStore;
  close(): Promise<void>;
}

export interface OpenLearnerRepositoryOptions {
  clock?: MigrationClock;
  recordClock?: RepositoryClock;
  databaseName?: string;
}

/** Opens, configures, and initializes the local repository, closing on failure. */
export async function openLearnerRepository(
  driver: AsyncSqliteDriver,
  options: OpenLearnerRepositoryOptions = {},
): Promise<LearnerRepository> {
  const database = await driver.openDatabaseAsync(
    options.databaseName ?? LEARNER_REPOSITORY_DATABASE_NAME,
  );
  try {
    await initializeRepositorySchema(database);
    let closePromise: Promise<void> | null = null;
    return {
      database,
      migrations: new MigrationJournal(database, options.clock),
      records: new LearnerRecordStore(database, options.recordClock),
      uiActions: new UiActionStore(database, options.recordClock),
      close: () => {
        if (!closePromise) closePromise = database.closeAsync();
        return closePromise;
      },
    };
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw error;
  }
}
