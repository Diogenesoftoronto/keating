import { useRef, useState, useTransition, useCallback, use, useEffect } from "react";
import { Agent } from "@mariozechner/pi-agent-core";
import {
  getModel,
  streamSimple,
  type Context,
  type AssistantMessage,
  createAssistantMessageEventStream,
  type SimpleStreamOptions,
  type Model,
  type Api,
} from "@mariozechner/pi-ai";
import {
  type AgentState,
  type AgentMessage,
  ApiKeyPromptDialog,
  AppStorage,
  ChatPanel,
  CustomProvidersStore,
  IndexedDBStorageBackend,
  PersistentStorageDialog,
  ProviderKeysStore,
  SessionsStore,
  SettingsDialog,
  SettingsStore,
  type SessionData,
  type SessionMetadata,
  setAppStorage,
  defaultConvertToLlm,
  ProxyTab,
} from "@mariozechner/pi-web-ui";
import { KeatingProvidersModelsTab } from "../components/providers-models-tab";
import { KeatingModelSelector } from "../components/model-selector";
import { SessionManagerDialog } from "../components/SessionManagerDialog";
import { getProviderApiKey, syncCustomProviderKeys } from "../lib/provider-models";
import { chatProxyBaseUrl, proxyTargetHeader, shouldProxyModel } from "../lib/provider-proxy";
import { localModel } from "../stores/local-model";
import { buildKeatingSystemPrompt, createKeatingTools } from "../keating/browser-tools";
import { loadWebSpeechSettings, primeSpeechAudio, saveWebSpeechSettings, type WebSpeechSettings } from "../keating/speech";
import { KeatingStorage } from "../keating/storage";
import { subscribeAgentEvents } from "./agent-subscriptions";

// ─── Storage singletons (module-level, initialised once) ───────────────────
const settingsStore = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const backend = new IndexedDBStorageBackend({
  dbName: "keating",
  version: 1,
  stores: [
    settingsStore.getConfig(),
    providerKeys.getConfig(),
    sessions.getConfig(),
    SessionsStore.getMetadataConfig(),
    customProviders.getConfig(),
  ],
});

settingsStore.setBackend(backend);
providerKeys.setBackend(backend);
sessions.setBackend(backend);
customProviders.setBackend(backend);

const storage = new AppStorage(settingsStore, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);

const keatingStorage = new KeatingStorage();

// ─── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_MODEL = getModel("google", "gemini-3-flash-preview");

// ─── Stream functions ───────────────────────────────────────────────────────
function createBrowserStreamFn() {
  return async (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    const abortSignal = options?.signal;

    const defaultFields = {
      api: "browser" as const,
      provider: "browser" as const,
      model: "gemma-4-e4b",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };

    (async () => {
      try {
        if (abortSignal?.aborted) {
          stream.end({
            ...defaultFields,
            role: "assistant",
            content: [],
            stopReason: "aborted",
            errorMessage: "Request aborted",
            timestamp: Date.now(),
          } as AssistantMessage);
          return;
        }

        const userMessages = context.messages
          .filter((m): m is Extract<typeof m, { role: "user" }> => m.role === "user")
          .map((m) => {
            const content = m.content;
            if (typeof content === "string") return content;
            return content
              .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
              .map((c) => c.text)
              .join("\n");
          });

        const systemPrompt = context.systemPrompt || "";
        const conversationHistory = userMessages.join("\n\n");
        const fullPrompt = systemPrompt
          ? `${systemPrompt}\n\n${conversationHistory}`
          : conversationHistory;

        const partialMessage: AssistantMessage = {
          ...defaultFields,
          role: "assistant",
          content: [{ type: "text", text: "" }],
          stopReason: "stop",
          timestamp: Date.now(),
        };

        stream.push({ type: "start", partial: partialMessage });

        const response = await localModel.generate(
          fullPrompt,
          { max_length: options?.maxTokens ?? 1024, temperature: options?.temperature ?? 0.7 },
          (token: string) => {
            const textBlock = partialMessage.content[0];
            if (textBlock.type === "text") textBlock.text += token;
            stream.push({ type: "text_start", contentIndex: 0, partial: partialMessage });
          },
        );

        if (abortSignal?.aborted) {
          stream.end({
            ...defaultFields,
            role: "assistant",
            content: [{ type: "text", text: response }],
            stopReason: "aborted",
            errorMessage: "Request aborted",
            timestamp: Date.now(),
          } as AssistantMessage);
          return;
        }

        stream.end({
          ...defaultFields,
          role: "assistant",
          content: [{ type: "text", text: response }],
          stopReason: "stop",
          timestamp: Date.now(),
        } as AssistantMessage);
      } catch (error) {
        stream.end({
          ...defaultFields,
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        } as AssistantMessage);
      }
    })();

    return stream;
  };
}

