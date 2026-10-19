import type {
  CardReviewRecord,
  GoalStepStatus,
  LearnerGoal,
  LearnerQuestionCheck,
  LearnerQuizResult,
  PortableLearnerData,
  PortableLearnerEnvelope,
  SrsRating,
  StudyPriority,
  StudyPriorityTargetType,
  UiAction,
  UiActionJournal,
  UiActionResult,
  UiDocument,
} from "@keating/learner-contracts";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CatalogModel } from "@/lib/model-catalog";
import { useUiSettings } from "@/state/UiSettingsProvider";
import type { ReasoningLevel } from "@/lib/ui-settings";
import type { MobileQuizPerformanceAttempt } from "@/lib/judgement/quiz-performance";
import type { MobileQuizPerformanceExport } from "@/lib/learner-repository/quiz-performance";
import type { MobileJudgementReviewRecord } from "@/lib/learner-repository/judgement-reviews";
import type { UnprojectedNativeRecords } from "@/lib/learner-repository/portable-native-state";
import { interruptedAgentTurn } from "@/lib/durable-agent-events";
import { useMobileWorkspace } from "@/state/MobileWorkspaceProvider";
import { useMobileKnowledge } from "@/state/MobileKnowledgeProvider";
import type {
  ArtifactKind,
  ChatAttachment,
  ChatSession,
  GeneratedArtifactKind,
  MessageFeedback,
  PersistedAppState,
  ProviderId,
  ProviderSettings,
} from "@/lib/types";
import type { KeyStatus } from "@/state/hydration";
import { generationErrorMessage } from "@/state/turn-policy";
import { useAccountScopes } from "@/state/use-account-scopes";
import { useHydration } from "@/state/use-hydration";
import { useLearnerDataActions } from "@/state/use-learner-data-actions";
import { useLearnerEvidence } from "@/state/use-learner-evidence";
import { useLearnerRepository, useLearnerStatePersistence } from "@/state/use-learner-repository";
import { useProviderSettings } from "@/state/use-provider-settings";
import { useSessionActions } from "@/state/use-session-actions";
import { useSessionStore } from "@/state/use-session-store";
import { useTeachingRun } from "@/state/use-teaching-run";
import { useTutorProfile } from "@/state/use-tutor-profile";

interface KeatingContextValue {
  state: PersistedAppState;
  activeSession: ChatSession;
  hydrated: boolean;
  storageError: string | null;
  /** Latest validated SQLite/portable snapshot; null while repository bootstrap is pending. */
  learnerData: PortableLearnerData | null;
  learnerRepositoryReady: boolean;
  judgementReviews: readonly MobileJudgementReviewRecord[];
  generationError: string | null;
  isGenerating: boolean;
  /** Id of the assistant message currently receiving streamed tokens. */
  streamingMessageId: string | null;
  keyStatus: KeyStatus;
  isProviderConfigured: boolean;
  /** True when the selected model advertises a thinking budget. */
  supportsReasoning: boolean;
  /** Exact reasoning tiers advertised for the selected model. */
  reasoningLevels: readonly ReasoningLevel[];
  /** Whether the selected model accepts a temperature parameter. */
  supportsTemperature: boolean;
  persona: string;
  setPersona: (text: string) => Promise<void>;
  restoreDefaultPersona: () => Promise<void>;
  /** The learner's own "about you" background, appended to the system prompt. */
  learnerContext: string;
  setLearnerContext: (text: string) => Promise<void>;
  sendMessage: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  /** Atomically cancels any active reply, creates a lesson, and sends its first turn. */
  startNewSessionWithMessage: (content: string) => Promise<string | null>;
  retryLastResponse: () => Promise<void>;
  stopGeneration: () => void;
  clearGenerationError: () => void;
  newSession: () => string;
  forkSession: (sourceSessionId: string, throughMessageId?: string) => string | null;
  selectSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  setMessageFeedback: (messageId: string, feedback: MessageFeedback) => void;
  saveArtifact: (messageId: string, kind?: ArtifactKind) => void;
  createLearningArtifact: (topic: string, kind: GeneratedArtifactKind) => string;
  createLiveQuiz: (
    topic: string,
    questions: readonly { question: string; correctAnswer: string; explanation: string; options?: readonly string[] }[],
  ) => string;
  /** Appends final Live turns to the current Tutor lesson so both surfaces stay continuous. */
  preserveLiveConversation: (
    turns: readonly { role: "user" | "assistant"; text: string }[],
    sessionId?: string,
  ) => void;
  deleteArtifact: (artifactId: string) => void;
  setProvider: (provider: ProviderId) => void;
  selectProviderModel: (model: CatalogModel) => void;
  updateProviderSettings: (patch: Partial<ProviderSettings>) => void;
  saveApiKey: (provider: ProviderId, apiKey: string) => Promise<void>;
  removeApiKey: (provider: ProviderId) => Promise<void>;
  exportLearnerData: () => Promise<PortableLearnerEnvelope>;
  importLearnerData: (candidate: unknown) => Promise<{
    data: PortableLearnerData;
    unprojected: UnprojectedNativeRecords;
  }>;
  saveLearnerGoal: (goal: LearnerGoal) => Promise<void>;
  saveLearnerGoalStep: (goal: LearnerGoal, stepId: string, status: GoalStepStatus) => Promise<void>;
  saveLearnerQuizResult: (result: LearnerQuizResult) => Promise<void>;
  saveLearnerQuestionChecks: (checks: readonly LearnerQuestionCheck[]) => Promise<void>;
  /** Creates a complete deck in one SQLite transaction and resolves after commit. */
  createLearnerDeck: (
    title: string,
    topic: string,
    cards: readonly { front: string; back: string; tags: readonly string[] }[],
  ) => Promise<string>;
  updateLearnerGoalStep: (goalId: string, stepId: string, status: GoalStepStatus) => Promise<void>;
  recordLearnerCardReview: (deckId: string, cardId: string, rating: SrsRating) => Promise<CardReviewRecord>;
  setLearnerStudyPriority: (
    targetType: StudyPriorityTargetType,
    targetId: string,
    priority: StudyPriority,
  ) => Promise<void>;
  createQuizPerformanceAttempt: (document: UiDocument, nodeId: string) => MobileQuizPerformanceAttempt;
  exportQuizPerformanceEvidence: (documentId: string, nodeId: string) => Promise<MobileQuizPerformanceExport>;
  isQuizPerformanceEvidenceCurrent: (evidence: MobileQuizPerformanceExport) => boolean;
  dispatchUiAction: (action: UiAction, document: UiDocument, sessionId?: string) => Promise<UiActionResult>;
  getUiActionJournal: (documentId: string) => Promise<UiActionJournal>;
  clearLearningData: () => Promise<void>;
}

