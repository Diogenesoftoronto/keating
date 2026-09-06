import { Agent, type AgentMessage, type AgentOptions, type AgentTool, type StreamFn, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { EpisodeExecution, EpisodeMessage, EpisodeRunner, EpisodeToolCall } from "../../../shared/evolution/contracts";
import type { ExperimentCompletion } from "../../../shared/evolution/model-adapters";
import { createAssessmentTools } from "./browser-tools/assessment";
import { createTeachingTools } from "./browser-tools/teaching";
import { KeatingStorage } from "./storage";

export const BROWSER_EPISODE_TOOLS = Object.freeze(["deck", "quiz", "grade_quiz", "grade_question_checks"]);

interface BrowserEpisodeLimits {
  timeoutMs: number;
  maxProviderCalls: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  maxOutputCharacters: number;
}

export interface BrowserEpisodeDependencies {
  model: Model<Api>;
  streamFn: StreamFn;
  getApiKey: NonNullable<AgentOptions["getApiKey"]>;
  convertToLlm?: AgentOptions["convertToLlm"];
  thinkingLevel?: ThinkingLevel;
  limits?: Partial<BrowserEpisodeLimits>;
}

export class BrowserEpisodeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BrowserEpisodeError";
  }
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => block?.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
}

function prefixMessage(message: EpisodeMessage, model: Model<Api>): AgentMessage {
  if (message.role === "user") return { role: "user", content: message.content, timestamp: 0 };
  return {
    role: "assistant", content: [{ type: "text", text: message.content }],
    provider: model.provider, model: model.id, api: model.api, timestamp: 0, stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function episodeExecution(agent: Agent, prefixLength: number, mode: "teaching" | "completion"): EpisodeExecution {
  const fresh = agent.state.messages.slice(prefixLength);
  const assistants = fresh.filter((message) => message.role === "assistant");
  if (assistants.some((message) => message.role === "assistant" && ["error", "aborted"].includes(message.stopReason))) {
    throw new BrowserEpisodeError("episode_provider_failure");
  }
  if (!assistants.some((message) => textContent(message.content).trim())) throw new BrowserEpisodeError("episode_empty_response");
  const toolCalls: EpisodeToolCall[] = [];
  const byId = new Map<string, EpisodeToolCall>();
  for (const message of fresh) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const call: EpisodeToolCall = { name: block.name, arguments: block.arguments };
        byId.set(block.id, call);
        toolCalls.push(call);
      }
    } else if (message.role === "toolResult") {
      const call = byId.get(message.toolCallId);
      if (call) call.result = `${message.isError ? "[tool error]\n" : ""}${textContent(message.content)}`;
    }
  }
  return {
    messages: agent.state.messages.flatMap((message): EpisodeMessage[] => message.role === "user" || message.role === "assistant"
      ? [{ role: message.role, content: textContent(message.content) }] : []),
    toolCalls,
    model: `${agent.state.model.provider}/${agent.state.model.id}`,
    runtime: `pi-agent-core;browser-headless;${mode === "teaching" ? "pedagogical-tools" : "no-tools"};api=${agent.state.model.api};thinking=${agent.state.thinkingLevel};frozen-prompt;isolated-indexeddb`,
  };
}

