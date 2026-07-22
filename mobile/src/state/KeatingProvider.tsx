import * as Haptics from "expo-haptics";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetch as streamingFetch } from "expo/fetch";
import { DEFAULT_PROVIDER_SETTINGS, providerDefinition, PROVIDERS, settingsForProvider } from "@/lib/provider-config";
import { streamCompletion } from "@/lib/provider-client";
import { DEFAULT_TEACHER_PERSONA } from "@/lib/persona";
import { loadPersona, resetPersona, savePersona } from "@/lib/persona-storage";
import { composeSystemPrompt } from "@/lib/system-prompt";
import {
  clearPersistedState,
  deleteProviderKey,
  getProviderKey,
  loadPersistedState,
  savePersistedState,
  setProviderKey,
} from "@/lib/storage";
import { generateLearningArtifact } from "@/lib/learning-artifacts";
import { clearCardState } from "@/state/card-state";
import {
  type ArtifactKind,
  type ChatMessage,
  type ChatSession,
  createId,
  createSession,
  type GeneratedArtifactKind,
  type MessageFeedback,
  type PersistedAppState,
  type ProviderId,
  type ProviderSettings,
} from "@/lib/types";

type KeyStatus = Record<ProviderId, boolean>;

interface KeatingContextValue {
  state: PersistedAppState;
  activeSession: ChatSession;
  hydrated: boolean;
  storageError: string | null;
  generationError: string | null;
  isGenerating: boolean;
  /** Id of the assistant message currently receiving streamed tokens. */
  streamingMessageId: string | null;
  keyStatus: KeyStatus;
  isProviderConfigured: boolean;
  persona: string;
  setPersona: (text: string) => Promise<void>;
  restoreDefaultPersona: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryLastResponse: () => Promise<void>;
  stopGeneration: () => void;
  clearGenerationError: () => void;
  newSession: () => string;
  selectSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  setMessageFeedback: (messageId: string, feedback: MessageFeedback) => void;
  saveArtifact: (messageId: string, kind?: ArtifactKind) => void;
  createLearningArtifact: (topic: string, kind: GeneratedArtifactKind) => string;
  deleteArtifact: (artifactId: string) => void;
  setProvider: (provider: ProviderId) => void;
  updateProviderSettings: (patch: Partial<ProviderSettings>) => void;
  saveApiKey: (provider: ProviderId, apiKey: string) => Promise<void>;
  removeApiKey: (provider: ProviderId) => Promise<void>;
  clearLearningData: () => Promise<void>;
}

/** How often buffered stream deltas are committed to React state. */
const STREAM_FLUSH_INTERVAL_MS = 60;

const emptyKeyStatus: KeyStatus = {
  openai: false,
  anthropic: false,
  google: false,
  openrouter: false,
  custom: false,
};

function initialState(): PersistedAppState {
  const session = createSession();
  return {
    schemaVersion: 1,
    sessions: [session],
    activeSessionId: session.id,
    artifacts: [],
    providerSettings: DEFAULT_PROVIDER_SETTINGS,
    learnerFeedback: { helpful: 0, missed: 0 },
  };
}

function normalizeState(candidate: PersistedAppState | null): PersistedAppState {
  if (!candidate || candidate.sessions.length === 0) return initialState();
  const activeExists = candidate.sessions.some((session) => session.id === candidate.activeSessionId);
  return {
    ...candidate,
    activeSessionId: activeExists ? candidate.activeSessionId : candidate.sessions[0].id,
    artifacts: Array.isArray(candidate.artifacts) ? candidate.artifacts : [],
    learnerFeedback: candidate.learnerFeedback ?? { helpful: 0, missed: 0 },
    providerSettings: candidate.providerSettings ?? DEFAULT_PROVIDER_SETTINGS,
  };
}

function titleFromFirstMessage(content: string): string {
  const title = content.replace(/\s+/g, " ").trim();
  return title.length > 48 ? `${title.slice(0, 47)}…` : title || "New lesson";
}

