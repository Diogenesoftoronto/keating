import type { AsyncSqlDatabase } from "../learner-repository/database";
import { LearnerRecordStore, type LocalAttachmentLocation } from "../learner-repository/records";
import type { PortableLearnerData } from "@keating/learner-contracts";

/** A logout or local edit during an async native transaction must roll it back. */
export async function replaceSyncedLearnerData(
  database: AsyncSqlDatabase, data: PortableLearnerData, locations: readonly LocalAttachmentLocation[], current: () => boolean,
): Promise<boolean> {
  const cancelled = new Error("The sync account or local conversation changed.");
  const check = () => { if (!current()) throw cancelled; };
  const guarded: AsyncSqlDatabase = {
    execAsync: source => database.execAsync(source),
    runAsync: (source, ...params) => database.runAsync(source, ...params),
    getFirstAsync: (source, ...params) => database.getFirstAsync(source, ...params),
    getAllAsync: (source, ...params) => database.getAllAsync(source, ...params),
    closeAsync: () => database.closeAsync(),
    withExclusiveTransactionAsync: task => database.withExclusiveTransactionAsync(async transaction => {
      check(); await task(transaction); check();
    }),
  };
  try {
    await new LearnerRecordStore(guarded).replaceWithLocalAttachments(data, locations);
    return true;
  } catch (error) { if (error === cancelled) return false; throw error; }
}
