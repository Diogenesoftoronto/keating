/** Learner-data operations: goals, quizzes, decks, card reviews, UI actions, and export/import/clear. */
import { type MutableRefObject, useCallback, useMemo } from "react";
import type {
  CardReviewRecord,
  GoalStepStatus,
  LearnerGoal,
  LearnerQuestionCheck,
  LearnerQuizResult,
  PortableLearnerEnvelope,
  SrsRating,
  StudyPriority,
  StudyPriorityTargetType,
  UiAction,
  UiActionJournal,
  UiActionResult,
  UiDocument,
} from "@keating/learner-contracts";
import { clearComposerAttachmentFiles } from "@/lib/composer-attachments";
import { clearAllComposerDrafts } from "@/lib/composer-draft-storage";
import { saveLearnerContext } from "@/lib/learner-context-storage";
import { resumePendingLearningDataClear } from "@/lib/learner-repository/clear-recovery";
import { projectPortableToNativeState } from "@/lib/learner-repository/portable-native-state";
import {
  appendQuestionChecks as appendQuestionChecksData,
  appendQuizResult as appendQuizResultData,
  ensureLearnerGoal as ensureLearnerGoalData,
  recordCardReview as recordCardReviewData,
  setStudyPriority as setStudyPriorityData,
  updateGoalStep as updateGoalStepData,
} from "@/lib/learner-mutations";
import { createDeckWithCards as createDeckWithCardsData } from "@/lib/learner-decks";
import { clearPersistedState, savePersistedState } from "@/lib/storage";
import { createId } from "@/lib/types";
import type { PortableLearnerData } from "@keating/learner-contracts";
import type { UnprojectedNativeRecords } from "@/lib/learner-repository/portable-native-state";
import type { ActivityAccount } from "@/state/account-scope";
import { clearCardState } from "@/state/card-state";
import { beginDataReplacement, endDataReplacement } from "@/state/learner-data-replacement";
import { learningDataClearDependencies } from "@/lib/learner-repository/learning-data-clear";
import { drainRepositoryWrites, enqueueRepositoryWrite } from "@/state/repository-writes";
import { initialState, normalizeState } from "@/state/session-state";
import { dispatchLocalUiAction, readUiActionJournal } from "@/state/ui-action-dispatch";
import type { LearnerEvidence } from "@/state/use-learner-evidence";
import type { LearnerRepositoryState } from "@/state/use-learner-repository";
import type { SessionStore } from "@/state/use-session-store";
import type { TutorProfile } from "@/state/use-tutor-profile";
import type { TeachingRun } from "@/state/use-teaching-run";

export interface LearnerDataActions {
  exportLearnerData(): Promise<PortableLearnerEnvelope>;
  importLearnerData(candidate: unknown): Promise<{ data: PortableLearnerData; unprojected: UnprojectedNativeRecords }>;
  saveLearnerGoal(goal: LearnerGoal): Promise<void>;
  saveLearnerGoalStep(goal: LearnerGoal, stepId: string, status: GoalStepStatus): Promise<void>;
  saveLearnerQuizResult(result: LearnerQuizResult): Promise<void>;
  saveLearnerQuestionChecks(checks: readonly LearnerQuestionCheck[]): Promise<void>;
  createLearnerDeck(title: string, topic: string, cards: readonly { front: string; back: string; tags: readonly string[] }[]): Promise<string>;
  updateLearnerGoalStep(goalId: string, stepId: string, status: GoalStepStatus): Promise<void>;
  recordLearnerCardReview(deckId: string, cardId: string, rating: SrsRating): Promise<CardReviewRecord>;
  setLearnerStudyPriority(targetType: StudyPriorityTargetType, targetId: string, priority: StudyPriority): Promise<void>;
  dispatchUiAction(action: UiAction, document: UiDocument, sessionId?: string): Promise<UiActionResult>;
  getUiActionJournal(documentId: string): Promise<UiActionJournal>;
  clearLearningData(): Promise<void>;
}

