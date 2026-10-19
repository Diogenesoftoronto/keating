/** Generation lifecycle: sending, retrying, streaming state, and cancellation of the active reply. */
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { AppState, type AppStateStatus } from "react-native";
import type { KeatingUiSettings } from "@/lib/ui-settings";
import { createSession, type ChatAttachment, type ChatSession } from "@/lib/types";
import type { MobileToolExecutionContext, MobileToolExecutionResult } from "@/lib/mobile-tools";
import {
  activeSessionOf,
  buildUserMessage,
  retryPlan,
  titleAfterUserMessage,
  titleFromFirstMessage,
  withSessionFirst,
} from "@/state/session-state";
import { runTeachingTurn, type TurnEnv } from "@/state/teaching-turn";
import type { AccountScopes } from "@/state/use-account-scopes";
import type { LearnerEvidence } from "@/state/use-learner-evidence";
import type { LearnerRepositoryState } from "@/state/use-learner-repository";
import type { SessionStore } from "@/state/use-session-store";
import type { TutorProfile } from "@/state/use-tutor-profile";
import type { ProviderSettingsApi } from "@/state/use-provider-settings";

export const BACKGROUND_PAUSE_MESSAGE = "The response paused when Keating moved to the background. Return here and retry it.";

export interface TeachingRun {
  isGenerating: boolean;
  streamingMessageId: string | null;
  rawGenerationError: string | null;
  setRawGenerationError(message: string | null): void;
  generationBusyRef: MutableRefObject<boolean>;
  generationPromiseRef: MutableRefObject<Promise<void> | null>;
  sendMessage(content: string, attachments?: ChatAttachment[]): Promise<void>;
  startNewSessionWithMessage(content: string): Promise<string | null>;
  retryLastResponse(): Promise<void>;
  stopGeneration(): void;
}

interface TeachingRunInputs {
  store: SessionStore;
  repo: LearnerRepositoryState;
  evidence: LearnerEvidence;
  tutor: TutorProfile;
  providers: ProviderSettingsApi;
  scopes: AccountScopes;
  uiSettingsRef: MutableRefObject<KeatingUiSettings>;
  workspace: {
    executeAgentTool: TurnEnv["executeAgentTool"];
    hasOverlay: TurnEnv["hasOverlay"];
  };
  knowledgeExecute(name: string, args: string | Readonly<Record<string, unknown>>, context: MobileToolExecutionContext): Promise<MobileToolExecutionResult>;
}

