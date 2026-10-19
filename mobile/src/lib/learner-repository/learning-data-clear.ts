/**
 * The set of stores wiped when the learner clears their learning data.
 * Draft clearing covers both composer drafts and system-design diagram
 * drafts, so no typed work survives a "clear my data" request.
 */
import { clearAllDiagramDrafts, type DiagramDraftStorage } from "../diagram-draft-storage";
import type { LearningDataClearDependencies } from "./clear-recovery";

export interface LearningDataStores {
  clearPersistedState(): Promise<void>;
  clearComposerDrafts(): Promise<void>;
  clearComposerAttachmentFiles(): Promise<void> | void;
  clearLearnerContext(): Promise<void>;
  /** Defaults to AsyncStorage; tests inject an in-memory store. */
  diagramDraftStorage?: DiagramDraftStorage;
}

export function learningDataClearDependencies(stores: LearningDataStores): LearningDataClearDependencies {
  return {
    clearPersistedState: stores.clearPersistedState,
    clearComposerDrafts: async () => {
      await stores.clearComposerDrafts();
      await clearAllDiagramDrafts(stores.diagramDraftStorage);
    },
    clearComposerAttachmentFiles: stores.clearComposerAttachmentFiles,
    clearLearnerContext: stores.clearLearnerContext,
  };
}