function hybridStreamFn(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	if (model.provider === "browser") return createBrowserStreamFn()(model, context, options);

  if (shouldProxyModel(model)) {
    const proxiedModel = {
      ...model,
      baseUrl: chatProxyBaseUrl(),
    };
    const proxiedOptions: SimpleStreamOptions = {
      ...options,
      headers: {
        ...options?.headers,
        "x-target-url": proxyTargetHeader(model.baseUrl),
      },
    };
    return streamSimple(proxiedModel, context, proxiedOptions);
  }

  return streamSimple(model, context, options);
}

// ─── Initialisation Promise ─────────────────────────────────────────────────
let initPromise: Promise<void> | null = null;
function getInitPromise() {
  if (!initPromise) {
    initPromise = Promise.all([
      syncCustomProviderKeys(),
      keatingStorage.init()
    ]).then(() => {});
  }
  return initPromise;
}

// ─── Hook ───────────────────────────────────────────────────────────────────
export interface UseKeatingAgentReturn {
  title: string;
  isPending: boolean;
  openSettings: () => void;
  openSessions: () => void;
  newSession: () => void;
  chatPanelRef: (node: ChatPanel | null) => void;
  speechEnabled: boolean;
  toggleSpeech: () => void;
}

function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const emptyUsage: SessionMetadata["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function messageText(message: AgentMessage): string {
  const msg = message as any;
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join(" ");
  }
  return "";
}

function sessionTitle(messages: AgentMessage[]) {
  const firstUserText = messages
    .filter((message) => (message as any).role === "user" || (message as any).role === "user-with-attachments")
    .map(messageText)
    .find((text) => text.trim().length > 0);
  if (!firstUserText) return "New session";
  return firstUserText.trim().replace(/\s+/g, " ").slice(0, 80);
}

function sessionPreview(messages: AgentMessage[]) {
  return messages
    .map(messageText)
    .filter(Boolean)
    .join("\n")
    .slice(0, 2048);
}

function sessionUsage(messages: AgentMessage[]): SessionMetadata["usage"] {
  return messages.reduce<SessionMetadata["usage"]>((usage, message) => {
    const messageUsage = (message as any).usage;
    if (!messageUsage) return usage;
    usage.input += messageUsage.input ?? 0;
    usage.output += messageUsage.output ?? 0;
    usage.cacheRead += messageUsage.cacheRead ?? 0;
    usage.cacheWrite += messageUsage.cacheWrite ?? 0;
    usage.totalTokens += messageUsage.totalTokens ?? 0;
    usage.cost.input += messageUsage.cost?.input ?? 0;
    usage.cost.output += messageUsage.cost?.output ?? 0;
    usage.cost.cacheRead += messageUsage.cost?.cacheRead ?? 0;
    usage.cost.cacheWrite += messageUsage.cost?.cacheWrite ?? 0;
    usage.cost.total += messageUsage.cost?.total ?? 0;
    return usage;
  }, structuredClone(emptyUsage));
}

