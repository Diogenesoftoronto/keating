import * as Haptics from "expo-haptics";
import type {
  AgentStreamEvent,
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
  AppState,
  type AppStateStatus,
} from "react-native";
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
import {
  BUILT_IN_MODEL_CATALOG,
  type CatalogModel,
  mergeCatalogModels,
  modelReasoningLevels,
  modelSupportsTemperature,
  modelSupportsToolCalls,
  modelSupportsReasoning,
  resolveModelReasoningLevel,
  selectedProviderSettings,
} from "@/lib/model-catalog";
import { readCachedModelCatalog } from "@/lib/model-catalog-storage";
import { presentedErrorMessage } from "@/lib/error-messages";
import { useUiSettings } from "@/state/UiSettingsProvider";
import type { ReasoningLevel } from "@/lib/ui-settings";
import {
  applyMobileToolArtifactEffects,
  runMobileToolLoop,
  type CommittedMobileToolCall,
} from "@/lib/provider-tool-loop";
import { clearComposerAttachmentFiles, hydrateMessageAttachments } from "@/lib/composer-attachments";
import { clearAllComposerDrafts } from "@/lib/composer-draft-storage";
import { DEFAULT_TEACHER_PERSONA } from "@/lib/persona";
import { loadPersona, resetPersona, savePersona } from "@/lib/persona-storage";
import { normalizeLearnerContext } from "@/lib/learner-context";
import { loadLearnerContext, saveLearnerContext } from "@/lib/learner-context-storage";
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
import { unavailableMobileCapabilityPrompt } from "@/lib/mobile-tools";
import { restoreMobileToolReceipt } from "@/lib/mobile-tool-receipts";
import { interruptedAgentTurn } from "@/lib/durable-agent-events";
import { createForkedSession } from "@/lib/session-lineage";
import {
  appendQuestionChecks as appendQuestionChecksData,
  appendQuizResult as appendQuizResultData,
  ensureLearnerGoal as ensureLearnerGoalData,
  recordCardReview as recordCardReviewData,
  setStudyPriority as setStudyPriorityData,
  updateGoalStep as updateGoalStepData,
} from "@/lib/learner-mutations";
import { createDeckWithCards as createDeckWithCardsData } from "@/lib/learner-decks";
import { extractUiDocuments, scopeUiDocument } from "@/lib/ui-document-wire";
import { applyLocalUiAction } from "@/lib/ui-action-mutations";
import { bootstrapLearnerRepository } from "@/lib/learner-repository/bootstrap";
import { resumePendingLearningDataClear } from "@/lib/learner-repository/clear-recovery";
import {
  projectPortableToNativeState,
  reconcileNativeStateIntoPortable,
  type UnprojectedNativeRecords,
} from "@/lib/learner-repository/portable-native-state";
import type { LearnerRepository } from "@/lib/learner-repository";
import { useMobileWorkspace } from "@/state/MobileWorkspaceProvider";
import { clearCardState } from "@/state/card-state";
import {
  type ArtifactKind,
  type ChatAttachment,
  type ChatMessage,
  type ChatSession,
  createId,
  createSession,
  type GeneratedArtifactKind,
  type MessageFeedback,
  type PersistedAppState,
  type ProviderId,
  type ProviderSettings,
  type ProviderUsage,
} from "@/lib/types";

type KeyStatus = Record<ProviderId, boolean>;

interface KeatingContextValue {
  state: PersistedAppState;
  activeSession: ChatSession;
  hydrated: boolean;
  storageError: string | null;
  /** Latest validated SQLite/portable snapshot; null while repository bootstrap is pending. */
  learnerData: PortableLearnerData | null;
  learnerRepositoryReady: boolean;
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
  dispatchUiAction: (action: UiAction, document: UiDocument, sessionId?: string) => Promise<UiActionResult>;
  getUiActionJournal: (documentId: string) => Promise<UiActionJournal>;
  clearLearningData: () => Promise<void>;
}

/** How often buffered stream deltas are committed to React state. */
const STREAM_FLUSH_INTERVAL_MS = 60;

function contractId(value: string, fallbackPrefix: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : createId(fallbackPrefix);
}

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
  schemaVersion: 4,
    sessions: [session],
    activeSessionId: session.id,
    artifacts: [],
    providerSettings: DEFAULT_PROVIDER_SETTINGS,
    learnerFeedback: { helpful: 0, missed: 0 },
  };
}

