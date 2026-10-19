/**
 * Tool catalog and runtime preparation for the browser teacher: the options
 * passed to `createKeatingTools`, the capability filter, and the model/prompt
 * resolution done before a conversation is created.
 */
import type { AgentState } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  composeKeatingSystemPrompt,
  createKeatingTools,
  getActiveKeatingPrompt,
  type KeatingToolsOptions,
} from "../../keating/browser-tools";
import {
  loadAgentRuntimeConfig,
  type KeatingAgentRuntimeConfig,
} from "../../keating/agent-runtime";
import { filterAvailableKeatingTools } from "../../keating/capabilities";
import { courseToolsAvailable } from "../../courses/tool-availability";
import { appendKeatingPortableCatalog } from "../../keating/portable-agent";
import { loadLearnerContext } from "../../keating/learner-context";
import { isDefaultPersona, loadPersona } from "../../keating/persona";
import { shouldExposeClientWebSearch } from "../../keating/provider-web-search";
import type { WebSpeechSettings } from "../../keating/speech";
import { runBrowserTeachingExperiment } from "../../keating/teaching-evolution";
import { toModelMessages } from "../../keating/flue/model-messages";
import { getRecentModels, loadModelPrefs } from "../../keating/model-prefs";
import { modelKey } from "../../lib/model-catalog";
import {
  getProviderApiKey,
  getSelectableModels,
  resolveAvailableChatModel,
} from "../../lib/provider-models";
import { NOTORGANIC_DEFAULT_MODEL, isNotOrganicProvider } from "../../notorganic-provider";
import type { SessionData } from "../../types/session";
import { hybridStreamFn, searchWithConfiguredProvider } from "../keating-stream";
import { keatingStorage, sessions } from "../keating-storage";
import { resolveConnectedAccountPrompt } from "./account-prompt";
import type { AgentHostRefs } from "./host-refs";
import { buildAgentSystemPrompt } from "./system-prompt";

export type ToolOptionsFactory = (
  settings: WebSpeechSettings,
  agentRuntime?: KeatingAgentRuntimeConfig,
) => KeatingToolsOptions;

export function createToolOptions(
  refs: AgentHostRefs,
  courseContext: KeatingToolsOptions["course"],
  settings: WebSpeechSettings,
  agentRuntime?: KeatingAgentRuntimeConfig,
) {
  return {
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
      refs.systemPromptBaseRef.current = basePrompt;
      if (refs.agentRef.current) {
        refs.agentRef.current.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
          settings.enabled,
          basePrompt,
          loadLearnerContext(),
          refs.sessionStartContextRef.current.context,
          agentRuntime,
          courseContext,
        ));
      }
    },
    runTeachingExperiment: async (options: { force?: boolean; signal?: AbortSignal }) => {
      const model = refs.agentRef.current?.context.model;
      if (!model) throw new Error("Select a model before running a teaching experiment.");
      return runBrowserTeachingExperiment({
        model,
        streamFn: hybridStreamFn,
        getApiKey: getProviderApiKey,
        convertToLlm: toModelMessages,
        thinkingLevel: refs.agentRef.current?.context.thinkingLevel,
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
      executor: refs.toolExecutorRef.current,
      getContext: () => ({
        sessionId: refs.sessionIdRef.current,
        surface: "text" as const,
        provenance: refs.untrustedSearchProvenanceRef.current
          ? { trust: "untrusted-web" as const, userAuthorized: false }
          : { trust: "trusted" as const, userAuthorized: true },
      }),
    },
  };
}

/** The tools the current runtime, model and speech setting can actually use. */
export async function availableToolsFor(
  tools: Awaited<ReturnType<typeof createKeatingTools>>,
  runtime: KeatingAgentRuntimeConfig,
  speechEnabled: boolean,
  model: Model<Api>,
) {
  return filterAvailableKeatingTools(tools, {
    coursesAvailable: await courseToolsAvailable(),
    runtime,
    speechEnabled,
    clientWebSearch: shouldExposeClientWebSearch(model),
  });
}

export interface PreparedAgent {
  promptBase: string;
  agentRuntime: KeatingAgentRuntimeConfig;
  resolvedModel: Model<Api>;
  tools: Awaited<ReturnType<typeof availableToolsFor>>;
}

/**
 * Resolves the model, base prompt, runtime and tools for a new conversation.
 * A fresh start with no model restores the learner's default or most recent
 * explicit model choice, even across account redirects.
 */
export async function prepareAgentRuntime({
  refs,
  initialState,
  preserveSelectedModel,
  speechSettings,
  toolOptions,
}: {
  refs: AgentHostRefs;
  initialState?: Partial<AgentState>;
  preserveSelectedModel: boolean;
  speechSettings: WebSpeechSettings;
  toolOptions: ToolOptionsFactory;
}): Promise<PreparedAgent> {
  const persona = loadPersona();
  let requestedModel = initialState?.model ?? refs.selectedModelRef.current;
  // Restore an explicit model choice after account redirects, even before the
  // first message creates a saved session. Existing sessions keep their model.
  if (!initialState?.model && !refs.agentRef.current && !refs.explicitModelSelectionRef.current) {
    const defaultKey = loadModelPrefs().defaultChatModelKey;
    const recent = defaultKey ? { key: defaultKey } : getRecentModels()[0];
    if (recent) {
      const models = recent.key === modelKey(NOTORGANIC_DEFAULT_MODEL)
        ? [NOTORGANIC_DEFAULT_MODEL]
        : await getSelectableModels();
      const saved = models.find((model) => modelKey(model) === recent.key);
      if (saved) {
        requestedModel = saved;
        refs.explicitModelSelectionRef.current = true;
      }
    }
  }
  const [promptBase, agentRuntime, resolvedModel] = await Promise.all([
    (initialState?.systemPrompt && refs.systemPromptBaseRef.current) || initialState?.systemPrompt
      || getActiveKeatingPrompt(keatingStorage, "learn", undefined, composeKeatingSystemPrompt(persona))
        .then((prompt) => isDefaultPersona(persona) ? resolveConnectedAccountPrompt(prompt) : prompt),
    loadAgentRuntimeConfig(),
    resolveAvailableChatModel(requestedModel, { allowFallback: !preserveSelectedModel && !refs.explicitModelSelectionRef.current && !isNotOrganicProvider(requestedModel.provider) }),
  ]);
  const tools = await availableToolsFor(
    await createKeatingTools(keatingStorage, toolOptions(speechSettings, agentRuntime)),
    agentRuntime,
    speechSettings.enabled,
    resolvedModel,
  );
  return { promptBase, agentRuntime, resolvedModel, tools };
}
