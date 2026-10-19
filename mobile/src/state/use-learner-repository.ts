/**
 * Lifecycle of the SQLite learner repository: hydration flags, the validated
 * snapshot, serialized writes, and the debounced persistence of app state to
 * both the repository and the compatibility cache.
 */
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PortableLearnerData } from "@keating/learner-contracts";
import type { LearnerRepository } from "@/lib/learner-repository";
import { MobileJudgementReviewStore, type MobileJudgementReviewRecord } from "@/lib/learner-repository/judgement-reviews";
import { reconcileNativeStateIntoPortable } from "@/lib/learner-repository/portable-native-state";
import { reviewMobileQuestionChecks, type MobileQuestionReviewInput } from "@/lib/judgement/grading";
import { savePersistedState } from "@/lib/storage";
import type { PersistedAppState } from "@/lib/types";
import { type WriteTail, enqueueRepositoryWrite } from "@/state/repository-writes";

/** Debounce between a state change and its write to storage. */
export const PERSIST_DEBOUNCE_MS = 120;

export interface RepositoryRefs {
  repository: MutableRefObject<LearnerRepository | null>;
  writeTail: WriteTail;
  /** True while a clear/import is replacing the learner's data. */
  clearing: MutableRefObject<boolean>;
  /** True while quiz evidence tied to the old data must not be produced. */
  evidenceChanging: MutableRefObject<boolean>;
}

export interface LearnerRepositoryState {
  refs: RepositoryRefs;
  hydrated: boolean;
  setHydrated: Dispatch<SetStateAction<boolean>>;
  persistenceReady: boolean;
  setPersistenceReady: Dispatch<SetStateAction<boolean>>;
  repositoryReady: boolean;
  setRepositoryReady: Dispatch<SetStateAction<boolean>>;
  learnerData: PortableLearnerData | null;
  setLearnerData: Dispatch<SetStateAction<PortableLearnerData | null>>;
  judgementReviews: MobileJudgementReviewRecord[];
  setJudgementReviews: Dispatch<SetStateAction<MobileJudgementReviewRecord[]>>;
  persistLearnerState(next: PersistedAppState, required?: boolean): Promise<void>;
  queueLearnerState(next: PersistedAppState): void;
  mutateLearnerRecords<Result>(
    mutation: (current: PortableLearnerData, now: string) => { data: PortableLearnerData; result: Result },
  ): Promise<Result>;
  queueQuestionReviews(inputs: readonly MobileQuestionReviewInput[]): void;
}

