import { FlueConversation } from "../keating/flue/conversation";
import flueRuntimeUrl from "virtual:keating-flue-runtime";
import {
  useRef,
  useTransition,
  useCallback,
  use,
  useEffect,
  useState,
} from "react";
import { usePostHog } from "@posthog/react";
import {
  type AgentMessage,
  type AgentState,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { PortableAgentInstance } from "@keating/agent-runtime";
import {
  BROWSER_DECLARATIVE_ARTIFACT_KINDS,
  browserSystemPromptFromRevision,
  createBrowserAccountEvolutionClient,
} from "../keating/account-evolution";
import { useDialogState } from "./useDialogState";
import { type Model, type Api, type Context } from "@earendil-works/pi-ai";
import { defaultConvertToLlm } from "@earendil-works/pi-web-ui";
import { SettingsDialog } from "../components/SettingsDialog";
import {
  MODELS_TAB_ALL_SECTION_IDS,
  SETTINGS_DIALOG_TAB_IDS,
} from "../components/settings/section-ids";
import { KeatingUiSettingsTab } from "../components/KeatingUiSettingsTab";
import { DiagnosticsTab } from "../components/settings/DiagnosticsTab";
import { LearningTab } from "../components/settings/LearningTab";
import { ModelsProvidersTab } from "../components/settings/ModelsProvidersTab";
import {
  SessionBrowser,
  SESSION_BROWSER_BREAKPOINT,
} from "../components/SessionBrowser";
import {
  ImageGenerationModelSelectorDialog,
  ModelSelectorDialog,
} from "../components/ModelSelector";
import {
  KeatingApiKeyPromptDialog,
  promptKeatingApiKey,
} from "../components/KeatingApiKeyPromptDialog";
import {
  getProviderApiKey,
  resolveAvailableChatModel,
} from "../lib/provider-models";
import { recordDiagnostic } from "../lib/diagnostics";
import { notOrganicPublicClient } from "../notorganic-provider";
import {
  captureSessionModelContext,
  recordSessionDebugAgentEvent,
  recordSessionHook,
  subscribeLifecycleDebug,
} from "../lib/session-debug";
import {
  DEFAULT_IMAGE_GENERATOR_ID,
  getImageGenerator,
} from "../lib/image-generators";
import { localModel } from "../stores/local-model";
import {
  buildKeatingSystemPrompt,
  composeKeatingSystemPrompt,
  appendCourseCollaborationPrompt,
  createKeatingTools,
  executeRawKeatingTool,
  getActiveKeatingPrompt,
  type KeatingToolsOptions,
} from "../keating/browser-tools";
import { toolExecutionSucceeded } from "../keating/tool-result";
import { runBrowserTeachingExperiment } from "../keating/teaching-evolution";
import {
  loadAgentRuntimeConfig,
  shouldAutoBootNodePod,
  type KeatingAgentRuntimeConfig,
} from "../keating/agent-runtime";
import {
  appendWorkspaceCapabilityPrompt,
  filterAvailableKeatingTools,
} from "../keating/capabilities";
import { keatingLifecycle } from "../keating/lifecycle";
import { detectTopicCategoryShift } from "../keating/topic-shift-hook";
import {
  browserConversationRuntime,
  recordAgentEvent,
  recordOpenUIAction,
  type ConversationRuntime,
} from "../keating/integration";
import { AuthorizedToolExecutor } from "../keating/security";
import type { ConversationEvent } from "../keating/protocol";
import type { KeatingOpenUIAction } from "../keating/openui/types";
import { keatingOpenUIPrompt } from "../keating/openui/library";
import {
  isDefaultPersona,
  loadPersona,
  subscribePersona,
} from "../keating/persona";
import {
  loadLearnerContext,
  subscribeLearnerContext,
} from "../keating/learner-context";
import {
  composeSessionStartSystemPrompt,
  runSessionStartHooks,
} from "../keating/session-start-hooks";
import {
  buildPendingResponseComparison,
  type PendingResponseComparison,
  type ResponseComparisonDecision,
} from "../keating/response-comparison";
import { bootNodePod } from "../keating/nodepod-runtime";
import { registerKeatingWebMcp } from "../keating/webmcp";
import { shouldExposeClientWebSearch } from "../keating/provider-web-search";
import {
  appendKeatingPortableCatalog,
  authorKeatingBrowserAgent,
  type DelegationRequest,
} from "../keating/portable-agent";
import {
  type LiveSpeechBridge,
  type WebSpeechSettings,
} from "../keating/speech";
import { buildLiveHistory } from "../keating/live-history";
import { buildLiveSessionContext } from "../keating/live-context";
import {
  savePersistentStorageStatus,
  useKeatingAgentStore,
  type ForkInfo,
  type PersistentStorageStatus,
} from "../stores/keating-agent-store";
import { subscribeAgentEvents } from "./agent-subscriptions";
import {
  DEFAULT_MODEL,
  hybridStreamFn,
  searchWithConfiguredProvider,
} from "./keating-stream";
import {
  getInitPromise,
  keatingStorage,
  sessions,
  storageBackendKind,
  updateSessionTitle,
} from "./keating-storage";
import { runSessionSwitch, SessionSaveQueue, SessionSnapshotTracker, SessionSwitchRequests } from "./session-switch";
import { hasAutoTitleContext } from "./session-auto-title";
import {
  cloneMessages,
  createSessionId,
  sessionModelMetadata,
  sessionPreview,
  sessionSearchText,
  sessionTitle,
  sessionUsage,
  buildForkSession,
} from "./session-metadata";
import {
  messagesForSessionSnapshot,
  prepareMessagesForRetry,
} from "./session-recovery";
import {
  buildSharedTrajectory,
  saveSharedSession,
  sharedSessionUrl,
  type SharedSessionUrlResult,
} from "../keating/shared-sessions";
import {
  loadKeatingUiSettings,
  saveKeatingUiSettings,
} from "../keating/ui-settings";
import {
  branchBeforeAssistantTurn,
  canGenerateAlternativeFromBranch,
  lastAssistantTimestamp,
  shouldGenerateAlternativeResponse,
} from "../keating/alternative-responses";
import type { ChatPanelHandle } from "../types/chat-panel";
import type { SessionData, SessionMetadata } from "../types/session";
import { subscribeAgentAnalytics } from "../lib/agent-analytics";
import {
  ArizeTraceClient,
  getArizePublicConfig,
  publishArizeTraceStatus,
  type ArizePublicConfig,
} from "../lib/arize-observability";
import {
  readAnalyticsPreferences,
  writeAnalyticsPreferences,
} from "../lib/analytics-preferences";
import { isSessionReplayAvailable } from "../lib/posthog";
import { currentTurnEvaluationContent } from "../lib/arize-evaluation-content";

function buildAgentSystemPrompt(
  speechEnabled: boolean,
  basePrompt: string,
  learnerContext: string,
  sessionStartContext = "",
  agentRuntime?: KeatingAgentRuntimeConfig,
  course?: KeatingToolsOptions["course"],
): string {
  const prompt = buildKeatingSystemPrompt(
    speechEnabled,
    basePrompt,
    learnerContext,
  );
  const promptWithOpenUi = basePrompt.includes(keatingOpenUIPrompt)
    ? prompt
    : `${prompt}\n\n${keatingOpenUIPrompt}`;
  const promptWithSessionContext = composeSessionStartSystemPrompt(
    promptWithOpenUi,
    sessionStartContext,
  );
  const promptWithWorkspace = appendWorkspaceCapabilityPrompt(
    promptWithSessionContext,
    { runtime: agentRuntime },
  );
  return appendCourseCollaborationPrompt(promptWithWorkspace, course);
}

async function runPortableBrowserDelegate(
  request: DelegationRequest,
  model: Model<Api>,
  thinkingLevel: ThinkingLevel,
  signal?: AbortSignal,
): Promise<string> {
  const instance = new PortableAgentInstance({
    id: `browser-delegate-${crypto.randomUUID()}`,
  });
  const frame = instance.render(request.subagent.agent);
  const child = new FlueConversation({
    initialState: {
      model,
      thinkingLevel,
      messages: [],
      tools: [],
      systemPrompt: frame.system,
    },
    convertToLlm: defaultConvertToLlm,
    streamFn: hybridStreamFn,
    sessionId: `delegate-${crypto.randomUUID()}`,
  }, flueRuntimeUrl);
  child.getApiKey = (provider: string) => getProviderApiKey(provider);
  const abort = () => child.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await child.send(request.task);
  } finally {
    signal?.removeEventListener("abort", abort);
    await child.dispose();
  }
  const output = lastAssistantText(child.context.messages);
  if (!output) throw new Error(`Portable subagent ${request.subagent.name} returned no text.`);
  return output;
}