export function useKeatingAgent(): UseKeatingAgentReturn {
  // Use React 19's use() for suspense handling of asynchronous init
  use(getInitPromise());

  const [title] = useState("Keating");
  const agentRef = useRef<Agent | null>(null);
  const panelRef = useRef<ChatPanel | null>(null);
  const sessionIdRef = useRef<string>(createSessionId());
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const selectedModelRef = useRef<Model<Api>>(DEFAULT_MODEL);
  const [speechSettings, setSpeechSettings] = useState<WebSpeechSettings>(() => loadWebSpeechSettings());
  const [isPending, startTransition] = useTransition();
  const bootstrapTimerRef = useRef<number | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const persistentStorageRequestedRef = useRef(false);

  const openSettings = useCallback(() => {
    SettingsDialog.open([new KeatingProvidersModelsTab(), new ProxyTab()]);
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

  const createAgent = useCallback(async (panel: ChatPanel, initialState?: Partial<AgentState>) => {
    const agentSessionId = sessionIdRef.current;
    const agentCreatedAt = sessionCreatedAtRef.current;
    const tools = await createKeatingTools(keatingStorage, toolOptions(speechSettings));
    const nextState: Partial<AgentState> = {
      systemPrompt: buildKeatingSystemPrompt(speechSettings.enabled),
      model: initialState?.model ?? selectedModelRef.current,
      thinkingLevel: "medium",
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
    unsubRef.current = subscribeAgentEvents(agent, panel);
    if (persistUnsubRef.current) persistUnsubRef.current();
    persistUnsubRef.current = agent.subscribe((ev) => {
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
      onBeforeSend: () => {
        if (import.meta.env.DEV) {
          console.log(`[keating:send] model=${agent.state.model.provider}/${agent.state.model.id} messages=${agent.state.messages.length}`);
        }
      },
      onModelSelect: () =>
        KeatingModelSelector.open(
          agent.state.model as Model<Api>,
          (model) => {
            startTransition(async () => {
              if (model.provider === "browser") await loadBrowserModel();
              selectedModelRef.current = model;
              const current = agent.state;
              await createAgent(panel, { ...current, model, messages: [...current.messages] });
            });
          },
        ),
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
      await createAgent(panel, { messages: [], model: selectedModelRef.current, thinkingLevel: "medium" });
    });
  }, [createAgent, endLearnerSession, saveSessionSnapshot]);

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

  const openSessions = useCallback(() => {
    SessionManagerDialog.open({
      onLoad: (sessionId) => {
        startTransition(async () => {
          const session = await sessions.loadSession(sessionId);
          if (session) await loadSession(session);
        });
      },
    });
  }, [loadSession]);

  // Use a callback ref to safely initialize the agent when the DOM node resolves
  const chatPanelRef = useCallback((node: ChatPanel | null) => {
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
        unsubRef.current = subscribeAgentEvents(existingAgent, node);
        const setupCallbacks = {
          onApiKeyRequired: async (provider: string) => {
            if (provider === "browser") return true;
            if (await getProviderApiKey(provider)) return true;
            return ApiKeyPromptDialog.prompt(provider);
          },
          onBeforeSend: () => {
            if (import.meta.env.DEV) {
              console.log(`[keating:send] model=${existingAgent.state.model.provider}/${existingAgent.state.model.id} messages=${existingAgent.state.messages.length}`);
            }
          },
          onModelSelect: () =>
            KeatingModelSelector.open(
              existingAgent.state.model as Model<Api>,
              (model) => {
                startTransition(async () => {
                  if (model.provider === "browser") await loadBrowserModel();
                  selectedModelRef.current = model;
                  const current = existingAgent.state;
                  await createAgent(node, { ...current, model, messages: [...current.messages] });
                });
              },
            ),
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

  return { title, isPending, openSettings, openSessions, newSession, chatPanelRef, speechEnabled: speechSettings.enabled, toggleSpeech };
}
