/**
 * App start-up: reads provider credentials, the cached model catalog, the
 * persona, and opens the SQLite learner repository. Loaders and sinks are
 * injected so the sequencing (and its failure fallbacks) is testable without
 * React or native storage.
 */
import { normalizeState } from "@/state/session-state";
import type { LearnerRepository } from "@/lib/learner-repository";
import type { CatalogModel } from "@/lib/model-catalog";
import type { PortableLearnerData } from "@keating/learner-contracts";
import type { MobileJudgementReviewRecord } from "@/lib/learner-repository/judgement-reviews";
import type { PersistedAppState, ProviderId, ProviderSettings } from "@/lib/types";
import type { projectPortableToNativeState } from "@/lib/learner-repository/portable-native-state";

export type KeyStatus = Record<ProviderId, boolean>;

export interface HydrationLoaders {
  providerIds: readonly ProviderId[];
  hasProviderKey(provider: ProviderId): Promise<unknown>;
  readCachedModelCatalog(): Promise<readonly CatalogModel[]>;
  loadPersona(): Promise<string>;
  /** Owns migration and interrupted-delete recovery before the legacy cache is read. */
  bootstrapRepository(): Promise<{ repository: LearnerRepository }>;
  loadPersistedState(): Promise<PersistedAppState | null>;
  loadLearnerContext(): Promise<string>;
  listJudgementReviews(repository: LearnerRepository): Promise<MobileJudgementReviewRecord[]>;
  project: typeof projectPortableToNativeState;
  defaultProviderSettings: ProviderSettings;
}

export interface HydrationSinks {
  setKeyStatus(status: KeyStatus): void;
  mergeCachedCatalog(cached: readonly CatalogModel[]): void;
  setPersona(text: string): void;
  setStorageError(message: string): void;
  /** Publishes the validated snapshot and attaches the repository for later writes. */
  attachRepository(repository: LearnerRepository, state: PersistedAppState, snapshot: PortableLearnerData): void;
  setJudgementReviews(reviews: MobileJudgementReviewRecord[]): void;
  setLearnerContext(text: string): void;
  markRepositoryReady(): void;
  /** SQLite could not open: keep the preserved cache usable. */
  useCacheOnly(state: PersistedAppState): void;
  markHydrated(): void;
  /** Called on teardown with the repository to close once queued writes settle. */
  releaseRepository(opened: LearnerRepository | null): void;
}

const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

async function loadRepositoryState(loaders: HydrationLoaders, repository: LearnerRepository) {
  // Repository bootstrap owns migration and interrupted-delete recovery,
  // so the legacy UI cache is read only after those operations settle.
  const persisted = await loaders.loadPersistedState();
  const snapshot = await repository.records.snapshot();
  const localAttachments = await repository.records.getLocalAttachments();
  const projected = loaders.project(
    snapshot,
    persisted?.providerSettings ?? loaders.defaultProviderSettings,
    localAttachments,
    persisted?.activeSessionId,
  );
  const state = normalizeState(projected.state);
  const learnerContext = await loaders.loadLearnerContext();
  return { snapshot, state, learnerContext };
}

/** Starts hydration and returns the teardown. Matches the provider's original effect order. */
export function startHydration(loaders: HydrationLoaders, sinks: HydrationSinks): () => void {
  let cancelled = false;
  let openedRepository: LearnerRepository | null = null;

  Promise.all(loaders.providerIds.map(async (provider) => [provider, Boolean(await loaders.hasProviderKey(provider))] as const))
    .then((keys) => {
      if (!cancelled) sinks.setKeyStatus(Object.fromEntries(keys) as KeyStatus);
    })
    .catch((error) => {
      if (!cancelled) sinks.setStorageError(message(error, "Could not read provider credentials."));
    });

  // The model list the selector caches also tells us which models accept a
  // thinking budget, so the reasoning control never offers an unsupported
  // parameter. A miss just leaves the built-in catalog in place.
  loaders.readCachedModelCatalog()
    .then((cached) => {
      if (!cancelled && cached.length > 0) sinks.mergeCachedCatalog(cached);
    })
    .catch(() => undefined);

  loaders.loadPersona()
    .then((storedPersona) => {
      if (!cancelled) sinks.setPersona(storedPersona);
    })
    .catch((error) => {
      if (!cancelled) sinks.setStorageError(message(error, "Could not load the tutor persona."));
    });

  loaders.bootstrapRepository()
    .then(async ({ repository }) => {
      openedRepository = repository;
      if (cancelled) {
        void repository.close();
        return;
      }
      const { snapshot, state, learnerContext } = await loadRepositoryState(loaders, repository);
      if (cancelled) {
        void repository.close();
        return;
      }
      sinks.attachRepository(repository, state, snapshot);
      sinks.setJudgementReviews(await loaders.listJudgementReviews(repository));
      sinks.setLearnerContext(learnerContext);
      sinks.markRepositoryReady();
    })
    .catch(async (error) => {
      if (cancelled) return;
      sinks.setStorageError(error instanceof Error
        ? `SQLite learner repository: ${error.message}`
        : "Could not open the SQLite learner repository.");
      // Keep the learner's preserved cache usable when SQLite cannot open;
      // no repository-backed feature is claimed in this recovery mode.
      try {
        sinks.useCacheOnly(normalizeState(await loaders.loadPersistedState()));
      } catch {
        // The primary error already explains why storage is unavailable.
      }
    })
    .finally(() => {
      if (!cancelled) sinks.markHydrated();
    });

  return () => {
    cancelled = true;
    sinks.releaseRepository(openedRepository);
  };
}
