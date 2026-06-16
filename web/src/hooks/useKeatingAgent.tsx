import { useRef, useTransition, useCallback, use, useEffect } from "react";
import { Agent, type AgentMessage, type AgentState, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { useDialogState } from "./useDialogState";
import {
  type Model,
  type Api,
  type Context,
} from "@earendil-works/pi-ai";
import { defaultConvertToLlm } from "@earendil-works/pi-web-ui";
import { SessionManagerDialog } from "../components/SessionManagerDialog";
import { SettingsDialog } from "../components/SettingsDialog";
import { KeatingUiSettingsTab } from "../components/KeatingUiSettingsTab";
import { TeacherPersonaTab } from "../components/TeacherPersonaTab";
import { ProvidersModelsTab } from "../components/ProvidersModelsTab";
import { ProxyTab } from "../components/ProxyTab";
import { SpeechSettingsTab } from "../components/SpeechSettingsTab";
import { SessionSidebar } from "../components/SessionSidebar";
import { ModelSelectorDialog } from "../components/ModelSelector";
import { KeatingApiKeyPromptDialog, promptKeatingApiKey } from "../components/KeatingApiKeyPromptDialog";
import { getProviderApiKey } from "../lib/provider-models";
import { localModel } from "../stores/local-model";
import { buildKeatingSystemPrompt, composeKeatingSystemPrompt, createKeatingTools, getActiveKeatingPrompt } from "../keating/browser-tools";
import { loadAgentRuntimeConfig, type KeatingAgentRuntimeConfig } from "../keating/agent-runtime";
import { isDefaultPersona, loadPersona, subscribePersona } from "../keating/persona";
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
import { cloneMessages, createSessionId, sessionPreview, sessionTitle, sessionUsage, truncateAtForkPoint } from "./session-metadata";
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

function cleanSuggestedTitle(text: string) {
  return text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^title:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const ARTIFACT_TOOL_NAMES = new Set([
  "plan",
  "map",
  "animate",
  "verify",
  "quiz",
  "bench",
  "evolve",
  "auto_improve",
  "prompt_evolve",
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
}

export function useKeatingAgent(): UseKeatingAgentReturn {
  // Use React 19's use() for suspense handling of asynchronous init
  use(getInitPromise());

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
  const setSpeechSettings = useKeatingAgentStore((state) => state.setSpeechSettings);
  const toggleSpeech = useKeatingAgentStore((state) => state.toggleSpeech);
  const persistentStorageStatus = useKeatingAgentStore((state) => state.persistentStorageStatus);
  const setPersistentStorageStatus = useKeatingAgentStore((state) => state.setPersistentStorageStatus);
  const persistentStorageChecked = useKeatingAgentStore((state) => state.persistentStorageChecked);
  const setPersistentStorageChecked = useKeatingAgentStore((state) => state.setPersistentStorageChecked);
  const persistentBannerDismissed = useKeatingAgentStore((state) => state.persistentBannerDismissed);
  const dismissPersistentBanner = useKeatingAgentStore((state) => state.dismissPersistentBanner);
  const sessionsDialog = useDialogState();
  const settingsDialog = useDialogState();
  const modelSelectorDialog = useDialogState();
  const [isPending, startTransition] = useTransition();
  const bootstrapTimerRef = useRef<number | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const persistentStorageRequestedRef = useRef(false);
  const systemPromptBaseRef = useRef<string>("");
  const alternativeGenerationRef = useRef(new Set<string>());

  const openSettings = useCallback(() => {
    settingsDialog.onOpen();
  }, [settingsDialog]);

  useEffect(() => {
    setActiveSessionId(sessionIdRef.current);
    keatingStorage.setCurrentSessionId(sessionIdRef.current);
  }, [setActiveSessionId]);

  useEffect(() => {
    const onMessageFeedback = async (event: Event) => {
      const detail = (event as CustomEvent<{ type?: unknown; comment?: unknown; messageId?: unknown }>).detail;
      const signal = detail?.type === "up"
        ? "thumbs-up"
        : detail?.type === "down"
          ? "thumbs-down"
          : null;
      if (!signal) return;
      const state = await keatingStorage.getLearnerState();
      const topic = state.topicsExplored.at(-1) ?? "general";
      await keatingStorage.recordFeedback(topic, signal, {
        source: "explicit",
        evidence: typeof detail.comment === "string" && detail.comment.trim() ? detail.comment : undefined,
        messageId: typeof detail.messageId === "string" ? detail.messageId : undefined,
        sessionId: sessionIdRef.current,
      });
    };
    window.addEventListener("keating:message-feedback", onMessageFeedback);
    return () => window.removeEventListener("keating:message-feedback", onMessageFeedback);
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

  const toolOptions = useCallback((settings: WebSpeechSettings, agentRuntime?: KeatingAgentRuntimeConfig) => ({
    agentRuntime,
    speech: {
      settings,
      getApiKey: (provider: string) => getProviderApiKey(provider),
    },
    setSystemPrompt: (basePrompt: string) => {
      systemPromptBaseRef.current = basePrompt;
      if (agentRef.current) {
        agentRef.current.state.systemPrompt = buildKeatingSystemPrompt(settings.enabled, basePrompt);
      }
    },
  }), []);

  const saveSessionSnapshot = useCallback(async (
    agent: Agent | null = agentRef.current,
    sessionId = sessionIdRef.current,
    createdAt = sessionCreatedAtRef.current,
  ) => {
    if (!agent || agent.state.messages.length === 0) return;

    const now = new Date().toISOString();
    const messages = [...agent.state.messages];
    const title = sessionTitle(messages);
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
      preview: sessionPreview(messages),
      aiGeneratedTitle: false,
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
      aiGeneratedTitle: false,
    };

    await sessions.save(data, metadata);
    await keatingStorage.recordLearnerTurnFeedback(messages as Array<{ role?: unknown; content?: unknown }>);
    window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
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
      const alternative = await stream.result() as AgentMessage;
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
        preview: sessionPreview(messages),
        aiGeneratedTitle: false,
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
      };
      await sessions.save(data, metadata);
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
      initialState?.systemPrompt ??
      (isDefaultPersona(persona)
        ? await getActiveKeatingPrompt(keatingStorage)
        : composeKeatingSystemPrompt(persona));
    systemPromptBaseRef.current = promptBase;
    const agentRuntime = await loadAgentRuntimeConfig();
    const tools = await createKeatingTools(keatingStorage, toolOptions(speechSettings, agentRuntime));
    registerKeatingWebMcp(keatingStorage, tools).catch(console.warn);
    const nextState: Partial<AgentState> = {
      systemPrompt: buildKeatingSystemPrompt(speechSettings.enabled, promptBase),
      model: initialState?.model ?? selectedModelRef.current,
      thinkingLevel: initialState?.thinkingLevel ?? loadKeatingUiSettings().reasoningLevel,
      messages: [],
      tools,
      ...initialState,
    };

    const agent = new Agent({
      initialState: nextState,
      convertToLlm: defaultConvertToLlm,
      streamFn: hybridStreamFn,
      sessionId: agentSessionId,
    });
    agent.getApiKey = (provider: string) => getProviderApiKey(provider);
    agentRef.current = agent;

    // Boot NodePod lazily in the background; update tools when ready
    bootNodePod()
      .then((pod) => {
        if (!pod || !agentRef.current) return;
        return loadAgentRuntimeConfig(true)
          .then((runtime) => createKeatingTools(keatingStorage, toolOptions(speechSettings, runtime)))
          .then((tools) => {
            if (!agentRef.current) return;
            agentRef.current.state.tools = tools;
            registerKeatingWebMcp(keatingStorage, tools).catch(console.warn);
          });
      })
      .catch(console.warn);

    if (unsubRef.current) unsubRef.current();
    unsubRef.current = subscribeAgentEvents(agent, panel as any);
    if (persistUnsubRef.current) persistUnsubRef.current();
    persistUnsubRef.current = agent.subscribe((ev) => {
      if (ev.type === "tool_execution_end" && !ev.isError && ARTIFACT_TOOL_NAMES.has(ev.toolName)) {
        window.dispatchEvent(new CustomEvent("keating:artifact-created", { detail: { toolName: ev.toolName, result: ev.result } }));
      }
      if (ev.type === "agent_end") {
        agent.waitForIdle()
          .then(() => saveSessionSnapshot(agent, agentSessionId, agentCreatedAt))
          .then(() => maybeGenerateAlternativeResponse(agent, agentSessionId))
          .catch(console.error);
      }
    });

    const setupCallbacks = {
      onApiKeyRequired: async (provider: string) => {
        if (provider === "browser") return true;
        if (await getProviderApiKey(provider)) return true;
        return promptKeatingApiKey(provider);
      },
      onAuthError: async (provider: string) => {
        if (provider === "browser") return false;
        return promptKeatingApiKey(provider);
      },
      onBeforeSend: () => {
        if (import.meta.env.DEV) {
          console.log(`[keating:send] model=${agent.state.model.provider}/${agent.state.model.id} messages=${agent.state.messages.length}`);
        }
      },
      onLocalMessagesChanged: () => saveSessionSnapshot(agent, agentSessionId, agentCreatedAt),
      onModelSelect: () => {
        modelSelectorDialog.onOpen();
      },
      onFork: (forkPoint?: number) => forkSession(agentSessionId, forkPoint),
      thinkingLevel: agent.state.thinkingLevel,
      onThinkingLevelChange: (level: ThinkingLevel) => {
        if (agentRef.current) {
          agentRef.current.state.thinkingLevel = level;
        }
      },
    };

    await panel.setAgent(agent, setupCallbacks);
  }, [maybeGenerateAlternativeResponse, saveSessionSnapshot, speechSettings, toolOptions]);

  useEffect(() => {
    const agent = agentRef.current;
    if (!agent) return;

    let cancelled = false;
    loadAgentRuntimeConfig()
      .then((agentRuntime) => createKeatingTools(keatingStorage, toolOptions(speechSettings, agentRuntime)))
      .then((tools) => {
        if (cancelled) return;
        agent.state.tools = tools;
        agent.state.systemPrompt = buildKeatingSystemPrompt(speechSettings.enabled, systemPromptBaseRef.current);
        registerKeatingWebMcp(keatingStorage, tools).catch(console.warn);
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
        agentRef.current.state.systemPrompt = buildKeatingSystemPrompt(
          speechSettings.enabled,
          base,
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
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        setPersistentStorageChecked(true);
        console.warn("Persistent storage request failed:", error);
      });
  }, [persistentBannerDismissed, persistentStorageStatus, setPersistentStorageChecked, setPersistentStorageStatus]);

  const retryPersistentStorage = useCallback(() => {
    persistentStorageRequestedRef.current = false;
    void requestBrowserPersistentStorage()
      .then((nextStatus) => {
        setPersistentStorageStatus(nextStatus);
        savePersistentStorageStatus(nextStatus as Exclude<PersistentStorageStatus, "unknown">);
        setPersistentStorageChecked(true);
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        setPersistentStorageChecked(true);
        console.warn("Persistent storage retry failed:", error);
      })
      // If the browser silently denies persistence, stop nagging for this
      // session instead of leaving a banner the user cannot resolve.
      .finally(() => dismissPersistentBanner());
  }, [dismissPersistentBanner, setPersistentStorageChecked, setPersistentStorageStatus]);

  const endLearnerSession = useCallback(async () => {
    try {
      await keatingStorage.recordSessionEnd([]);
    } catch (error) {
      console.warn("Failed to record session end:", error);
    }
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
      await createAgent(panel, { messages: [], model: selectedModelRef.current });
    });
  }, [createAgent, endLearnerSession, saveSessionSnapshot]);

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
    await createAgent(panel, {
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      messages: session.messages,
    });
  }, [createAgent, endLearnerSession, saveSessionSnapshot]);

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
      preview: sessionPreview(messages),
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
    sessionsDialog.onOpen();
  }, [sessionsDialog]);

  const sessionManagerDialogElement = (
    <SessionManagerDialog
      open={sessionsDialog.open}
      onClose={sessionsDialog.onClose}
      onFork={forkSession}
      onSuggestTitle={suggestSessionTitle}
      onDeleted={() => {
        window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
      }}
      onRenamed={() => {
        window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
      }}
      onLoad={(sessionId: string) => {
        startTransition(async () => {
          const session = await sessions.loadSession(sessionId);
          if (session) await loadSession(session as SessionData);
        });
      }}
    />
  );

  const sessionSidebarElement = (
    <SessionSidebar
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
      onOpenSessions={sessionsDialog.onOpen}
      mobileOpen={mobileSidebarOpen}
      onMobileClose={closeMobileSidebar}
      onNewSession={newSession}
    />
  );

  const settingsDialogElement = (
    <SettingsDialog
      open={settingsDialog.open}
      onClose={settingsDialog.onClose}
      tabs={[
        { id: "providers", label: "Providers & Models", component: <ProvidersModelsTab /> },
        { id: "persona", label: "Teacher Persona", component: <TeacherPersonaTab /> },
        { id: "speech", label: "Speech & Voice", component: <SpeechSettingsTab onSettingsChange={setSpeechSettings} /> },
        { id: "interface", label: "Interface", component: <KeatingUiSettingsTab /> },
        { id: "proxy", label: "Proxy", component: <ProxyTab /> },
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
        const setupCallbacks = {
          onApiKeyRequired: async (provider: string) => {
            if (provider === "browser") return true;
            if (await getProviderApiKey(provider)) return true;
            return promptKeatingApiKey(provider);
          },
          onAuthError: async (provider: string) => {
            if (provider === "browser") return false;
            return promptKeatingApiKey(provider);
          },
          onBeforeSend: () => {
            if (import.meta.env.DEV) {
              console.log(`[keating:send] model=${existingAgent.state.model.provider}/${existingAgent.state.model.id} messages=${existingAgent.state.messages.length}`);
            }
          },
          onLocalMessagesChanged: () => saveSessionSnapshot(existingAgent),
          onModelSelect: () => {
            modelSelectorDialog.onOpen();
          },
          onFork: (forkPoint?: number) => forkSession(sessionIdRef.current, forkPoint),
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
            const latestSessionId = await withSessionRestoreTimeout(sessions.getLatestSessionId(), "Restoring latest session");
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
                return;
              }
            }

            if (bootstrapGenerationRef.current !== generation || panelRef.current !== node || agentRef.current) {
              return;
            }

            await createAgent(node);
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
      {sessionManagerDialogElement}
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
  };
}
