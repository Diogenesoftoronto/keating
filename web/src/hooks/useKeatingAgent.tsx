import { useRef, useState, useTransition, useCallback, use, useEffect } from "react";
import { Agent, type AgentState, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { useDialogState } from "./useDialogState";
import {
  type Model,
  type Api,
  type Context,
} from "@earendil-works/pi-ai";
import {
  PersistentStorageDialog,
  defaultConvertToLlm,
} from "@earendil-works/pi-web-ui";
import { SessionManagerDialog } from "../components/SessionManagerDialog";
import { SettingsDialog } from "../components/SettingsDialog";
import { KeatingUiSettingsTab } from "../components/KeatingUiSettingsTab";
import { ProvidersModelsTab } from "../components/ProvidersModelsTab";
import { ProxyTab } from "../components/ProxyTab";
import { SpeechSettingsTab } from "../components/SpeechSettingsTab";
import { SessionSidebar } from "../components/SessionSidebar";
import { ModelSelectorDialog } from "../components/ModelSelector";
import { KeatingApiKeyPromptDialog, promptKeatingApiKey } from "../components/KeatingApiKeyPromptDialog";
import { getProviderApiKey } from "../lib/provider-models";
import { localModel } from "../stores/local-model";
import { buildKeatingSystemPrompt, createKeatingTools } from "../keating/browser-tools";
import { registerKeatingWebMcp } from "../keating/webmcp";
import { loadWebSpeechSettings, primeSpeechAudio, saveWebSpeechSettings, type WebSpeechSettings } from "../keating/speech";
import { subscribeAgentEvents } from "./agent-subscriptions";
import { DEFAULT_MODEL, hybridStreamFn } from "./keating-stream";
import { getInitPromise, keatingStorage, sessions } from "./keating-storage";
import { createSessionId, sessionPreview, sessionTitle, sessionUsage } from "./session-metadata";
import { saveSharedSession, sharedSessionUrl, type SharedSessionUrlResult } from "../keating/shared-sessions";
import { loadKeatingUiSettings } from "../keating/ui-settings";
import type { ChatPanelHandle } from "../types/chat-panel";
import type { SessionData, SessionMetadata } from "../types/session";

function cloneMessages(messages: SessionData["messages"]): SessionData["messages"] {
  return structuredClone(messages);
}

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
const PERSISTENT_STORAGE_STATUS_KEY = "keating:persistent-storage-status";
const SESSION_SIDEBAR_COLLAPSED_KEY = "keating:session-sidebar-collapsed";

function readSessionSidebarCollapsed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(SESSION_SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSessionSidebarCollapsed(collapsed: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SESSION_SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore storage failures
  }
}

type PersistentStorageStatus = "unknown" | "granted" | "declined";

function getPersistentStorageStatus(): PersistentStorageStatus {
  if (typeof localStorage === "undefined") return "unknown";
  try {
    const value = localStorage.getItem(PERSISTENT_STORAGE_STATUS_KEY);
    if (value === "granted" || value === "declined") return value;
    return "unknown";
  } catch {
    return "unknown";
  }
}

function savePersistentStorageStatus(status: Exclude<PersistentStorageStatus, "unknown">): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PERSISTENT_STORAGE_STATUS_KEY, status);
  } catch {
    // Ignore storage failures; the in-memory ref still suppresses repeats this mount.
  }
}

async function browserPersistentStorageGranted(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
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
  openSettings: () => void;
  openSessions: () => void;
  newSession: () => void;
  shareSession: () => Promise<SharedSessionUrlResult>;
  chatPanelRef: (node: ChatPanelHandle | null) => void;
  dialogs: React.ReactNode;
  speechEnabled: boolean;
  persistentStorageStatus: PersistentStorageStatus;
  toggleSpeech: () => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
  generateCurrentSessionTitle: () => Promise<string>;
  sessionSidebar: React.ReactNode;
  activeSessionId: string;
  forkingSessionId: string | null;
  sessionSidebarCollapsed: boolean;
  toggleSessionSidebar: () => void;
}