interface LearnerDataInputs {
  store: SessionStore;
  repo: LearnerRepositoryState;
  evidence: LearnerEvidence;
  tutor: TutorProfile;
  run: TeachingRun;
  quizIdentityRef: MutableRefObject<string>;
  activityAccountRef: MutableRefObject<ActivityAccount>;
  setStorageError(message: string | null): void;
}

const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function useLearnerDataActions(inputs: LearnerDataInputs): LearnerDataActions {
  const { store, repo, evidence, tutor, run, quizIdentityRef, activityAccountRef, setStorageError } = inputs;
  const { stateRef, commitState } = store;
  const { refs, setLearnerData, mutateLearnerRecords, setJudgementReviews, setPersistenceReady, queueQuestionReviews } = repo;
  const { setLearnerContextLocal } = tutor;
  const { stopGeneration, generationPromiseRef } = run;
  const { memoryAdmissionRef, needleRecallRef, quizPerformanceRef } = evidence;
  const replacementEnv = useMemo(
    () => ({ repo: refs, evidence: { memoryAdmissionRef, needleRecallRef, quizPerformanceRef }, stopGeneration, generationPromiseRef }),
    [refs, memoryAdmissionRef, needleRecallRef, quizPerformanceRef, stopGeneration, generationPromiseRef],
  );

  const exportLearnerData = useCallback(async (): Promise<PortableLearnerEnvelope> => {
    const repository = refs.repository.current;
    if (!repository) throw new Error("Learning data is still loading. Wait a moment and try exporting again.");
    await drainRepositoryWrites(refs.writeTail);
    return repository.records.exportPortable();
  }, [refs]);

  const importLearnerData = useCallback(async (candidate: unknown) => {
    const repository = await beginDataReplacement(replacementEnv, "importing");
    let result: { data: PortableLearnerData; unprojected: UnprojectedNativeRecords } | undefined;
    try {
      await enqueueRepositoryWrite(refs.writeTail, async () => {
        const merged = await repository.records.importPortable(candidate);
        const locations = await repository.records.getLocalAttachments();
        const current = stateRef.current;
        const projected = projectPortableToNativeState(merged, current.providerSettings, locations, current.activeSessionId);
        const next = normalizeState(projected.state);
        commitState(next);
        setLearnerData(merged);
        result = { data: merged, unprojected: projected.unprojected };
        // SQLite is authoritative. AsyncStorage is a compatibility cache, so
        // a cache failure cannot turn a committed import into a false rollback.
        try {
          await savePersistedState(next);
        } catch (error) {
          setStorageError(errorText(error, "Imported data was saved, but the compatibility cache could not be refreshed."));
        }
      });
      if (!result) throw new Error("The learner import did not produce a validated snapshot.");
      return result;
    } finally {
      endDataReplacement(refs);
    }
  }, [replacementEnv, refs, stateRef, commitState, setLearnerData, setStorageError]);

  const updateLearnerGoalStep = useCallback(async (goalId: string, stepId: string, status: GoalStepStatus) => {
    await mutateLearnerRecords((current, now) => ({
      data: updateGoalStepData(current, goalId, stepId, status, now),
      result: true,
    }));
  }, [mutateLearnerRecords]);

  const saveLearnerGoal = useCallback(async (goal: LearnerGoal) => {
    await mutateLearnerRecords((current, now) => ({
      data: ensureLearnerGoalData(current, goal, now),
      result: true,
    }));
  }, [mutateLearnerRecords]);

  const saveLearnerGoalStep = useCallback(async (goal: LearnerGoal, stepId: string, status: GoalStepStatus) => {
    await mutateLearnerRecords((current, now) => {
      const ensured = ensureLearnerGoalData(current, goal, now);
      return { data: updateGoalStepData(ensured, goal.id, stepId, status, now), result: true };
    });
  }, [mutateLearnerRecords]);

  const saveLearnerQuizResult = useCallback(async (result: LearnerQuizResult) => {
    await mutateLearnerRecords((current, now) => ({
      data: appendQuizResultData(current, result, now),
      result: true,
    }));
  }, [mutateLearnerRecords]);

  const saveLearnerQuestionChecks = useCallback(async (checks: readonly LearnerQuestionCheck[]) => {
    await mutateLearnerRecords((current, now) => ({
      data: appendQuestionChecksData(current, checks, now),
      result: true,
    }));
  }, [mutateLearnerRecords]);

  const createLearnerDeck = useCallback(async (
    title: string,
    topic: string,
    cards: readonly { front: string; back: string; tags: readonly string[] }[],
  ): Promise<string> => {
    // IDs are allocated before entering the serialized write tail, so this one
    // invocation has a stable semantic payload even when it waits behind a
    // separate learner mutation.
    const deckId = createId("deck");
    const pendingCards = cards.map((card) => ({
      id: createId("card"),
      front: card.front,
      back: card.back,
      tags: [...card.tags],
    }));
    return mutateLearnerRecords((current, now) => ({
      data: createDeckWithCardsData(current, { id: deckId, title, topic, createdAt: now, cards: pendingCards }),
      result: deckId,
    }));
  }, [mutateLearnerRecords]);

  const recordLearnerCardReview = useCallback(async (
    deckId: string,
    cardId: string,
    rating: SrsRating,
  ): Promise<CardReviewRecord> => mutateLearnerRecords((current, now) => {
    const applied = recordCardReviewData(current, deckId, cardId, rating, createId("review"), now);
    return { data: applied.data, result: applied.review };
  }), [mutateLearnerRecords]);

  const setLearnerStudyPriority = useCallback(async (
    targetType: StudyPriorityTargetType,
    targetId: string,
    priority: StudyPriority,
  ) => {
    await mutateLearnerRecords((current, now) => {
      const applied = setStudyPriorityData(current, targetType, targetId, priority, createId("priority"), now);
      return { data: applied.data, result: applied.record };
    });
  }, [mutateLearnerRecords]);

  const dispatchUiAction = useCallback((action: UiAction, document: UiDocument, sessionId?: string) =>
    dispatchLocalUiAction({
      repo: refs,
      stateRef,
      quizIdentityRef,
      activityAccountRef,
      quizPerformanceRef: evidence.quizPerformanceRef,
      commitState,
      setLearnerData,
      setStorageError,
      queueQuestionReviews,
      refreshBackgroundActivity: evidence.refreshBackgroundActivity,
    }, action, document, sessionId),
  [refs, stateRef, quizIdentityRef, activityAccountRef, evidence.quizPerformanceRef, commitState, setLearnerData,
    setStorageError, queueQuestionReviews, evidence.refreshBackgroundActivity]);

  const getUiActionJournal = useCallback((documentId: string) => readUiActionJournal(refs, documentId), [refs]);

  const clearLearningData = useCallback(async () => {
    const repository = await beginDataReplacement(replacementEnv, "clearing");
    try {
      await drainRepositoryWrites(refs.writeTail);
      const pending = await repository.records.pendingClear();
      const intent = pending ?? { id: createId("clear"), createdAt: new Date().toISOString() };
      if (!pending) await repository.records.beginClear(intent);
      await resumePendingLearningDataClear(repository.records, learningDataClearDependencies({
        clearPersistedState,
        clearComposerDrafts: clearAllComposerDrafts,
        clearComposerAttachmentFiles,
        clearLearnerContext: () => saveLearnerContext(""),
      }));
      clearCardState();
      const next = initialState();
      commitState(next);
      setLearnerContextLocal("");
      setLearnerData(await repository.records.snapshot());
      setJudgementReviews([]);
      setPersistenceReady(true);
      setStorageError(null);
      try {
        await savePersistedState(next);
      } catch (error) {
        setStorageError(errorText(error, "Learning data was cleared, but the compatibility cache could not be refreshed."));
      }
    } finally {
      endDataReplacement(refs);
    }
  }, [replacementEnv, refs, commitState, setLearnerContextLocal, setLearnerData, setJudgementReviews, setPersistenceReady, setStorageError]);

  return {
    exportLearnerData, importLearnerData, saveLearnerGoal, saveLearnerGoalStep, saveLearnerQuizResult, saveLearnerQuestionChecks,
    createLearnerDeck, updateLearnerGoalStep, recordLearnerCardReview, setLearnerStudyPriority,
    dispatchUiAction, getUiActionJournal, clearLearningData,
  };
}
