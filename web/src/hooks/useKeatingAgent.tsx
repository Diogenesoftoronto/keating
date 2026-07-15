import { useRef, useTransition, useCallback, use, useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { Agent, type AgentMessage, type AgentState, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { useDialogState } from "./useDialogState";
import {
  type Model,
  type Api,
  type Context,
} from "@earendil-works/pi-ai";
import { defaultConvertToLlm } from "@earendil-works/pi-web-ui";
import { SettingsDialog } from "../components/SettingsDialog";
import {
	MODELS_TAB_ALL_SECTION_IDS,
	SETTINGS_DIALOG_TAB_IDS,
} from "../components/settings/section-ids";
import { KeatingUiSettingsTab } from "../components/KeatingUiSettingsTab";
import { LearningTab } from "../components/settings/LearningTab";
import { ModelsProvidersTab } from "../components/settings/ModelsProvidersTab";
import { SessionBrowser, SESSION_BROWSER_BREAKPOINT } from "../components/SessionBrowser";
import { ModelSelectorDialog } from "../components/ModelSelector";
import { KeatingApiKeyPromptDialog, promptKeatingApiKey } from "../components/KeatingApiKeyPromptDialog";
import { getProviderApiKey, resolveAvailableChatModel } from "../lib/provider-models";
import { localModel } from "../stores/local-model";
import { buildKeatingSystemPrompt, composeKeatingSystemPrompt, createKeatingTools, getActiveKeatingPrompt } from "../keating/browser-tools";
import { loadAgentRuntimeConfig, shouldAutoBootNodePod, type KeatingAgentRuntimeConfig } from "../keating/agent-runtime";
import { KeatingCapabilityController } from "../keating/capabilities";
import { keatingLifecycle } from "../keating/lifecycle";
import { keatingOpenUIPrompt } from "../keating/openui/library";
import { isDefaultPersona, loadPersona, subscribePersona } from "../keating/persona";
import { loadLearnerContext, subscribeLearnerContext } from "../keating/learner-context";
import { composeSessionStartSystemPrompt, runSessionStartHooks } from "../keating/session-start-hooks";
import {
  buildPendingResponseComparison,
  type PendingResponseComparison,
  type ResponseComparisonDecision,
} from "../keating/response-comparison";
import { bootNodePod } from "../keating/nodepod-runtime";
import { registerKeatingWebMcp } from "../keating/webmcp";
import { type WebSpeechSettings } from "../keating/speech";
import {
  savePersistentStorageStatus,
  useKeatingAgentStore,
  type ForkInfo,
  type PersistentStorageStatus,
} from "../stores/keating-agent-store";
import { subscribeAgentEvents } from "./agent-subscriptions";
import { DEFAULT_MODEL, hybridStreamFn } from "./keating-stream";
import { getInitPromise, keatingStorage, sessions, updateSessionTitle } from "./keating-storage";
import { hasAutoTitleContext } from "./session-auto-title";
import { cloneMessages, createSessionId, sessionModelMetadata, sessionPreview, sessionSearchText, sessionTitle, sessionUsage, truncateAtForkPoint } from "./session-metadata";
import { messagesForSessionSnapshot, prepareMessagesForRetry } from "./session-recovery";
import { saveSharedSession, sharedSessionUrl, type SharedSessionUrlResult } from "../keating/shared-sessions";
import { loadKeatingUiSettings } from "../keating/ui-settings";
import {
  branchBeforeAssistantTurn,
  canGenerateAlternativeFromBranch,
  lastAssistantTimestamp,
  shouldGenerateAlternativeResponse,
} from "../keating/alternative-responses";
import type { ChatPanelHandle } from "../types/chat-panel";
import type { SessionData, SessionMetadata } from "../types/session";

function buildAgentSystemPrompt(
  speechEnabled: boolean,
  basePrompt: string,
  learnerContext: string,
  sessionStartContext = "",
): string {
  const prompt = buildKeatingSystemPrompt(speechEnabled, basePrompt, learnerContext);
  const promptWithOpenUi = basePrompt.includes(keatingOpenUIPrompt) ? prompt : `${prompt}\n\n${keatingOpenUIPrompt}`;
  return composeSessionStartSystemPrompt(promptWithOpenUi, sessionStartContext);
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
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

async function requestBrowserPersistentStorage(): Promise<PersistentStorageStatus> {
  if (typeof navigator === "undefined" || !navigator.storage) return "declined";
  try {
    if (navigator.storage.persisted && await navigator.storage.persisted()) {
      return "granted";
    }
    if (!navigator.storage.persist) return "declined";
    const granted = await navigator.storage.persist();
    if (granted) return "granted";
    return await browserPersistentStorageGranted() ? "granted" : "declined";
  } catch {
    return "declined";
  }
}

async function withSessionRestoreTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${SESSION_RESTORE_TIMEOUT_MS}ms`)), SESSION_RESTORE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
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

export function useKeatingAgent(): UseKeatingAgentReturn {
  // Use React 19's use() for suspense handling of asynchronous init
  use(getInitPromise());

  const posthog = usePostHog();
  const title = "Keating";
  const agentRef = useRef<Agent | null>(null);
  const panelRef = useRef<ChatPanelHandle | null>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const sessionParentIdRef = useRef<string | null>(null);
  const sessionForkedAtRef = useRef<string | undefined>(undefined);
  const selectedModelRef = useRef<Model<Api>>(DEFAULT_MODEL);
  const activeSessionId = useKeatingAgentStore((state) => state.activeSessionId);
  const setActiveSessionId = useKeatingAgentStore((state) => state.setActiveSessionId);
  const forkingSessionId = useKeatingAgentStore((state) => state.forkingSessionId);
  const setForkingSessionId = useKeatingAgentStore((state) => state.setForkingSessionId);
  const forkedSessionId = useKeatingAgentStore((state) => state.forkedSessionId);
  const setForkedSessionId = useKeatingAgentStore((state) => state.setForkedSessionId);
  const clearForkedSessionId = useKeatingAgentStore((state) => state.clearForkedSessionId);
  const forkInfo = useKeatingAgentStore((state) => state.forkInfo);
  const setForkInfo = useKeatingAgentStore((state) => state.setForkInfo);
  const sessionSidebarCollapsed = useKeatingAgentStore((state) => state.sessionSidebarCollapsed);
  const toggleSessionSidebar = useKeatingAgentStore((state) => state.toggleSessionSidebar);
  const setSidebarCollapsed = useKeatingAgentStore((state) => state.setSessionSidebarCollapsed);
  const mobileSidebarOpen = useKeatingAgentStore((state) => state.mobileSidebarOpen);
  const toggleMobileSidebar = useKeatingAgentStore((state) => state.toggleMobileSidebar);
  const closeMobileSidebar = useKeatingAgentStore((state) => state.closeMobileSidebar);
  const speechSettings = useKeatingAgentStore((state) => state.speechSettings);
  const speechEnabledRef = useRef(speechSettings.enabled);
  speechEnabledRef.current = speechSettings.enabled;
  const setSpeechSettings = useKeatingAgentStore((state) => state.setSpeechSettings);
  const toggleSpeech = useKeatingAgentStore((state) => state.toggleSpeech);
  const persistentStorageStatus = useKeatingAgentStore((state) => state.persistentStorageStatus);
  const setPersistentStorageStatus = useKeatingAgentStore((state) => state.setPersistentStorageStatus);
  const persistentStorageChecked = useKeatingAgentStore((state) => state.persistentStorageChecked);
  const setPersistentStorageChecked = useKeatingAgentStore((state) => state.setPersistentStorageChecked);
  const persistentBannerDismissed = useKeatingAgentStore((state) => state.persistentBannerDismissed);
  const dismissPersistentBanner = useKeatingAgentStore((state) => state.dismissPersistentBanner);
  const settingsDialog = useDialogState();
  const modelSelectorDialog = useDialogState();
  const [isPending, startTransition] = useTransition();
  const bootstrapTimerRef = useRef<number | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const persistentStorageRequestedRef = useRef(false);
  const systemPromptBaseRef = useRef<string>("");
  const sessionStartContextRef = useRef<{
    sessionId: string;
    context: string;
    promise: Promise<string> | null;
  }>({ sessionId: "", context: "", promise: null });
  const ensureSessionStartContextRef = useRef<() => Promise<void>>(async () => {});
  const alternativeGenerationRef = useRef(new Set<string>());
  const settingsDeepLinkRef = useRef<{ tabId: string; sectionId: string | null } | null>(null);
  const [responseComparison, setResponseComparison] = useState<PendingResponseComparison | null>(null);

  const restorePendingResponseComparison = useCallback(async (sourceSessionId: string) => {
    const metadata = await sessions.getAllMetadata() as SessionMetadata[];
    const pending = metadata
      .filter((entry) => entry.parentSessionId === sourceSessionId && entry.generatedAlternative && !entry.responsePreference)
      .sort((left, right) => right.lastModified.localeCompare(left.lastModified))[0];
    if (!pending) {
      setResponseComparison(null);
      return;
    }
    const [source, alternative] = await Promise.all([
      sessions.loadSession(sourceSessionId) as Promise<SessionData | null>,
      sessions.loadSession(pending.id) as Promise<SessionData | null>,
    ]);
    setResponseComparison(source && alternative ? buildPendingResponseComparison(source, alternative) : null);
  }, []);

  const openSettings = useCallback(() => {
    posthog.capture('settings_opened', { source: 'toolbar' });
    settingsDialog.onOpen();
  }, [posthog, settingsDialog]);

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
    if (!SETTINGS_DIALOG_TAB_IDS.includes(raw as typeof SETTINGS_DIALOG_TAB_IDS[number])) {
      const dashIndex = raw.indexOf("-");
      const candidateTab = dashIndex === -1 ? raw : raw.slice(0, dashIndex);
      const candidateSection = dashIndex === -1 ? raw : raw.slice(dashIndex + 1);
      if ((SETTINGS_DIALOG_TAB_IDS as readonly string[]).includes(candidateTab)) {
        tabId = candidateTab;
        sectionId = MODEL_SECTION_SET.has(candidateSection) ? candidateSection : null;
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
      const el = link.sectionId ? document.getElementById(`settings-section-${link.sectionId}`) : null;
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
      const detail = (event as CustomEvent<{
        type?: unknown;
        comment?: unknown;
        messageId?: unknown;
        messageText?: unknown;
        messageCreatedAt?: unknown;
      }>).detail;
      const signal = detail?.type === "up"
        ? "thumbs-up"
        : detail?.type === "down"
          ? "thumbs-down"
          : null;
      if (!signal) return;
      const sessionId = sessionIdRef.current;
      const session = await sessions.loadSession(sessionId) as SessionData | null;
      // The session title is context only; the referent retains the exact
      // generated answer, so later analysis need not guess from a topic bucket.
      const topic = session?.title?.trim() || "general";
      const messageId = typeof detail.messageId === "string" ? detail.messageId : undefined;
      const messageText = typeof detail.messageText === "string" ? detail.messageText.trim() : "";
      posthog.capture('message_feedback_given', { signal, topic, session_id: sessionIdRef.current });
      await keatingStorage.recordFeedback(topic, signal, {
        source: "explicit",
        evidence: typeof detail.comment === "string" && detail.comment.trim() ? detail.comment : undefined,
        messageId,
        sessionId,
        topicSource: "session-title",
        referent: messageId && messageText
          ? {
              sessionId,
              messageId,
              content: messageText.slice(0, 12_000),
              createdAt: typeof detail.messageCreatedAt === "number" ? detail.messageCreatedAt : undefined,
            }
          : undefined,
      });
    };
    window.addEventListener("keating:message-feedback", onMessageFeedback);
    return () => window.removeEventListener("keating:message-feedback", onMessageFeedback);
  }, []);

  useEffect(() => {
    const onQuestionAnswered = (event: Event) => {
      const detail = (event as CustomEvent<{
        topic?: unknown;
        answers?: Array<{ question?: unknown; answer?: unknown; score?: unknown; grading?: unknown }>;
      }>).detail;
      const answers = detail?.answers?.filter(
        (answer): answer is { question: string; answer: string; score?: unknown; grading?: unknown } =>
          typeof answer?.question === "string" && typeof answer.answer === "string",
      ) ?? [];
      if (answers.length === 0) return;
      void (async () => {
        const state = await keatingStorage.getLearnerState();
        const topic = typeof detail?.topic === "string" && detail.topic.trim()
          ? detail.topic.trim()
          : state.topicsExplored.at(-1) ?? "general";
        await Promise.all(answers.map((answer) => keatingStorage.recordQuestionCheck({
          topic,
          question: answer.question,
          answer: answer.answer,
          score: typeof answer.score === "number" ? answer.score : undefined,
          grading: answer.grading === "auto" ? "auto" : "pending",
          sessionId: sessionIdRef.current,
        })));
      })();
    };
    window.addEventListener("keating:question-answered", onQuestionAnswered);
    return () => window.removeEventListener("keating:question-answered", onQuestionAnswered);
  }, []);

  async function loadBrowserModel() {
    const state = localModel.getState();
    if (!state.loaded && !state.loading) await localModel.load();
    if (!localModel.getState().loaded) {
      throw new Error(localModel.getState().error ?? "Failed to load browser model");
    }
  }

  const unsubRef = useRef<(() => void) | null>(null);
  const persistUnsubRef = useRef<(() => void) | null>(null);
  const persistCurrentSnapshotRef = useRef<() => Promise<void>>(async () => {});
  const capabilityControllerRef = useRef<KeatingCapabilityController | null>(null);
  const autoTitleRequestedRef = useRef<Set<string>>(new Set());

  const toolOptions = useCallback((settings: WebSpeechSettings, agentRuntime?: KeatingAgentRuntimeConfig) => ({
    agentRuntime,
    speech: {
      settings,
      getApiKey: (provider: string) => getProviderApiKey(provider),
    },
    setSystemPrompt: (basePrompt: string) => {
      systemPromptBaseRef.current = basePrompt;
      if (agentRef.current) {
        agentRef.current.state.systemPrompt = buildAgentSystemPrompt(
          settings.enabled,
          basePrompt,
          loadLearnerContext(),
          sessionStartContextRef.current.context,
        );
      }
    },
    getSessionSamples: async () => {
      const metadata = await sessions.getAllMetadata();
      const loaded = await Promise.all(metadata.map((entry) => sessions.loadSession(entry.id) as Promise<SessionData | null>));
      return loaded
        .filter((data): data is SessionData => Boolean(data))
        .map((data) => ({
          id: data.id,
          title: data.title,
          model: data.model
            ? { provider: data.model.provider, id: data.model.id, name: data.model.name }
            : undefined,
          messages: data.messages as unknown[],
        }));
    },
  }), []);

  const saveSessionSnapshot = useCallback(async (
    agent: Agent | null = agentRef.current,
    sessionId = sessionIdRef.current,
    createdAt = sessionCreatedAtRef.current,
  ) => {
    if (!agent || agent.state.messages.length === 0) return;

    const now = new Date().toISOString();
    const snapshot = messagesForSessionSnapshot(agent.state.messages, agent.state.streamingMessage);
    const messages = snapshot.messages;
    const fallbackTitle = sessionTitle(messages);
    const existing = await sessions.loadSession(sessionId) as SessionData | null;
    const existingFallbackTitle = existing ? sessionTitle(existing.messages) : "";
    const hasManualTitle = Boolean(
      existing &&
      existing.aiGeneratedTitle !== true &&
      existing.title.trim() &&
      existing.title.trim() !== existingFallbackTitle.trim(),
    );
    const title = existing && (hasManualTitle || existing.aiGeneratedTitle)
      ? existing.title
      : fallbackTitle;
    const aiGeneratedTitle = existing?.aiGeneratedTitle ?? false;
    const metadata: SessionMetadata = {
      id: sessionId,
      title,
      parentSessionId: sessionParentIdRef.current,
      forkedAt: sessionForkedAtRef.current,
      createdAt,
      lastModified: now,
      messageCount: messages.length,
      usage: sessionUsage(messages),
      thinkingLevel: agent.state.thinkingLevel,
      ...sessionModelMetadata(agent.state.model),
      preview: sessionPreview(messages),
      searchText: sessionSearchText(messages),
      aiGeneratedTitle,
		generatedAlternative: existing?.generatedAlternative,
		hiddenAlternative: existing?.hiddenAlternative,
		alternativeForMessageTimestamp: existing?.alternativeForMessageTimestamp,
		responsePreference: existing?.responsePreference,
    };
    const data: SessionData = {
      id: sessionId,
      title,
      parentSessionId: sessionParentIdRef.current,
      forkedAt: sessionForkedAtRef.current,
      model: agent.state.model,
      thinkingLevel: agent.state.thinkingLevel,
      messages,
      createdAt,
      lastModified: now,
      aiGeneratedTitle,
		generatedAlternative: existing?.generatedAlternative,
		hiddenAlternative: existing?.hiddenAlternative,
		alternativeForMessageTimestamp: existing?.alternativeForMessageTimestamp,
		responsePreference: existing?.responsePreference,
    };

    await sessions.save(data, metadata);
    window.dispatchEvent(new CustomEvent("keating:sessions-changed"));

    // Live snapshots exist only so a suspended or killed tab can recover the
    // visible response. Derive learner signals and titles from settled turns.
    if (snapshot.interrupted) return;

    await keatingStorage.recordLearnerTurnFeedback(messages as Array<{ role?: unknown; content?: unknown }>);

    if (!hasManualTitle && !aiGeneratedTitle && hasAutoTitleContext(messages) && !autoTitleRequestedRef.current.has(sessionId)) {
      autoTitleRequestedRef.current.add(sessionId);
      void (async () => {
        const model = agent.state.model as Model<Api>;
        try {
          if (model.provider === "browser") {
            await loadBrowserModel();
          } else if (!(await getProviderApiKey(model.provider))) {
            return;
          }
          const apiKey = model.provider === "browser" ? undefined : await getProviderApiKey(model.provider);
          const context: Context = {
            systemPrompt: "You rename learning chat sessions. Return only a concise, specific title. No quotes. No punctuation-only titles. Maximum 7 words.",
            messages: [{
              role: "user",
              timestamp: Date.now(),
              content: `Conversation preview:\n${sessionPreview(messages).slice(0, 2400)}\n\nCurrent title: ${title}`,
            }],
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
  }, []);

  const maybeGenerateAlternativeResponse = useCallback(async (
    agent: Agent,
    sourceSessionId: string,
  ) => {
    if (sessionIdRef.current !== sourceSessionId) return;
    const settings = loadKeatingUiSettings();
    if (!shouldGenerateAlternativeResponse(settings.alternativeResponseChance)) return;

    const sourceMessages = cloneMessages(agent.state.messages);
    const assistantTimestamp = lastAssistantTimestamp(sourceMessages);
    if (assistantTimestamp == null) return;
    const generationKey = `${sourceSessionId}:${assistantTimestamp}`;
    if (alternativeGenerationRef.current.has(generationKey)) return;

    const branchMessages = branchBeforeAssistantTurn(sourceMessages, assistantTimestamp);
    if (!canGenerateAlternativeFromBranch(branchMessages)) return;
    alternativeGenerationRef.current.add(generationKey);

    const model = agent.state.model as Model<Api>;
    try {
      if (model.provider === "browser") {
        await loadBrowserModel();
      } else if (!(await getProviderApiKey(model.provider))) {
        return;
      }
      const stream = await hybridStreamFn(model, {
        systemPrompt: agent.state.systemPrompt,
        messages: branchMessages as unknown as Context["messages"],
      }, {
        temperature: 0.85,
      });
      const streamedAlternative = await stream.result() as AgentMessage;
      const alternative = typeof (streamedAlternative as { timestamp?: unknown }).timestamp === "number"
        ? streamedAlternative
        : ({ ...streamedAlternative, timestamp: Date.now() } as AgentMessage);
      const alternativeContent = (alternative as any).content;
      const text = Array.isArray(alternativeContent)
        ? alternativeContent
          .filter((part: any) => part?.type === "text" && typeof part.text === "string")
          .map((part: any) => part.text)
          .join("")
          .trim()
        : "";
      if (!text || (alternative as any).stopReason === "error" || (alternative as any).stopReason === "aborted") return;

      const now = new Date().toISOString();
      const id = createSessionId();
      const messages = [...branchMessages, alternative];
      const title = `${sessionTitle(branchMessages) || "Alternative response"} (alternative)`;
      const metadata: SessionMetadata = {
        id,
        title,
        parentSessionId: sourceSessionId,
        forkedAt: now,
        createdAt: now,
        lastModified: now,
        messageCount: messages.length,
        usage: sessionUsage(messages),
        thinkingLevel: agent.state.thinkingLevel,
        ...sessionModelMetadata(agent.state.model),
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
        model: agent.state.model,
        thinkingLevel: agent.state.thinkingLevel,
        messages,
        createdAt: now,
        lastModified: now,
        aiGeneratedTitle: false,
		generatedAlternative: true,
		hiddenAlternative: true,
		alternativeForMessageTimestamp: assistantTimestamp,
      };
      await sessions.save(data, metadata);
		const source = await sessions.loadSession(sourceSessionId) as SessionData | null;
		if (source) setResponseComparison(buildPendingResponseComparison(source, data));
      window.dispatchEvent(new CustomEvent("keating:sessions-changed", { detail: { sessionId: id, parentSessionId: sourceSessionId, generatedAlternative: true } }));
      window.dispatchEvent(new CustomEvent("keating:dpo-alternative-created", { detail: { sessionId: id, parentSessionId: sourceSessionId } }));
    } catch (error) {
      console.warn("Failed to generate DPO alternative response:", error);
    }
  }, []);

  const createAgent = useCallback(async (panel: ChatPanelHandle, initialState?: Partial<AgentState>) => {
    const agentSessionId = sessionIdRef.current;
    const agentCreatedAt = sessionCreatedAtRef.current;
    // Custom personas take precedence; the untouched default still honors any
    // evolved prompt produced by the self-improvement loop.
    const persona = loadPersona();
    const promptBase =
      (initialState?.systemPrompt && systemPromptBaseRef.current) ||
      initialState?.systemPrompt ||
      (isDefaultPersona(persona)
        ? await getActiveKeatingPrompt(keatingStorage)
        : composeKeatingSystemPrompt(persona));
    systemPromptBaseRef.current = promptBase;
    if (sessionStartContextRef.current.sessionId !== agentSessionId) {
      sessionStartContextRef.current = { sessionId: agentSessionId, context: "", promise: null };
    }
    const sessionStartRecord = sessionStartContextRef.current;
    const agentRuntime = await loadAgentRuntimeConfig();
    const allTools = await createKeatingTools(keatingStorage, toolOptions(speechSettings, agentRuntime));
    const capabilityController = new KeatingCapabilityController({
      runtime: agentRuntime,
      speechEnabled: speechSettings.enabled,
    });
		let capabilityContinuationPending = false;
		capabilityController.setActivationListener((result) => {
			if (result.activated.length > 0) capabilityContinuationPending = true;
		});
    capabilityControllerRef.current = capabilityController;
    const tools = capabilityController.setAllTools(allTools);
    registerKeatingWebMcp(keatingStorage, tools).catch(console.warn);
    const resolvedModel = await resolveAvailableChatModel(initialState?.model ?? selectedModelRef.current);
    selectedModelRef.current = resolvedModel;
    const nextState: Partial<AgentState> = {
      model: resolvedModel,
      thinkingLevel: initialState?.thinkingLevel ?? loadKeatingUiSettings().reasoningLevel,
      messages: [],
      tools,
      ...initialState,
      systemPrompt: buildAgentSystemPrompt(
        speechSettings.enabled,
        promptBase,
        loadLearnerContext(),
        sessionStartRecord.context,
      ),
    };

    const agent = new Agent({
      initialState: nextState,
      convertToLlm: defaultConvertToLlm,
      streamFn: hybridStreamFn,
      sessionId: agentSessionId,
    });
    agent.getApiKey = (provider: string) => getProviderApiKey(provider);
		agent.state.tools = tools;
    agentRef.current = agent;
		capabilityController.setListener((activeTools) => {
			if (agentRef.current !== agent) return;
			agent.state.tools = activeTools;
			registerKeatingWebMcp(keatingStorage, activeTools).catch(console.warn);
		});
		const sessionAlreadyAnswered = agent.state.messages.some((message) => {
			const candidate = message as { role?: unknown; stopReason?: unknown };
			return candidate.role === "assistant" && candidate.stopReason !== "error" && candidate.stopReason !== "aborted";
		});
		const ensureSessionStartContext = async () => {
			if (!sessionStartRecord.context && sessionAlreadyAnswered) return;
			sessionStartRecord.promise ??= (async () => {
				await keatingLifecycle.emit({ type: "session_start", sessionId: agentSessionId });
				return runSessionStartHooks(keatingStorage, undefined, {
					capabilityCatalog: capabilityController.catalog(),
				});
			})();
			sessionStartRecord.context = await sessionStartRecord.promise;
			agent.state.systemPrompt = buildAgentSystemPrompt(
				speechEnabledRef.current,
				systemPromptBaseRef.current,
				loadLearnerContext(),
				sessionStartRecord.context,
			);
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
							tools: await createKeatingTools(keatingStorage, toolOptions(speechSettings, runtime)),
						}))
						.then(({ runtime, tools: refreshedTools }) => {
              if (agentRef.current !== agent) return;
							capabilityController.setEnvironment({ runtime, speechEnabled: speechSettings.enabled });
							const activeTools = capabilityController.setAllTools(refreshedTools);
							registerKeatingWebMcp(keatingStorage, activeTools).catch(console.warn);
            });
        })
        .catch(console.warn);
    }

    if (unsubRef.current) unsubRef.current();
    unsubRef.current = subscribeAgentEvents(agent, panel as any);
    if (persistUnsubRef.current) persistUnsubRef.current();
    let snapshotTimer: number | null = null;
    let snapshotQueue = Promise.resolve();
    const persistSnapshot = () => {
      snapshotQueue = snapshotQueue
        .catch(() => {})
        .then(() => saveSessionSnapshot(agent, agentSessionId, agentCreatedAt));
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
    const unsubscribePersistence = agent.subscribe((ev) => {
      if (ev.type === "message_update") {
        scheduleSnapshot();
      } else if (ev.type === "message_end") {
        if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
        snapshotTimer = null;
        void persistSnapshot();
      }
      if (ev.type === "tool_execution_end") {
        const succeeded = !ev.isError;
        posthog.capture('tool_invoked', {
          tool_name: ev.toolName,
          session_id: agentSessionId,
          succeeded,
          is_artifact: ARTIFACT_TOOL_NAMES.has(ev.toolName),
        });
        if (succeeded && ARTIFACT_TOOL_NAMES.has(ev.toolName)) {
          posthog.capture('artifact_created', { tool_name: ev.toolName, session_id: agentSessionId });
          window.dispatchEvent(new CustomEvent("keating:artifact-created", { detail: { toolName: ev.toolName, result: ev.result } }));
					void keatingLifecycle.emit({
						type: "artifact_finalized",
						sessionId: agentSessionId,
						artifact: { kind: ev.toolName, payload: ev.result },
					});
        }
      }
      if (ev.type === "agent_end") {
        const turnIndex = agent.state.messages.filter((m) => m.role === "assistant").length;
        posthog.capture('agent_turn_completed', { session_id: agentSessionId, turn_index: turnIndex });
				const continueWithActivatedCapabilities = capabilityContinuationPending;
				capabilityContinuationPending = false;
        agent.waitForIdle()
          .then(() => persistSnapshot())
					.then(async () => {
						if (continueWithActivatedCapabilities) {
							if (agentRef.current === agent && !agent.state.isStreaming) await agent.continue();
							return;
						}
						await keatingLifecycle.emit({ type: "session_idle", sessionId: agentSessionId });
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
      if (agent.state.isStreaming) return;
      const retryMessages = prepareMessagesForRetry(agent.state.messages);
      if (!retryMessages) return;
			await ensureSessionStartContext();
      agent.state.messages = retryMessages;
      await persistSnapshot();
      await agent.continue();
    };

    const setupCallbacks = {
      onApiKeyRequired: async (provider: string) => {
        if (provider === "browser") return true;
        if (await getProviderApiKey(provider)) return true;
        return promptKeatingApiKey(provider);
      },
      onAuthError: async (provider: string) => {
        if (provider === "browser") return false;
        posthog.capture('api_error', { error_type: 'auth', provider, session_id: agentSessionId });
        const ok = await promptKeatingApiKey(provider, { force: true });
        if (!ok) return false;
        // Key re-entered — actually recover by retrying the failed turn:
        // drop the trailing errored assistant message and resume generation
        // from the last user message.
        retryLastResponse().catch((error) => {
          console.error("Keating retry after API key re-entry failed:", error);
          posthog.capture('api_error', { error_type: 'retry_failed', provider, session_id: agentSessionId });
        });
        return true;
      },
      onBeforeSend: async () => {
			await ensureSessionStartContext();
			await keatingLifecycle.emit({ type: "before_turn", sessionId: agentSessionId });
        if (import.meta.env.DEV) {
          console.log(`[keating:send] model=${agent.state.model.provider}/${agent.state.model.id} messages=${agent.state.messages.length}`);
        }
        const turnIndex = agent.state.messages.filter((m) => m.role === "user").length;
        posthog.capture('message_sent', { session_id: agentSessionId, turn_index: turnIndex });
        if (turnIndex === 0) {
          posthog.capture('first_message_sent', { session_id: agentSessionId });
        }
      },
      onLocalMessagesChanged: () => saveSessionSnapshot(agent, agentSessionId, agentCreatedAt),
      onModelSelect: () => {
        posthog.capture('model_selector_opened', { session_id: agentSessionId });
        modelSelectorDialog.onOpen();
      },
      onFork: (forkPoint?: number) => forkSession(agentSessionId, forkPoint),
      onRetry: retryLastResponse,
      thinkingLevel: agent.state.thinkingLevel,
      onThinkingLevelChange: (level: ThinkingLevel) => {
        if (agentRef.current) {
          agentRef.current.state.thinkingLevel = level;
          posthog.capture('thinking_level_changed', { level, session_id: agentSessionId });
        }
      },
    };

    await panel.setAgent(agent, setupCallbacks);
  }, [maybeGenerateAlternativeResponse, posthog, saveSessionSnapshot, speechSettings, toolOptions]);

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
			tools: await createKeatingTools(keatingStorage, toolOptions(speechSettings, agentRuntime)),
		}))
      .then(({ agentRuntime, tools }) => {
        if (cancelled) return;
			const controller = capabilityControllerRef.current;
			if (controller) {
				controller.setEnvironment({ runtime: agentRuntime, speechEnabled: speechSettings.enabled });
				agent.state.tools = controller.setAllTools(tools);
			} else {
				agent.state.tools = tools;
			}
        agent.state.systemPrompt = buildAgentSystemPrompt(
          speechSettings.enabled,
          systemPromptBaseRef.current,
          loadLearnerContext(),
          sessionStartContextRef.current.context,
        );
			registerKeatingWebMcp(keatingStorage, agent.state.tools).catch(console.warn);
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [speechSettings, toolOptions]);

  // Apply teacher-persona edits to the live agent so changes take effect on the
  // next turn without needing a new session.
  useEffect(() => {
    return subscribePersona((persona) => {
      const base = composeKeatingSystemPrompt(persona);
      systemPromptBaseRef.current = base;
      if (agentRef.current) {
        agentRef.current.state.systemPrompt = buildAgentSystemPrompt(
          speechSettings.enabled,
          base,
          loadLearnerContext(),
          sessionStartContextRef.current.context,
        );
      }
    });
  }, [speechSettings.enabled]);

  useEffect(() => {
    return subscribeLearnerContext((context) => {
      if (agentRef.current) {
        agentRef.current.state.systemPrompt = buildAgentSystemPrompt(
          speechSettings.enabled,
          systemPromptBaseRef.current,
          context,
          sessionStartContextRef.current.context,
        );
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
    if (persistentBannerDismissed || persistentStorageStatus !== "unknown") return;
    persistentStorageRequestedRef.current = true;
    void requestBrowserPersistentStorage()
      .then((nextStatus) => {
        setPersistentStorageStatus(nextStatus);
        savePersistentStorageStatus(nextStatus as Exclude<PersistentStorageStatus, "unknown">);
        setPersistentStorageChecked(true);
        posthog.capture('persistent_storage_requested', { granted: nextStatus === "granted" });
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        setPersistentStorageChecked(true);
        posthog.capture('persistent_storage_requested', { granted: false });
        console.warn("Persistent storage request failed:", error);
      });
  }, [persistentBannerDismissed, persistentStorageStatus, posthog, setPersistentStorageChecked, setPersistentStorageStatus]);

  const retryPersistentStorage = useCallback(() => {
    persistentStorageRequestedRef.current = false;
    void requestBrowserPersistentStorage()
      .then((nextStatus) => {
        setPersistentStorageStatus(nextStatus);
        savePersistentStorageStatus(nextStatus as Exclude<PersistentStorageStatus, "unknown">);
        setPersistentStorageChecked(true);
        posthog.capture('persistent_storage_retried', { granted: nextStatus === "granted" });
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        setPersistentStorageChecked(true);
        posthog.capture('persistent_storage_retried', { granted: false });
        console.warn("Persistent storage retry failed:", error);
      })
      // If the browser silently denies persistence, stop nagging for this
      // session instead of leaving a banner the user cannot resolve.
      .finally(() => dismissPersistentBanner());
  }, [dismissPersistentBanner, posthog, setPersistentStorageChecked, setPersistentStorageStatus]);

  const endLearnerSession = useCallback(async () => {
    try {
      await keatingStorage.recordSessionEnd([]);
    } catch (error) {
      console.warn("Failed to record session end:", error);
    }
		await keatingLifecycle.emit({ type: "session_end", sessionId: sessionIdRef.current });
  }, []);

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (persistUnsubRef.current) persistUnsubRef.current();
    };
  }, []);

  const newSession = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;

    startTransition(async () => {
      const currentAgent = agentRef.current;
      if (currentAgent?.state.isStreaming) {
        currentAgent.abort();
        await currentAgent.waitForIdle();
      }
      await saveSessionSnapshot(currentAgent);
      await endLearnerSession();
      sessionIdRef.current = createSessionId();
      keatingStorage.setCurrentSessionId(sessionIdRef.current);
      sessionCreatedAtRef.current = new Date().toISOString();
      sessionParentIdRef.current = null;
      sessionForkedAtRef.current = undefined;
      setActiveSessionId(sessionIdRef.current);
      setForkInfo(null);
		setResponseComparison(null);
      await createAgent(panel, { messages: [], model: selectedModelRef.current });
      posthog.capture('session_started', { session_id: sessionIdRef.current, source: 'new_button', is_initial: false });
    });
  }, [createAgent, endLearnerSession, posthog, saveSessionSnapshot]);

  const shareSession = useCallback(async () => {
    const agent = agentRef.current;
    if (!agent) throw new Error("No active session to share");
    await saveSessionSnapshot(agent);
    const shared = saveSharedSession([...agent.state.messages], sessionCreatedAtRef.current, {
      model: agent.state.model,
      thinkingLevel: agent.state.thinkingLevel,
    });
    const result = await sharedSessionUrl(shared, window.location.origin, loadKeatingUiSettings().shareLinkMode);
    await navigator.clipboard?.writeText(result.url).catch((error) => {
      console.warn("Failed to copy share link:", error);
    });
    return result;
  }, [saveSessionSnapshot]);

  const loadSession = useCallback(async (session: SessionData) => {
    const panel = panelRef.current;
    if (!panel) return;

    const currentAgent = agentRef.current;
    if (currentAgent?.state.isStreaming) {
      currentAgent.abort();
      await currentAgent.waitForIdle();
    }
    await saveSessionSnapshot(currentAgent);
    if (currentAgent) await endLearnerSession();

    sessionIdRef.current = session.id;
    keatingStorage.setCurrentSessionId(session.id);
    sessionCreatedAtRef.current = session.createdAt;
    sessionParentIdRef.current = session.parentSessionId ?? null;
    sessionForkedAtRef.current = session.forkedAt;
    setActiveSessionId(session.id);
		setResponseComparison(null);
    if (session.parentSessionId && session.forkedAt) {
      const parentId = session.parentSessionId;
      const parentMeta = await sessions.getMetadata(parentId).catch(() => null);
      setForkInfo({
        parentId,
        parentTitle: parentMeta?.title ?? "original session",
        forkedAt: session.forkedAt,
      });
    } else {
      setForkInfo(null);
    }
    selectedModelRef.current = session.model;
    posthog.capture('session_loaded', { session_id: session.id, is_restored: true, has_parent: !!session.parentSessionId });
    await createAgent(panel, {
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      messages: session.messages,
    });
		if (!session.generatedAlternative) await restorePendingResponseComparison(session.id);
  }, [createAgent, endLearnerSession, restorePendingResponseComparison, saveSessionSnapshot]);

	const chooseResponse = useCallback(async (preference: ResponseComparisonDecision) => {
		const comparison = responseComparison;
		if (!comparison) return;
		const alternative = await sessions.loadSession(comparison.alternativeSessionId) as SessionData | null;
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
		const existingMetadata = await sessions.getMetadata(alternative.id) as SessionMetadata | null;
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
		if (preference === "alternative") await loadSession(nextAlternative);
	}, [loadSession, posthog, responseComparison]);

  const openOriginalSession = useCallback(() => {
    const parentId = forkInfo?.parentId;
    if (!parentId) return;
    startTransition(async () => {
      const session = await sessions.loadSession(parentId);
      if (session) await loadSession(session as SessionData);
    });
  }, [forkInfo, loadSession]);

  const forkSession = useCallback(async (sessionId: string, forkPoint?: number) => {
    // Persist the live session first so forking the current session captures its
    // latest messages before we read the stored copy below.
    await saveSessionSnapshot();
    const source = await sessions.loadSession(sessionId) as SessionData | null;
    if (!source) throw new Error("Session not found");

    const panel = panelRef.current;
    const now = new Date().toISOString();
    const messages = truncateAtForkPoint(cloneMessages(source.messages), forkPoint);
    const id = createSessionId();
    const title = `${source.title || sessionTitle(messages)} (fork)`;
    const metadata: SessionMetadata = {
      id,
      title,
      parentSessionId: source.id,
      forkedAt: now,
      createdAt: now,
      lastModified: now,
      messageCount: messages.length,
      usage: sessionUsage(messages),
      thinkingLevel: source.thinkingLevel,
        ...sessionModelMetadata(source.model),
        preview: sessionPreview(messages),
        searchText: sessionSearchText(messages),
        aiGeneratedTitle: false,
      };
    const data: SessionData = {
      ...source,
      id,
      title,
      parentSessionId: source.id,
      forkedAt: now,
      messages,
      createdAt: now,
      lastModified: now,
      aiGeneratedTitle: false,
    };

    setForkingSessionId(sessionId);
    setForkedSessionId(null);
    window.dispatchEvent(new CustomEvent("keating:session-fork-start", { detail: { sourceId: sessionId } }));
    try {
      await sessions.save(data, metadata);
      window.dispatchEvent(new CustomEvent("keating:sessions-changed", { detail: { sessionId: id, parentSessionId: source.id } }));
      posthog.capture('session_forked', { parent_session_id: source.id, new_session_id: id });
      if (panel) await loadSession(data);
      setForkedSessionId(id);
      window.dispatchEvent(new CustomEvent("keating:session-fork-end", { detail: { sourceId: sessionId, sessionId: id } }));
      window.setTimeout(() => clearForkedSessionId(id), 1800);
    } finally {
      setForkingSessionId(null);
    }
  }, [loadSession, saveSessionSnapshot]);

  const suggestSessionTitle = useCallback(async (sessionId: string) => {
    const session = await sessions.loadSession(sessionId) as SessionData | null;
    if (!session) throw new Error("Session not found");

    const model = session.model ?? selectedModelRef.current;
    if (model.provider === "browser") {
      await loadBrowserModel();
    } else if (!(await getProviderApiKey(model.provider))) {
      const allowed = await promptKeatingApiKey(model.provider);
      if (!allowed) throw new Error(`No API key available for ${model.provider}`);
    }

    const apiKey = model.provider === "browser" ? undefined : await getProviderApiKey(model.provider);
    const context: Context = {
      systemPrompt: "You rename learning chat sessions. Return only a concise, specific title. No quotes. No punctuation-only titles. Maximum 7 words.",
      messages: [{
        role: "user",
        timestamp: Date.now(),
        content: `Conversation preview:\n${sessionPreview(session.messages).slice(0, 2400)}\n\nCurrent title: ${session.title}`,
      }],
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
    if (!agent || agent.state.messages.length === 0) {
      throw new Error("Send a message first — there's nothing for the model to title yet.");
    }
    await saveSessionSnapshot();
    const sessionId = sessionIdRef.current;
    const nextTitle = await suggestSessionTitle(sessionId);
    await updateSessionTitle(sessionId, nextTitle, true);
    return nextTitle;
  }, [saveSessionSnapshot, suggestSessionTitle]);

  const openSessions = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < SESSION_BROWSER_BREAKPOINT) {
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
        closeMobileSidebar();
        startTransition(async () => {
          const session = await sessions.loadSession(sessionId);
          if (session) await loadSession(session as SessionData);
        });
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
        { id: "models", label: "Models & Providers", component: <ModelsProvidersTab /> },
        { id: "learning", label: "Learning", component: <LearningTab onSpeechSettingsChange={setSpeechSettings} /> },
        { id: "app", label: "App", component: <KeatingUiSettingsTab /> },
      ]}
    />
  );

  const modelSelectorDialogElement = (
    <ModelSelectorDialog
      open={modelSelectorDialog.open}
      currentModel={agentRef.current?.state.model ?? selectedModelRef.current}
      onClose={modelSelectorDialog.onClose}
      onSelect={(model: Model<Api>) => {
        modelSelectorDialog.onClose();
        const prevModel = selectedModelRef.current;
        posthog.capture('model_changed', { from_model: `${prevModel.provider}/${prevModel.id}`, to_model: `${model.provider}/${model.id}`, session_id: sessionIdRef.current });
        startTransition(async () => {
          if (model.provider === "browser") await loadBrowserModel();
          selectedModelRef.current = model;
          const agent = agentRef.current;
          if (agent) {
            const current = agent.state;
            await createAgent(panelRef.current!, { ...current, model, messages: [...current.messages] });
          }
        });
      }}
    />
  );

  // Use a callback ref to safely initialize the agent when the DOM node resolves
  const chatPanelRef = useCallback((node: ChatPanelHandle | null) => {
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
        unsubRef.current = subscribeAgentEvents(existingAgent, node as any);
        const retryExistingResponse = async () => {
          if (existingAgent.state.isStreaming) return;
          const retryMessages = prepareMessagesForRetry(existingAgent.state.messages);
          if (!retryMessages) return;
          await ensureSessionStartContextRef.current();
          existingAgent.state.messages = retryMessages;
          await persistCurrentSnapshotRef.current();
          await existingAgent.continue();
        };
        const setupCallbacks = {
          onApiKeyRequired: async (provider: string) => {
            if (provider === "browser") return true;
            if (await getProviderApiKey(provider)) return true;
            return promptKeatingApiKey(provider);
          },
          onAuthError: async (provider: string) => {
            if (provider === "browser") return false;
            const ok = await promptKeatingApiKey(provider, { force: true });
            if (ok) void retryExistingResponse();
            return ok;
          },
          onBeforeSend: async () => {
            await ensureSessionStartContextRef.current();
            await keatingLifecycle.emit({ type: "before_turn", sessionId: sessionIdRef.current });
            if (import.meta.env.DEV) {
              console.log(`[keating:send] model=${existingAgent.state.model.provider}/${existingAgent.state.model.id} messages=${existingAgent.state.messages.length}`);
            }
            const turnIndex = existingAgent.state.messages.filter((m) => m.role === "user").length;
            posthog.capture('message_sent', { session_id: sessionIdRef.current, turn_index: turnIndex });
            if (turnIndex === 0) {
              posthog.capture('first_message_sent', { session_id: sessionIdRef.current });
            }
          },
          onLocalMessagesChanged: () => saveSessionSnapshot(existingAgent),
          onModelSelect: () => {
            posthog.capture('model_selector_opened', { session_id: sessionIdRef.current });
            modelSelectorDialog.onOpen();
          },
          onFork: (forkPoint?: number) => forkSession(sessionIdRef.current, forkPoint),
          onRetry: retryExistingResponse,
          thinkingLevel: existingAgent.state.thinkingLevel,
          onThinkingLevelChange: (level: ThinkingLevel) => {
            if (agentRef.current) {
              agentRef.current.state.thinkingLevel = level;
            }
          },
        };
        node.setAgent(existingAgent, setupCallbacks).catch(console.error);
        return;
      }

      const generation = bootstrapGenerationRef.current;
      bootstrapTimerRef.current = window.setTimeout(() => {
        if (bootstrapGenerationRef.current !== generation || panelRef.current !== node || agentRef.current) {
          return;
        }

        requestPersistentStorageOnce();

        void (async () => {
		  try {
			const requestedSessionId = new URLSearchParams(window.location.search).get("session")?.trim() || null;
			const latestSessionId = await withSessionRestoreTimeout(
				requestedSessionId
					? Promise.resolve(requestedSessionId)
					: (sessions.getAllMetadata() as Promise<SessionMetadata[]>).then((items) => items
						.filter((item) => !item.hiddenAlternative)
						.sort((left, right) => right.lastModified.localeCompare(left.lastModified))[0]?.id ?? null),
				"Restoring latest session",
			);
            if (bootstrapGenerationRef.current !== generation || panelRef.current !== node || agentRef.current) {
              return;
            }

            if (latestSessionId) {
              const session = await withSessionRestoreTimeout(sessions.loadSession(latestSessionId), "Loading latest session");
              if (bootstrapGenerationRef.current !== generation || panelRef.current !== node || agentRef.current) {
                return;
              }
			  if (session) {
				await loadSession(session);
				if (requestedSessionId) {
					const params = new URLSearchParams(window.location.search);
					params.delete("session");
					const next = params.toString();
					window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`);
				}
				return;
              }
            }

            if (bootstrapGenerationRef.current !== generation || panelRef.current !== node || agentRef.current) {
              return;
            }

            await createAgent(node);
            posthog.capture('session_started', { session_id: sessionIdRef.current, source: 'initial', is_initial: true });
          } catch (error) {
            console.warn("Could not restore the latest saved session; starting a new chat session.", error);
            if (!agentRef.current && panelRef.current === node && bootstrapGenerationRef.current === generation) {
              await createAgent(node).catch(console.error);
            }
          }
        })();
      }, 0);
    }
  }, [createAgent, loadSession, requestPersistentStorageOnce]);

  const setThinkingLevel = useCallback((level: ThinkingLevel) => {
    const agent = agentRef.current;
    if (agent) {
      agent.state.thinkingLevel = level;
    }
  }, []);

  const allDialogs = (
    <>
      {settingsDialogElement}
      {modelSelectorDialogElement}
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
