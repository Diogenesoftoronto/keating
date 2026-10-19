/**
 * Optional, source-bound learning evidence: saved memory admission, local
 * recall, quiz-performance predictions and background activity research.
 * Each is cancelled whenever the identity or judge configuration it was
 * built for changes.
 */
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { DEFAULT_MODELS } from "@keating/runtime-config";
import type { UiDocument } from "@keating/learner-contracts";
import { createMobileNeedleRecall } from "@/lib/needle-retrieval";
import { createId } from "@/lib/types";
import type { KeatingUiSettings } from "@/lib/ui-settings";
import { createMobileMemoryAdmission } from "@/lib/judgement/memory-admission";
import { mobileJudgementCalibrationStore, mobileLocalJudgementCalibrationStore } from "@/lib/judgement/calibration";
import { MobileQuizPerformanceSession } from "@/lib/judgement/quiz-performance";
import { MobileQuizPerformanceStore, type MobileQuizPerformanceExport } from "@/lib/learner-repository/quiz-performance";
import { MobileActivityLearningStore } from "@/lib/learner-repository/activity-learning";
import { mobileOnlineLearningPreferences } from "@/lib/judgement/online-learning";
import { mobileActivityBoundaries } from "@/lib/judgement/activity-learning";
import { MobileBackgroundActivityLearning } from "@/lib/judgement/background-activity-learning";
import { notOrganicTabularRequest } from "@/lib/notorganic-account/client";
import type { LearnerRepository } from "@/lib/learner-repository";
import type { PersistedAppState } from "@/lib/types";
import type { AccountScopes } from "@/state/use-account-scopes";
import type { RepositoryRefs } from "@/state/use-learner-repository";
import { currentCalibrationRevisions } from "@/state/calibration-revisions";
import {
  backgroundActivityAllowed,
  configuredJudgeKey,
  hostedPredictionAllowed,
  memoryRequestKey,
} from "@/state/judge-config";

export type NeedleRecall = ReturnType<typeof createMobileNeedleRecall>;
export type MemoryAdmission = ReturnType<typeof createMobileMemoryAdmission>;

export interface QuizPerformanceHolder {
  repository: LearnerRepository;
  identity: string;
  session: MobileQuizPerformanceSession;
}

export interface LearnerEvidence {
  memoryAdmissionRef: MutableRefObject<MemoryAdmission | null>;
  needleRecallRef: MutableRefObject<NeedleRecall | null>;
  quizPerformanceRef: MutableRefObject<QuizPerformanceHolder | null>;
  activityControllerRef: MutableRefObject<AbortController | null>;
  refreshBackgroundActivity(): void;
  createQuizPerformanceAttempt(document: UiDocument, nodeId: string): ReturnType<MobileQuizPerformanceSession["create"]>;
  exportQuizPerformanceEvidence(documentId: string, nodeId: string): ReturnType<MobileQuizPerformanceSession["export"]>;
  isQuizPerformanceEvidenceCurrent(evidence: MobileQuizPerformanceExport): boolean;
}

interface EvidenceInputs {
  stateRef: MutableRefObject<PersistedAppState>;
  activeSessionId: string;
  uiSettings: KeatingUiSettings;
  uiSettingsRef: MutableRefObject<KeatingUiSettings>;
  scopes: AccountScopes;
  repo: RepositoryRefs;
}