const KeatingContext = createContext<KeatingContextValue | null>(null);

/**
 * Composes the state owners into the single `useKeating()` value:
 * the session store (state + mirror), provider settings, tutor profile,
 * learner repository, learner evidence, the teaching run, and the session and
 * learner-data actions. Each owner lives in its own `use-*` module.
 */
export function KeatingProvider({ children }: PropsWithChildren) {
  const mobileWorkspace = useMobileWorkspace();
  const knowledge = useMobileKnowledge();
  const scopes = useAccountScopes();
  const { settings: uiSettings } = useUiSettings();
  const uiSettingsRef = useRef(uiSettings);
  uiSettingsRef.current = uiSettings;
  const [storageError, setStorageError] = useState<string | null>(null);

  const store = useSessionStore();
  const { state, activeSession } = store;
  const tutor = useTutorProfile();
  const providers = useProviderSettings(state.providerSettings, store.setState);
  const repo = useLearnerRepository(setStorageError);
  const evidence = useLearnerEvidence({
    stateRef: store.stateRef,
    activeSessionId: state.activeSessionId,
    uiSettings,
    uiSettingsRef,
    scopes,
    repo: repo.refs,
  });
  useHydration({ store, repo, providers, tutor, setStorageError });
  useLearnerStatePersistence(repo, state, setStorageError);

  const run = useTeachingRun({
    store, repo, evidence, tutor, providers, scopes, uiSettingsRef,
    workspace: { executeAgentTool: mobileWorkspace.executeAgentTool, hasOverlay: mobileWorkspace.hasOverlay },
    knowledgeExecute: knowledge.execute,
  });
  const sessions = useSessionActions({
    store,
    queueLearnerState: repo.queueLearnerState,
    stopGeneration: run.stopGeneration,
    generationBusyRef: run.generationBusyRef,
    setStorageError,
  });
  const learnerData = useLearnerDataActions({
    store, repo, evidence, tutor, run,
    quizIdentityRef: scopes.quizIdentityRef,
    activityAccountRef: scopes.activityAccountRef,
    setStorageError,
  });

  const { isGenerating, rawGenerationError, setRawGenerationError } = run;
  const interruptedTurn = useMemo(() => {
    if (isGenerating) return false;
    const latestAssistant = [...activeSession.messages].reverse().find((message) => message.role === "assistant");
    return interruptedAgentTurn(latestAssistant?.agentEvents);
  }, [activeSession.messages, isGenerating]);
  const generationError = useMemo(
    () => generationErrorMessage(rawGenerationError, interruptedTurn, uiSettings.showRawErrors),
    [interruptedTurn, rawGenerationError, uiSettings.showRawErrors],
  );
  const clearGenerationError = useCallback(() => setRawGenerationError(null), [setRawGenerationError]);

  const value = useMemo<KeatingContextValue>(() => ({
    state,
    activeSession,
    hydrated: repo.hydrated,
    storageError,
    learnerData: repo.learnerData,
    learnerRepositoryReady: repo.repositoryReady,
    judgementReviews: repo.judgementReviews,
    generationError,
    isGenerating,
    streamingMessageId: run.streamingMessageId,
    keyStatus: providers.keyStatus,
    isProviderConfigured: providers.isProviderConfigured,
    supportsReasoning: providers.supportsReasoning,
    reasoningLevels: providers.reasoningLevels,
    supportsTemperature: providers.supportsTemperature,
    persona: tutor.persona,
    setPersona: tutor.setPersona,
    restoreDefaultPersona: tutor.restoreDefaultPersona,
    learnerContext: tutor.learnerContext,
    setLearnerContext: tutor.setLearnerContext,
    sendMessage: run.sendMessage,
    startNewSessionWithMessage: run.startNewSessionWithMessage,
    retryLastResponse: run.retryLastResponse,
    stopGeneration: run.stopGeneration,
    clearGenerationError,
    newSession: sessions.newSession,
    forkSession: sessions.forkSession,
    selectSession: sessions.selectSession,
    deleteSession: sessions.deleteSession,
    setMessageFeedback: sessions.setMessageFeedback,
    saveArtifact: sessions.saveArtifact,
    createLearningArtifact: sessions.createLearningArtifact,
    createLiveQuiz: sessions.createLiveQuiz,
    preserveLiveConversation: sessions.preserveLiveConversation,
    deleteArtifact: sessions.deleteArtifact,
    setProvider: providers.setProvider,
    selectProviderModel: providers.selectProviderModel,
    updateProviderSettings: providers.updateProviderSettings,
    saveApiKey: providers.saveApiKey,
    removeApiKey: providers.removeApiKey,
    exportLearnerData: learnerData.exportLearnerData,
    importLearnerData: learnerData.importLearnerData,
    saveLearnerGoal: learnerData.saveLearnerGoal,
    saveLearnerGoalStep: learnerData.saveLearnerGoalStep,
    saveLearnerQuizResult: learnerData.saveLearnerQuizResult,
    saveLearnerQuestionChecks: learnerData.saveLearnerQuestionChecks,
    createLearnerDeck: learnerData.createLearnerDeck,
    updateLearnerGoalStep: learnerData.updateLearnerGoalStep,
    recordLearnerCardReview: learnerData.recordLearnerCardReview,
    setLearnerStudyPriority: learnerData.setLearnerStudyPriority,
    createQuizPerformanceAttempt: evidence.createQuizPerformanceAttempt,
    exportQuizPerformanceEvidence: evidence.exportQuizPerformanceEvidence,
    isQuizPerformanceEvidenceCurrent: evidence.isQuizPerformanceEvidenceCurrent,
    dispatchUiAction: learnerData.dispatchUiAction,
    getUiActionJournal: learnerData.getUiActionJournal,
    clearLearningData: learnerData.clearLearningData,
  }), [
    state, activeSession, repo.hydrated, storageError, repo.learnerData, repo.repositoryReady, repo.judgementReviews,
    generationError, isGenerating, run.streamingMessageId,
    providers.keyStatus, providers.isProviderConfigured, providers.supportsReasoning, providers.reasoningLevels, providers.supportsTemperature,
    tutor.persona, tutor.setPersona, tutor.restoreDefaultPersona, tutor.learnerContext, tutor.setLearnerContext,
    run.sendMessage, run.startNewSessionWithMessage, run.retryLastResponse, run.stopGeneration, clearGenerationError,
    sessions.newSession, sessions.forkSession, sessions.selectSession, sessions.deleteSession, sessions.setMessageFeedback,
    sessions.saveArtifact, sessions.createLearningArtifact, sessions.createLiveQuiz, sessions.preserveLiveConversation, sessions.deleteArtifact,
    providers.setProvider, providers.selectProviderModel, providers.updateProviderSettings, providers.saveApiKey, providers.removeApiKey,
    learnerData.exportLearnerData, learnerData.importLearnerData, learnerData.saveLearnerGoal, learnerData.saveLearnerGoalStep,
    learnerData.saveLearnerQuizResult, learnerData.saveLearnerQuestionChecks, learnerData.createLearnerDeck,
    learnerData.updateLearnerGoalStep, learnerData.recordLearnerCardReview, learnerData.setLearnerStudyPriority,
    evidence.createQuizPerformanceAttempt, evidence.exportQuizPerformanceEvidence, evidence.isQuizPerformanceEvidenceCurrent,
    learnerData.dispatchUiAction, learnerData.getUiActionJournal, learnerData.clearLearningData,
  ]);

  return <KeatingContext.Provider value={value}>{children}</KeatingContext.Provider>;
}

export function useKeating(): KeatingContextValue {
  const context = useContext(KeatingContext);
  if (!context) throw new Error("useKeating must be used inside KeatingProvider.");
  return context;
}
