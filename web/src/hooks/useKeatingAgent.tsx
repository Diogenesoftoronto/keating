import { createElement, useRef, useState, useTransition, useCallback, use, useEffect } from "react";
import type { JSX } from "react";
import { Agent, type AgentState, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import {
  type Model,
  type Api,
  type Context,
} from "@mariozechner/pi-ai";
import {
  ApiKeyPromptDialog,
  PersistentStorageDialog,
  defaultConvertToLlm,
} from "@mariozechner/pi-web-ui";
import { SessionManagerDialog } from "../components/SessionManagerDialogReact";
import { SettingsDialog } from "../components/SettingsDialog";
import { KeatingUiSettingsTabReact } from "../components/KeatingUiSettingsTabReact";
import { ProvidersModelsTabReact } from "../components/ProvidersModelsTabReact";
import { ProxyTabReact } from "../components/ProxyTabReact";
import { ModelSelectorDialog } from "../components/ModelSelectorReact";
import { getProviderApiKey } from "../lib/provider-models";
import { localModel } from "../stores/local-model";
import { buildKeatingSystemPrompt, createKeatingTools } from "../keating/browser-tools";
import { loadWebSpeechSettings, primeSpeechAudio, saveWebSpeechSettings, type WebSpeechSettings } from "../keating/speech";
import { subscribeAgentEvents } from "./agent-subscriptions";
import { DEFAULT_MODEL, hybridStreamFn } from "./keating-stream";
import { getInitPromise, keatingStorage, sessions } from "./keating-storage";
import { createSessionId, sessionPreview, sessionTitle, sessionUsage } from "./session-metadata";
import { saveSharedSession, sharedSessionUrl } from "../keating/shared-sessions";
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

// ─── Hook ───────────────────────────────────────────────────────────────────
export interface UseKeatingAgentReturn {
  title: string;
  isPending: boolean;
  openSettings: () => void;
  openSessions: () => void;
  newSession: () => void;
  shareSession: () => Promise<string>;
  chatPanelRef: (node: ChatPanelHandle | null) => void;
  dialogs: React.ReactNode;
  speechEnabled: boolean;
  toggleSpeech: () => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
}

export function useKeatingAgent(): UseKeatingAgentReturn {
  // Use React 19's use() for suspense handling of asynchronous init
  use(getInitPromise());

  const [title] = useState("Keating");
  const agentRef = useRef<Agent | null>(null);
  const panelRef = useRef<ChatPanelHandle | null>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const selectedModelRef = useRef<Model<Api>>(DEFAULT_MODEL);
  const [speechSettings, setSpeechSettings] = useState<WebSpeechSettings>(() => loadWebSpeechSettings());
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const bootstrapTimerRef = useRef<number | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const persistentStorageRequestedRef = useRef(false);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
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

  const toolOptions = useCallback((settings: WebSpeechSettings) => ({
    speech: {
      settings,
      getGoogleApiKey: () => getProviderApiKey("google"),
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
      model: agent.state.model,
      thinkingLevel: agent.state.thinkingLevel,
      messages,
      createdAt,
      lastModified: now,
    };

    await sessions.save(data, metadata);
  }, []);

  const createAgent = useCallback(async (panel: ChatPanelHandle, initialState?: Partial<AgentState>) => {
    const agentSessionId = sessionIdRef.current;
    const agentCreatedAt = sessionCreatedAtRef.current;
    const tools = await createKeatingTools(keatingStorage, toolOptions(speechSettings));
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
        return ApiKeyPromptDialog.prompt(provider);
      },
      onAuthError: async (provider: string) => {
        if (provider === "browser") return false;
        return ApiKeyPromptDialog.prompt(provider);
      },
      onBeforeSend: () => {
        if (import.meta.env.DEV) {
          console.log(`[keating:send] model=${agent.state.model.provider}/${agent.state.model.id} messages=${agent.state.messages.length}`);
        }
      },
      onModelSelect: () => {
        setModelSelectorOpen(true);
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

  const requestPersistentStorageOnce = useCallback(() => {
    if (persistentStorageRequestedRef.current) return;
    persistentStorageRequestedRef.current = true;
    void PersistentStorageDialog.request().catch((error) => {
      console.warn("Persistent storage request failed:", error);
    });
  }, []);

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
      await createAgent(panel, { messages: [], model: selectedModelRef.current });
    });
  }, [createAgent, endLearnerSession, saveSessionSnapshot]);

  const shareSession = useCallback(async () => {
    const agent = agentRef.current;
    if (!agent) throw new Error("No active session to share");
    await saveSessionSnapshot(agent);
    const shared = saveSharedSession([...agent.state.messages], sessionCreatedAtRef.current);
    const url = sharedSessionUrl(shared, window.location.origin);
    await navigator.clipboard?.writeText(url).catch((error) => {
      console.warn("Failed to copy share link:", error);
    });
    return url;
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
      messages,
      createdAt: now,
      lastModified: now,
    };

    await saveSessionSnapshot();
    await sessions.save(data, metadata);
    if (panel) await loadSession(data);
  }, [loadSession, saveSessionSnapshot]);

  const suggestSessionTitle = useCallback(async (sessionId: string) => {
    const session = await sessions.loadSession(sessionId) as SessionData | null;
    if (!session) throw new Error("Session not found");

    const model = session.model ?? selectedModelRef.current;
    if (model.provider === "browser") {
      await loadBrowserModel();
    } else if (!(await getProviderApiKey(model.provider))) {
      const allowed = await ApiKeyPromptDialog.prompt(model.provider);
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

  const openSessions = useCallback(() => {
    setSessionsOpen(true);
  }, []);

  const sessionManagerDialog = createElement(SessionManagerDialog, {
    open: sessionsOpen,
    onClose: () => setSessionsOpen(false),
    onFork: forkSession,
    onSuggestTitle: suggestSessionTitle,
    onLoad: (sessionId: string) => {
      startTransition(async () => {
        const session = await sessions.loadSession(sessionId);
        if (session) await loadSession(session as SessionData);
      });
    },
  });

  const settingsDialog = createElement(SettingsDialog, {
    open: settingsOpen,
    onClose: () => setSettingsOpen(false),
    tabs: [
      { id: "providers", label: "Providers & Models", component: createElement(ProvidersModelsTabReact, {}) },
      { id: "interface", label: "Interface", component: createElement(KeatingUiSettingsTabReact, {}) },
      { id: "proxy", label: "Proxy", component: createElement(ProxyTabReact, {}) },
    ],
  });

  const modelSelectorDialog = createElement(ModelSelectorDialog, {
    open: modelSelectorOpen,
    currentModel: agentRef.current?.state.model ?? selectedModelRef.current,
    onClose: () => setModelSelectorOpen(false),
    onSelect: (model: Model<Api>) => {
      setModelSelectorOpen(false);
      startTransition(async () => {
        if (model.provider === "browser") await loadBrowserModel();
        selectedModelRef.current = model;
        const agent = agentRef.current;
        if (agent) {
          const current = agent.state;
          await createAgent(panelRef.current!, { ...current, model, messages: [...current.messages] });
        }
      });
    },
  });

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
            return ApiKeyPromptDialog.prompt(provider);
          },
          onAuthError: async (provider: string) => {
            if (provider === "browser") return false;
            return ApiKeyPromptDialog.prompt(provider);
          },
          onBeforeSend: () => {
            if (import.meta.env.DEV) {
              console.log(`[keating:send] model=${existingAgent.state.model.provider}/${existingAgent.state.model.id} messages=${existingAgent.state.messages.length}`);
            }
          },
          onModelSelect: () => {
            setModelSelectorOpen(true);
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
            const latestSessionId = await sessions.getLatestSessionId();
            if (bootstrapGenerationRef.current !== generation || panelRef.current !== node || agentRef.current) {
              return;
            }

            if (latestSessionId) {
              const session = await sessions.loadSession(latestSessionId);
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
            console.error(error);
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
      {sessionManagerDialog}
      {settingsDialog}
      {modelSelectorDialog}
    </>
  );

  return { title, isPending, openSettings, openSessions, newSession, shareSession, chatPanelRef, dialogs: allDialogs, speechEnabled: speechSettings.enabled, toggleSpeech, setThinkingLevel };
}
