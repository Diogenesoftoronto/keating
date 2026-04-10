import { useEffect, useRef, useState } from "react";
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
  ApiKeyPromptDialog,
  AppStorage,
  ChatPanel,
  CustomProvidersStore,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsDialog,
  SettingsStore,
  setAppStorage,
  defaultConvertToLlm,
  ProxyTab,
} from "@mariozechner/pi-web-ui";
import { KeatingProvidersModelsTab } from "../components/providers-models-tab";
import { KeatingModelSelector } from "../components/model-selector";
import { getProviderApiKey, syncCustomProviderKeys } from "../lib/provider-models";
import { localModel } from "../stores/local-model";
import { createKeatingTools, KEATING_SYSTEM_PROMPT as TOOLS_PROMPT } from "../keating/browser-tools";
import { KeatingStorage } from "../keating/storage";

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
const DEFAULT_MODEL = getModel("google", "gemini-2.5-flash");

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
  return streamSimple(model, context, options);
}

// ─── Hook ───────────────────────────────────────────────────────────────────
export interface UseKeatingAgentReturn {
  title: string;
  ready: boolean;
  openSettings: () => void;
}

export function useKeatingAgent(
  chatPanelRef: React.RefObject<ChatPanel | null>,
): UseKeatingAgentReturn {
  const [title] = useState("Keating");
  const [ready, setReady] = useState(false);
  const agentRef = useRef<Agent | null>(null);
  const agentUnsubRef = useRef<(() => void) | null>(null);
  const selectedModelRef = useRef<Model<Api>>(DEFAULT_MODEL);

  const openSettings = () =>
    SettingsDialog.open([new KeatingProvidersModelsTab(), new ProxyTab()]);

  async function loadBrowserModel() {
    const state = localModel.getState();
    if (!state.loaded && !state.loading) await localModel.load();
    if (!localModel.getState().loaded) {
      throw new Error(localModel.getState().error ?? "Failed to load browser model");
    }
  }

  async function createAgent(initialState?: Partial<AgentState>) {
    const tools = await createKeatingTools(keatingStorage);
    const nextState: Partial<AgentState> = {
      systemPrompt: TOOLS_PROMPT,
      model: initialState?.model ?? selectedModelRef.current,
      thinkingLevel: "medium",
      messages: [],
      tools,
      ...initialState,
    };

    agentUnsubRef.current?.();
    const agent = new Agent({
      initialState: nextState,
      convertToLlm: defaultConvertToLlm,
      streamFn: hybridStreamFn,
    });
    agent.getApiKey = (provider: string) => getProviderApiKey(provider);
    agentRef.current = agent;

    await chatPanelRef.current?.setAgent(agent, {
      onApiKeyRequired: async (provider: string) => {
        if (provider === "browser") return true;
        if (await getProviderApiKey(provider)) return true;
        return ApiKeyPromptDialog.prompt(provider);
      },
      onModelSelect: () =>
        KeatingModelSelector.open(
          agent.state.model as Model<Api>,
          async (model) => {
            if (model.provider === "browser") await loadBrowserModel();
            selectedModelRef.current = model;
            const current = agent.state;
            await createAgent({ ...current, model, messages: [...current.messages] });
          },
        ),
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      await syncCustomProviderKeys();
      await keatingStorage.init();

      if (cancelled) return;
      if (!chatPanelRef.current) return;

      await createAgent();
      if (!cancelled) setReady(true);
    }

    init().catch(console.error);

    return () => {
      cancelled = true;
      agentUnsubRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPanelRef]);

  return { title, ready, openSettings };
}