function lastAssistantText(messages: readonly AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: unknown;
      content?: unknown;
    };
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter(
        (part): part is { type: "text"; text: string } =>
          Boolean(
            part &&
              typeof part === "object" &&
              (part as { type?: unknown }).type === "text" &&
              typeof (part as { text?: unknown }).text === "string",
          ),
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function cleanSuggestedTitle(text: string) {
  return text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^title:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// Lesson plans, concept maps, and verification checklists are no longer
// agent tools — they are streamed as OpenUI components (StudyPlan,
// ConceptMap, SharedNotes, Explanation) inside LearningSurface. Keep the
// durable-saved artifact tools here so the chat can still surface historical
// plans/maps alongside media and self-improvement work.
const ARTIFACT_TOOL_NAMES = new Set([
  "animate",
  "quiz",
  "deck",
  "generate_image",
  "bench",
  "evolve",
  "auto_improve",
  "prompt_evolve",
  "evaluate_teaching",
  "request_teaching_improvement",
]);

const SESSION_RESTORE_TIMEOUT_MS = 5_000;

async function browserPersistentStorageGranted(): Promise<boolean> {
  if (storageBackendKind === "p2p") return true;
  if (typeof navigator === "undefined" || !navigator.storage?.persisted)
    return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

async function requestBrowserPersistentStorage(): Promise<PersistentStorageStatus> {
  if (storageBackendKind === "p2p") return "granted";
  if (typeof navigator === "undefined" || !navigator.storage) return "declined";
  try {
    if (navigator.storage.persisted && (await navigator.storage.persisted())) {
      return "granted";
    }
    if (!navigator.storage.persist) return "declined";
    const granted = await navigator.storage.persist();
    if (granted) return "granted";
    return (await browserPersistentStorageGranted()) ? "granted" : "declined";
  } catch {
    return "declined";
  }
}

async function withSessionRestoreTimeout<T>(
  operation: Promise<T>,
  label: string,
): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () =>
        reject(
          new Error(`${label} timed out after ${SESSION_RESTORE_TIMEOUT_MS}ms`),
        ),
      SESSION_RESTORE_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

const BROWSER_EVOLUTION_COMPATIBILITY = Object.freeze({
  agentApi: "keating-agent-hooks-v1",
  learnerContract: 1,
  capabilities: BROWSER_DECLARATIVE_ARTIFACT_KINDS,
});

async function resolveConnectedAccountPrompt(localPrompt: string): Promise<string> {
  const publicClient = notOrganicPublicClient();
  if (!publicClient?.getSession()) return localPrompt;
  try {
    const revision = await createBrowserAccountEvolutionClient(
      publicClient,
      BROWSER_EVOLUTION_COMPATIBILITY,
    ).resolveActiveRevision();
    if (!revision) return localPrompt;
    const prompt = browserSystemPromptFromRevision(revision);
    if (!prompt) {
      recordDiagnostic(
        "warning",
        "account-evolution",
        "The active account revision has no supported system prompt; using the local prompt.",
        { revisionId: revision.revisionId, generation: revision.generation },
      );
      return localPrompt;
    }
    recordDiagnostic(
      "info",
      "account-evolution",
      "Activated the connected Not Organic account pedagogy revision.",
      { revisionId: revision.revisionId, generation: revision.generation },
    );
    return prompt;
  } catch (error) {
    recordDiagnostic(
      "warning",
      "account-evolution",
      error,
      { fallback: "local-prompt" },
    );
    return localPrompt;
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────
export interface UseKeatingAgentReturn {
  title: string;
  isPending: boolean;
  // Rendered nodes
  chatPanelRef: (node: ChatPanelHandle | null) => void;
  dialogs: React.ReactNode;
  sessionSidebar: React.ReactNode;
  // Top-level actions
  openSettings: () => void;
  /** Display name of the active chat model, for the header's model button. */
  modelLabel: string;
  openModelSelector: () => void;
  openSessions: () => void;
  newSession: () => void;
  shareSession: () => Promise<SharedSessionUrlResult>;
  setThinkingLevel: (level: ThinkingLevel) => void;
  generateCurrentSessionTitle: () => Promise<string>;
  // Speech
  speechEnabled: boolean;
  toggleSpeech: () => void;
  // Persistent storage
  persistentStorageStatus: PersistentStorageStatus;
  persistentBannerDismissed: boolean;
  retryPersistentStorage: () => void;
  dismissPersistentBanner: () => void;
  // Session & fork state
  activeSessionId: string;
  forkingSessionId: string | null;
  forkInfo: ForkInfo | null;
  openOriginalSession: () => void;
  // Sidebar layout
  sessionSidebarCollapsed: boolean;
  toggleSessionSidebar: () => void;
  mobileSidebarOpen: boolean;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  responseComparison: PendingResponseComparison | null;
  chooseResponse: (preference: ResponseComparisonDecision) => Promise<void>;
}

export function useKeatingAgent(
  options: { courseContext?: KeatingToolsOptions["course"] } = {},
): UseKeatingAgentReturn {
  // Use React 19's use() for suspense handling of asynchronous init
  use(getInitPromise());

  const posthog = usePostHog();
  const activeCourseId = options.courseContext?.activeCourseId;
  const courseMode = options.courseContext?.mode;
  const courseContext: KeatingToolsOptions["course"] =
    activeCourseId || courseMode
      ? { activeCourseId, mode: courseMode }
      : undefined;
  const title = "Keating";
  const agentRef = useRef<FlueConversation | null>(null);
  const sessionSwitchRequestsRef = useRef(new SessionSwitchRequests());
  const sessionSaveQueueRef = useRef(new SessionSaveQueue());
  const sessionSnapshotsRef = useRef(new SessionSnapshotTracker());
  const learnerBookkeepingRef = useRef(Promise.resolve());
  const panelRef = useRef<ChatPanelHandle | null>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const toolExecutorRef = useRef(new AuthorizedToolExecutor());
  const untrustedSearchProvenanceRef = useRef(false);
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const sessionParentIdRef = useRef<string | null>(null);
  const sessionForkedAtRef = useRef<string | undefined>(undefined);
  const selectedModelRef = useRef<Model<Api>>(DEFAULT_MODEL);
  const courseContextRef = useRef(courseContext);
  courseContextRef.current = courseContext;
  // The ref is what the agent reads; this mirrors it for anything that has to
  // re-render when the model changes, such as the chat header's model button.
  const [modelLabel, setModelLabel] = useState<string>(
    DEFAULT_MODEL.name ?? DEFAULT_MODEL.id,
  );
  const selectModel = useCallback((model: Model<Api>) => {
    recordDiagnostic("info", "model", "Active model selected", {
      provider: model.provider,
      model: model.id,
    });
    selectedModelRef.current = model;
    setModelLabel(model.name ?? model.id);
  }, []);
  const activeSessionId = useKeatingAgentStore(
    (state) => state.activeSessionId,
  );
  const setActiveSessionId = useKeatingAgentStore(
    (state) => state.setActiveSessionId,
  );
  const forkingSessionId = useKeatingAgentStore(
    (state) => state.forkingSessionId,
  );
  const setForkingSessionId = useKeatingAgentStore(
    (state) => state.setForkingSessionId,
  );
  const forkedSessionId = useKeatingAgentStore(
    (state) => state.forkedSessionId,
  );
  const setForkedSessionId = useKeatingAgentStore(
    (state) => state.setForkedSessionId,
  );
  const clearForkedSessionId = useKeatingAgentStore(
    (state) => state.clearForkedSessionId,
  );
  const forkInfo = useKeatingAgentStore((state) => state.forkInfo);
  const setForkInfo = useKeatingAgentStore((state) => state.setForkInfo);
  const sessionSidebarCollapsed = useKeatingAgentStore(
    (state) => state.sessionSidebarCollapsed,
  );
  const toggleSessionSidebar = useKeatingAgentStore(
    (state) => state.toggleSessionSidebar,
  );
  const setSidebarCollapsed = useKeatingAgentStore(
    (state) => state.setSessionSidebarCollapsed,
  );
  const mobileSidebarOpen = useKeatingAgentStore(
    (state) => state.mobileSidebarOpen,
  );
  const toggleMobileSidebar = useKeatingAgentStore(
    (state) => state.toggleMobileSidebar,
  );
  const closeMobileSidebar = useKeatingAgentStore(
    (state) => state.closeMobileSidebar,
  );
  const speechSettings = useKeatingAgentStore((state) => state.speechSettings);
  const speechEnabledRef = useRef(speechSettings.enabled);
  speechEnabledRef.current = speechSettings.enabled;
  const setSpeechSettings = useKeatingAgentStore(
    (state) => state.setSpeechSettings,
  );
  const toggleSpeech = useKeatingAgentStore((state) => state.toggleSpeech);
  const persistentStorageStatus = useKeatingAgentStore(
    (state) => state.persistentStorageStatus,
  );
  const setPersistentStorageStatus = useKeatingAgentStore(
    (state) => state.setPersistentStorageStatus,
  );
  const persistentStorageChecked = useKeatingAgentStore(
    (state) => state.persistentStorageChecked,
  );
  const setPersistentStorageChecked = useKeatingAgentStore(
    (state) => state.setPersistentStorageChecked,
  );
  const persistentBannerDismissed = useKeatingAgentStore(
    (state) => state.persistentBannerDismissed,
  );
  const dismissPersistentBanner = useKeatingAgentStore(
    (state) => state.dismissPersistentBanner,
  );
  const settingsDialog = useDialogState();
  const modelSelectorDialog = useDialogState();
  const imageModelSelectorDialog = useDialogState();
  const imageModelRetryRef = useRef<null | (() => Promise<void>)>(null);
  const [isPending, startTransition] = useTransition();
  const bootstrapTimerRef = useRef<number | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const persistentStorageRequestedRef = useRef(false);
  const systemPromptBaseRef = useRef<string>("");
  const agentRuntimeRef = useRef<KeatingAgentRuntimeConfig | undefined>(
    undefined,
  );
  const sessionStartContextRef = useRef<{
    sessionId: string;
    context: string;
    promise: Promise<string> | null;
  }>({ sessionId: "", context: "", promise: null });
  const ensureSessionStartContextRef = useRef<() => Promise<void>>(
    async () => {},
  );
  const alternativeGenerationRef = useRef(new Set<string>());
  const settingsDeepLinkRef = useRef<{
    tabId: string;
    sectionId: string | null;
  } | null>(null);
  const [responseComparison, setResponseComparison] =
    useState<PendingResponseComparison | null>(null);
  const arizeConfigRef = useRef<ArizePublicConfig>({
    enabled: false,
    reason: "loading",
    evaluationContentEnabled: false,
    maxContentChars: 16_000,
    rateLimitPerMinute: 30,
  });
  const arizeTraceClientRef = useRef<ArizeTraceClient | null>(null);

  if (!arizeTraceClientRef.current && typeof window !== "undefined") {
    arizeTraceClientRef.current = new ArizeTraceClient(
      fetch,
      publishArizeTraceStatus,
      () => {
        const current = readAnalyticsPreferences(isSessionReplayAvailable());
        writeAnalyticsPreferences({
          ...current,
          arizeEvaluationEnabled: false,
        });
      },
    );
  }

  useEffect(() => {
    void getArizePublicConfig().then((config) => {
      arizeConfigRef.current = config;
    });
  }, []);

  useEffect(() => {
    const turnOffArize = () => arizeTraceClientRef.current?.turnOff();
    window.addEventListener("keating:arize-trace-turn-off", turnOffArize);
    return () =>
      window.removeEventListener("keating:arize-trace-turn-off", turnOffArize);
  }, []);

  const restorePendingResponseComparison = useCallback(
    async (source: SessionData, isCurrent: () => boolean) => {
      const metadata = (await sessions.getAllMetadata()) as SessionMetadata[];
      if (!isCurrent()) return;
      const pending = metadata
        .filter((entry) => entry.parentSessionId === source.id && entry.generatedAlternative && !entry.responsePreference)
        .sort((left, right) => right.lastModified.localeCompare(left.lastModified))[0];
      if (!pending) return;
      const alternative = await sessions.loadSession(pending.id) as SessionData | null;
      if (!isCurrent()) return;
      setResponseComparison(alternative ? buildPendingResponseComparison(source, alternative) : null);
    },
    [],
  );

  useEffect(() => {
    const updateSearchTrust = (event: Event) => {
      const detail = (event as CustomEvent<{ untrusted?: boolean }>).detail;
      untrustedSearchProvenanceRef.current = detail?.untrusted === true;
    };
    window.addEventListener("keating:search-provenance", updateSearchTrust);
    return () =>
      window.removeEventListener(
        "keating:search-provenance",
        updateSearchTrust,
      );
  }, []);

  const openSettings = useCallback(() => {
    posthog.capture("settings_opened", { source: "toolbar" });
    settingsDialog.onOpen();
  }, [posthog, settingsDialog]);

  // In-app request to open settings on a particular tab. The live surface uses
  // this to turn "no API key" into a button that lands on the right page,
  // without the URL churn the ?settings= deep link involves.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpenSettingsTab = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: unknown }>).detail;
      const requested = typeof detail?.tab === "string" ? detail.tab : "";
      const tabId = (SETTINGS_DIALOG_TAB_IDS as readonly string[]).includes(
        requested,
      )
        ? requested
        : "models";
      settingsDeepLinkRef.current = { tabId, sectionId: null };
      settingsDialog.onOpen();
    };
    window.addEventListener("keating:open-settings", onOpenSettingsTab);
    return () =>
      window.removeEventListener("keating:open-settings", onOpenSettingsTab);
  }, [settingsDialog]);

  // Deep-link support: ?settings=<tabId> or ?settings=<tabId>-<sectionId>.
  // Opens the settings dialog on the matching tab, scrolls to the section
  // anchor after the dialog mounts, then strips the param from the URL so
  // it doesn't pollute history/back-button behavior.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("settings");
    if (!raw) return;
    const MODEL_SECTION_SET = new Set<string>(MODELS_TAB_ALL_SECTION_IDS);
    let tabId = raw;
    let sectionId: string | null = null;
    if (
      !SETTINGS_DIALOG_TAB_IDS.includes(
        raw as (typeof SETTINGS_DIALOG_TAB_IDS)[number],
      )
    ) {
      const dashIndex = raw.indexOf("-");
      const candidateTab = dashIndex === -1 ? raw : raw.slice(0, dashIndex);
      const candidateSection =
        dashIndex === -1 ? raw : raw.slice(dashIndex + 1);
      if (
        (SETTINGS_DIALOG_TAB_IDS as readonly string[]).includes(candidateTab)
      ) {
        tabId = candidateTab;
        sectionId = MODEL_SECTION_SET.has(candidateSection)
          ? candidateSection
          : null;
      } else if (MODEL_SECTION_SET.has(raw)) {
        tabId = "models";
        sectionId = raw;
      } else {
        tabId = "models";
      }
    }
    settingsDeepLinkRef.current = { tabId, sectionId };
    params.delete("settings");
    const next = params.toString();
    const url = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", url);
    settingsDialog.onOpen();
  }, [settingsDialog]);

  useEffect(() => {
    if (!settingsDialog.open) return;
    const link = settingsDeepLinkRef.current;
    if (!link) return;
    const handle = window.setTimeout(() => {
      const el = link.sectionId
        ? document.getElementById(`settings-section-${link.sectionId}`)
        : null;
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      settingsDeepLinkRef.current = null;
    }, 80);
    return () => window.clearTimeout(handle);
  }, [settingsDialog.open]);

  useEffect(() => {
    setActiveSessionId(sessionIdRef.current);
    keatingStorage.setCurrentSessionId(sessionIdRef.current);
  }, [setActiveSessionId]);

  useEffect(() => {
    const onMessageFeedback = async (event: Event) => {
      const detail = (
        event as CustomEvent<{
          type?: unknown;
          comment?: unknown;
          messageId?: unknown;
          messageText?: unknown;
          messageCreatedAt?: unknown;
        }>
      ).detail;
      const signal =
        detail?.type === "up"
          ? "thumbs-up"
          : detail?.type === "down"
            ? "thumbs-down"
            : null;
      if (!signal) return;
      const sessionId = sessionIdRef.current;
      const session = (await sessions.loadSession(
        sessionId,
      )) as SessionData | null;
      // The session title is context only; the referent retains the exact
      // generated answer, so later analysis need not guess from a topic bucket.
      const topic = session?.title?.trim() || "general";
      const messageId =
        typeof detail.messageId === "string" ? detail.messageId : undefined;
      const messageText =
        typeof detail.messageText === "string" ? detail.messageText.trim() : "";
      posthog.capture("message_feedback_given", {
        signal,
        has_comment:
          typeof detail.comment === "string" &&
          detail.comment.trim().length > 0,
        session_id: sessionIdRef.current,
      });
      await keatingStorage.recordFeedback(topic, signal, {
        source: "explicit",
        evidence:
          typeof detail.comment === "string" && detail.comment.trim()
            ? detail.comment
            : undefined,
        messageId,
        sessionId,
        topicSource: "session-title",
        referent:
          messageId && messageText
            ? {
                sessionId,
                messageId,
                content: messageText.slice(0, 12_000),
                createdAt:
                  typeof detail.messageCreatedAt === "number"
                    ? detail.messageCreatedAt
                    : undefined,
              }
            : undefined,
      });
    };
    window.addEventListener("keating:message-feedback", onMessageFeedback);
    return () =>
      window.removeEventListener("keating:message-feedback", onMessageFeedback);
  }, []);

  useEffect(() => {
    const onQuestionAnswered = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          topic?: unknown;
          answers?: Array<{
            question?: unknown;
            answer?: unknown;
            score?: unknown;
            grading?: unknown;
          }>;
        }>
      ).detail;
      const answers =
        detail?.answers?.filter(
          (
            answer,
          ): answer is {
            question: string;
            answer: string;
            score?: unknown;
            grading?: unknown;
          } =>
            typeof answer?.question === "string" &&
            typeof answer.answer === "string",
        ) ?? [];
      if (answers.length === 0) return;
      void (async () => {
        const state = await keatingStorage.getLearnerState();
        const topic =
          typeof detail?.topic === "string" && detail.topic.trim()
            ? detail.topic.trim()
            : (state.topicsExplored.at(-1) ?? "general");
        await Promise.all(
          answers.map((answer) =>
            keatingStorage.recordQuestionCheck({
              topic,
              question: answer.question,
              answer: answer.answer,
              score:
                typeof answer.score === "number" ? answer.score : undefined,
              grading: answer.grading === "auto" ? "auto" : "pending",
              sessionId: sessionIdRef.current,
            }),
          ),
        );
      })();
    };
    window.addEventListener("keating:question-answered", onQuestionAnswered);
    return () =>
      window.removeEventListener(
        "keating:question-answered",
        onQuestionAnswered,
      );
  }, []);

  async function loadBrowserModel(modelId?: string) {
    const state = localModel.getState();
    if (!state.loaded || (modelId && state.modelId !== modelId)) {
      await localModel.load(modelId);
    }
    if (!localModel.getState().loaded) {
      throw new Error(
        localModel.getState().error ?? "Failed to load browser model",
      );
    }
  }

  const unsubRef = useRef<(() => void) | null>(null);
  const persistUnsubRef = useRef<(() => void) | null>(null);
  const analyticsUnsubRef = useRef<(() => void) | null>(null);
  const analyticsTurnIndexRef = useRef(0);
  const persistCurrentSnapshotRef = useRef<() => Promise<void>>(async () => {});
  const conversationRuntimeRef = useRef<ConversationRuntime | null>(null);
  const autoTitleRequestedRef = useRef<Set<string>>(new Set());

  const conversationRuntime = useCallback(
    (sessionId = sessionIdRef.current) => {
      if (typeof window === "undefined") return null;
      const current = conversationRuntimeRef.current;
      if (current?.sessionId === sessionId) return current;
      const runtime = browserConversationRuntime(
        sessionId,
        window.localStorage,
      );
      conversationRuntimeRef.current = runtime;
      const pendingActions = runtime.pendingActions();
      if (pendingActions.length > 0) {
        window.dispatchEvent(
          new CustomEvent("keating:pending-ui-actions-restored", {
            detail: { sessionId, actions: pendingActions },
          }),
        );
      }
      return runtime;
    },
    [],
  );

  useEffect(() => {
    const receiveCanonicalEvent = (event: Event) => {
      const canonical = (event as CustomEvent<ConversationEvent>).detail;
      if (!canonical || canonical.sessionId !== sessionIdRef.current) return;
      conversationRuntime(canonical.sessionId)?.accept(canonical);
    };
    window.addEventListener(
      "keating:conversation-event",
      receiveCanonicalEvent,
    );
    return () =>
      window.removeEventListener(
        "keating:conversation-event",
        receiveCanonicalEvent,
      );
  }, [conversationRuntime]);

  useEffect(() => {
    const provideConversationIds = (event: Event) => {
      const detail = (event as CustomEvent<{ ids?: { sessionId: string } }>)
        .detail;
      if (detail) detail.ids = { sessionId: sessionIdRef.current };
    };
    window.addEventListener("keating:conversation-ids", provideConversationIds);
    return () =>
      window.removeEventListener(
        "keating:conversation-ids",
        provideConversationIds,
      );
  }, []);

  useEffect(() => {
    const receiveOpenUIAction = (event: Event) => {
	  const detail = (event as CustomEvent<KeatingOpenUIAction | {
		kind: "keating-openui-dispatch";
		action: KeatingOpenUIAction;
		persisted?: Promise<void>;
	  }>).detail;
	  const wrapped = detail?.kind === "keating-openui-dispatch";
	  const action = wrapped ? detail.action : detail;
	  if (!action) return;
	  const persist = async () => {
		if (action.kind === "canonical") {
			await keatingStorage.materializeCanonicalOpenUiAction(
				action.action,
				action.sourceDocument,
				action.receipt.createdAt,
			);
		}
		recordOpenUIAction(conversationRuntime()!, action);
	  };
	  if (wrapped) detail.persisted = persist();
	  else void persist();
    };
    window.addEventListener("keating:openui-action", receiveOpenUIAction);
    return () =>
      window.removeEventListener("keating:openui-action", receiveOpenUIAction);
  }, [conversationRuntime]);

  const applyThinkingLevel = useCallback((level: ThinkingLevel) => {
    const agent = agentRef.current;
    if (agent) {
      agent.context.thinkingLevel = level;
    }

    const settings = loadKeatingUiSettings();
    if (settings.reasoningLevel !== level) {
      saveKeatingUiSettings({ ...settings, reasoningLevel: level });
    }

    void persistCurrentSnapshotRef.current();
  }, []);

  const toolOptions = useCallback(
    (
      settings: WebSpeechSettings,
      agentRuntime?: KeatingAgentRuntimeConfig,
    ) => ({
      agentRuntime,
      course: courseContext,
      webSearch: {
        search: searchWithConfiguredProvider,
      },
      speech: {
        settings,
        getApiKey: (provider: string) => getProviderApiKey(provider),
      },
      setSystemPrompt: (basePrompt: string) => {
        systemPromptBaseRef.current = basePrompt;
        if (agentRef.current) {
          agentRef.current.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
            settings.enabled,
            basePrompt,
            loadLearnerContext(),
            sessionStartContextRef.current.context,
            agentRuntime,
            courseContext,
          ));
        }
      },
      runTeachingExperiment: async (options: { force?: boolean; signal?: AbortSignal }) => {
        const model = agentRef.current?.context.model;
        if (!model) throw new Error("Select a model before running a teaching experiment.");
        return runBrowserTeachingExperiment({
          model,
          streamFn: hybridStreamFn,
          getApiKey: getProviderApiKey,
          convertToLlm: defaultConvertToLlm,
          thinkingLevel: agentRef.current?.context.thinkingLevel,
        }, { ...options, basePrompt: composeKeatingSystemPrompt(loadPersona()) });
      },
      getSessionSamples: async () => {
        const metadata = await sessions.getAllMetadata();
        const loaded = await Promise.all(
          metadata.map(
            (entry) =>
              sessions.loadSession(entry.id) as Promise<SessionData | null>,
          ),
        );
        return loaded
          .filter((data): data is SessionData => Boolean(data))
          .map((data) => ({
            id: data.id,
            title: data.title,
            model: data.model
              ? {
                  provider: data.model.provider,
                  id: data.model.id,
                  name: data.model.name,
                }
              : undefined,
            messages: data.messages as unknown[],
          }));
      },
      security: {
        executor: toolExecutorRef.current,
        getContext: () => ({
          sessionId: sessionIdRef.current,
          surface: "text" as const,
          provenance: untrustedSearchProvenanceRef.current
            ? { trust: "untrusted-web" as const, userAuthorized: false }
            : { trust: "trusted" as const, userAuthorized: true },
        }),
      },
    }),
    [activeCourseId, courseMode],
  );

  const saveSessionSnapshot = useCallback(
    async (
      agent: FlueConversation | null = agentRef.current,
      sessionId = sessionIdRef.current,
      createdAt = sessionCreatedAtRef.current,
    ) => {
      if (!agent || agent.context.messages.length === 0) return;
      const ancestry = sessionId === sessionIdRef.current
        ? { parentSessionId: sessionParentIdRef.current, forkedAt: sessionForkedAtRef.current }
        : undefined;
      return sessionSaveQueueRef.current.run(sessionId, async () => {
        const stamp = sessionSnapshotsRef.current.capture(agent, agent.context);
        if (sessionSnapshotsRef.current.isSaved(agent, stamp)) return;
        const model = agent.context.model;
        const thinkingLevel = agent.context.thinkingLevel;
        const now = new Date().toISOString();
        const snapshot = messagesForSessionSnapshot(
          agent.context.messages,
          agent.context.streamingMessage,
        );
        const messages = snapshot.messages;
        const fallbackTitle = sessionTitle(messages);
        const existing = (await sessions.loadSession(
          sessionId,
        )) as SessionData | null;
        const existingFallbackTitle = existing
          ? sessionTitle(existing.messages)
          : "";
        const hasManualTitle = Boolean(
          existing &&
          existing.aiGeneratedTitle !== true &&
          existing.title.trim() &&
          existing.title.trim() !== existingFallbackTitle.trim(),
        );
        const title =
          existing && (hasManualTitle || existing.aiGeneratedTitle)
            ? existing.title
            : fallbackTitle;
        const aiGeneratedTitle = existing?.aiGeneratedTitle ?? false;
        const metadata: SessionMetadata = {
          id: sessionId,
          title,
          parentSessionId: ancestry ? ancestry.parentSessionId : existing?.parentSessionId ?? null,
          forkedAt: ancestry ? ancestry.forkedAt : existing?.forkedAt,
          forkedFromMessageTimestamp: existing?.forkedFromMessageTimestamp,
          createdAt,
          lastModified: now,
          messageCount: messages.length,
          usage: sessionUsage(messages),
          thinkingLevel,
          ...sessionModelMetadata(model),
          preview: sessionPreview(messages),
          searchText: sessionSearchText(messages),
          aiGeneratedTitle,
          generatedAlternative: existing?.generatedAlternative,
          hiddenAlternative: existing?.hiddenAlternative,
          alternativeForMessageTimestamp:
            existing?.alternativeForMessageTimestamp,
          responsePreference: existing?.responsePreference,
        };
        const data: SessionData = {
          id: sessionId,
          title,
          parentSessionId: ancestry ? ancestry.parentSessionId : existing?.parentSessionId ?? null,
          forkedAt: ancestry ? ancestry.forkedAt : existing?.forkedAt,
          forkedFromMessageTimestamp: existing?.forkedFromMessageTimestamp,
          model,
          thinkingLevel,
          messages,
          createdAt,
          lastModified: now,
          aiGeneratedTitle,
          generatedAlternative: existing?.generatedAlternative,
          hiddenAlternative: existing?.hiddenAlternative,
          alternativeForMessageTimestamp:
            existing?.alternativeForMessageTimestamp,
          responsePreference: existing?.responsePreference,
        };

        await sessions.save(data, metadata);
        sessionSnapshotsRef.current.remember(agent, stamp);
        window.dispatchEvent(new CustomEvent("keating:sessions-changed"));

        // Live snapshots exist only so a suspended or killed tab can recover the
        // visible response. Derive learner signals and titles from settled turns.
        if (snapshot.interrupted) return;

        const bookkeeping = async () => {
          await keatingStorage.recordLearnerTurnFeedback(
            messages as Array<{ role?: unknown; content?: unknown }>,
          );

          void detectTopicCategoryShift(
            model as Model<Api>,
            sessionId,
            messages as Array<{ role?: unknown; content?: unknown }>,
          ).catch((error) => {
            console.warn("Topic-shift detection failed:", error);
          });

          if (
            !hasManualTitle &&
            !aiGeneratedTitle &&
            hasAutoTitleContext(messages) &&
            !autoTitleRequestedRef.current.has(sessionId)
          ) {
            autoTitleRequestedRef.current.add(sessionId);
            void (async () => {
              try {
                if (model.provider === "browser") {
                  await loadBrowserModel(model.id);
                } else if (!(await getProviderApiKey(model.provider))) {
                  return;
                }
                const apiKey =
                  model.provider === "browser"
                    ? undefined
                    : await getProviderApiKey(model.provider);
                const context: Context = {
                  systemPrompt:
                    "You rename learning chat sessions. Return only a concise, specific title. No quotes. No punctuation-only titles. Maximum 7 words.",
                  messages: [
                    {
                      role: "user",
                      timestamp: Date.now(),
                      content: `Conversation preview:\n${sessionPreview(messages).slice(0, 2400)}\n\nCurrent title: ${title}`,
                    },
                  ],
                };
                const stream = await hybridStreamFn(model, context, {
                  apiKey,
                  maxTokens: 32,
                  temperature: 0.2,
                  reasoning: "minimal",
                });
                const message = await stream.result();
                const text = message.content
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join(" ");
                const nextTitle = cleanSuggestedTitle(text);
                if (nextTitle) await updateSessionTitle(sessionId, nextTitle, true);
              } catch (error) {
                console.warn("Failed to auto-generate session title:", error);
              }
            })();
          }
        };
        // History is durable now. Derived learner signals and title work must not
        // delay navigation, and remain ordered to avoid duplicate feedback writes.
        learnerBookkeepingRef.current = learnerBookkeepingRef.current.catch(() => {}).then(bookkeeping);
        void learnerBookkeepingRef.current.catch((error) => console.warn("Session learner bookkeeping failed:", error));
      });
    },
    [],
  );

  const maybeGenerateAlternativeResponse = useCallback(
    async (agent: FlueConversation, sourceSessionId: string) => {
      if (sessionIdRef.current !== sourceSessionId) return;
      const settings = loadKeatingUiSettings();
      if (
        !shouldGenerateAlternativeResponse(settings.alternativeResponseChance)
      )
        return;

      const sourceMessages = cloneMessages(agent.context.messages);
      const assistantTimestamp = lastAssistantTimestamp(sourceMessages);
      if (assistantTimestamp == null) return;
      const generationKey = `${sourceSessionId}:${assistantTimestamp}`;
      if (alternativeGenerationRef.current.has(generationKey)) return;

      const branchMessages = branchBeforeAssistantTurn(
        sourceMessages,
        assistantTimestamp,
      );
      if (!canGenerateAlternativeFromBranch(branchMessages)) return;
      alternativeGenerationRef.current.add(generationKey);

      const model = agent.context.model as Model<Api>;
      try {
        if (model.provider === "browser") {
          await loadBrowserModel(model.id);
        } else if (!(await getProviderApiKey(model.provider))) {
          return;
        }
        const stream = await hybridStreamFn(
          model,
          {
            systemPrompt: agent.context.systemPrompt,
            messages: branchMessages as unknown as Context["messages"],
          },
          {
            temperature: 0.85,
          },
        );
        const streamedAlternative = (await stream.result()) as AgentMessage;
        const alternative =
          typeof (streamedAlternative as { timestamp?: unknown }).timestamp ===
          "number"
            ? streamedAlternative
            : ({
                ...streamedAlternative,
                timestamp: Date.now(),
              } as AgentMessage);
        const alternativeContent = (alternative as any).content;
        const text = Array.isArray(alternativeContent)
          ? alternativeContent
              .filter(
                (part: any) =>
                  part?.type === "text" && typeof part.text === "string",
              )
              .map((part: any) => part.text)
              .join("")
              .trim()
          : "";
        if (
          !text ||
          (alternative as any).stopReason === "error" ||
          (alternative as any).stopReason === "aborted"
        )
          return;

        const now = new Date().toISOString();
        const id = createSessionId();
        const messages = [...branchMessages, alternative];
        const title = `${sessionTitle(branchMessages) || "Alternative response"} (alternative)`;
        const metadata: SessionMetadata = {
          id,
          title,
          parentSessionId: sourceSessionId,
          forkedAt: now,
		  forkedFromMessageTimestamp: assistantTimestamp,
          createdAt: now,
          lastModified: now,
          messageCount: messages.length,
          usage: sessionUsage(messages),
          thinkingLevel: agent.context.thinkingLevel,
          ...sessionModelMetadata(agent.context.model),
          preview: sessionPreview(messages),
          searchText: sessionSearchText(messages),
          aiGeneratedTitle: false,
          generatedAlternative: true,
          hiddenAlternative: true,
          alternativeForMessageTimestamp: assistantTimestamp,
        };
        const data: SessionData = {
          id,
          title,
          parentSessionId: sourceSessionId,
          forkedAt: now,
		  forkedFromMessageTimestamp: assistantTimestamp,
          model: agent.context.model,
          thinkingLevel: agent.context.thinkingLevel,
          messages,
          createdAt: now,
          lastModified: now,
          aiGeneratedTitle: false,
          generatedAlternative: true,
          hiddenAlternative: true,
          alternativeForMessageTimestamp: assistantTimestamp,
        };
        await sessions.save(data, metadata);
        const source = (await sessions.loadSession(
          sourceSessionId,
        )) as SessionData | null;
        if (source)
          setResponseComparison(buildPendingResponseComparison(source, data));
        window.dispatchEvent(
          new CustomEvent("keating:sessions-changed", {
            detail: {
              sessionId: id,
              parentSessionId: sourceSessionId,
              generatedAlternative: true,
            },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("keating:dpo-alternative-created", {
            detail: { sessionId: id, parentSessionId: sourceSessionId },
          }),
        );
      } catch (error) {
        console.warn("Failed to generate DPO alternative response:", error);
      }
    },
    [],
  );

  const prepareAgent = useCallback(async (initialState?: Partial<AgentState>, preserveSelectedModel = false) => {
    const persona = loadPersona();
    const [promptBase, agentRuntime, resolvedModel] = await Promise.all([
      (initialState?.systemPrompt && systemPromptBaseRef.current) || initialState?.systemPrompt
        || getActiveKeatingPrompt(keatingStorage, "learn", undefined, composeKeatingSystemPrompt(persona))
          .then((prompt) => isDefaultPersona(persona) ? resolveConnectedAccountPrompt(prompt) : prompt),
      loadAgentRuntimeConfig(),
      resolveAvailableChatModel(initialState?.model ?? selectedModelRef.current, { allowFallback: !preserveSelectedModel }),
    ]);
    const tools = filterAvailableKeatingTools(await createKeatingTools(keatingStorage, toolOptions(speechSettings, agentRuntime)), {
      runtime: agentRuntime, speechEnabled: speechSettings.enabled, clientWebSearch: shouldExposeClientWebSearch(resolvedModel),
    });
    return { promptBase, agentRuntime, resolvedModel, tools };
  }, [speechSettings, toolOptions]);

  const createAgent = useCallback(
    async (
      panel: ChatPanelHandle,
      initialState?: Partial<AgentState>,
      options?: {
        preserveSelectedModel?: boolean;
        prepared?: Awaited<ReturnType<typeof prepareAgent>>;
        isCurrent?: () => boolean;
        onCommit?: () => void;
        alreadySaved?: boolean;
      },
    ) => {
      const sourceSessionId = sessionIdRef.current;
      const request = sessionSwitchRequestsRef.current.current;
      const isCurrent = options?.isCurrent ?? (() =>
        sessionSwitchRequestsRef.current.isCurrent(request) && sessionIdRef.current === sourceSessionId && panelRef.current === panel);
      const { promptBase, agentRuntime, resolvedModel, tools } = options?.prepared ?? await prepareAgent(initialState, options?.preserveSelectedModel);
      if (!isCurrent()) return;
      options?.onCommit?.();
      const agentSessionId = sessionIdRef.current;
      const agentCreatedAt = sessionCreatedAtRef.current;
      systemPromptBaseRef.current = promptBase;
      if (sessionStartContextRef.current.sessionId !== agentSessionId) {
        sessionStartContextRef.current = { sessionId: agentSessionId, context: "", promise: null };
      }
      const sessionStartRecord = sessionStartContextRef.current;
      agentRuntimeRef.current = agentRuntime;
      registerKeatingWebMcp(keatingStorage, tools).catch(console.warn);
      selectModel(resolvedModel);
      const thinkingLevel =
        initialState?.thinkingLevel ?? loadKeatingUiSettings().reasoningLevel;
      const systemPrompt = buildAgentSystemPrompt(
        speechSettings.enabled,
        promptBase,
        loadLearnerContext(),
        sessionStartRecord.context,
        agentRuntime,
        courseContext,
      );
      const portableHosts = {
        delegate: (request: DelegationRequest, signal?: AbortSignal) =>
          runPortableBrowserDelegate(
            request,
            resolvedModel,
            thinkingLevel,
            signal,
          ),
        resolveMcpConnection: async () => [],
      };
      const authored = await authorKeatingBrowserAgent({
        instanceId: `browser-teacher-${agentSessionId}`,
        modelKey: `${resolvedModel.provider}/${resolvedModel.id}`,
        systemPrompt,
        tools,
        hosts: portableHosts,
      });
      const nextState: Partial<AgentState> = {
		...initialState,
        model: resolvedModel,
        thinkingLevel,
        messages: [],
        tools: [...authored.tools],
		...(initialState?.messages ? { messages: initialState.messages } : {}),
        systemPrompt: authored.systemPrompt,
      };

      if (agentRef.current instanceof FlueConversation) await agentRef.current.dispose();
      if (!isCurrent()) return;
      const agent = new FlueConversation({
        initialState: nextState,
        convertToLlm: defaultConvertToLlm,
        streamFn: hybridStreamFn,
        sessionId: agentSessionId,
      }, flueRuntimeUrl);
      agent.getApiKey = (provider: string) => getProviderApiKey(provider);
      agent.context.tools = [...authored.tools];
      agentRef.current = agent;
      if (options?.alreadySaved) sessionSnapshotsRef.current.remember(agent, sessionSnapshotsRef.current.capture(agent, agent.context));
      const sessionAlreadyAnswered = agent.context.messages.some((message) => {
        const candidate = message as { role?: unknown; stopReason?: unknown };
        return (
          candidate.role === "assistant" &&
          candidate.stopReason !== "error" &&
          candidate.stopReason !== "aborted"
        );
      });
      const ensureSessionStartContext = async () => {
        // Navigation stays immediate; a new teaching turn still sees feedback
        // and session-end records from the conversation we left.
        await learnerBookkeepingRef.current.catch(() => {});
        if (!sessionStartRecord.context && sessionAlreadyAnswered) return;
        sessionStartRecord.promise ??= (async () => {
          const hookStartedAt = performance.now();
          recordSessionHook("session-start-hooks", "started", { sessionId: agentSessionId });
          try {
            await keatingLifecycle.emit({
              type: "session_start",
              sessionId: agentSessionId,
            });
            const context = await runSessionStartHooks(keatingStorage);
            recordSessionHook(
              "session-start-hooks",
              "completed",
              { sessionId: agentSessionId, contextCharacters: context.length },
              Math.round(performance.now() - hookStartedAt),
            );
            return context;
          } catch (error) {
            recordSessionHook(
              "session-start-hooks",
              "failed",
              { sessionId: agentSessionId, error: error instanceof Error ? error.message : String(error) },
              Math.round(performance.now() - hookStartedAt),
            );
            throw error;
          }
        })();
        sessionStartRecord.context = await sessionStartRecord.promise;
        agent.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
          speechEnabledRef.current,
          systemPromptBaseRef.current,
          loadLearnerContext(),
          sessionStartRecord.context,
          agentRuntimeRef.current,
          courseContext,
        ));
      };
      ensureSessionStartContextRef.current = ensureSessionStartContext;

      // NodePod is the browser-only local sandbox. Explicit remote/cloud modes
      // stay external and must never be silently captured by a local pod.
      if (shouldAutoBootNodePod(agentRuntime)) {
        bootNodePod()
          .then((pod) => {
            if (!pod || !agentRef.current) return;
            return loadAgentRuntimeConfig(true)
              .then(async (runtime) => ({
                runtime,
                tools: await createKeatingTools(
                  keatingStorage,
                  toolOptions(speechSettings, runtime),
                ),
              }))
              .then(async ({ runtime, tools: refreshedTools }) => {
                if (agentRef.current !== agent) return;
                agentRuntimeRef.current = runtime;
                const availableTools = filterAvailableKeatingTools(
                  refreshedTools,
                  {
                    runtime,
                    speechEnabled: speechSettings.enabled,
                    clientWebSearch: shouldExposeClientWebSearch(
                      agent.context.model as Model<Api>,
                    ),
                  },
                );
                const refreshedPrompt = buildAgentSystemPrompt(
                  speechSettings.enabled,
                  systemPromptBaseRef.current,
                  loadLearnerContext(),
                  sessionStartContextRef.current.context,
                  runtime,
                  courseContext,
                );
                const refreshed = await authorKeatingBrowserAgent({
                  instanceId: `browser-teacher-${agentSessionId}-nodepod`,
                  modelKey: `${resolvedModel.provider}/${resolvedModel.id}`,
                  systemPrompt: refreshedPrompt,
                  tools: availableTools,
                  hosts: portableHosts,
                });
                if (agentRef.current !== agent) return;
                agent.context.tools = [...refreshed.tools];
                agent.context.systemPrompt = refreshed.systemPrompt;
                registerKeatingWebMcp(keatingStorage, availableTools).catch(
                  console.warn,
                );
              });
          })
          .catch(console.warn);
      }

      if (unsubRef.current) unsubRef.current();
      unsubRef.current = subscribeAgentEvents(agent.execution, panel as any);
      if (analyticsUnsubRef.current) analyticsUnsubRef.current();
      analyticsUnsubRef.current = subscribeAgentAnalytics(agent.execution, {
        capture: (event, properties) => posthog.capture(event, properties),
        sessionId: agentSessionId,
        getModel: () => ({
          id: agent.context.model.id,
          provider: agent.context.model.provider,
        }),
        getSource: () =>
          agent.context.model.provider === "browser" ? "local" : "provider",
        getTurnIndex: () => analyticsTurnIndexRef.current,
        appVersion: String(import.meta.env.APP_VERSION ?? "dev"),
        isArtifactTool: (toolName) => ARTIFACT_TOOL_NAMES.has(toolName),
        getEvaluationContent: () => {
          const preference = readAnalyticsPreferences(false);
          if (
            !preference.arizeEvaluationEnabled ||
            !arizeConfigRef.current.evaluationContentEnabled
          )
            return undefined;
          return currentTurnEvaluationContent(agent.context.messages);
        },
        onCompletedRun: (envelope) => {
          const preference = readAnalyticsPreferences(false);
          void arizeTraceClientRef.current?.submit(
            envelope,
            arizeConfigRef.current,
            preference.arizeEvaluationEnabled,
          );
        },
      });
      if (persistUnsubRef.current) persistUnsubRef.current();
      let snapshotTimer: number | null = null;
      let snapshotQueue = Promise.resolve();
      const persistSnapshot = () => {
        snapshotQueue = snapshotQueue
          .catch(() => {})
          .then(() =>
            saveSessionSnapshot(agent, agentSessionId, agentCreatedAt),
          );
        return snapshotQueue;
      };
      const scheduleSnapshot = () => {
        if (snapshotTimer !== null) return;
        snapshotTimer = window.setTimeout(() => {
          snapshotTimer = null;
          void persistSnapshot();
        }, 400);
      };
      persistCurrentSnapshotRef.current = persistSnapshot;
      const unsubscribePersistence = agent.observeExecution((ev) => {
        if (ev.type === "message_update" || ev.type === "message_end" || ev.type === "message_start") sessionSnapshotsRef.current.changed(agent);
        recordSessionDebugAgentEvent(agent, ev);
        const canonicalRuntime = conversationRuntime(agentSessionId);
        if (canonicalRuntime) recordAgentEvent(canonicalRuntime, ev);
        if (ev.type === "message_update") {
          scheduleSnapshot();
        } else if (ev.type === "message_end") {
          if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
          snapshotTimer = null;
          void persistSnapshot();
        }
        if (ev.type === "tool_execution_end") {
          const succeeded = toolExecutionSucceeded(ev);
          if (succeeded && ARTIFACT_TOOL_NAMES.has(ev.toolName)) {
            posthog.capture("artifact_created", {
              tool_name: ev.toolName,
              session_id: agentSessionId,
            });
            window.dispatchEvent(
              new CustomEvent("keating:artifact-created", {
                detail: { toolName: ev.toolName, result: ev.result },
              }),
            );
            void keatingLifecycle.emit({
              type: "artifact_finalized",
              sessionId: agentSessionId,
              artifact: { kind: ev.toolName, payload: ev.result },
            });
          }
        }
        if (ev.type === "agent_end") {
          untrustedSearchProvenanceRef.current = false;
          agent
            .whenIdle()
            .then(() => persistSnapshot())
            .then(async () => {
              await keatingLifecycle.emit({
                type: "session_idle",
                sessionId: agentSessionId,
              });
              await maybeGenerateAlternativeResponse(agent, agentSessionId);
            })
            .catch(console.error);
        }
      });
      persistUnsubRef.current = () => {
        unsubscribePersistence();
        if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
        if (persistCurrentSnapshotRef.current === persistSnapshot) {
          persistCurrentSnapshotRef.current = async () => {};
        }
      };

      const retryLastResponse = async () => {
        if (agent.context.isStreaming) return;
        const retryMessages = prepareMessagesForRetry(agent.context.messages);
        if (!retryMessages) return;
        await ensureSessionStartContext();
        untrustedSearchProvenanceRef.current = false;
        agent.context.messages = retryMessages;
        await persistSnapshot();
        analyticsTurnIndexRef.current = Math.max(
          0,
          retryMessages.filter((message) => message.role === "user").length - 1,
        );
        await agent.resume();
      };

      const setupCallbacks = {
		sessionId: agentSessionId,
		getPendingLearnerResponses: () => conversationRuntime(agentSessionId)?.pendingLearnerResponses() ?? [],
		onLearnerResponseDelivered: (response: import("../keating/event-store").PendingLearnerResponse) => {
			const runtime = conversationRuntime(agentSessionId);
			runtime?.resolveLearnerResponse(response.receiptId);
			runtime?.resolveAction(response.uiActionId);
		},
        onApiKeyRequired: async (provider: string) => {
          if (provider === "browser") return true;
          if (await getProviderApiKey(provider)) return true;
          return promptKeatingApiKey(provider);
        },
        onAuthError: async (provider: string) => {
          if (provider === "browser") return false;
          posthog.capture("api_error", {
            error_type: "auth",
            provider,
            session_id: agentSessionId,
          });
          posthog.capture("auth_recovery_prompted", {
            provider,
            session_id: agentSessionId,
          });
          const ok = await promptKeatingApiKey(provider, { force: true });
          posthog.capture("auth_recovery_action", {
            provider,
            session_id: agentSessionId,
            outcome: ok ? "credentials_submitted" : "dismissed",
          });
          if (!ok) return false;
          // Key re-entered — actually recover by retrying the failed turn:
          // drop the trailing errored assistant message and resume generation
          // from the last user message.
          retryLastResponse().catch((error) => {
            console.error(
              "Keating retry after API key re-entry failed:",
              error,
            );
            posthog.capture("api_error", {
              error_type: "retry_failed",
              provider,
              session_id: agentSessionId,
            });
          });
          return true;
        },
        onBeforeSend: async () => {
          untrustedSearchProvenanceRef.current = false;
          await ensureSessionStartContext();
          await keatingLifecycle.emit({
            type: "before_turn",
            sessionId: agentSessionId,
          });
          if (import.meta.env.DEV) {
            console.log(
              `[keating:send] model=${agent.context.model.provider}/${agent.context.model.id} messages=${agent.context.messages.length}`,
            );
          }
          const turnIndex = agent.context.messages.filter(
            (m) => m.role === "user",
          ).length;
          analyticsTurnIndexRef.current = turnIndex;
          const model = `${agent.context.model.provider}/${agent.context.model.id}`;
          posthog.capture("message_sent", {
            session_id: agentSessionId,
            turn_index: turnIndex,
            turn_number: turnIndex + 1,
            model,
            provider: agent.context.model.provider,
          });
          window.dispatchEvent(
            new CustomEvent("keating:message-sent", {
              detail: { sessionId: agentSessionId, turnIndex },
            }),
          );
          if (turnIndex === 0) {
            posthog.capture("first_message_sent", {
              session_id: agentSessionId,
              model,
              provider: agent.context.model.provider,
            });
          }
        },
        onLocalMessagesChanged: () => {
          sessionSnapshotsRef.current.changed(agent);
          return saveSessionSnapshot(agent, agentSessionId, agentCreatedAt);
        },
        onModelSelect: () => {
          posthog.capture("model_selector_opened", {
            session_id: agentSessionId,
          });
          modelSelectorDialog.onOpen();
        },
        onImageGenerationModelSelect: () => {
          imageModelRetryRef.current = retryLastResponse;
          imageModelSelectorDialog.onOpen();
        },
        onFork: (forkPoint?: number) => forkSession(agentSessionId, forkPoint),
        onRetry: retryLastResponse,
        thinkingLevel: agent.context.thinkingLevel,
        onThinkingLevelChange: (level: ThinkingLevel) => {
          applyThinkingLevel(level);
          posthog.capture("thinking_level_changed", {
            level,
            session_id: agentSessionId,
          });
        },
      };

      await panel.setConversation(agent, setupCallbacks);
    },
    [
      prepareAgent,
      applyThinkingLevel,
      maybeGenerateAlternativeResponse,
      posthog,
      saveSessionSnapshot,
      speechSettings,
      toolOptions,
    ],
  );

  useEffect(() => {
    const persistIfBackgrounded = () => {
      if (document.visibilityState === "hidden") {
        void persistCurrentSnapshotRef.current();
      }
    };
    const persistBeforePageHide = () => {
      void persistCurrentSnapshotRef.current();
    };
    document.addEventListener("visibilitychange", persistIfBackgrounded);
    window.addEventListener("pagehide", persistBeforePageHide);
    return () => {
      document.removeEventListener("visibilitychange", persistIfBackgrounded);
      window.removeEventListener("pagehide", persistBeforePageHide);
    };
  }, []);

  useEffect(() => {
    const agent = agentRef.current;
    if (!agent) return;

    let cancelled = false;
    loadAgentRuntimeConfig()
      .then(async (agentRuntime) => ({
        agentRuntime,
        tools: await createKeatingTools(
          keatingStorage,
          toolOptions(speechSettings, agentRuntime),
        ),
      }))
      .then(async ({ agentRuntime, tools }) => {
        if (cancelled) return;
        agentRuntimeRef.current = agentRuntime;
        const availableTools = filterAvailableKeatingTools(tools, {
          runtime: agentRuntime,
          speechEnabled: speechSettings.enabled,
          clientWebSearch: shouldExposeClientWebSearch(
            agent.context.model as Model<Api>,
          ),
        });
        const systemPrompt = buildAgentSystemPrompt(
          speechSettings.enabled,
          systemPromptBaseRef.current,
          loadLearnerContext(),
          sessionStartContextRef.current.context,
          agentRuntime,
          courseContext,
        );
        const authored = await authorKeatingBrowserAgent({
          instanceId: `browser-teacher-${sessionIdRef.current}-capabilities`,
          modelKey: `${agent.context.model.provider}/${agent.context.model.id}`,
          systemPrompt,
          tools: availableTools,
          hosts: {
            delegate: (request, signal) =>
              runPortableBrowserDelegate(
                request,
                agent.context.model,
                agent.context.thinkingLevel,
                signal,
              ),
            resolveMcpConnection: async () => [],
          },
        });
        if (cancelled || agentRef.current !== agent) return;
        agent.context.tools = [...authored.tools];
        agent.context.systemPrompt = authored.systemPrompt;
        registerKeatingWebMcp(keatingStorage, availableTools).catch(
          console.warn,
        );
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [speechSettings, toolOptions]);

  // Realtime voice has its own WebRTC model connection. Expose the active Flue
  // tool catalog synchronously so voice function calls use the same tools and
  // learner state as typed chat.
  useEffect(() => {
    const handleBridgeRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ bridge?: LiveSpeechBridge }>)
        .detail;
      const agent = agentRef.current;
      if (!detail || !agent) return;
      const tools = (agent.context.tools ?? []) as any[];
      detail.bridge = {
        // The real Keating system prompt, so a voice session is the same
        // teacher as the text session rather than a generic assistant.
        instructions: agent.context.systemPrompt,
        history: buildLiveHistory(agent.context.messages ?? []),
		loadContext: () => buildLiveSessionContext({
			storage: keatingStorage,
			sessionId: sessionIdRef.current,
			messages: agent.context.messages ?? [],
			providedProfile: loadLearnerContext(),
			activeCourseId: courseContextRef.current?.activeCourseId,
		}),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? tool.label ?? tool.name,
          parameters: tool.parameters ?? { type: "object", properties: {} },
        })),
        async execute(call, signal) {
          const tool = tools.find((candidate) => candidate.name === call.name);
          if (!tool?.execute)
            throw new Error(`Unknown live voice tool: ${call.name}`);
          return toolExecutorRef.current.execute({
            toolName: call.name,
            arguments: call.arguments,
            context: {
              sessionId: sessionIdRef.current,
              surface: "voice",
              provenance: untrustedSearchProvenanceRef.current
                ? { trust: "untrusted-web", userAuthorized: false }
                : { trust: "unknown", userAuthorized: false },
            },
            run: () =>
              executeRawKeatingTool(tool, [
                call.callId,
                call.arguments,
                signal,
                () => {},
              ]),
          });
        },
      };
    };
    window.addEventListener("keating:live-speech-bridge", handleBridgeRequest);
    return () =>
      window.removeEventListener(
        "keating:live-speech-bridge",
        handleBridgeRequest,
      );
  }, []);

  useEffect(() => {
    const unsubscribeLifecycle = subscribeLifecycleDebug(keatingLifecycle);
    const captureCurrentContext = () => {
      const agent = agentRef.current;
      if (!agent) return;
      captureSessionModelContext(agent.context.model, {
        systemPrompt: agent.context.systemPrompt,
        messages: agent.context.messages,
        tools: agent.context.tools,
      }, "agent-state");
    };
    window.addEventListener("keating:session-debug-enabled", captureCurrentContext);
    return () => {
      unsubscribeLifecycle();
      window.removeEventListener("keating:session-debug-enabled", captureCurrentContext);
    };
  }, []);

  // Apply teacher-persona edits to the live agent so changes take effect on the
  // next turn without needing a new session.
  useEffect(() => {
    return subscribePersona((persona) => {
      const base = composeKeatingSystemPrompt(persona);
      systemPromptBaseRef.current = base;
      if (agentRef.current) {
        agentRef.current.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
          speechSettings.enabled,
          base,
          loadLearnerContext(),
          sessionStartContextRef.current.context,
          agentRuntimeRef.current,
          courseContext,
        ));
      }
    });
  }, [speechSettings.enabled]);

  useEffect(() => {
    return subscribeLearnerContext((context) => {
      if (agentRef.current) {
        agentRef.current.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
          speechSettings.enabled,
          systemPromptBaseRef.current,
          context,
          sessionStartContextRef.current.context,
          agentRuntimeRef.current,
          courseContext,
        ));
      }
    });
  }, [speechSettings.enabled]);

  useEffect(() => {
    let cancelled = false;
    void browserPersistentStorageGranted().then((granted) => {
      if (cancelled) return;
      if (granted) {
        setPersistentStorageStatus("granted");
        savePersistentStorageStatus("granted");
      }
      setPersistentStorageChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestPersistentStorageOnce = useCallback(() => {
    if (persistentStorageRequestedRef.current) return;
    if (persistentBannerDismissed || persistentStorageStatus !== "unknown")
      return;
    persistentStorageRequestedRef.current = true;
    void requestBrowserPersistentStorage()
      .then((nextStatus) => {
        setPersistentStorageStatus(nextStatus);
        savePersistentStorageStatus(
          nextStatus as Exclude<PersistentStorageStatus, "unknown">,
        );
        setPersistentStorageChecked(true);
        posthog.capture("persistent_storage_requested", {
          granted: nextStatus === "granted",
        });
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        setPersistentStorageChecked(true);
        posthog.capture("persistent_storage_requested", { granted: false });
        console.warn("Persistent storage request failed:", error);
      });
  }, [
    persistentBannerDismissed,
    persistentStorageStatus,
    posthog,
    setPersistentStorageChecked,
    setPersistentStorageStatus,
  ]);

  const retryPersistentStorage = useCallback(() => {
    persistentStorageRequestedRef.current = false;
    void requestBrowserPersistentStorage()
      .then((nextStatus) => {
        setPersistentStorageStatus(nextStatus);
        savePersistentStorageStatus(
          nextStatus as Exclude<PersistentStorageStatus, "unknown">,
        );
        setPersistentStorageChecked(true);
        posthog.capture("persistent_storage_retried", {
          granted: nextStatus === "granted",
        });
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        setPersistentStorageChecked(true);
        posthog.capture("persistent_storage_retried", { granted: false });
        console.warn("Persistent storage retry failed:", error);
      })
      // If the browser silently denies persistence, stop nagging for this
      // session instead of leaving a banner the user cannot resolve.
      .finally(() => dismissPersistentBanner());
  }, [
    dismissPersistentBanner,
    posthog,
    setPersistentStorageChecked,
    setPersistentStorageStatus,
  ]);

  const endLearnerSession = useCallback((sessionId: string) => {
    learnerBookkeepingRef.current = learnerBookkeepingRef.current.catch(() => {}).then(async () => {
      try {
        await keatingStorage.recordSessionEnd([], sessionId);
      } catch (error) {
        console.warn("Failed to record session end:", error);
      }
      await keatingLifecycle.emit({ type: "session_end", sessionId });
    });
    void learnerBookkeepingRef.current.catch((error) => console.warn("Session end hook failed:", error));
  }, []);

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (persistUnsubRef.current) persistUnsubRef.current();
      if (analyticsUnsubRef.current) analyticsUnsubRef.current();
    };
  }, []);

  const newSession = useCallback(() => {
    const request = sessionSwitchRequestsRef.current.begin();
    const panel = panelRef.current;
    if (!panel) return;
    const currentAgent = agentRef.current;
    const previousId = sessionIdRef.current;
    const previousCreatedAt = sessionCreatedAtRef.current;
    const id = createSessionId();
    const createdAt = new Date().toISOString();
    const initialState = { messages: [], model: selectedModelRef.current };
    const isCurrent = () => sessionSwitchRequestsRef.current.isCurrent(request) && panelRef.current === panel;
    startTransition(async () => {
      await runSessionSwitch({
        isCurrent,
        prepare: () => prepareAgent(initialState),
        needsFinalSave: () => currentAgent ? sessionSnapshotsRef.current.needsSave(currentAgent, currentAgent.context) : false,
        persist: async () => {
          if (currentAgent?.context.isStreaming) {
            currentAgent.cancel();
            await currentAgent.whenIdle();
          }
          await saveSessionSnapshot(currentAgent, previousId, previousCreatedAt);
        },
        commit: (prepared) => createAgent(panel, initialState, {
          prepared, isCurrent,
          onCommit: () => {
            if (currentAgent) endLearnerSession(previousId);
            sessionIdRef.current = id;
            keatingStorage.setCurrentSessionId(id);
            sessionCreatedAtRef.current = createdAt;
            sessionParentIdRef.current = null;
            sessionForkedAtRef.current = undefined;
            setActiveSessionId(id);
            setForkInfo(null);
            setResponseComparison(null);
            posthog.capture("session_started", { session_id: id, source: "new_button", is_initial: false });
          },
        }),
      });
    });
  }, [createAgent, endLearnerSession, posthog, prepareAgent, saveSessionSnapshot]);

  const shareSession = useCallback(async () => {
    const agent = agentRef.current;
    if (!agent) throw new Error("No active session to share");
    const originalSessionId = sessionIdRef.current;
    const originalCreatedAt = sessionCreatedAtRef.current;
    const originalMessages = [...agent.context.messages];
    const originalModel = agent.context.model;
    const originalThinkingLevel = agent.context.thinkingLevel;
    const assertShareSourceIsCurrent = () => {
      if (agentRef.current !== agent || sessionIdRef.current !== originalSessionId) {
        throw new Error("The active session changed while the share was being prepared. Share it again from the session you want.");
      }
    };
    await saveSessionSnapshot(agent);
    assertShareSourceIsCurrent();
    const trajectory = await buildSharedTrajectory(
      originalSessionId,
      originalMessages,
    );
    assertShareSourceIsCurrent();
    const shared = saveSharedSession(
      originalMessages,
      originalCreatedAt,
      {
        model: originalModel,
        thinkingLevel: originalThinkingLevel,
        trajectory,
      },
    );
    const result = await sharedSessionUrl(
      shared,
      window.location.origin,
      loadKeatingUiSettings().shareLinkMode,
    );
    await navigator.clipboard?.writeText(result.url).catch((error) => {
      console.warn("Failed to copy share link:", error);
    });
    return result;
  }, [saveSessionSnapshot]);

  const loadSession = useCallback(
    async (session: SessionData, request = sessionSwitchRequestsRef.current.begin()) => {
      const panel = panelRef.current;
      const isCurrent = () => sessionSwitchRequestsRef.current.isCurrent(request) && panelRef.current === panel;
      if (!panel || !isCurrent()) return;
      const currentAgent = agentRef.current;
      const previousId = sessionIdRef.current;
      const previousCreatedAt = sessionCreatedAtRef.current;
      if (currentAgent && previousId === session.id) return;
      const initialState = { model: session.model, thinkingLevel: session.thinkingLevel, messages: session.messages };
      const committed = await runSessionSwitch({
        isCurrent,
        needsFinalSave: () => currentAgent ? sessionSnapshotsRef.current.needsSave(currentAgent, currentAgent.context) : false,
        // Restoring history must not refresh credentials or replace its saved
        // model. The existing send callbacks still obtain/refresh provider keys.
        prepare: () => prepareAgent(initialState, true),
        persist: async () => {
          if (currentAgent?.context.isStreaming) {
            currentAgent.cancel();
            await currentAgent.whenIdle();
          }
          await saveSessionSnapshot(currentAgent, previousId, previousCreatedAt);
        },
        commit: (prepared) => createAgent(panel, initialState, {
          prepared, isCurrent, alreadySaved: true,
          onCommit: () => {
            if (currentAgent) endLearnerSession(previousId);
            sessionIdRef.current = session.id;
            keatingStorage.setCurrentSessionId(session.id);
            sessionCreatedAtRef.current = session.createdAt;
            sessionParentIdRef.current = session.parentSessionId ?? null;
            sessionForkedAtRef.current = session.forkedAt;
            setActiveSessionId(session.id);
            setResponseComparison(null);
            setForkInfo(session.parentSessionId && session.forkedAt
              ? { parentId: session.parentSessionId, parentTitle: "original session", forkedAt: session.forkedAt }
              : null);
            posthog.capture("session_loaded", { session_id: session.id, is_restored: true, has_parent: !!session.parentSessionId });
          },
        }),
      });
      if (!committed) return;
      // These details can arrive after the saved messages are already visible.
      if (session.parentSessionId && session.forkedAt) {
        const parentId = session.parentSessionId;
        const forkedAt = session.forkedAt;
        void sessions.getMetadata(parentId).then((parentMeta) => {
          if (isCurrent()) setForkInfo({ parentId, parentTitle: parentMeta?.title ?? "original session", forkedAt });
        }).catch((error) => console.warn("Could not load the parent session title:", error));
      }
      if (!session.generatedAlternative) {
        void restorePendingResponseComparison(session, isCurrent).catch((error) => console.warn("Could not restore the response comparison:", error));
      }
    },
    [createAgent, endLearnerSession, posthog, prepareAgent, restorePendingResponseComparison, saveSessionSnapshot],
  );

  const loadSessionById = useCallback(async (sessionId: string, request = sessionSwitchRequestsRef.current.begin()) => {
    if (agentRef.current && sessionIdRef.current === sessionId) return;
    const session = await sessionSwitchRequestsRef.current.read(request, () => sessions.loadSession(sessionId));
    if (session === undefined) return;
    if (!session) throw new Error("Session not found");
    await loadSession(session as SessionData, request);
  }, [loadSession]);

  const chooseResponse = useCallback(
    async (preference: ResponseComparisonDecision) => {
      const comparison = responseComparison;
      if (!comparison) return;
      const request = sessionSwitchRequestsRef.current.begin();
      const alternative = (await sessions.loadSession(
        comparison.alternativeSessionId,
      )) as SessionData | null;
      if (!alternative) {
        setResponseComparison(null);
        return;
      }
      const now = new Date().toISOString();
      const nextAlternative: SessionData = {
        ...alternative,
        hiddenAlternative: preference !== "alternative",
        responsePreference: preference,
        lastModified: now,
      };
      const existingMetadata = (await sessions.getMetadata(
        alternative.id,
      )) as SessionMetadata | null;
      const nextMetadata: SessionMetadata = {
        ...(existingMetadata ?? {
          id: alternative.id,
          title: alternative.title,
          createdAt: alternative.createdAt,
          messageCount: alternative.messages.length,
          usage: sessionUsage(alternative.messages),
          thinkingLevel: alternative.thinkingLevel,
          preview: sessionPreview(alternative.messages),
        }),
        lastModified: now,
        generatedAlternative: true,
        hiddenAlternative: preference !== "alternative",
        alternativeForMessageTimestamp: comparison.originalMessageTimestamp,
        responsePreference: preference,
      };
      await sessions.save(nextAlternative, nextMetadata);
      setResponseComparison(null);
      window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
      posthog.capture("response_comparison_selected", {
        preference,
        session_id: comparison.sourceSessionId,
        alternative_session_id: comparison.alternativeSessionId,
      });
      if (preference === "alternative") await loadSession(nextAlternative, request);
    },
    [loadSession, posthog, responseComparison],
  );

  const openOriginalSession = useCallback(() => {
    const parentId = forkInfo?.parentId;
    if (!parentId) return;
    const request = sessionSwitchRequestsRef.current.begin();
    startTransition(() => loadSessionById(parentId, request));
  }, [forkInfo, loadSessionById]);

  const forkSession = useCallback(
    async (sessionId: string, forkPoint?: number) => {
      const request = sessionSwitchRequestsRef.current.begin();
      // Persist the live session first so forking the current session captures its
      // latest messages before we read the stored copy below.
      await saveSessionSnapshot();
      const source = (await sessions.loadSession(
        sessionId,
      )) as SessionData | null;
      if (!source) throw new Error("Session not found");

      const panel = panelRef.current;
      const now = new Date().toISOString();
      const id = createSessionId();
	  const allMetadata = (await sessions.getAllMetadata()) as SessionMetadata[];
	  const { data, metadata } = buildForkSession(
		source,
		allMetadata,
		forkPoint,
		now,
		id,
	  );

      setForkingSessionId(sessionId);
      setForkedSessionId(null);
      window.dispatchEvent(
        new CustomEvent("keating:session-fork-start", {
          detail: { sourceId: sessionId },
        }),
      );
      try {
        await sessions.save(data, metadata);
        window.dispatchEvent(
          new CustomEvent("keating:sessions-changed", {
            detail: { sessionId: id, parentSessionId: source.id },
          }),
        );
        posthog.capture("session_forked", {
          parent_session_id: source.id,
          new_session_id: id,
		  forked_from_message_timestamp: forkPoint,
        });
        if (panel) await loadSession(data, request);
        setForkedSessionId(id);
        window.dispatchEvent(
          new CustomEvent("keating:session-fork-end", {
            detail: { sourceId: sessionId, sessionId: id },
          }),
        );
        window.setTimeout(() => clearForkedSessionId(id), 1800);
      } finally {
        setForkingSessionId(null);
      }
    },
    [loadSession, saveSessionSnapshot],
  );

  const suggestSessionTitle = useCallback(async (sessionId: string) => {
    const session = (await sessions.loadSession(
      sessionId,
    )) as SessionData | null;
    if (!session) throw new Error("Session not found");

    const model = session.model ?? selectedModelRef.current;
    if (model.provider === "browser") {
      await loadBrowserModel(model.id);
    } else if (!(await getProviderApiKey(model.provider))) {
      const allowed = await promptKeatingApiKey(model.provider);
      if (!allowed)
        throw new Error(`No API key available for ${model.provider}`);
    }

    const apiKey =
      model.provider === "browser"
        ? undefined
        : await getProviderApiKey(model.provider);
    const context: Context = {
      systemPrompt:
        "You rename learning chat sessions. Return only a concise, specific title. No quotes. No punctuation-only titles. Maximum 7 words.",
      messages: [
        {
          role: "user",
          timestamp: Date.now(),
          content: `Conversation preview:\n${sessionPreview(session.messages).slice(0, 2400)}\n\nCurrent title: ${session.title}`,
        },
      ],
    };

    const stream = await hybridStreamFn(model as Model<Api>, context, {
      apiKey,
      maxTokens: 32,
      temperature: 0.2,
      reasoning: "minimal",
    });
    const message = await stream.result();
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ");
    const title = cleanSuggestedTitle(text);
    if (!title) return sessionTitle(session.messages);
    return title;
  }, []);

  const generateCurrentSessionTitle = useCallback(async () => {
    const agent = agentRef.current;
    if (!agent || agent.context.messages.length === 0) {
      throw new Error(
        "Send a message first — there's nothing for the model to title yet.",
      );
    }
    await saveSessionSnapshot();
    const sessionId = sessionIdRef.current;
    const nextTitle = await suggestSessionTitle(sessionId);
    await updateSessionTitle(sessionId, nextTitle, true);
    return nextTitle;
  }, [saveSessionSnapshot, suggestSessionTitle]);

  const openSessions = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.innerWidth < SESSION_BROWSER_BREAKPOINT
    ) {
      if (!mobileSidebarOpen) toggleMobileSidebar();
      return;
    }
    setSidebarCollapsed(false);
  }, [mobileSidebarOpen, setSidebarCollapsed, toggleMobileSidebar]);

  const sessionSidebarElement = (
    <SessionBrowser
      activeSessionId={activeSessionId}
      forkingSessionId={forkingSessionId}
      forkedSessionId={forkedSessionId}
      collapsed={sessionSidebarCollapsed}
      onCollapsedChange={setSidebarCollapsed}
      onLoad={(sessionId: string) => {
        const request = sessionSwitchRequestsRef.current.begin();
        closeMobileSidebar();
        return loadSessionById(sessionId, request);
      }}
      onFork={forkSession}
      mobileOpen={mobileSidebarOpen}
      onMobileClose={closeMobileSidebar}
      onNewSession={newSession}
      onSuggestTitle={suggestSessionTitle}
    />
  );

  const settingsDialogElement = (
    <SettingsDialog
      open={settingsDialog.open}
      onClose={settingsDialog.onClose}
      defaultTabId={settingsDeepLinkRef.current?.tabId}
      tabs={[
        {
          id: "models",
          label: "Models & Providers",
          component: <ModelsProvidersTab />,
        },
        {
          id: "learning",
          label: "Learning",
          component: <LearningTab onSpeechSettingsChange={setSpeechSettings} />,
        },
        { id: "app", label: "App", component: <KeatingUiSettingsTab /> },
        { id: "diagnostics", label: "Diagnostics", component: <DiagnosticsTab /> },
      ]}
    />
  );

  const modelSelectorDialogElement = (
    <ModelSelectorDialog
      open={modelSelectorDialog.open}
      currentModel={agentRef.current?.context.model ?? selectedModelRef.current}
      onClose={modelSelectorDialog.onClose}
      onSelect={(model: Model<Api>) => {
        modelSelectorDialog.onClose();
        const prevModel = selectedModelRef.current;
        const activeAgent = agentRef.current;
        if (activeAgent?.context.isStreaming) {
          posthog.capture("model_change_blocked", {
            reason: "active_turn",
            from_model: `${prevModel.provider}/${prevModel.id}`,
            to_model: `${model.provider}/${model.id}`,
            session_id: sessionIdRef.current,
          });
          return;
        }
        posthog.capture("model_changed", {
          model: `${model.provider}/${model.id}`,
          provider: model.provider,
          from_model: `${prevModel.provider}/${prevModel.id}`,
          to_model: `${model.provider}/${model.id}`,
          from_provider: prevModel.provider,
          to_provider: model.provider,
          during_turn: false,
          session_id: sessionIdRef.current,
        });
        const request = sessionSwitchRequestsRef.current.current;
        startTransition(async () => {
          if (model.provider === "browser") await loadBrowserModel(model.id);
          if (!sessionSwitchRequestsRef.current.isCurrent(request) || agentRef.current !== activeAgent) return;
          selectModel(model);
          const agent = agentRef.current;
          if (agent) {
            const current = agent.context;
            await createAgent(panelRef.current!, {
              ...current,
              model,
              messages: [...current.messages],
            }, { preserveSelectedModel: true });
          }
        });
      }}
    />
  );

  const imageSettings = loadKeatingUiSettings();
  const selectedImageGenerator =
    getImageGenerator(imageSettings.imageGenerator) ??
    getImageGenerator(DEFAULT_IMAGE_GENERATOR_ID)!;
  const imageModelSelectorDialogElement = (
    <ImageGenerationModelSelectorDialog
      open={imageModelSelectorDialog.open}
      generator={selectedImageGenerator}
      currentModelId={
        imageSettings.imageModel || selectedImageGenerator.models[0] || ""
      }
      onClose={() => {
        imageModelRetryRef.current = null;
        imageModelSelectorDialog.onClose();
      }}
      onSelect={(modelId) => {
        saveKeatingUiSettings({
          ...loadKeatingUiSettings(),
          imageModel: modelId,
        });
        imageModelSelectorDialog.onClose();
        const retry = imageModelRetryRef.current;
        imageModelRetryRef.current = null;
        void retry?.().catch((error) => {
          console.error("Keating image generation retry failed:", error);
          posthog.capture("image_generation_retry_failed", {
            session_id: sessionIdRef.current,
          });
        });
      }}
    />
  );

  // Use a callback ref to safely initialize the agent when the DOM node resolves
  const chatPanelRef = useCallback(
    (node: ChatPanelHandle | null) => {
      if (bootstrapTimerRef.current !== null) {
        clearTimeout(bootstrapTimerRef.current);
        bootstrapTimerRef.current = null;
      }

      bootstrapGenerationRef.current += 1;
      panelRef.current = node;

      if (!node) return;

      const existingAgent = agentRef.current;
      if (node) {
        if (existingAgent) {
          // Re-attach existing agent if component re-mounted (e.g. strict mode)
          if (unsubRef.current) unsubRef.current();
          unsubRef.current = subscribeAgentEvents(existingAgent.execution, node as any);
          const retryExistingResponse = async () => {
            if (existingAgent.context.isStreaming) return;
            const retryMessages = prepareMessagesForRetry(
              existingAgent.context.messages,
            );
            if (!retryMessages) return;
            await ensureSessionStartContextRef.current();
            untrustedSearchProvenanceRef.current = false;
            existingAgent.context.messages = retryMessages;
            await persistCurrentSnapshotRef.current();
            analyticsTurnIndexRef.current = Math.max(
              0,
              retryMessages.filter((message) => message.role === "user")
                .length - 1,
            );
            await existingAgent.resume();
          };
          const setupCallbacks = {
			sessionId: sessionIdRef.current,
			getPendingLearnerResponses: () => conversationRuntime(sessionIdRef.current)?.pendingLearnerResponses() ?? [],
			onLearnerResponseDelivered: (response: import("../keating/event-store").PendingLearnerResponse) => {
				const runtime = conversationRuntime(sessionIdRef.current);
				runtime?.resolveLearnerResponse(response.receiptId);
				runtime?.resolveAction(response.uiActionId);
			},
            onApiKeyRequired: async (provider: string) => {
              if (provider === "browser") return true;
              if (await getProviderApiKey(provider)) return true;
              return promptKeatingApiKey(provider);
            },
            onAuthError: async (provider: string) => {
              if (provider === "browser") return false;
              posthog.capture("api_error", {
                error_type: "auth",
                provider,
                session_id: sessionIdRef.current,
              });
              posthog.capture("auth_recovery_prompted", {
                provider,
                session_id: sessionIdRef.current,
              });
              const ok = await promptKeatingApiKey(provider, { force: true });
              posthog.capture("auth_recovery_action", {
                provider,
                session_id: sessionIdRef.current,
                outcome: ok ? "credentials_submitted" : "dismissed",
              });
              if (ok) void retryExistingResponse();
              return ok;
            },
            onBeforeSend: async () => {
              untrustedSearchProvenanceRef.current = false;
              await ensureSessionStartContextRef.current();
              await keatingLifecycle.emit({
                type: "before_turn",
                sessionId: sessionIdRef.current,
              });
              if (import.meta.env.DEV) {
                console.log(
                  `[keating:send] model=${existingAgent.context.model.provider}/${existingAgent.context.model.id} messages=${existingAgent.context.messages.length}`,
                );
              }
              const turnIndex = existingAgent.context.messages.filter(
                (m) => m.role === "user",
              ).length;
              analyticsTurnIndexRef.current = turnIndex;
              const model = `${existingAgent.context.model.provider}/${existingAgent.context.model.id}`;
              posthog.capture("message_sent", {
                session_id: sessionIdRef.current,
                turn_index: turnIndex,
                turn_number: turnIndex + 1,
                model,
                provider: existingAgent.context.model.provider,
              });
              window.dispatchEvent(
                new CustomEvent("keating:message-sent", {
                  detail: { sessionId: sessionIdRef.current, turnIndex },
                }),
              );
              if (turnIndex === 0) {
                posthog.capture("first_message_sent", {
                  session_id: sessionIdRef.current,
                  model,
                  provider: existingAgent.context.model.provider,
                });
              }
            },
            onLocalMessagesChanged: () => {
              sessionSnapshotsRef.current.changed(existingAgent);
              return saveSessionSnapshot(existingAgent);
            },
            onModelSelect: () => {
              posthog.capture("model_selector_opened", {
                session_id: sessionIdRef.current,
              });
              modelSelectorDialog.onOpen();
            },
            onImageGenerationModelSelect: () => {
              imageModelRetryRef.current = retryExistingResponse;
              imageModelSelectorDialog.onOpen();
            },
            onFork: (forkPoint?: number) =>
              forkSession(sessionIdRef.current, forkPoint),
            onRetry: retryExistingResponse,
            thinkingLevel: existingAgent.context.thinkingLevel,
            onThinkingLevelChange: (level: ThinkingLevel) => {
              applyThinkingLevel(level);
            },
          };
          node.setConversation(existingAgent, setupCallbacks).catch(console.error);
          return;
        }

        const generation = bootstrapGenerationRef.current;
        const request = sessionSwitchRequestsRef.current.current;
        bootstrapTimerRef.current = window.setTimeout(() => {
          if (
            bootstrapGenerationRef.current !== generation ||
            !sessionSwitchRequestsRef.current.isCurrent(request) ||
            panelRef.current !== node ||
            agentRef.current
          ) {
            return;
          }

          requestPersistentStorageOnce();

          void (async () => {
            try {
              const requestedSessionId =
                new URLSearchParams(window.location.search)
                  .get("session")
                  ?.trim() || null;
              const latestSessionId = await withSessionRestoreTimeout(
                requestedSessionId
                  ? Promise.resolve(requestedSessionId)
                  : (
                      sessions.getAllMetadata() as Promise<SessionMetadata[]>
                    ).then(
                      (items) =>
                        items
                          .filter((item) => !item.hiddenAlternative)
                          .sort((left, right) =>
                            right.lastModified.localeCompare(left.lastModified),
                          )[0]?.id ?? null,
                    ),
                "Restoring latest session",
              );
              if (
                bootstrapGenerationRef.current !== generation ||
                !sessionSwitchRequestsRef.current.isCurrent(request) ||
                panelRef.current !== node ||
                agentRef.current
              ) {
                return;
              }

              if (latestSessionId) {
                const session = await withSessionRestoreTimeout(
                  sessions.loadSession(latestSessionId),
                  "Loading latest session",
                );
                if (
                  bootstrapGenerationRef.current !== generation ||
                  !sessionSwitchRequestsRef.current.isCurrent(request) ||
                  panelRef.current !== node ||
                  agentRef.current
                ) {
                  return;
                }
                if (session) {
                  await loadSession(session, request);
                  if (requestedSessionId) {
                    const params = new URLSearchParams(window.location.search);
                    params.delete("session");
                    const next = params.toString();
                    window.history.replaceState(
                      {},
                      "",
                      `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`,
                    );
                  }
                  return;
                }
              }

              if (
                bootstrapGenerationRef.current !== generation ||
                !sessionSwitchRequestsRef.current.isCurrent(request) ||
                panelRef.current !== node ||
                agentRef.current
              ) {
                return;
              }

              await createAgent(node);
              posthog.capture("session_started", {
                session_id: sessionIdRef.current,
                source: "initial",
                is_initial: true,
              });
            } catch (error) {
              console.warn(
                "Could not restore the latest saved session; starting a new chat session.",
                error,
              );
              if (
                !agentRef.current &&
                panelRef.current === node &&
                bootstrapGenerationRef.current === generation &&
                sessionSwitchRequestsRef.current.isCurrent(request)
              ) {
                await createAgent(node).catch(console.error);
              }
            }
          })();
        }, 0);
      }
    },
    [
      applyThinkingLevel,
      createAgent,
      loadSession,
      requestPersistentStorageOnce,
    ],
  );

  const setThinkingLevel = useCallback(
    (level: ThinkingLevel) => {
      applyThinkingLevel(level);
    },
    [applyThinkingLevel],
  );

  const allDialogs = (
    <>
      {settingsDialogElement}
      {modelSelectorDialogElement}
      {imageModelSelectorDialogElement}
      <KeatingApiKeyPromptDialog />
    </>
  );

  const visiblePersistentStorageStatus =
    persistentStorageStatus === "declined" && !persistentStorageChecked
      ? "unknown"
      : persistentStorageStatus;

  return {
    title,
    isPending,
    // Rendered nodes
    chatPanelRef,
    dialogs: allDialogs,
    sessionSidebar: sessionSidebarElement,
    // Top-level actions
    openSettings,
    modelLabel,
    openModelSelector: modelSelectorDialog.onOpen,
    openSessions,
    newSession,
    shareSession,
    setThinkingLevel,
    generateCurrentSessionTitle,
    // Speech
    speechEnabled: speechSettings.enabled,
    toggleSpeech,
    // Persistent storage
    persistentStorageStatus: visiblePersistentStorageStatus,
    persistentBannerDismissed,
    retryPersistentStorage,
    dismissPersistentBanner,
    // Session & fork state
    activeSessionId,
    forkingSessionId,
    forkInfo,
    openOriginalSession,
    // Sidebar layout
    sessionSidebarCollapsed,
    toggleSessionSidebar,
    mobileSidebarOpen,
    toggleMobileSidebar,
    closeMobileSidebar,
    responseComparison,
    chooseResponse,
  };
}