/** Runs the current browser model and real teaching tools without rendering UI or touching the learner's database. */
export function createBrowserEpisodeAdapters(dependencies: BrowserEpisodeDependencies): { runner: EpisodeRunner; complete: ExperimentCompletion } {
  if (!dependencies.model?.provider || !dependencies.model.id) throw new BrowserEpisodeError("episode_model_unconfigured");
  const model = structuredClone(dependencies.model);
  const limits: BrowserEpisodeLimits = {
    timeoutMs: 90_000, maxProviderCalls: 6, maxToolCalls: 8, maxOutputTokens: 2_048, maxOutputCharacters: 128_000,
    ...dependencies.limits,
  };
  for (const [name, value] of Object.entries(limits)) {
    const maximum = name === "timeoutMs" ? 120_000 : name === "maxProviderCalls" ? 12
      : name === "maxToolCalls" ? 24 : name === "maxOutputTokens" ? 8_192 : 256_000;
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new BrowserEpisodeError("episode_invalid_limits");
  }

  async function execute(input: Parameters<EpisodeRunner>[0], mode: "teaching" | "completion"): Promise<EpisodeExecution> {
    if (input.signal.aborted) throw new BrowserEpisodeError("episode_aborted");
    if (typeof input.systemPrompt !== "string" || !input.systemPrompt.trim() || !input.caseId
      || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 64
      || input.messages.at(-1)?.role !== "user"
      || input.messages.some((message) => !message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content.trim())
      || input.systemPrompt.length + input.messages.reduce((sum, message) => sum + message.content.length, 0) > 128_000) {
      throw new BrowserEpisodeError("episode_invalid_request");
    }
    const frozen = structuredClone({ caseId: input.caseId, systemPrompt: input.systemPrompt, messages: input.messages });
    const storage = new KeatingStorage(`keating-eval-${crypto.randomUUID()}`);
    const activeTools = new Set<Promise<unknown>>();
    let agent: Agent | undefined;
    let unsubscribe: (() => void) | undefined;
    let closed = false;
    let failure: string | undefined;
    let providerCalls = 0;
    let toolCalls = 0;
    let finishedCharacters = 0;
    let rejectStopped!: (error: BrowserEpisodeError) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
    // A cancellation can arrive while storage initializes, before Promise.race attaches.
    void stopped.catch(() => {});
    const stop = (code: string) => {
      if (closed) return;
      failure ??= code;
      agent?.abort();
      rejectStopped(new BrowserEpisodeError(failure));
    };
    const onAbort = () => stop("episode_aborted");
    input.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stop("episode_timeout"), limits.timeoutMs);
    try {
      await storage.init();
      if (input.signal.aborted) stop("episode_aborted");
      if (failure) throw new BrowserEpisodeError(failure);
      storage.setCurrentSessionId(`episode-${frozen.caseId}`);
      const available: AgentTool[] = mode === "teaching" ? [
        ...createTeachingTools(storage), ...createAssessmentTools(storage, async () => []),
      ].filter((tool) => BROWSER_EPISODE_TOOLS.includes(tool.name)) : [];
      const tools = available.map((tool): AgentTool => ({
        ...tool,
        execute: async (...args) => {
          if (closed || failure || input.signal.aborted) throw new BrowserEpisodeError(failure ?? "episode_aborted");
          const running = tool.execute(...args);
          activeTools.add(running);
          try { return await running; }
          finally { activeTools.delete(running); }
        },
      }));
      const prefix = frozen.messages.slice(0, -1).map((message) => prefixMessage(message, model));
      agent = new Agent({
        initialState: { model, thinkingLevel: dependencies.thinkingLevel ?? "off", systemPrompt: frozen.systemPrompt, messages: prefix, tools },
        convertToLlm: dependencies.convertToLlm,
        getApiKey: dependencies.getApiKey,
        sessionId: `keating-eval-${crypto.randomUUID()}`,
        streamFn: (currentModel, context, options) => {
          if (closed || failure || input.signal.aborted) throw new BrowserEpisodeError(failure ?? "episode_aborted");
          providerCalls += 1;
          if (providerCalls > (mode === "completion" ? 1 : limits.maxProviderCalls)) {
            stop("episode_provider_call_limit");
            throw new BrowserEpisodeError("episode_provider_call_limit");
          }
          return dependencies.streamFn(currentModel, context, { ...options, maxTokens: limits.maxOutputTokens });
        },
        beforeToolCall: async ({ toolCall }) => {
          toolCalls += 1;
          if (closed || failure || input.signal.aborted) return { block: true, reason: failure ?? "episode_aborted" };
          if (toolCalls > limits.maxToolCalls) {
            stop("episode_tool_limit");
            return { block: true, reason: "episode_tool_limit" };
          }
          return BROWSER_EPISODE_TOOLS.includes(toolCall.name) && mode === "teaching" ? undefined : { block: true, reason: "episode_tool_disabled" };
        },
      });
      unsubscribe = agent.subscribe((event) => {
        if ((event.type === "message_update" || event.type === "message_end") && (event.message.role === "assistant" || event.message.role === "toolResult")) {
          const characters = JSON.stringify(event.message.content).length;
          if (finishedCharacters + characters > limits.maxOutputCharacters) stop("episode_output_limit");
          if (event.type === "message_end") finishedCharacters += characters;
        }
      });
      await Promise.race([agent.prompt(frozen.messages.at(-1)!.content), stopped]);
      if (failure) throw new BrowserEpisodeError(failure);
      if (agent.state.systemPrompt !== frozen.systemPrompt) throw new BrowserEpisodeError("episode_prompt_mismatch");
      return episodeExecution(agent, prefix.length, mode);
    } catch (error) {
      throw error instanceof BrowserEpisodeError ? error : new BrowserEpisodeError("episode_execution_failure");
    } finally {
      closed = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
      agent?.abort();
      unsubscribe?.();
      // These operations are local IndexedDB transactions; no allowed tool calls a provider.
      await Promise.allSettled([...activeTools]);
      try { await storage.destroyIsolatedDatabase(); }
      catch { throw new BrowserEpisodeError("episode_cleanup_failure"); }
    }
  }

  return {
    runner: (input) => execute(input, "teaching"),
    complete: async (input) => {
      const execution = await execute({ caseId: "independent-completion", systemPrompt: input.systemPrompt, messages: [{ role: "user", content: input.prompt }], signal: input.signal }, "completion");
      const content = execution.messages.filter((message) => message.role === "assistant").at(-1)?.content;
      if (!content?.trim()) throw new BrowserEpisodeError("episode_empty_response");
      return content;
    },
  };
}