const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function useLearnerRepository(setStorageError: (message: string) => void): LearnerRepositoryState {
  const [hydrated, setHydrated] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [repositoryReady, setRepositoryReady] = useState(false);
  const [judgementReviews, setJudgementReviews] = useState<MobileJudgementReviewRecord[]>([]);
  const [learnerData, setLearnerData] = useState<PortableLearnerData | null>(null);
  const pendingJudgements = useRef(new Set<string>());
  const repository = useRef<LearnerRepository | null>(null);
  const writeTail = useRef<Promise<unknown>>(Promise.resolve());
  const clearing = useRef(false);
  const evidenceChanging = useRef(false);
  const refs = useMemo<RepositoryRefs>(
    () => ({ repository, writeTail, clearing, evidenceChanging }),
    [],
  );

  const persistLearnerState = useCallback(async (next: PersistedAppState, required = false) => {
    const repository = refs.repository.current;
    if (!repository || refs.clearing.current) {
      if (required) throw new Error("The local learner repository is unavailable, so Keating did not apply the tool effect.");
      return;
    }
    await enqueueRepositoryWrite(refs.writeTail, async () => {
      if (refs.clearing.current) {
        if (required) throw new Error("Learning data is being cleared, so Keating did not apply the tool effect.");
        return;
      }
      const current = await repository.records.snapshot();
      const currentLocations = await repository.records.getLocalAttachments();
      const reconciled = reconcileNativeStateIntoPortable(current, next, currentLocations);
      await repository.records.replaceWithLocalAttachments(reconciled.data, reconciled.localAttachments);
      setLearnerData(reconciled.data);
    });
  }, [refs]);

  const mutateLearnerRecords = useCallback(async <Result,>(
    mutation: (current: PortableLearnerData, now: string) => { data: PortableLearnerData; result: Result },
  ): Promise<Result> => {
    const repository = refs.repository.current;
    if (!repository || refs.clearing.current) {
      throw new Error("Learning data is still loading. Wait a moment and try again.");
    }
    let result: Result | undefined;
    const write = enqueueRepositoryWrite(refs.writeTail, async () => {
      if (refs.clearing.current) throw new Error("Learning data is being cleared. Try again when it finishes.");
      const updated = await repository.records.mutatePortable((current, now) => {
        const applied = mutation(current, now);
        result = applied.result;
        return applied.data;
      });
      setLearnerData(updated);
    });
    try {
      await write;
    } catch (error) {
      setStorageError(errorText(error, "Could not update the learner repository."));
      throw error;
    }
    if (result === undefined) throw new Error("The learner update did not produce a result.");
    return result;
  }, [refs, setStorageError]);

  const queueQuestionReviews = useCallback((inputs: readonly MobileQuestionReviewInput[]) => {
    const repository = refs.repository.current;
    if (!repository || refs.clearing.current) return;
    for (const source of inputs) {
      const key = JSON.stringify(source);
      if (pendingJudgements.current.has(key)) continue;
      pendingJudgements.current.add(key);
      void (async () => {
        const [judgement] = await reviewMobileQuestionChecks([source.input]);
        if (!judgement || refs.repository.current !== repository || refs.clearing.current) return;
        await enqueueRepositoryWrite(refs.writeTail, async () => {
          if (refs.repository.current !== repository || refs.clearing.current) return;
          const reviews = new MobileJudgementReviewStore(repository.database);
          if (!await reviews.saveIfCurrent(source, judgement)) return;
          setLearnerData(await repository.records.snapshot());
          setJudgementReviews(await reviews.list());
        });
      })().catch(() => { /* Saved answers remain authoritative; never expose provider bodies. */ })
        .finally(() => pendingJudgements.current.delete(key));
    }
  }, [refs]);

  const queueLearnerState = useCallback((next: PersistedAppState) => {
    void persistLearnerState(next).catch((error) => {
      setStorageError(errorText(error, "Could not save the SQLite learner repository."));
    });
  }, [persistLearnerState, setStorageError]);

  return {
    refs, hydrated, setHydrated, persistenceReady, setPersistenceReady, repositoryReady, setRepositoryReady,
    learnerData, setLearnerData, judgementReviews, setJudgementReviews,
    persistLearnerState, queueLearnerState, mutateLearnerRecords, queueQuestionReviews,
  };
}

/** Debounced mirror of app state into the AsyncStorage compatibility cache and into SQLite. */
export function useLearnerStatePersistence(
  repo: LearnerRepositoryState,
  state: PersistedAppState,
  setStorageError: (message: string) => void,
): void {
  const { hydrated, persistenceReady, repositoryReady, persistLearnerState } = repo;
  const repositoryRef = repo.refs.repository;
  useEffect(() => {
    if (!hydrated || !persistenceReady) return;
    const timeout = setTimeout(() => {
      savePersistedState(state).catch((error) => {
        setStorageError(errorText(error, "Could not save local learning data."));
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [hydrated, persistenceReady, setStorageError, state]);

  useEffect(() => {
    if (!hydrated || !repositoryReady) return;
    const timeout = setTimeout(() => {
      if (!repositoryRef.current) return;
      try {
        persistLearnerState(state).catch((error) => {
          setStorageError(errorText(error, "Could not save the SQLite learner repository."));
        });
      } catch (error) {
        setStorageError(errorText(error, "Could not prepare learning data for SQLite."));
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [hydrated, persistLearnerState, repositoryReady, repositoryRef, setStorageError, state]);
}