export function useKeatingAgent(): UseKeatingAgentReturn {
  // Use React 19's use() for suspense handling of asynchronous init
  use(getInitPromise());

  const [title] = useState("Keating");
  const agentRef = useRef<Agent | null>(null);
  const panelRef = useRef<ChatPanelHandle | null>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const sessionParentIdRef = useRef<string | null>(null);
  const sessionForkedAtRef = useRef<string | undefined>(undefined);
  const selectedModelRef = useRef<Model<Api>>(DEFAULT_MODEL);
  const [activeSessionId, setActiveSessionId] = useState(() => sessionIdRef.current);
  const [forkingSessionId, setForkingSessionId] = useState<string | null>(null);
  const [forkedSessionId, setForkedSessionId] = useState<string | null>(null);
  const [sessionSidebarCollapsed, setSessionSidebarCollapsed] = useState<boolean>(
    () => readSessionSidebarCollapsed(),
  );
  const toggleSessionSidebar = useCallback(() => {
    setSessionSidebarCollapsed((current) => {
      const next = !current;
      writeSessionSidebarCollapsed(next);
      return next;
    });
  }, []);
  const setSidebarCollapsed = useCallback((next: boolean) => {
    setSessionSidebarCollapsed(next);
    writeSessionSidebarCollapsed(next);
  }, []);
  const [speechSettings, setSpeechSettings] = useState<WebSpeechSettings>(() => loadWebSpeechSettings());
  const [persistentStorageStatus, setPersistentStorageStatus] = useState<PersistentStorageStatus>(() => getPersistentStorageStatus());
  const [persistentStorageChecked, setPersistentStorageChecked] = useState(false);
  const sessionsDialog = useDialogState();
  const settingsDialog = useDialogState();
  const modelSelectorDialog = useDialogState();
  const [isPending, startTransition] = useTransition();
  const bootstrapTimerRef = useRef<number | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const persistentStorageRequestedRef = useRef(false);

  const openSettings = useCallback(() => {
    settingsDialog.onOpen();
  }, [settingsDialog]);

  async function loadBrowserModel() {
    const state = localModel.getState();
    if (!state.loaded && !state.loading) await localModel.load();
    if (!localModel.getState().loaded) {
      throw new Error(localModel.getState().error ?? "Failed to load browser model");
    }
  }

  const unsubRef = useRef<(() => void) | null>(null);
  const persistUnsubRef = useRef<(() => void) | null>(null);

  const toolOptions = useCallback((settings: WebSpeechSettings) => ({
    speech: {
      settings,
      getApiKey: (provider: string) => getProviderApiKey(provider),
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
    };

    await sessions.save(data, metadata);
    window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
  }, []);

  const createAgent = useCallback(async (panel: ChatPanelHandle, initialState?: Partial<AgentState>) => {
    const agentSessionId = sessionIdRef.current;
    const agentCreatedAt = sessionCreatedAtRef.current;
    const tools = await createKeatingTools(keatingStorage, toolOptions(speechSettings));
    registerKeatingWebMcp(keatingStorage, tools).catch(console.warn);
    const nextState: Partial<AgentState> = {
      systemPrompt: buildKeatingSystemPrompt(speechSettings.enabled),
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

    if (unsubRef.current) unsubRef.current();
    unsubRef.current = subscribeAgentEvents(agent, panel as any);
    if (persistUnsubRef.current) persistUnsubRef.current();
    persistUnsubRef.current = agent.subscribe((ev) => {
      if (ev.type === "tool_execution_end" && !ev.isError && ARTIFACT_TOOL_NAMES.has(ev.toolName)) {
        window.dispatchEvent(new CustomEvent("keating:artifact-created", { detail: { toolName: ev.toolName, result: ev.result } }));
      }
      if (ev.type === "agent_end") {
        agent.waitForIdle().then(() => saveSessionSnapshot(agent, agentSessionId, agentCreatedAt)).catch(console.error);
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
      onModelSelect: () => {
        modelSelectorDialog.onOpen();
      },
      onFork: () => forkSession(agentSessionId),
      thinkingLevel: agent.state.thinkingLevel,
      onThinkingLevelChange: (level: ThinkingLevel) => {
        if (agentRef.current) {
          agentRef.current.state.thinkingLevel = level;
        }
      },
    };

    await panel.setAgent(agent, setupCallbacks);
  }, [saveSessionSnapshot, speechSettings, toolOptions]);

  useEffect(() => {
    const agent = agentRef.current;
    if (!agent) return;

    let cancelled = false;
    createKeatingTools(keatingStorage, toolOptions(speechSettings))
      .then((tools) => {
        if (cancelled) return;
        agent.state.tools = tools;
        agent.state.systemPrompt = buildKeatingSystemPrompt(speechSettings.enabled);
        registerKeatingWebMcp(keatingStorage, tools).catch(console.warn);
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [speechSettings, toolOptions]);

  const toggleSpeech = useCallback(() => {
    setSpeechSettings((current) => {
      const next = { ...current, enabled: !current.enabled };
      saveWebSpeechSettings(next);
      if (next.enabled) primeSpeechAudio().catch(console.warn);
      return next;
    });
  }, []);

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
    if (persistentStorageRequestedRef.current || persistentStorageStatus !== "unknown") return;
    persistentStorageRequestedRef.current = true;
    void PersistentStorageDialog.request()
      .then(async (granted) => {
        const nextStatus: PersistentStorageStatus =
          granted || (await browserPersistentStorageGranted()) ? "granted" : "declined";
        setPersistentStorageStatus(nextStatus);
        savePersistentStorageStatus(nextStatus as Exclude<PersistentStorageStatus, "unknown">);
      })
      .catch((error) => {
        setPersistentStorageStatus("declined");
        savePersistentStorageStatus("declined");
        console.warn("Persistent storage request failed:", error);
      });
  }, [persistentStorageStatus]);

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
      sessionCreatedAtRef.current = new Date().toISOString();
      sessionParentIdRef.current = null;
      sessionForkedAtRef.current = undefined;
      setActiveSessionId(sessionIdRef.current);
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
    sessionCreatedAtRef.current = session.createdAt;
    sessionParentIdRef.current = session.parentSessionId ?? null;
    sessionForkedAtRef.current = session.forkedAt;
    setActiveSessionId(session.id);
    selectedModelRef.current = session.model;
    await createAgent(panel, {
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      messages: session.messages,
    });
  }, [createAgent, endLearnerSession, saveSessionSnapshot]);

  const forkSession = useCallback(async (sessionId: string) => {
    const source = await sessions.loadSession(sessionId) as SessionData | null;
    if (!source) throw new Error("Session not found");

    const panel = panelRef.current;
    const now = new Date().toISOString();
    const messages = cloneMessages(source.messages);
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
    };

    setForkingSessionId(sessionId);
    setForkedSessionId(null);
    window.dispatchEvent(new CustomEvent("keating:session-fork-start", { detail: { sourceId: sessionId } }));
    try {
      await saveSessionSnapshot();
      await sessions.save(data, metadata);
      window.dispatchEvent(new CustomEvent("keating:sessions-changed", { detail: { sessionId: id, parentSessionId: source.id } }));
      if (panel) await loadSession(data);
      setForkedSessionId(id);
      window.dispatchEvent(new CustomEvent("keating:session-fork-end", { detail: { sourceId: sessionId, sessionId: id } }));
      window.setTimeout(() => setForkedSessionId((current) => current === id ? null : current), 1800);
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
    await sessions.updateTitle(sessionId, nextTitle);
    window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
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
        startTransition(async () => {
          const session = await sessions.loadSession(sessionId);
          if (session) await loadSession(session as SessionData);
        });
      }}
      onFork={forkSession}
      onOpenSessions={sessionsDialog.onOpen}
    />
  );

  const settingsDialogElement = (
    <SettingsDialog
      open={settingsDialog.open}
      onClose={settingsDialog.onClose}
      tabs={[
        { id: "providers", label: "Providers & Models", component: <ProvidersModelsTab /> },
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
          onModelSelect: () => {
            modelSelectorDialog.onOpen();
          },
          onFork: () => forkSession(sessionIdRef.current),
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

  return { title, isPending, openSettings, openSessions, newSession, shareSession, chatPanelRef, dialogs: allDialogs, speechEnabled: speechSettings.enabled, persistentStorageStatus: visiblePersistentStorageStatus, toggleSpeech, setThinkingLevel, generateCurrentSessionTitle, sessionSidebar: sessionSidebarElement, activeSessionId, forkingSessionId, sessionSidebarCollapsed, toggleSessionSidebar };
}
