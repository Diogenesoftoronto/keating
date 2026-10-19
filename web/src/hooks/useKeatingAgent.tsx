/**
 * The browser teacher, as used by the chat page.
 *
 * Composition only; each concern lives in hooks/agent/:
 *   host-refs                  shared mutable identity (agent, panel, session)
 *   useSessionPersistence      save queue, snapshot stamps, learner bookkeeping
 *   useAgentSessionLifecycle   conversation creation, subscriptions, disposal,
 *                              and the chat panel's attach/bootstrap ref
 *   useSessionNavigation       new/open/fork/compare with save-before-switch
 *   useLiveAgentSync           live prompt and tool refresh, voice bridge
 *   useConversationRuntime     canonical event store for the active session
 *   usePersistentStorage, useSettingsDialogLinks, useLearnerSignalEvents,
 *   useAgentEnvironmentSync    page-level settings and window events
 */
import { useCallback, use, useRef, useState, useTransition } from "react";
import { usePostHog } from "@posthog/react";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { useDialogState } from "./useDialogState";
import { SessionBrowser, SESSION_BROWSER_BREAKPOINT } from "../components/SessionBrowser";
import { recordDiagnostic } from "../lib/diagnostics";
import type { TeachingAdjustmentController } from "../keating/judgement/teaching-adjustment";
import { NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";
import type { KeatingToolsOptions } from "../keating/browser-tools";
import type { KeatingAgentRuntimeConfig } from "../keating/agent-runtime";
import type {
  PendingResponseComparison,
  ResponseComparisonDecision,
} from "../keating/response-comparison";
import type { WebSpeechSettings } from "../keating/speech";
import type { SharedSessionUrlResult } from "../keating/shared-sessions";
import { loadKeatingUiSettings, saveKeatingUiSettings } from "../keating/ui-settings";
import {
  useKeatingAgentStore,
  type ForkInfo,
  type PersistentStorageStatus,
} from "../stores/keating-agent-store";
import type { ChatPanelHandle } from "../types/chat-panel";
import { DEFAULT_MODEL } from "./keating-stream";
import { getInitPromise, updateSessionTitle } from "./keating-storage";
import { renderAgentDialogs } from "./agent/agent-dialogs";
import { createToolOptions } from "./agent/agent-tools";
import { maybeGenerateAlternativeResponse as generateAlternativeResponse } from "./agent/alternative-response";
import { changeChatModel as switchChatModel } from "./agent/chat-model";
import { useAgentHostRefs } from "./agent/host-refs";
import { shareActiveSession, suggestSessionTitle as suggestTitleFor } from "./agent/session-actions";
import { useSettingsDialogLinks } from "./agent/settings-deep-link";
import { useAgentEnvironmentSync } from "./agent/useAgentEnvironmentSync";
import { useAgentSessionLifecycle, useChatPanelAttachment } from "./agent/useAgentSessionLifecycle";
import { useConversationRuntime } from "./agent/useConversationRuntime";
import { useLearnerSignalEvents } from "./agent/useLearnerSignalEvents";
import { useLiveAgentSync } from "./agent/useLiveAgentSync";
import { usePersistentStorage } from "./agent/usePersistentStorage";
import { useSessionNavigation } from "./agent/useSessionNavigation";
import { useSessionPersistence } from "./agent/useSessionPersistence";

// ─── Hook ───────────────────────────────────────────────────────────────────
export interface UseKeatingAgentReturn {
  teachingAdjustment: TeachingAdjustmentController | null;
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
  chooseKeatingModel: () => Promise<void>;
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

/** Session, fork, sidebar and speech state shared with the session browser. */
function useAgentUiStore() {
  return {
    activeSessionId: useKeatingAgentStore((state) => state.activeSessionId),
    setActiveSessionId: useKeatingAgentStore((state) => state.setActiveSessionId),
    forkingSessionId: useKeatingAgentStore((state) => state.forkingSessionId),
    setForkingSessionId: useKeatingAgentStore((state) => state.setForkingSessionId),
    forkedSessionId: useKeatingAgentStore((state) => state.forkedSessionId),
    setForkedSessionId: useKeatingAgentStore((state) => state.setForkedSessionId),
    clearForkedSessionId: useKeatingAgentStore((state) => state.clearForkedSessionId),
    forkInfo: useKeatingAgentStore((state) => state.forkInfo),
    setForkInfo: useKeatingAgentStore((state) => state.setForkInfo),
    sessionSidebarCollapsed: useKeatingAgentStore((state) => state.sessionSidebarCollapsed),
    toggleSessionSidebar: useKeatingAgentStore((state) => state.toggleSessionSidebar),
    setSidebarCollapsed: useKeatingAgentStore((state) => state.setSessionSidebarCollapsed),
    mobileSidebarOpen: useKeatingAgentStore((state) => state.mobileSidebarOpen),
    toggleMobileSidebar: useKeatingAgentStore((state) => state.toggleMobileSidebar),
    closeMobileSidebar: useKeatingAgentStore((state) => state.closeMobileSidebar),
    speechSettings: useKeatingAgentStore((state) => state.speechSettings),
    syncSpeechSettings: useKeatingAgentStore((state) => state.syncSpeechSettings),
    toggleSpeech: useKeatingAgentStore((state) => state.toggleSpeech),
  };
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
  const store = useAgentUiStore();
  const { speechSettings } = store;
  const refs = useAgentHostRefs(courseContext, speechSettings.enabled);
  const [teachingAdjustment, setTeachingAdjustment] = useState<TeachingAdjustmentController | null>(null);
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
    refs.selectedModelRef.current = model;
    setModelLabel(model.name ?? model.id);
  }, []);
  useAgentEnvironmentSync({
    refs,
    syncSpeechSettings: store.syncSpeechSettings,
    setActiveSessionId: store.setActiveSessionId,
  });
  const storage = usePersistentStorage(posthog);
  const settingsDialog = useDialogState();
  const modelSelectorDialog = useDialogState();
  const imageModelSelectorDialog = useDialogState();
  const [isPending, startTransition] = useTransition();
  const [responseComparison, setResponseComparison] =
    useState<PendingResponseComparison | null>(null);
  const { openSettings, settingsDeepLinkRef } = useSettingsDialogLinks(settingsDialog, posthog);
  useLearnerSignalEvents(refs, posthog);
  const conversationRuntime = useConversationRuntime(refs);
  const persistence = useSessionPersistence(refs);
  const { saveSessionSnapshot } = persistence;

  const applyThinkingLevel = useCallback((level: ThinkingLevel) => {
    const agent = refs.agentRef.current;
    if (agent) {
      agent.context.thinkingLevel = level;
    }

    const settings = loadKeatingUiSettings();
    if (settings.reasoningLevel !== level) {
      saveKeatingUiSettings({ ...settings, reasoningLevel: level });
    }

    void persistence.persistCurrentSnapshotRef.current();
  }, []);

  const toolOptions = useCallback(
    (settings: WebSpeechSettings, agentRuntime?: KeatingAgentRuntimeConfig) =>
      createToolOptions(refs, courseContext, settings, agentRuntime),
    [activeCourseId, courseMode],
  );

  const alternativeGenerationRef = useRef(new Set<string>());
  const maybeGenerateAlternativeResponse = useCallback(
    (agent: NonNullable<typeof refs.agentRef.current>, sourceSessionId: string) =>
      generateAlternativeResponse({
        agent,
        sourceSessionId,
        isActiveSession: () => refs.sessionIdRef.current === sourceSessionId,
        generated: alternativeGenerationRef.current,
        onComparison: setResponseComparison,
      }),
    [],
  );

  // Conversations are created before navigation exists; forks they trigger
  // go through the latest navigation.
  const forkSessionRef = useRef<(sessionId: string, forkPoint?: number) => Promise<void>>(async () => {});
  const { prepareAgent, createAgent, subscriptions } = useAgentSessionLifecycle({
    refs,
    persistence,
    posthog,
    speechSettings,
    courseContext,
    toolOptions,
    applyThinkingLevel,
    selectModel,
    conversationRuntime,
    maybeGenerateAlternativeResponse,
    setTeachingAdjustment,
    openModelSelector: modelSelectorDialog.onOpen,
    openImageModelSelector: imageModelSelectorDialog.onOpen,
    forkSessionRef,
  });
  useLiveAgentSync({ refs, speechSettings, toolOptions, courseContext });

  const navigation = useSessionNavigation({
    refs,
    persistence,
    posthog,
    prepareAgent,
    createAgent,
    startTransition,
    forkInfo: store.forkInfo,
    responseComparison,
    setResponseComparison,
    setActiveSessionId: store.setActiveSessionId,
    setForkInfo: store.setForkInfo,
    setForkingSessionId: store.setForkingSessionId,
    setForkedSessionId: store.setForkedSessionId,
    clearForkedSessionId: store.clearForkedSessionId,
  });
  const { newSession, loadSession, loadSessionById, forkSession } = navigation;
  forkSessionRef.current = forkSession;

  const shareSession = useCallback(
    () => shareActiveSession(refs, (agent) => saveSessionSnapshot(agent)),
    [saveSessionSnapshot],
  );

  const suggestSessionTitle = useCallback(
    (sessionId: string) => suggestTitleFor(sessionId, refs.selectedModelRef.current),
    [],
  );

  const generateCurrentSessionTitle = useCallback(async () => {
    const agent = refs.agentRef.current;
    if (!agent || agent.context.messages.length === 0) {
      throw new Error(
        "Send a message first — there's nothing for the model to title yet.",
      );
    }
    await saveSessionSnapshot();
    const sessionId = refs.sessionIdRef.current;
    const nextTitle = await suggestSessionTitle(sessionId);
    await updateSessionTitle(sessionId, nextTitle, true);
    return nextTitle;
  }, [saveSessionSnapshot, suggestSessionTitle]);

  const { mobileSidebarOpen, setSidebarCollapsed, toggleMobileSidebar, closeMobileSidebar } = store;
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
      activeSessionId={store.activeSessionId}
      forkingSessionId={store.forkingSessionId}
      forkedSessionId={store.forkedSessionId}
      collapsed={store.sessionSidebarCollapsed}
      onCollapsedChange={setSidebarCollapsed}
      onLoad={(sessionId: string) => {
        const request = refs.sessionSwitchRequestsRef.current.begin();
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

  const changeChatModel = useCallback(
    (model: Model<Api>) => switchChatModel({ refs, model, posthog, selectModel, createAgent }),
    [createAgent, posthog, selectModel],
  );

  const chooseKeatingModel = useCallback(
    () => changeChatModel(NOTORGANIC_DEFAULT_MODEL),
    [changeChatModel],
  );

  const chatPanelRef = useChatPanelAttachment({
    refs,
    persistence,
    posthog,
    subscriptions,
    createAgent,
    loadSession,
    forkSession,
    applyThinkingLevel,
    conversationRuntime,
    requestPersistentStorageOnce: storage.requestPersistentStorageOnce,
    openModelSelector: modelSelectorDialog.onOpen,
    openImageModelSelector: imageModelSelectorDialog.onOpen,
  });

  const setThinkingLevel = useCallback(
    (level: ThinkingLevel) => {
      applyThinkingLevel(level);
    },
    [applyThinkingLevel],
  );

  const allDialogs = renderAgentDialogs({
    settingsDialog,
    settingsDeepLinkRef,
    modelSelectorDialog,
    imageModelSelectorDialog,
    currentModel: refs.agentRef.current?.context.model ?? refs.selectedModelRef.current,
    onSelectModel: (model: Model<Api>) => {
      startTransition(() => changeChatModel(model));
    },
    imageModelRetryRef: refs.imageModelRetryRef,
    onImageRetryFailed: () => {
      posthog.capture("image_generation_retry_failed", {
        session_id: refs.sessionIdRef.current,
      });
    },
  });

  return {
    teachingAdjustment,
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
    chooseKeatingModel,
    openSessions,
    newSession,
    shareSession,
    setThinkingLevel,
    generateCurrentSessionTitle,
    // Speech
    speechEnabled: speechSettings.enabled,
    toggleSpeech: store.toggleSpeech,
    // Persistent storage
    persistentStorageStatus: storage.persistentStorageStatus,
    persistentBannerDismissed: storage.persistentBannerDismissed,
    retryPersistentStorage: storage.retryPersistentStorage,
    dismissPersistentBanner: storage.dismissPersistentBanner,
    // Session & fork state
    activeSessionId: store.activeSessionId,
    forkingSessionId: store.forkingSessionId,
    forkInfo: store.forkInfo,
    openOriginalSession: navigation.openOriginalSession,
    // Sidebar layout
    sessionSidebarCollapsed: store.sessionSidebarCollapsed,
    toggleSessionSidebar: store.toggleSessionSidebar,
    mobileSidebarOpen,
    toggleMobileSidebar,
    closeMobileSidebar,
    responseComparison,
    chooseResponse: navigation.chooseResponse,
  };
}
