/** Wires start-up hydration to the stores it fills; see `startHydration` for the sequencing. */
import { type Dispatch, type SetStateAction, useEffect } from "react";
import { PROVIDERS, DEFAULT_PROVIDER_SETTINGS } from "@/lib/provider-config";
import { BUILT_IN_MODEL_CATALOG, mergeCatalogModels } from "@/lib/model-catalog";
import { readCachedModelCatalog } from "@/lib/model-catalog-storage";
import { loadPersona } from "@/lib/persona-storage";
import { loadLearnerContext } from "@/lib/learner-context-storage";
import { getProviderKey, loadPersistedState } from "@/lib/storage";
import { bootstrapLearnerRepository } from "@/lib/learner-repository/bootstrap";
import { MobileJudgementReviewStore } from "@/lib/learner-repository/judgement-reviews";
import { projectPortableToNativeState } from "@/lib/learner-repository/portable-native-state";
import { drainRepositoryWrites } from "@/state/repository-writes";
import { startHydration } from "@/state/hydration";
import type { ProviderSettingsApi } from "@/state/use-provider-settings";
import type { LearnerRepositoryState } from "@/state/use-learner-repository";
import type { SessionStore } from "@/state/use-session-store";
import type { TutorProfile } from "@/state/use-tutor-profile";

interface HydrationInputs {
  store: SessionStore;
  repo: LearnerRepositoryState;
  providers: ProviderSettingsApi;
  tutor: TutorProfile;
  setStorageError: Dispatch<SetStateAction<string | null>>;
}

export function useHydration({ store, repo, providers, tutor, setStorageError }: HydrationInputs): void {
  const { commitState } = store;
  const { refs, setLearnerData, setJudgementReviews, setHydrated, setPersistenceReady, setRepositoryReady } = repo;
  const { setKeyStatus, setCatalog } = providers;
  const { setPersonaLocal, setLearnerContextLocal } = tutor;

  useEffect(() => startHydration({
    providerIds: PROVIDERS.map((provider) => provider.id),
    hasProviderKey: getProviderKey,
    readCachedModelCatalog,
    loadPersona,
    bootstrapRepository: bootstrapLearnerRepository,
    loadPersistedState,
    loadLearnerContext,
    listJudgementReviews: (repository) => new MobileJudgementReviewStore(repository.database).list(),
    project: projectPortableToNativeState,
    defaultProviderSettings: DEFAULT_PROVIDER_SETTINGS,
  }, {
    setKeyStatus,
    mergeCachedCatalog: (cached) => setCatalog(mergeCatalogModels(BUILT_IN_MODEL_CATALOG, cached)),
    setPersona: setPersonaLocal,
    setStorageError,
    attachRepository: (repository, next, snapshot) => {
      refs.repository.current = repository;
      commitState(next);
      setLearnerData(snapshot);
    },
    setJudgementReviews,
    setLearnerContext: setLearnerContextLocal,
    markRepositoryReady: () => {
      setPersistenceReady(true);
      setRepositoryReady(true);
    },
    useCacheOnly: (next) => {
      commitState(next);
      setPersistenceReady(true);
    },
    markHydrated: () => setHydrated(true),
    releaseRepository: (opened) => {
      const repository = refs.repository.current ?? opened;
      refs.repository.current = null;
      if (repository) void drainRepositoryWrites(refs.writeTail).then(() => repository.close());
    },
  // Hydration runs exactly once per mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
}
