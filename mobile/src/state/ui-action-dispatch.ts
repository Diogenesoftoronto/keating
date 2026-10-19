/**
 * Dispatch of a learner's interaction with a rendered document (answer a
 * question, grade a quiz). The answer and its journal commit first; optional
 * evidence (judge review, activity link, quiz-performance record) is queued
 * behind it and never delays the acknowledgement.
 */
import { DEFAULT_MODELS } from "@keating/runtime-config";
import type { PortableLearnerData, UiAction, UiActionResult, UiDocument } from "@keating/learner-contracts";
import type { LearnerRepository } from "@/lib/learner-repository";
import { MobileActivityLearningStore } from "@/lib/learner-repository/activity-learning";
import { projectPortableToNativeState } from "@/lib/learner-repository/portable-native-state";
import { mobileQuestionReviewInputs, type MobileQuestionReviewInput } from "@/lib/judgement/grading";
import { mobileOnlineLearningPreferences } from "@/lib/judgement/online-learning";
import { savePersistedState } from "@/lib/storage";
import { applyLocalUiAction } from "@/lib/ui-action-mutations";
import type { PersistedAppState } from "@/lib/types";
import type { ActivityAccount } from "@/state/account-scope";
import { drainRepositoryWrites, enqueueRepositoryWrite } from "@/state/repository-writes";
import { normalizeState } from "@/state/session-state";
import type { RepositoryRefs } from "@/state/use-learner-repository";
import type { QuizPerformanceHolder } from "@/state/use-learner-evidence";
import type { MutableRefObject } from "react";

export interface DispatchEnv {
  repo: RepositoryRefs;
  stateRef: MutableRefObject<PersistedAppState>;
  quizIdentityRef: MutableRefObject<string>;
  activityAccountRef: MutableRefObject<ActivityAccount>;
  quizPerformanceRef: MutableRefObject<QuizPerformanceHolder | null>;
  commitState(next: PersistedAppState): void;
  setLearnerData(data: PortableLearnerData): void;
  setStorageError(message: string): void;
  queueQuestionReviews(inputs: readonly MobileQuestionReviewInput[]): void;
  refreshBackgroundActivity(): void;
}

type ActivityEvidence = Pick<PortableLearnerData, "questionChecks" | "quizResults">;

/** The activity store for this account, when the learner's online-learning choice still holds. */
async function activityEvidenceStore(repository: LearnerRepository, outcomeCurrent: () => boolean, account: ActivityAccount) {
  const store = account.scope && outcomeCurrent() ? new MobileActivityLearningStore(repository.database, account.scope) : null;
  const generation = store ? await store.generation().catch(() => null) : null;
  return { store, generation };
}

/** Re-reads the committed snapshot into native state and mirrors it to the compatibility cache. */
async function publishCommittedSnapshot(env: DispatchEnv, repository: LearnerRepository): Promise<void> {
  const snapshot = await repository.records.snapshot();
  const locations = await repository.records.getLocalAttachments();
  const current = env.stateRef.current;
  const projected = projectPortableToNativeState(snapshot, current.providerSettings, locations, current.activeSessionId);
  const next = normalizeState(projected.state);
  env.commitState(next);
  env.setLearnerData(snapshot);
  try {
    await savePersistedState(next);
  } catch (error) {
    env.setStorageError(error instanceof Error ? error.message : "OpenUI progress was saved, but the compatibility cache could not be refreshed.");
  }
}

export async function dispatchLocalUiAction(
  env: DispatchEnv,
  action: UiAction,
  document: UiDocument,
  sessionId?: string,
): Promise<UiActionResult> {
  const repository = env.repo.repository.current;
  if (!repository) throw new Error("Learning data is still loading. Wait a moment and try again.");
  const committedAction = structuredClone(action);
  const committedDocument = structuredClone(document);
  const outcomeAccount = env.activityAccountRef.current;
  const outcomeIdentity = env.quizIdentityRef.current;
  const outcomeCurrent = () => env.repo.repository.current === repository && env.quizIdentityRef.current === outcomeIdentity
    && !env.repo.clearing.current && !env.repo.evidenceChanging.current && env.activityAccountRef.current.scope === outcomeAccount.scope
    && !!outcomeAccount.scope && mobileOnlineLearningPreferences.get(outcomeAccount.scope) === DEFAULT_MODELS.judgement.tabular;
  const { store: activityStore, generation: activityGeneration } = await activityEvidenceStore(repository, outcomeCurrent, outcomeAccount);
  let priorActivityEvidence: ActivityEvidence | null = null;
  let result: UiActionResult | undefined;
  let reviewInputs: MobileQuestionReviewInput[] = [];
  await enqueueRepositoryWrite(env.repo.writeTail, async () => {
    result = await repository.uiActions.dispatch(action, document, (current, now) => {
      priorActivityEvidence = structuredClone({ questionChecks: current.questionChecks, quizResults: current.quizResults });
      const applied = applyLocalUiAction(current, action, document, now, sessionId);
      const existing = new Set(current.questionChecks.map(check => check.id));
      reviewInputs = mobileQuestionReviewInputs(applied.data.questionChecks.filter(check => !existing.has(check.id)), document);
      return applied;
    });
    await publishCommittedSnapshot(env, repository);
  });
  if (!result) throw new Error("OpenUI action did not produce a durable result.");
  if (result.status === "completed") {
    env.queueQuestionReviews(reviewInputs);
    if (activityStore && activityGeneration !== null && priorActivityEvidence && sessionId) {
      const prior: ActivityEvidence = priorActivityEvidence;
      void enqueueRepositoryWrite(env.repo.writeTail, async () => {
        try {
          await activityStore.linkCommitted(activityGeneration, committedAction, committedDocument, sessionId, prior, outcomeCurrent);
          env.refreshBackgroundActivity();
        } catch { /* Optional evidence never fails the committed answer. */ }
      });
    }
    // The answer and its journal already committed. Serialize optional local evidence with
    // later repository writes, while returning this acknowledgement without waiting for it.
    const evidenceSession = env.quizPerformanceRef.current;
    if (evidenceSession?.repository === repository) {
      void enqueueRepositoryWrite(env.repo.writeTail, async () => {
        try {
          await evidenceSession.session.collectCommitted(committedAction, committedDocument);
        } catch { /* Optional evidence never fails the committed answer. */ }
      });
    }
  }
  return result;
}

export async function readUiActionJournal(repo: RepositoryRefs, documentId: string) {
  const repository = repo.repository.current;
  if (!repository) throw new Error("Learning data is still loading. Wait a moment and try again.");
  await drainRepositoryWrites(repo.writeTail);
  return repository.uiActions.getJournal(documentId);
}