export function useLearnerEvidence({ stateRef, activeSessionId, uiSettings, uiSettingsRef, scopes, repo }: EvidenceInputs): LearnerEvidence {
  const { quizIdentity, quizIdentityRef, activityAccountRef, memoryScopeRef } = scopes;
  const activityControllerRef = useRef<AbortController | null>(null);
  const backgroundActivityRef = useRef<MobileBackgroundActivityLearning | null>(null);
  const backgroundActivityEpochRef = useRef(0);
  backgroundActivityRef.current ??= new MobileBackgroundActivityLearning();
  const quizPerformanceRef = useRef<QuizPerformanceHolder | null>(null);
  const needleRecallRef = useRef<NeedleRecall | null>(null);
  needleRecallRef.current ??= createMobileNeedleRecall();
  const memoryAdmissionRef = useRef<MemoryAdmission | null>(null);
  memoryAdmissionRef.current ??= createMobileMemoryAdmission({
    sessions: () => stateRef.current.sessions,
    scope: () => memoryScopeRef.current,
    enabled: () => uiSettingsRef.current.judgementMemory,
    current: () => !!repo.repository.current && !repo.clearing.current && !repo.evidenceChanging.current,
    requestIdentity: () => memoryRequestKey(quizIdentityRef.current, uiSettingsRef.current, currentCalibrationRevisions()),
  });

  useEffect(() => {
    const cancel = () => memoryAdmissionRef.current?.cancel();
    const hosted = mobileJudgementCalibrationStore.subscribe(cancel);
    const local = mobileLocalJudgementCalibrationStore.subscribe(cancel);
    return () => { cancel(); hosted(); local(); };
  }, []);
  useEffect(() => {
    memoryAdmissionRef.current?.cancel();
    return () => memoryAdmissionRef.current?.cancel();
  }, [quizIdentity, uiSettings.judgementMemory, uiSettings.judgementHosted, uiSettings.judgementLocalModel, activeSessionId]);
  useEffect(() => {
    needleRecallRef.current?.clear();
    return () => needleRecallRef.current?.clear();
  }, [quizIdentity]);
  useEffect(() => {
    quizPerformanceRef.current?.session.invalidate();
    return () => quizPerformanceRef.current?.session.invalidate();
  }, [quizIdentity, uiSettings.judgementHosted, uiSettings.judgementLocalModel]);
  useEffect(() => () => activityControllerRef.current?.abort(),
    [quizIdentity, uiSettings.judgementHosted, uiSettings.judgementLocalModel, activeSessionId]);
  useEffect(() => {
    const cancel = () => { backgroundActivityEpochRef.current++; backgroundActivityRef.current?.cancel(); };
    const preference = mobileOnlineLearningPreferences.subscribe(cancel);
    const hosted = mobileJudgementCalibrationStore.subscribe(cancel);
    const local = mobileLocalJudgementCalibrationStore.subscribe(cancel);
    const app = AppState.addEventListener("change", next => { if (next !== "active") cancel(); });
    return () => { cancel(); preference(); hosted(); local(); app.remove(); };
  }, [quizIdentity, uiSettings.judgementHosted, uiSettings.judgementLocalModel]);

  const refreshBackgroundActivity = useCallback(() => {
    const repository = repo.repository.current, { scope, granted } = activityAccountRef.current;
    const settings = uiSettingsRef.current;
    if (!scope || !repository || !backgroundActivityAllowed({
      appActive: AppState.currentState === "active", hasRepository: true, scope, granted,
      preference: mobileOnlineLearningPreferences.get(scope), expectedPreference: DEFAULT_MODELS.judgement.tabular,
      chatMode: mobileOnlineLearningPreferences.chatMode(scope),
    }, settings)) return;
    const identity = quizIdentityRef.current, preference = mobileOnlineLearningPreferences.epoch(scope), epoch = backgroundActivityEpochRef.current;
    const configuredJudge = configuredJudgeKey(settings, currentCalibrationRevisions());
    // Conversation changes are deliberately absent: valid research can finish during a later turn.
    const current = () => AppState.currentState === "active" && backgroundActivityEpochRef.current === epoch
      && repo.repository.current === repository && !repo.clearing.current && !repo.evidenceChanging.current
      && quizIdentityRef.current === identity && activityAccountRef.current.scope === scope && activityAccountRef.current.granted
      && mobileOnlineLearningPreferences.get(scope) === DEFAULT_MODELS.judgement.tabular && mobileOnlineLearningPreferences.chatMode(scope) === "background"
      && mobileOnlineLearningPreferences.epoch(scope) === preference
      && configuredJudge === configuredJudgeKey(uiSettingsRef.current, currentCalibrationRevisions());
    const store = new MobileActivityLearningStore(repository.database, scope);
    void store.generation().then(generation => {
      if (!current()) return;
      backgroundActivityRef.current?.schedule({ scope, generation, store, current,
        boundaries: () => mobileActivityBoundaries(stateRef.current.sessions),
        transport: async (request, signal, fresh) => {
          const response = await notOrganicTabularRequest(request, signal, undefined, fresh);
          if (!response.ok) throw Error("Background teaching research unavailable.");
          return response.json();
        } });
    }).catch(() => undefined);
  }, [repo, activityAccountRef, quizIdentityRef, stateRef, uiSettingsRef]);

  const quizPerformanceSession = useCallback(() => {
    const repository = repo.repository.current;
    if (!repository || repo.clearing.current || repo.evidenceChanging.current) throw new Error("Learning data is still loading or changing. Try again shortly.");
    const identity = quizIdentityRef.current;
    let stored = quizPerformanceRef.current;
    if (!stored || stored.repository !== repository || stored.identity !== identity) {
      stored?.session.invalidate();
      const session = new MobileQuizPerformanceSession({
        store: new MobileQuizPerformanceStore(repository.database),
        history: () => repository.records.snapshot(),
        id: () => createId("prediction"),
        current: () => repo.repository.current === repository && !repo.clearing.current && !repo.evidenceChanging.current
          && quizIdentityRef.current === identity,
        hostedAllowed: () => hostedPredictionAllowed(uiSettingsRef.current),
      });
      stored = { repository, identity, session };
      quizPerformanceRef.current = stored;
    }
    return stored.session;
  }, [repo, quizIdentityRef, uiSettingsRef]);
  const createQuizPerformanceAttempt = useCallback((document: UiDocument, nodeId: string) => quizPerformanceSession().create(document, nodeId), [quizPerformanceSession]);
  const exportQuizPerformanceEvidence = useCallback((documentId: string, nodeId: string) => quizPerformanceSession().export(documentId, nodeId), [quizPerformanceSession]);
  const isQuizPerformanceEvidenceCurrent = useCallback((evidence: MobileQuizPerformanceExport) => quizPerformanceRef.current?.session.isExportCurrent(evidence) ?? false, []);

  return {
    memoryAdmissionRef, needleRecallRef, quizPerformanceRef, activityControllerRef,
    refreshBackgroundActivity, createQuizPerformanceAttempt, exportQuizPerformanceEvidence, isQuizPerformanceEvidenceCurrent,
  };
}