function artifactTitle(message: ChatMessage, kind: ArtifactKind): string {
  const firstLine = message.content
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  if (firstLine) return firstLine.length > 64 ? `${firstLine.slice(0, 63)}…` : firstLine;
  return kind === "study-plan" ? "Study plan" : kind === "quiz" ? "Practice quiz" : "Saved note";
}

const KeatingContext = createContext<KeatingContextValue | null>(null);

export function KeatingProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<PersistedAppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(emptyKeyStatus);
  const [persona, setPersonaState] = useState<string>(DEFAULT_TEACHER_PERSONA);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const stateRef = useRef(state);
  const personaRef = useRef(persona);
  const abortControllerRef = useRef<AbortController | null>(null);

  personaRef.current = persona;

  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadPersistedState(),
      Promise.all(PROVIDERS.map(async (provider) => [provider.id, Boolean(await getProviderKey(provider.id))] as const)),
      loadPersona(),
    ])
      .then(([persisted, keys, storedPersona]) => {
        if (cancelled) return;
        const next = normalizeState(persisted);
        stateRef.current = next;
        setState(next);
        setKeyStatus(Object.fromEntries(keys) as KeyStatus);
        personaRef.current = storedPersona;
        setPersonaState(storedPersona);
      })
      .catch((error) => {
        if (!cancelled) setStorageError(error instanceof Error ? error.message : "Could not load local learning data.");
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = setTimeout(() => {
      savePersistedState(state).catch((error) => {
        setStorageError(error instanceof Error ? error.message : "Could not save local learning data.");
      });
    }, 120);
    return () => clearTimeout(timeout);
  }, [hydrated, state]);

  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0],
    [state.activeSessionId, state.sessions],
  );

  const updateSession = useCallback((sessionId: string, update: (session: ChatSession) => ChatSession) => {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) => session.id === sessionId ? update(session) : session),
    }));
  }, []);

  const runCompletion = useCallback(async (sessionId: string, messages: ChatMessage[]) => {
    const snapshot = stateRef.current;
    const settings = snapshot.providerSettings;
    const definition = providerDefinition(settings.provider);
    setGenerationError(null);

    const apiKey = await getProviderKey(settings.provider);
    if (definition.requiresKey && !apiKey) {
      setGenerationError(`Add your ${definition.label} API key in Settings before sending a message.`);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);

    // The placeholder is appended immediately so streamed tokens land in a
    // message the chat list is already rendering.
    const assistantId = createId("message");
    const startedAt = Date.now();
    updateSession(sessionId, (session) => ({
      ...session,
      messages: [...messages, { id: assistantId, role: "assistant", content: "", createdAt: startedAt }],
      updatedAt: startedAt,
    }));
    setStreamingMessageId(assistantId);

    const writeContent = (content: string) => {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) => message.id === assistantId ? { ...message, content } : message),
        updatedAt: Date.now(),
      }));
    };
    const dropPlaceholder = () => {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.filter((message) => message.id !== assistantId),
      }));
    };

    // Tokens arrive faster than the list can usefully re-render, so deltas are
    // buffered and flushed on a fixed cadence instead of per chunk.
    let pending = "";
    let rendered = "";
    const flush = () => {
      if (pending === rendered) return;
      rendered = pending;
      writeContent(rendered);
    };
    const flushTimer = setInterval(flush, STREAM_FLUSH_INTERVAL_MS);

    try {
      const content = await streamCompletion(settings, apiKey, messages, {
        signal: controller.signal,
        systemPrompt: composeSystemPrompt(personaRef.current),
        fetchImpl: streamingFetch as unknown as typeof fetch,
        onDelta: (_delta, accumulated) => {
          pending = accumulated;
        },
      });
      clearInterval(flushTimer);
      writeContent(content);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      clearInterval(flushTimer);
      const aborted = error instanceof Error && (error.name === "AbortError" || controller.signal.aborted);
      // A stopped response keeps whatever was already streamed; a failed one
      // leaves no half-message behind.
      if (aborted) {
        if (pending.trim()) writeContent(pending.trim());
        else dropPlaceholder();
        return;
      }
      dropPlaceholder();
      setGenerationError(error instanceof Error ? error.message : "The model request failed.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      clearInterval(flushTimer);
      setStreamingMessageId((current) => current === assistantId ? null : current);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setIsGenerating(false);
      }
    }
  }, [updateSession]);

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isGenerating) return;
    const current = stateRef.current;
    const session = current.sessions.find((entry) => entry.id === current.activeSessionId) ?? current.sessions[0];
    const message: ChatMessage = {
      id: createId("message"),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    const messages = [...session.messages, message];
    updateSession(session.id, (entry) => ({
      ...entry,
      title: entry.messages.length === 0 ? titleFromFirstMessage(trimmed) : entry.title,
      messages,
      updatedAt: message.createdAt,
    }));
    await runCompletion(session.id, messages);
  }, [isGenerating, runCompletion, updateSession]);

  const retryLastResponse = useCallback(async () => {
    if (isGenerating) return;
    const current = stateRef.current;
    const session = current.sessions.find((entry) => entry.id === current.activeSessionId) ?? current.sessions[0];
    let userIndex = -1;
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      if (session.messages[index].role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;
    const messages = session.messages.slice(0, userIndex + 1);
    updateSession(session.id, (entry) => ({ ...entry, messages, updatedAt: Date.now() }));
    await runCompletion(session.id, messages);
  }, [isGenerating, runCompletion, updateSession]);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);
  }, []);

  const newSession = useCallback(() => {
    stopGeneration();
    const session = createSession();
    setState((current) => ({
      ...current,
      sessions: [session, ...current.sessions],
      activeSessionId: session.id,
    }));
    void Haptics.selectionAsync().catch(() => undefined);
    return session.id;
  }, [stopGeneration]);

  const selectSession = useCallback((sessionId: string) => {
    if (!stateRef.current.sessions.some((session) => session.id === sessionId)) return;
    stopGeneration();
    setState((current) => ({ ...current, activeSessionId: sessionId }));
  }, [stopGeneration]);

  const deleteSession = useCallback((sessionId: string) => {
    stopGeneration();
    setState((current) => {
      const remaining = current.sessions.filter((session) => session.id !== sessionId);
      if (remaining.length === 0) remaining.push(createSession());
      return {
        ...current,
        sessions: remaining,
        activeSessionId: current.activeSessionId === sessionId ? remaining[0].id : current.activeSessionId,
        artifacts: current.artifacts.filter((artifact) => artifact.sessionId !== sessionId),
      };
    });
  }, [stopGeneration]);

  const setMessageFeedback = useCallback((messageId: string, feedback: MessageFeedback) => {
    setState((current) => {
      let previous: MessageFeedback | undefined;
      const sessions = current.sessions.map((session) => ({
        ...session,
        messages: session.messages.map((message) => {
          if (message.id !== messageId) return message;
          previous = message.feedback;
          return { ...message, feedback };
        }),
      }));
      if (!previous && sessions.every((session) => session.messages.every((message) => message.id !== messageId))) {
        return current;
      }
      const learnerFeedback = { ...current.learnerFeedback };
      if (previous) learnerFeedback[previous] = Math.max(0, learnerFeedback[previous] - 1);
      learnerFeedback[feedback] += 1;
      return { ...current, sessions, learnerFeedback };
    });
    void Haptics.selectionAsync().catch(() => undefined);
  }, []);

  const saveArtifact = useCallback((messageId: string, kind: ArtifactKind = "note") => {
    setState((current) => {
      if (current.artifacts.some((artifact) => artifact.messageId === messageId)) return current;
      const session = current.sessions.find((entry) => entry.messages.some((message) => message.id === messageId));
      const message = session?.messages.find((entry) => entry.id === messageId);
      if (!session || !message || message.role !== "assistant") return current;
      return {
        ...current,
        artifacts: [{
          id: createId("artifact"),
          sessionId: session.id,
          messageId,
          kind,
          source: "assistant",
          title: artifactTitle(message, kind),
          content: message.content,
          createdAt: Date.now(),
        }, ...current.artifacts],
      };
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, []);

  const createLearningArtifact = useCallback((topicName: string, kind: GeneratedArtifactKind) => {
    const generated = generateLearningArtifact(topicName, kind);
    const id = createId("artifact");
    setState((current) => ({
      ...current,
      artifacts: [{
        id,
        kind: generated.kind,
        source: "keating-core",
        topic: generated.topic,
        title: generated.title,
        content: generated.content,
        createdAt: Date.now(),
      }, ...current.artifacts],
    }));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    return id;
  }, []);

  const deleteArtifact = useCallback((artifactId: string) => {
    setState((current) => ({
      ...current,
      artifacts: current.artifacts.filter((artifact) => artifact.id !== artifactId),
    }));
  }, []);

  const setProvider = useCallback((provider: ProviderId) => {
    setState((current) => ({ ...current, providerSettings: settingsForProvider(provider) }));
  }, []);

  const updateProviderSettings = useCallback((patch: Partial<ProviderSettings>) => {
    setState((current) => ({
      ...current,
      providerSettings: { ...current.providerSettings, ...patch },
    }));
  }, []);

  const saveApiKey = useCallback(async (provider: ProviderId, apiKey: string) => {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error("Enter an API key before saving.");
    await setProviderKey(provider, trimmed);
    setKeyStatus((current) => ({ ...current, [provider]: true }));
  }, []);

  const removeApiKey = useCallback(async (provider: ProviderId) => {
    await deleteProviderKey(provider);
    setKeyStatus((current) => ({ ...current, [provider]: false }));
  }, []);

  const setPersona = useCallback(async (text: string) => {
    const next = text.trim().length > 0 ? text : DEFAULT_TEACHER_PERSONA;
    personaRef.current = next;
    setPersonaState(next);
    await savePersona(next);
  }, []);

  const restoreDefaultPersona = useCallback(async () => {
    personaRef.current = DEFAULT_TEACHER_PERSONA;
    setPersonaState(DEFAULT_TEACHER_PERSONA);
    await resetPersona();
  }, []);

  const clearLearningData = useCallback(async () => {
    stopGeneration();
    clearCardState();
    await clearPersistedState();
    const next = initialState();
    stateRef.current = next;
    setState(next);
  }, [stopGeneration]);

  const definition = providerDefinition(state.providerSettings.provider);
  const isProviderConfigured = !definition.requiresKey || keyStatus[state.providerSettings.provider];

  const value = useMemo<KeatingContextValue>(() => ({
    state,
    activeSession,
    hydrated,
    storageError,
    generationError,
    isGenerating,
    streamingMessageId,
    keyStatus,
    isProviderConfigured,
    persona,
    setPersona,
    restoreDefaultPersona,
    sendMessage,
    retryLastResponse,
    stopGeneration,
    clearGenerationError: () => setGenerationError(null),
    newSession,
    selectSession,
    deleteSession,
    setMessageFeedback,
    saveArtifact,
    createLearningArtifact,
    deleteArtifact,
    setProvider,
    updateProviderSettings,
    saveApiKey,
    removeApiKey,
    clearLearningData,
  }), [
    state, activeSession, hydrated, storageError, generationError, isGenerating, streamingMessageId,
    keyStatus, isProviderConfigured, persona, setPersona, restoreDefaultPersona,
    sendMessage, retryLastResponse, stopGeneration, newSession,
    selectSession, deleteSession, setMessageFeedback, saveArtifact, createLearningArtifact, deleteArtifact,
    setProvider, updateProviderSettings, saveApiKey, removeApiKey, clearLearningData,
  ]);

  return <KeatingContext.Provider value={value}>{children}</KeatingContext.Provider>;
}

export function useKeating(): KeatingContextValue {
  const context = useContext(KeatingContext);
  if (!context) throw new Error("useKeating must be used inside KeatingProvider.");
  return context;
}
