/** Learner-initiated edits to sessions and artifacts: each commits to state, then queues a durable save. */
import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { generateLearningArtifact } from "@/lib/learning-artifacts";
import { createForkedSession } from "@/lib/session-lineage";
import {
  type ArtifactKind,
  type ChatSession,
  createId,
  createSession,
  type GeneratedArtifactKind,
  type MessageFeedback,
  type PersistedAppState,
} from "@/lib/types";
import {
  type LiveConversationTurn,
  type LiveQuizQuestion,
  withActiveSession,
  withGeneratedArtifact,
  withLiveConversation,
  withLiveQuiz,
  withMessageFeedback,
  withoutArtifact,
  withoutSession,
  withSavedAssistantArtifact,
  withSessionFirst,
} from "@/state/session-state";
import type { SessionStore } from "@/state/use-session-store";
import type { TeachingRun } from "@/state/use-teaching-run";

export interface SessionActions {
  newSession(): string;
  forkSession(sourceSessionId: string, throughMessageId?: string): string | null;
  selectSession(sessionId: string): void;
  deleteSession(sessionId: string): void;
  setMessageFeedback(messageId: string, feedback: MessageFeedback): void;
  saveArtifact(messageId: string, kind?: ArtifactKind): void;
  createLearningArtifact(topic: string, kind: GeneratedArtifactKind): string;
  createLiveQuiz(topic: string, questions: readonly LiveQuizQuestion[]): string;
  preserveLiveConversation(turns: readonly LiveConversationTurn[], sessionId?: string): void;
  deleteArtifact(artifactId: string): void;
}

interface SessionActionInputs {
  store: SessionStore;
  queueLearnerState(next: PersistedAppState): void;
  stopGeneration(): void;
  generationBusyRef: TeachingRun["generationBusyRef"];
  setStorageError(message: string): void;
}

export function useSessionActions({ store, queueLearnerState, stopGeneration, generationBusyRef, setStorageError }: SessionActionInputs): SessionActions {
  const { stateRef, setState, commitState } = store;
  /** Commits and queues a save; the common tail of every edit below. */
  const apply = useCallback((next: PersistedAppState) => {
    commitState(next);
    queueLearnerState(next);
  }, [commitState, queueLearnerState]);

  const newSession = useCallback(() => {
    stopGeneration();
    const session = createSession();
    // Committed synchronously: a caller that opens a lesson and sends its
    // first message in the same tick must not land in the previous session.
    apply(withSessionFirst(stateRef.current, session));
    void Haptics.selectionAsync().catch(() => undefined);
    return session.id;
  }, [apply, stateRef, stopGeneration]);

  const forkSession = useCallback((sourceSessionId: string, throughMessageId?: string) => {
    if (generationBusyRef.current) return null;
    const source = stateRef.current.sessions.find((session) => session.id === sourceSessionId);
    if (!source) return null;
    let fork: ChatSession;
    try {
      fork = createForkedSession(source, { throughMessageId });
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not fork this lesson.");
      return null;
    }
    apply(withSessionFirst(stateRef.current, fork));
    void Haptics.selectionAsync().catch(() => undefined);
    return fork.id;
  }, [apply, generationBusyRef, setStorageError, stateRef]);

  const selectSession = useCallback((sessionId: string) => {
    if (!stateRef.current.sessions.some((session) => session.id === sessionId)) return;
    stopGeneration();
    setState((current) => withActiveSession(current, sessionId));
  }, [setState, stateRef, stopGeneration]);

  const deleteSession = useCallback((sessionId: string) => {
    stopGeneration();
    apply(withoutSession(stateRef.current, sessionId));
  }, [apply, stateRef, stopGeneration]);

  const setMessageFeedback = useCallback((messageId: string, feedback: MessageFeedback) => {
    const next = withMessageFeedback(stateRef.current, messageId, feedback);
    if (!next) return;
    apply(next);
    void Haptics.selectionAsync().catch(() => undefined);
  }, [apply, stateRef]);

  const saveArtifact = useCallback((messageId: string, kind: ArtifactKind = "note") => {
    const next = withSavedAssistantArtifact(stateRef.current, messageId, kind);
    if (!next) return;
    apply(next);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [apply, stateRef]);

  const createLearningArtifact = useCallback((topicName: string, kind: GeneratedArtifactKind) => {
    const generated = generateLearningArtifact(topicName, kind);
    const id = createId("artifact");
    apply(withGeneratedArtifact(stateRef.current, generated, id));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    return id;
  }, [apply, stateRef]);

  const createLiveQuiz = useCallback((topicName: string, questions: readonly LiveQuizQuestion[]) => {
    const id = createId("artifact");
    apply(withLiveQuiz(stateRef.current, topicName, questions, id));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    return id;
  }, [apply, stateRef]);

  const preserveLiveConversation = useCallback((turns: readonly LiveConversationTurn[], sessionId?: string) => {
    const next = withLiveConversation(stateRef.current, turns, sessionId);
    if (next) apply(next);
  }, [apply, stateRef]);

  const deleteArtifact = useCallback((artifactId: string) => {
    apply(withoutArtifact(stateRef.current, artifactId));
  }, [apply, stateRef]);

  return {
    newSession, forkSession, selectSession, deleteSession, setMessageFeedback, saveArtifact, createLearningArtifact,
    createLiveQuiz, preserveLiveConversation, deleteArtifact,
  };
}