export function useTeachingRun(inputs: TeachingRunInputs): TeachingRun {
  const { store, repo, evidence, tutor, providers, scopes, uiSettingsRef, workspace, knowledgeExecute } = inputs;
  const { stateRef, commitState, updateSession } = store;
  const { persistLearnerState } = repo;
  const [isGenerating, setIsGenerating] = useState(false);
  const [rawGenerationError, setRawGenerationError] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationBusyRef = useRef(false);
  const generationPromiseRef = useRef<Promise<void> | null>(null);

  const env = useMemo<TurnEnv>(() => ({
    stateRef,
    uiSettingsRef,
    learnerContextRef: tutor.learnerContextRef,
    quizIdentityRef: scopes.quizIdentityRef,
    activityAccountRef: scopes.activityAccountRef,
    activityControllerRef: evidence.activityControllerRef,
    repo: repo.refs,
    personaRef: tutor.personaRef,
    activePedagogyRef: scopes.activePedagogyRef,
    catalogRef: providers.catalogRef,
    memoryAdmissionRef: evidence.memoryAdmissionRef,
    needleRecallRef: evidence.needleRecallRef,
    abortControllerRef,
    generationBusyRef,
    setIsGenerating,
    setRawGenerationError,
    setStreamingMessageId,
    updateSession,
    commitState,
    persistLearnerState,
    refreshBackgroundActivity: evidence.refreshBackgroundActivity,
    executeAgentTool: workspace.executeAgentTool,
    hasOverlay: workspace.hasOverlay,
    executeKnowledgeTool: knowledgeExecute,
  }), [
    stateRef, uiSettingsRef, tutor.learnerContextRef, tutor.personaRef, scopes.quizIdentityRef, scopes.activityAccountRef,
    scopes.activePedagogyRef, evidence.activityControllerRef, evidence.memoryAdmissionRef, evidence.needleRecallRef,
    evidence.refreshBackgroundActivity, repo.refs, providers.catalogRef, updateSession, commitState, persistLearnerState,
    workspace.executeAgentTool, workspace.hasOverlay, knowledgeExecute,
  ]);

  const runCompletion = useCallback(
    (sessionId: string, messages: ChatSession["messages"], replayEvents?: Parameters<typeof runTeachingTurn>[3]) =>
      runTeachingTurn(env, sessionId, messages, replayEvents),
    [env],
  );

  const trackCompletion = useCallback(async (completion: Promise<void>) => {
    generationPromiseRef.current = completion;
    try {
      await completion;
    } finally {
      if (generationPromiseRef.current === completion) generationPromiseRef.current = null;
    }
  }, []);

  const sendMessage = useCallback(async (content: string, attachments: ChatAttachment[] = []) => {
    const trimmed = content.trim();
    if ((!trimmed && attachments.length === 0) || generationBusyRef.current) return;
    const session = activeSessionOf(stateRef.current);
    const message = buildUserMessage(trimmed, attachments);
    const messages = [...session.messages, message];
    const next = updateSession(session.id, (entry) => ({
      ...entry,
      title: titleAfterUserMessage(entry, trimmed, attachments),
      messages,
      updatedAt: message.createdAt,
    }));
    await persistLearnerState(next);
    await trackCompletion(runCompletion(session.id, messages));
  }, [persistLearnerState, runCompletion, stateRef, trackCompletion, updateSession]);

  const retryLastResponse = useCallback(async () => {
    if (generationBusyRef.current) return;
    const session = activeSessionOf(stateRef.current);
    const plan = retryPlan(session);
    if (!plan) return;
    const { messages, replayEvents } = plan;
    await persistLearnerState(updateSession(session.id, (entry) => ({ ...entry, messages, updatedAt: Date.now() })));
    await trackCompletion(runCompletion(session.id, messages, replayEvents));
  }, [persistLearnerState, runCompletion, stateRef, trackCompletion, updateSession]);

  const stopGeneration = useCallback(() => {
    evidence.memoryAdmissionRef.current?.cancel();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, [evidence.memoryAdmissionRef]);

  useEffect(() => {
    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active" || !generationBusyRef.current) return;
      // Expo cannot guarantee a JavaScript continuation after suspension. Stop
      // at the abort boundary so the catch path durably records partial text,
      // committed receipts, and an explicit learner retry route.
      setRawGenerationError(BACKGROUND_PAUSE_MESSAGE);
      stopGeneration();
    };
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, [stopGeneration]);

  const startNewSessionWithMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return null;

    stopGeneration();
    const activeCompletion = generationPromiseRef.current;
    if (activeCompletion) await activeCompletion.catch(() => undefined);

    const message = buildUserMessage(trimmed);
    const session: ChatSession = {
      ...createSession(),
      title: titleFromFirstMessage(trimmed),
      messages: [message],
      updatedAt: message.createdAt,
    };
    const next = withSessionFirst(stateRef.current, session);
    commitState(next);
    await persistLearnerState(next);
    void Haptics.selectionAsync().catch(() => undefined);
    await trackCompletion(runCompletion(session.id, [message]));
    return session.id;
  }, [commitState, persistLearnerState, runCompletion, stateRef, stopGeneration, trackCompletion]);

  return {
    isGenerating, streamingMessageId, rawGenerationError, setRawGenerationError, generationBusyRef, generationPromiseRef,
    sendMessage, startNewSessionWithMessage, retryLastResponse, stopGeneration,
  };
}
