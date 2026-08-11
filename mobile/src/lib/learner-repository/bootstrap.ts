import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { clearAllComposerDrafts } from "../composer-draft-storage";
import { clearComposerAttachmentFiles } from "../composer-attachments";
import { saveLearnerContext } from "../learner-context-storage";
import { clearPersistedState, loadPersistedStateSource } from "../storage";
import { resumePendingLearningDataClear } from "./clear-recovery";
import { openExpoLearnerRepository } from "./expo";
import {
  LEGACY_ASYNC_STORAGE_MIGRATION_ID,
  migrateLegacyPersistedStateToRepository,
  type LegacyMigrationConversion,
} from "./legacy-migration";
import type { LearnerRepository } from "./index";

export interface BootstrappedLearnerRepository {
  repository: LearnerRepository;
  migration: LegacyMigrationConversion | null;
  recoveredClear: boolean;
}

/** Opens SQLite and resumably copies the exact preserved AsyncStorage source. */
export async function bootstrapLearnerRepository(): Promise<BootstrappedLearnerRepository> {
  const repository = await openExpoLearnerRepository();
  try {
    const recoveredClear = await resumePendingLearningDataClear(repository.records, {
      clearPersistedState,
      clearComposerDrafts: clearAllComposerDrafts,
      clearComposerAttachmentFiles,
      clearLearnerContext: () => saveLearnerContext(""),
    });
    if (recoveredClear) return { repository, migration: null, recoveredClear: true };
    const existing = await repository.migrations.get(LEGACY_ASYNC_STORAGE_MIGRATION_ID);
    if (existing?.phase === "completed") return { repository, migration: null, recoveredClear: false };
    const source = await loadPersistedStateSource();
    if (!source) {
      if (existing) throw new Error("The preserved AsyncStorage migration source is missing before verification completed.");
      return { repository, migration: null, recoveredClear: false };
    }
    const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, source.raw);
    const migration = await migrateLegacyPersistedStateToRepository(repository, {
      state: source.state,
      digest,
    });
    return { repository, migration, recoveredClear: false };
  } catch (error) {
    await repository.close();
    throw error;
  }
}