function normalizeState(candidate: PersistedAppState | null): PersistedAppState {
  if (!candidate) return initialState();
  if (candidate.sessions.length === 0) {
    const session = createSession();
    return { ...candidate, sessions: [session], activeSessionId: session.id };
  }
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
  const mobileWorkspace = useMobileWorkspace();
  const { settings: uiSettings } = useUiSettings();
  const [state, setState] = useState<PersistedAppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [repositoryReady, setRepositoryReady] = useState(false);
  const [learnerData, setLearnerData] = useState<PortableLearnerData | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  // Kept raw so the "show raw errors" preference can be flipped after the
  // failure without losing the provider's own message.
  const [rawGenerationError, setRawGenerationError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<readonly CatalogModel[]>(BUILT_IN_MODEL_CATALOG);
  const [isGenerating, setIsGenerating] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(emptyKeyStatus);
  const [persona, setPersonaState] = useState<string>(DEFAULT_TEACHER_PERSONA);
  const [learnerContext, setLearnerContextState] = useState("");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const stateRef = useRef(state);
  const personaRef = useRef(persona);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationBusyRef = useRef(false);
  const generationPromiseRef = useRef<Promise<void> | null>(null);
  const catalogRef = useRef(catalog);
  const uiSettingsRef = useRef(uiSettings);
  const learnerContextRef = useRef(learnerContext);
  const learnerRepositoryRef = useRef<LearnerRepository | null>(null);
  const learnerRepositoryWriteTailRef = useRef<Promise<void>>(Promise.resolve());
  const learnerRepositoryClearingRef = useRef(false);

  personaRef.current = persona;
  learnerContextRef.current = learnerContext;
  catalogRef.current = catalog;
  uiSettingsRef.current = uiSettings;

  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    let openedRepository: LearnerRepository | null = null;

    Promise.all(PROVIDERS.map(async (provider) => [provider.id, Boolean(await getProviderKey(provider.id))] as const))
      .then((keys) => {
        if (!cancelled) setKeyStatus(Object.fromEntries(keys) as KeyStatus);
      })
      .catch((error) => {
        if (!cancelled) setStorageError(error instanceof Error ? error.message : "Could not read provider credentials.");
      });

    // The model list the selector caches also tells us which models accept a
    // thinking budget, so the reasoning control never offers an unsupported
    // parameter. A miss just leaves the built-in catalog in place.
    readCachedModelCatalog()
      .then((cached) => {
        if (!cancelled && cached.length > 0) setCatalog(mergeCatalogModels(BUILT_IN_MODEL_CATALOG, cached));
      })
      .catch(() => undefined);

    loadPersona()
      .then((storedPersona) => {
        if (cancelled) return;
        personaRef.current = storedPersona;
        setPersonaState(storedPersona);
      })
      .catch((error) => {
        if (!cancelled) setStorageError(error instanceof Error ? error.message : "Could not load the tutor persona.");
      });

    bootstrapLearnerRepository()
      .then(async ({ repository }) => {
        openedRepository = repository;
        if (cancelled) {
          void repository.close();
          return;
        }
        // Repository bootstrap owns migration and interrupted-delete recovery,
        // so the legacy UI cache is read only after those operations settle.
        const persisted = await loadPersistedState();
        const snapshot = await repository.records.snapshot();
        const localAttachments = await repository.records.getLocalAttachments();
        const projected = projectPortableToNativeState(
          snapshot,
          persisted?.providerSettings ?? DEFAULT_PROVIDER_SETTINGS,
          localAttachments,
          persisted?.activeSessionId,
        );
        const next = normalizeState(projected.state);
        const storedLearnerContext = await loadLearnerContext();
        if (cancelled) {
          void repository.close();
          return;
        }
        learnerRepositoryRef.current = repository;
        stateRef.current = next;
        setState(next);
        setLearnerData(snapshot);
        learnerContextRef.current = storedLearnerContext;
        setLearnerContextState(storedLearnerContext);
        setPersistenceReady(true);
        setRepositoryReady(true);
      })
      .catch(async (error) => {
        if (!cancelled) {
          setStorageError(error instanceof Error
            ? `SQLite learner repository: ${error.message}`
            : "Could not open the SQLite learner repository.");
          // Keep the learner's preserved cache usable when SQLite cannot open;
          // no repository-backed feature is claimed in this recovery mode.
          try {
            const next = normalizeState(await loadPersistedState());
            stateRef.current = next;
            setState(next);
            setPersistenceReady(true);
          } catch {
            // The primary error already explains why storage is unavailable.
          }
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
      const repository = learnerRepositoryRef.current ?? openedRepository;
      learnerRepositoryRef.current = null;
      if (repository) {
        void learnerRepositoryWriteTailRef.current
          .catch(() => undefined)
          .then(() => repository.close());
      }
    };
  }, []);

  const persistLearnerState = useCallback(async (next: PersistedAppState, required = false) => {
    const repository = learnerRepositoryRef.current;
    if (!repository || learnerRepositoryClearingRef.current) {
      if (required) throw new Error("The local learner repository is unavailable, so Keating did not apply the tool effect.");
      return;
    }
    const write = learnerRepositoryWriteTailRef.current
      .catch(() => undefined)
      .then(async () => {
        if (learnerRepositoryClearingRef.current) {
          if (required) throw new Error("Learning data is being cleared, so Keating did not apply the tool effect.");
          return;
        }
        const current = await repository.records.snapshot();
        const currentLocations = await repository.records.getLocalAttachments();
        const reconciled = reconcileNativeStateIntoPortable(current, next, currentLocations);
        await repository.records.replaceWithLocalAttachments(reconciled.data, reconciled.localAttachments);
        setLearnerData(reconciled.data);
      });
    learnerRepositoryWriteTailRef.current = write;
    await write;
  }, []);

  const mutateLearnerRecords = useCallback(async <Result,>(
    mutation: (current: PortableLearnerData, now: string) => { data: PortableLearnerData; result: Result },
  ): Promise<Result> => {
    const repository = learnerRepositoryRef.current;
    if (!repository || learnerRepositoryClearingRef.current) {
      throw new Error("Learning data is still loading. Wait a moment and try again.");
    }
    let result: Result | undefined;
    const write = learnerRepositoryWriteTailRef.current
      .catch(() => undefined)
      .then(async () => {
        if (learnerRepositoryClearingRef.current) throw new Error("Learning data is being cleared. Try again when it finishes.");
        const updated = await repository.records.mutatePortable((current, now) => {
          const applied = mutation(current, now);
          result = applied.result;
          return applied.data;
        });
        setLearnerData(updated);
      });
    learnerRepositoryWriteTailRef.current = write;
    try {
      await write;
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not update the learner repository.");
      throw error;
    }
    if (result === undefined) throw new Error("The learner update did not produce a result.");
    return result;
  }, []);

  const queueLearnerState = useCallback((next: PersistedAppState) => {
    void persistLearnerState(next).catch((error) => {
      setStorageError(error instanceof Error ? error.message : "Could not save the SQLite learner repository.");
    });
  }, [persistLearnerState]);

  useEffect(() => {
    if (!hydrated || !persistenceReady) return;
    const timeout = setTimeout(() => {
      savePersistedState(state).catch((error) => {
        setStorageError(error instanceof Error ? error.message : "Could not save local learning data.");
      });
    }, 120);
    return () => clearTimeout(timeout);
  }, [hydrated, persistenceReady, state]);

  useEffect(() => {
    if (!hydrated || !repositoryReady) return;
    const timeout = setTimeout(() => {
      const repository = learnerRepositoryRef.current;
      if (!repository) return;
      try {
        persistLearnerState(state).catch((error) => {
            setStorageError(error instanceof Error ? error.message : "Could not save the SQLite learner repository.");
        });
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : "Could not prepare learning data for SQLite.");
      }
    }, 120);
    return () => clearTimeout(timeout);
  }, [hydrated, persistLearnerState, repositoryReady, state]);

  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0],
    [state.activeSessionId, state.sessions],
  );

  const updateSession = useCallback((sessionId: string, update: (session: ChatSession) => ChatSession) => {
    const current = stateRef.current;
    const next = {
      ...current,
      sessions: current.sessions.map((session) => session.id === sessionId ? update(session) : session),
    };
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  const runCompletion = useCallback(async (
    sessionId: string,
    messages: ChatMessage[],
    replayEvents?: readonly AgentStreamEvent[],
  ) => {
    const snapshot = stateRef.current;
    const settings = snapshot.providerSettings;
    const definition = providerDefinition(settings.provider);
    const controller = new AbortController();
    const turnId = createId("turn");
    let eventSequence = 0;
    let agentEvents: AgentStreamEvent[] = [];
    let traceDirty = false;
    const appendTextEvent = (type: "text-delta" | "reasoning-delta", text: string) => {
      if (!text) return;
      const previous = agentEvents.at(-1);
      if (previous?.type === type && previous.text.length + text.length <= 65_536) {
        agentEvents = [...agentEvents.slice(0, -1), { ...previous, text: previous.text + text }];
      } else {
        agentEvents = [...agentEvents, {
          id: createId("event"), occurredAt: new Date().toISOString(), type, turnId,
          sequence: eventSequence++, text,
        }];
      }
      traceDirty = true;
    };
    const appendToolCall = (
      call: { id: string; name: string; arguments: Record<string, unknown> },
      idempotencyKey: string,
    ) => {
      // Provider ids may be optional, unsafe for the shared contract, or repeat
      // across rounds. The semantic key is stable and unique within this turn;
      // the exact native id stays private in the provider continuation.
      const callId = contractId(`call-${idempotencyKey}`, "call");
      agentEvents = [...agentEvents, {
        id: createId("event"), occurredAt: new Date().toISOString(), type: "tool-call", turnId,
        sequence: eventSequence++,
        call: {
          id: callId,
          name: call.name.slice(0, 128) || "unknown",
          arguments: call.arguments,
          idempotencyKey: contractId(idempotencyKey, "tool-key"),
        },
      }];
      traceDirty = true;
    };
    const appendToolResult = (committed: CommittedMobileToolCall) => {
      const callId = contractId(`call-${committed.idempotencyKey}`, "call");
      agentEvents = [...agentEvents, {
        id: createId("event"), occurredAt: new Date().toISOString(), type: "tool-result", turnId,
        sequence: eventSequence++,
        result: {
          toolCallId: callId,
          idempotencyKey: contractId(committed.idempotencyKey, "tool-key"),
          status: committed.execution.ok ? "success" : committed.execution.retryable ? "retryable" : "error",
          text: JSON.stringify(committed.execution.ok
            ? committed.execution.output
            : {
                code: committed.execution.code,
                message: committed.execution.message,
                retryable: committed.execution.retryable,
              }),
        },
      }];
      traceDirty = true;
    };
    const appendUiDocument = (document: Extract<AgentStreamEvent, { type: "ui-document" }>["document"]) => {
      agentEvents = [...agentEvents, {
        id: createId("event"), occurredAt: new Date().toISOString(), type: "ui-document", turnId,
        sequence: eventSequence++, document: structuredClone(document),
      }];
      traceDirty = true;
    };
    const appendTraceError = (message: string, retryable = false) => {
      agentEvents = [...agentEvents, {
        id: createId("event"), occurredAt: new Date().toISOString(), type: "error", turnId,
        sequence: eventSequence++, message: message.slice(0, 65_536), retryable,
      }];
      traceDirty = true;
    };
    const appendTerminal = (type: "completed" | "cancelled") => {
      agentEvents = [...agentEvents, {
        id: createId("event"), occurredAt: new Date().toISOString(), type, turnId,
        sequence: eventSequence++,
      }];
      traceDirty = true;
    };
    abortControllerRef.current = controller;
    generationBusyRef.current = true;
    setIsGenerating(true);
    setRawGenerationError(null);

    const finishBeforeStream = () => {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      generationBusyRef.current = false;
      setIsGenerating(false);
    };

    let apiKey: string | null;
    try {
      apiKey = await getProviderKey(settings.provider);
    } catch (error) {
      finishBeforeStream();
      setRawGenerationError(error instanceof Error ? error.message : "Could not read the provider credential.");
      return;
    }
    if (controller.signal.aborted) {
      finishBeforeStream();
      return;
    }
    if (definition.requiresKey && !apiKey) {
      finishBeforeStream();
      setRawGenerationError(`Add your ${definition.label} API key in Settings before sending a message.`);
      return;
    }

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

    const writeContent = (content: string, usage?: ProviderUsage) =>
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) => message.id === assistantId ? {
          ...message,
          content,
          provider: settings.provider,
          model: settings.model,
          ...(agentEvents.length ? { agentEvents: structuredClone(agentEvents) } : {}),
          ...(usage ? { usage } : {}),
        } : message),
        updatedAt: Date.now(),
      }));
    const dropPlaceholder = () =>
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.filter((message) => message.id !== assistantId),
      }));

    // Provider/tool trace updates are buffered so a multi-round tool exchange
    // does not force a React render for every protocol event.
    let pending = "";
    let providerUsage: ProviderUsage | undefined;
    let rendered = "";
    const flush = () => {
      if (pending === rendered && !traceDirty) return;
      rendered = pending;
      traceDirty = false;
      writeContent(rendered);
    };
    const flushTimer = setInterval(flush, STREAM_FLUSH_INTERVAL_MS);

    try {
      const providerMessages = await Promise.all(messages.slice(-40).map(async (message) => (
        message.attachments?.length
          ? { ...message, attachments: await hydrateMessageAttachments(message.attachments) }
          : message
      )));
      const triggeringMessage = [...providerMessages].reverse().find((message) => message.role === "user");
      if (!triggeringMessage) throw new Error("The tool loop requires a triggering learner message.");
      const toolLoop = await runMobileToolLoop(settings, apiKey, providerMessages, {
        sessionId,
        triggeringMessageId: triggeringMessage.id,
        // The learner turn timestamp is stable across Retry; using the new
        // assistant placeholder timestamp would rewrite an exactly-once effect.
        createdAt: triggeringMessage.createdAt,
        advertiseTools: settings.provider !== "custom" && modelSupportsToolCalls(catalogRef.current, settings),
        signal: controller.signal,
        systemPrompt: `${composeSystemPrompt(
          personaRef.current,
          learnerContextRef.current,
          uiSettingsRef.current.showToolUi,
        )}\n\nNative capability limits (do not claim these as available):\n${unavailableMobileCapabilityPrompt()}`,
        reasoningLevel: resolveModelReasoningLevel(
          catalogRef.current,
          settings,
          uiSettingsRef.current.reasoningLevel,
        ),
        supportsTemperature: modelSupportsTemperature(catalogRef.current, settings),
        fetchImpl: streamingFetch as unknown as typeof fetch,
        onTextDelta: (delta) => {
          pending += delta;
          appendTextEvent("text-delta", delta);
        },
        onReasoningDelta: (delta) => appendTextEvent("reasoning-delta", delta),
        onIntermediateText: () => {
          // Keep teaching prose from adjacent provider rounds visually distinct;
          // the tool call/result events remain between those text segments.
          pending = `${pending.trimEnd()}\n\n`;
        },
        onUsage: (usage) => { providerUsage = usage; },
        onToolCall: appendToolCall,
        executeTool: mobileWorkspace.executeAgentTool,
        lookupToolReceipt: (idempotencyKey, call) => restoreMobileToolReceipt(
          replayEvents,
          stateRef.current.artifacts,
          contractId(idempotencyKey, "tool-key"),
          call.name,
          mobileWorkspace.hasOverlay,
        ),
        commitToolCall: async (committed) => {
          const eventsBeforeResult = agentEvents;
          appendToolResult(committed);
          const current = stateRef.current;
          const next: PersistedAppState = {
            ...current,
            artifacts: applyMobileToolArtifactEffects(current.artifacts, committed.execution),
            sessions: current.sessions.map((session) => session.id === sessionId ? {
              ...session,
              messages: session.messages.map((message) => message.id === assistantId ? {
                ...message,
                provider: settings.provider,
                model: settings.model,
                agentEvents: structuredClone(agentEvents),
              } : message),
              updatedAt: Date.now(),
            } : session),
          };
          try {
            await persistLearnerState(next, true);
          } catch (error) {
            agentEvents = eventsBeforeResult;
            traceDirty = true;
            throw error;
          }
          stateRef.current = next;
          setState(next);
        },
      });
      providerUsage = toolLoop.usage ?? undefined;
      const content = toolLoop.text;
      pending = content;
      clearInterval(flushTimer);
      const uiOutput = extractUiDocuments(content);
      pending = uiOutput.content;
      for (const [index, document] of uiOutput.documents.entries()) {
        appendUiDocument(scopeUiDocument(document, `${sessionId}:${assistantId}:${index}`));
      }
      for (const message of uiOutput.errors) appendTraceError(message);
      appendTerminal("completed");
      await persistLearnerState(writeContent(uiOutput.content, providerUsage));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      clearInterval(flushTimer);
      const aborted = error instanceof Error && (error.name === "AbortError" || controller.signal.aborted);
      // A stopped response keeps whatever was already streamed; a failed one
      // leaves no half-message behind.
      if (aborted) {
        appendTerminal("cancelled");
        const hasCommittedToolTrace = agentEvents.some((event) => event.type === "tool-result");
        if (pending.trim() || hasCommittedToolTrace) await persistLearnerState(writeContent(pending.trim()));
        else await persistLearnerState(dropPlaceholder());
        return;
      }
      const errorMessage = error instanceof Error ? error.message : "The model request failed.";
      const hasCommittedToolTrace = agentEvents.some((event) => event.type === "tool-result");
      if (hasCommittedToolTrace || providerUsage) {
        appendTraceError(errorMessage, true);
        await persistLearnerState(writeContent(pending.trim(), providerUsage));
      } else {
        await persistLearnerState(dropPlaceholder());
      }
      setRawGenerationError(errorMessage);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      clearInterval(flushTimer);
      setStreamingMessageId((current) => current === assistantId ? null : current);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      generationBusyRef.current = false;
      setIsGenerating(false);
    }
  }, [mobileWorkspace.executeAgentTool, mobileWorkspace.hasOverlay, persistLearnerState, updateSession]);

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
    const current = stateRef.current;
    const session = current.sessions.find((entry) => entry.id === current.activeSessionId) ?? current.sessions[0];
    const message: ChatMessage = {
      id: createId("message"),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
      ...(attachments.length ? { attachments } : {}),
    };
    const messages = [...session.messages, message];
    const next = updateSession(session.id, (entry) => ({
      ...entry,
      title: entry.messages.length === 0
        ? titleFromFirstMessage(trimmed || attachments[0]?.name || "Attached lesson")
        : entry.title,
      messages,
      updatedAt: message.createdAt,
    }));
    await persistLearnerState(next);
    await trackCompletion(runCompletion(session.id, messages));
  }, [persistLearnerState, runCompletion, trackCompletion, updateSession]);

  const retryLastResponse = useCallback(async () => {
    if (generationBusyRef.current) return;
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
    const replayEvents = [...session.messages.slice(userIndex + 1)]
      .reverse()
      .find((message) => message.role === "assistant" && message.agentEvents?.some((event) => event.type === "tool-result"))
      ?.agentEvents;
    await persistLearnerState(updateSession(session.id, (entry) => ({ ...entry, messages, updatedAt: Date.now() })));
    await trackCompletion(runCompletion(session.id, messages, replayEvents));
  }, [persistLearnerState, runCompletion, trackCompletion, updateSession]);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  useEffect(() => {
    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active" || !generationBusyRef.current) return;
      // Expo cannot guarantee a JavaScript continuation after suspension. Stop
      // at the abort boundary so the catch path durably records partial text,
      // committed receipts, and an explicit learner retry route.
      setRawGenerationError("The response paused when Keating moved to the background. Return here and retry it.");
      stopGeneration();
    };
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, [stopGeneration]);

  const newSession = useCallback(() => {
    stopGeneration();
    const session = createSession();
    const current = stateRef.current;
    const next = {
      ...current,
      sessions: [session, ...current.sessions],
      activeSessionId: session.id,
    };
    // The ref normally catches up on the next render, which is too late for a
    // caller that opens a lesson and sends its first message in the same tick
    // — that message would otherwise land in the previous session.
    stateRef.current = next;
    setState(next);
    queueLearnerState(next);
    void Haptics.selectionAsync().catch(() => undefined);
    return session.id;
  }, [queueLearnerState, stopGeneration]);

  const startNewSessionWithMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return null;

    stopGeneration();
    const activeCompletion = generationPromiseRef.current;
    if (activeCompletion) await activeCompletion.catch(() => undefined);

    const createdAt = Date.now();
    const message: ChatMessage = {
      id: createId("message"),
      role: "user",
      content: trimmed,
      createdAt,
    };
    const session: ChatSession = {
      ...createSession(),
      title: titleFromFirstMessage(trimmed),
      messages: [message],
      updatedAt: createdAt,
    };
    const current = stateRef.current;
    const next: PersistedAppState = {
      ...current,
      sessions: [session, ...current.sessions],
      activeSessionId: session.id,
    };
    stateRef.current = next;
    setState(next);
    await persistLearnerState(next);
    void Haptics.selectionAsync().catch(() => undefined);
    await trackCompletion(runCompletion(session.id, [message]));
    return session.id;
  }, [persistLearnerState, runCompletion, stopGeneration, trackCompletion]);

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
    const current = stateRef.current;
    const next = {
      ...current,
      sessions: [fork, ...current.sessions],
      activeSessionId: fork.id,
    };
    stateRef.current = next;
    setState(next);
    queueLearnerState(next);
    void Haptics.selectionAsync().catch(() => undefined);
    return fork.id;
  }, [queueLearnerState]);

  const selectSession = useCallback((sessionId: string) => {
    if (!stateRef.current.sessions.some((session) => session.id === sessionId)) return;
    stopGeneration();
    setState((current) => ({ ...current, activeSessionId: sessionId }));
  }, [stopGeneration]);

  const deleteSession = useCallback((sessionId: string) => {
    stopGeneration();
    const current = stateRef.current;
    const remaining = current.sessions.filter((session) => session.id !== sessionId);
    if (remaining.length === 0) remaining.push(createSession());
    const next = {
      ...current,
      sessions: remaining,
      activeSessionId: current.activeSessionId === sessionId ? remaining[0].id : current.activeSessionId,
      artifacts: current.artifacts.filter((artifact) => artifact.sessionId !== sessionId),
    };
    stateRef.current = next;
    setState(next);
    queueLearnerState(next);
  }, [queueLearnerState, stopGeneration]);

  const setMessageFeedback = useCallback((messageId: string, feedback: MessageFeedback) => {
    const current = stateRef.current;
    let previous: MessageFeedback | undefined;
    const sessions = current.sessions.map((session) => ({
        ...session,
        messages: session.messages.map((message) => {
          if (message.id !== messageId) return message;
          previous = message.feedback;
          return { ...message, feedback, feedbackAt: Date.now() };
        }),
      }));
    if (!previous && sessions.every((session) => session.messages.every((message) => message.id !== messageId))) return;
    const learnerFeedback = { ...current.learnerFeedback };
    if (previous) learnerFeedback[previous] = Math.max(0, learnerFeedback[previous] - 1);
    learnerFeedback[feedback] += 1;
    const next = { ...current, sessions, learnerFeedback };
    stateRef.current = next;
    setState(next);
    queueLearnerState(next);
    void Haptics.selectionAsync().catch(() => undefined);
  }, [queueLearnerState]);

  const saveArtifact = useCallback((messageId: string, kind: ArtifactKind = "note") => {
    const current = stateRef.current;
    if (current.artifacts.some((artifact) => artifact.messageId === messageId)) return;
    const session = current.sessions.find((entry) => entry.messages.some((message) => message.id === messageId));
    const message = session?.messages.find((entry) => entry.id === messageId);
    if (!session || !message || message.role !== "assistant") return;
    const next: PersistedAppState = {
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
    stateRef.current = next;
    setState(next);
    queueLearnerState(next);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [queueLearnerState]);

  const createLearningArtifact = useCallback((topicName: string, kind: GeneratedArtifactKind) => {
    const generated = generateLearningArtifact(topicName, kind);
    const id = createId("artifact");
    const current = stateRef.current;
    const next: PersistedAppState = {
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
    };
    stateRef.current = next;
    setState(next);
    queueLearnerState(next);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    return id;
  }, [queueLearnerState]);

  const deleteArtifact = useCallback((artifactId: string) => {
    const current = stateRef.current;
    const next = {
      ...current,
      artifacts: current.artifacts.filter((artifact) => artifact.id !== artifactId),
    };
    stateRef.current = next;
    setState(next);
    queueLearnerState(next);
  }, [queueLearnerState]);

  const setProvider = useCallback((provider: ProviderId) => {
    setState((current) => ({ ...current, providerSettings: settingsForProvider(provider) }));
  }, []);

  const selectProviderModel = useCallback((model: CatalogModel) => {
    setCatalog((current) => {
      const next = mergeCatalogModels(current, [model]);
      catalogRef.current = next;
      return next;
    });
    setState((current) => ({
      ...current,
      providerSettings: selectedProviderSettings(current.providerSettings, model),
    }));
    void Haptics.selectionAsync().catch(() => undefined);
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

  const exportLearnerData = useCallback(async (): Promise<PortableLearnerEnvelope> => {
    const repository = learnerRepositoryRef.current;
    if (!repository) throw new Error("Learning data is still loading. Wait a moment and try exporting again.");
    await learnerRepositoryWriteTailRef.current.catch(() => undefined);
    return repository.records.exportPortable();
  }, []);

  const importLearnerData = useCallback(async (candidate: unknown) => {
    stopGeneration();
    const activeCompletion = generationPromiseRef.current;
    if (activeCompletion) await activeCompletion.catch(() => undefined);
    const repository = learnerRepositoryRef.current;
    if (!repository) throw new Error("Learning data is still loading. Wait a moment and try importing again.");
    learnerRepositoryClearingRef.current = true;
    let result: { data: PortableLearnerData; unprojected: UnprojectedNativeRecords } | undefined;
    try {
      const write = learnerRepositoryWriteTailRef.current
        .catch(() => undefined)
        .then(async () => {
          const merged = await repository.records.importPortable(candidate);
          const locations = await repository.records.getLocalAttachments();
          const current = stateRef.current;
          const projected = projectPortableToNativeState(
            merged,
            current.providerSettings,
            locations,
            current.activeSessionId,
          );
          const next = normalizeState(projected.state);
          stateRef.current = next;
          setState(next);
          setLearnerData(merged);
          result = { data: merged, unprojected: projected.unprojected };
          // SQLite is authoritative. AsyncStorage is a compatibility cache, so
          // a cache failure cannot turn a committed import into a false rollback.
          try {
            await savePersistedState(next);
          } catch (error) {
            setStorageError(error instanceof Error ? error.message : "Imported data was saved, but the compatibility cache could not be refreshed.");
          }
        });
      learnerRepositoryWriteTailRef.current = write;
      await write;
      if (!result) throw new Error("The learner import did not produce a validated snapshot.");
      return result;
    } finally {
      learnerRepositoryClearingRef.current = false;
    }
  }, [stopGeneration]);

  const updateLearnerGoalStep = useCallback(async (
    goalId: string,
    stepId: string,
    status: GoalStepStatus,
  ) => {
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

  const saveLearnerGoalStep = useCallback(async (
    goal: LearnerGoal,
    stepId: string,
    status: GoalStepStatus,
  ) => {
    await mutateLearnerRecords((current, now) => {
      const ensured = ensureLearnerGoalData(current, goal, now);
      return {
        data: updateGoalStepData(ensured, goal.id, stepId, status, now),
        result: true,
      };
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
      data: createDeckWithCardsData(current, {
        id: deckId,
        title,
        topic,
        createdAt: now,
        cards: pendingCards,
      }),
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
      const applied = setStudyPriorityData(
        current,
        targetType,
        targetId,
        priority,
        createId("priority"),
        now,
      );
      return { data: applied.data, result: applied.record };
    });
  }, [mutateLearnerRecords]);

  const dispatchUiAction = useCallback(async (
    action: UiAction,
    document: UiDocument,
    sessionId?: string,
  ): Promise<UiActionResult> => {
    const repository = learnerRepositoryRef.current;
    if (!repository) throw new Error("Learning data is still loading. Wait a moment and try again.");
    let result: UiActionResult | undefined;
    const write = learnerRepositoryWriteTailRef.current
      .catch(() => undefined)
      .then(async () => {
        result = await repository.uiActions.dispatch(
          action,
          document,
          (current, now) => applyLocalUiAction(current, action, document, now, sessionId),
        );
        const snapshot = await repository.records.snapshot();
        const locations = await repository.records.getLocalAttachments();
        const current = stateRef.current;
        const projected = projectPortableToNativeState(
          snapshot,
          current.providerSettings,
          locations,
          current.activeSessionId,
        );
        const next = normalizeState(projected.state);
        stateRef.current = next;
        setState(next);
        setLearnerData(snapshot);
        try {
          await savePersistedState(next);
        } catch (error) {
          setStorageError(error instanceof Error ? error.message : "OpenUI progress was saved, but the compatibility cache could not be refreshed.");
        }
      });
    learnerRepositoryWriteTailRef.current = write;
    await write;
    if (!result) throw new Error("OpenUI action did not produce a durable result.");
    return result;
  }, []);

  const getUiActionJournal = useCallback(async (documentId: string): Promise<UiActionJournal> => {
    const repository = learnerRepositoryRef.current;
    if (!repository) throw new Error("Learning data is still loading. Wait a moment and try again.");
    await learnerRepositoryWriteTailRef.current.catch(() => undefined);
    return repository.uiActions.getJournal(documentId);
  }, []);

  const setPersona = useCallback(async (text: string) => {
    const next = text.trim().length > 0 ? text : DEFAULT_TEACHER_PERSONA;
    await savePersona(next);
    personaRef.current = next;
    setPersonaState(next);
  }, []);

  const setLearnerContext = useCallback(async (text: string) => {
    const next = normalizeLearnerContext(text);
    await saveLearnerContext(next);
    learnerContextRef.current = next;
    setLearnerContextState(next);
  }, []);

  const restoreDefaultPersona = useCallback(async () => {
    await resetPersona();
    personaRef.current = DEFAULT_TEACHER_PERSONA;
    setPersonaState(DEFAULT_TEACHER_PERSONA);
  }, []);

  const clearLearningData = useCallback(async () => {
    stopGeneration();
    const activeCompletion = generationPromiseRef.current;
    if (activeCompletion) await activeCompletion.catch(() => undefined);
    const repository = learnerRepositoryRef.current;
    if (!repository) throw new Error("Learning data is still loading. Wait a moment and try clearing again.");
    learnerRepositoryClearingRef.current = true;
    try {
      await learnerRepositoryWriteTailRef.current.catch(() => undefined);
      const pending = await repository.records.pendingClear();
      const intent = pending ?? { id: createId("clear"), createdAt: new Date().toISOString() };
      if (!pending) await repository.records.beginClear(intent);
      await resumePendingLearningDataClear(repository.records, {
        clearPersistedState,
        clearComposerDrafts: clearAllComposerDrafts,
        clearComposerAttachmentFiles,
        clearLearnerContext: () => saveLearnerContext(""),
      });
      clearCardState();
      const next = initialState();
      stateRef.current = next;
      setState(next);
      learnerContextRef.current = "";
      setLearnerContextState("");
      setLearnerData(await repository.records.snapshot());
      setPersistenceReady(true);
      setStorageError(null);
      try {
        await savePersistedState(next);
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : "Learning data was cleared, but the compatibility cache could not be refreshed.");
      }
    } finally {
      learnerRepositoryClearingRef.current = false;
    }
  }, [stopGeneration]);

  const definition = providerDefinition(state.providerSettings.provider);
  const isProviderConfigured = !definition.requiresKey || keyStatus[state.providerSettings.provider];
  const supportsReasoning = useMemo(
    () => modelSupportsReasoning(catalog, state.providerSettings),
    [catalog, state.providerSettings],
  );
  const reasoningLevels = useMemo(
    () => modelReasoningLevels(catalog, state.providerSettings),
    [catalog, state.providerSettings],
  );
  const supportsTemperature = useMemo(
    () => modelSupportsTemperature(catalog, state.providerSettings),
    [catalog, state.providerSettings],
  );
  const interruptedTurn = useMemo(() => {
    if (isGenerating) return false;
    const latestAssistant = [...activeSession.messages].reverse().find((message) => message.role === "assistant");
    return interruptedAgentTurn(latestAssistant?.agentEvents);
  }, [activeSession.messages, isGenerating]);
  const generationError = useMemo(() => {
    const message = rawGenerationError ?? (interruptedTurn
      ? "The previous response was interrupted before Keating could finish. Retry it to reuse any completed work."
      : null);
    return message === null ? null : presentedErrorMessage(message, uiSettings.showRawErrors);
  }, [interruptedTurn, rawGenerationError, uiSettings.showRawErrors]);

  const value = useMemo<KeatingContextValue>(() => ({
    state,
    activeSession,
    hydrated,
    storageError,
    learnerData,
    learnerRepositoryReady: repositoryReady,
    generationError,
    isGenerating,
    streamingMessageId,
    keyStatus,
    isProviderConfigured,
    supportsReasoning,
    reasoningLevels,
    supportsTemperature,
    persona,
    setPersona,
    restoreDefaultPersona,
    learnerContext,
    setLearnerContext,
    sendMessage,
    startNewSessionWithMessage,
    retryLastResponse,
    stopGeneration,
    clearGenerationError: () => setRawGenerationError(null),
    newSession,
    forkSession,
    selectSession,
    deleteSession,
    setMessageFeedback,
    saveArtifact,
    createLearningArtifact,
    deleteArtifact,
    setProvider,
    selectProviderModel,
    updateProviderSettings,
    saveApiKey,
    removeApiKey,
    exportLearnerData,
    importLearnerData,
    saveLearnerGoal,
    saveLearnerGoalStep,
    saveLearnerQuizResult,
    saveLearnerQuestionChecks,
    createLearnerDeck,
    updateLearnerGoalStep,
    recordLearnerCardReview,
    setLearnerStudyPriority,
    dispatchUiAction,
    getUiActionJournal,
    clearLearningData,
  }), [
    state, activeSession, hydrated, storageError, learnerData, repositoryReady, generationError, isGenerating, streamingMessageId,
    keyStatus, isProviderConfigured, supportsReasoning, reasoningLevels, supportsTemperature,
    persona, setPersona, restoreDefaultPersona,
    learnerContext, setLearnerContext,
    sendMessage, startNewSessionWithMessage, retryLastResponse, stopGeneration, newSession, forkSession,
    selectSession, deleteSession, setMessageFeedback, saveArtifact, createLearningArtifact, deleteArtifact,
    setProvider, selectProviderModel, updateProviderSettings, saveApiKey, removeApiKey,
    exportLearnerData, importLearnerData, saveLearnerGoal, saveLearnerGoalStep, saveLearnerQuizResult, saveLearnerQuestionChecks, createLearnerDeck,
    updateLearnerGoalStep, recordLearnerCardReview,
    setLearnerStudyPriority, dispatchUiAction, getUiActionJournal, clearLearningData,
  ]);

  return <KeatingContext.Provider value={value}>{children}</KeatingContext.Provider>;
}

export function useKeating(): KeatingContextValue {
  const context = useContext(KeatingContext);
  if (!context) throw new Error("useKeating must be used inside KeatingProvider.");
  return context;
}
