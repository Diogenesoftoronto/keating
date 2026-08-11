import type { LearnerRecordStore, LearningDataClearIntent } from "./records";

export interface LearningDataClearDependencies {
  clearPersistedState(): Promise<void>;
  clearComposerDrafts(): Promise<void>;
  clearComposerAttachmentFiles(): Promise<void> | void;
  clearLearnerContext(): Promise<void>;
}

/**
 * Completes a journalled cross-store delete. Every operation is idempotent and
 * the SQLite intent is removed last, so a force-kill resumes instead of
 * restoring a partially deleted learner snapshot.
 */
export async function resumePendingLearningDataClear(
  records: Pick<LearnerRecordStore, "pendingClear" | "clear" | "completeClear">,
  dependencies: LearningDataClearDependencies,
): Promise<LearningDataClearIntent | null> {
  const intent = await records.pendingClear();
  if (!intent) return null;
  await dependencies.clearPersistedState();
  await dependencies.clearComposerDrafts();
  await dependencies.clearComposerAttachmentFiles();
  await dependencies.clearLearnerContext();
  await records.clear();
  await records.completeClear(intent.id);
  return intent;
}
