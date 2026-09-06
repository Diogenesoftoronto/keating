import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  AuthStorage, createAgentSession, DefaultResourceLoader, ModelRegistry, SessionManager, SettingsManager,
  VERSION as PI_VERSION, type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EpisodeExecution, EpisodeMessage, EpisodeToolCall } from "../../shared/evolution/contracts.js";
import {
  TEACHING_EPISODE_TOOLS, TeachingEpisodeError, validateTeachingEpisodeRequest,
  type TeachingEpisodeRequest,
} from "../core/teaching-episode-runner.js";
import { configDir } from "../core/paths.js";
import hyperteacher from "../pi/hyper-teacher/index.js";
import { createNotOrganicProviderConfig } from "../pi/notorganic-provider.js";

let failureStage = "initialization";

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
}

function historyMessage(message: EpisodeMessage, request: TeachingEpisodeRequest, api: string): AgentMessage {
  if (message.role === "user") return { role: "user", content: message.content, timestamp: 0 };
  return {
    role: "assistant", content: [{ type: "text", text: message.content }],
    api, provider: request.provider, model: request.model, timestamp: 0, stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

async function containedReadPath(cwd: string, input: unknown): Promise<boolean> {
  const path = input && typeof input === "object" ? (input as { path?: unknown }).path : undefined;
  if (typeof path !== "string" || !path) return false;
  try {
    const actual = await realpath(resolve(cwd, path));
    const inside = relative(await realpath(cwd), actual);
    return inside !== "" && !inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && inside !== ".." && !isAbsolute(inside);
  } catch { return false; }
}

/** Executes production Pi teaching tools; UI widgets and arbitrary filesystem execution are outside this benchmark. */
async function executeEpisode(request: TeachingEpisodeRequest): Promise<EpisodeExecution> {
  const cwd = process.cwd();
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: request.provider, defaultModel: request.model,
    defaultThinkingLevel: request.thinking,
    compaction: { enabled: false }, retry: { enabled: false },
  });
  const authStorage = AuthStorage.create(join(configDir(request.sourceCwd), "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, join(configDir(request.sourceCwd), "models.json"));
  modelRegistry.registerProvider("notorganic", createNotOrganicProviderConfig());
  const model = modelRegistry.find(request.provider, request.model);
  if (!model) throw new TeachingEpisodeError("episode_model_unavailable");
  const allowedTools: readonly string[] = request.mode === "teaching" ? TEACHING_EPISODE_TOOLS : [];
  let toolCalls = 0;
  let providerCalls = 0;
  let fatalCode: string | undefined;
  const guard: ExtensionFactory = (pi) => {
    pi.on("before_agent_start", () => ({ systemPrompt: request.systemPrompt }));
    pi.on("tool_call", async (event, ctx) => {
      toolCalls += 1;
      if (toolCalls > request.limits.maxToolCalls) {
        fatalCode = "episode_tool_limit";
        ctx.abort();
        return { block: true, reason: fatalCode };
      }
      if (!allowedTools.includes(event.toolName)) return { block: true, reason: "episode_tool_disabled" };
      if (event.toolName === "read" && !(await containedReadPath(cwd, event.input))) {
        return { block: true, reason: "episode_read_outside_workspace" };
      }
      return undefined;
    });
  };
  const teaching: ExtensionFactory = (pi) => {
    // Extension commands execute before tool guards. Evaluation accepts conversation text only.
    hyperteacher({ ...pi, registerCommand: () => {} });
  };
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir: join(cwd, ".pi"), settingsManager,
    noExtensions: true, noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    systemPrompt: request.systemPrompt,
    extensionFactories: request.mode === "teaching" ? [teaching, guard] : [guard],
  });
  failureStage = "resources";
  await resourceLoader.reload();
  if (resourceLoader.getExtensions().errors.length) throw new TeachingEpisodeError("episode_extension_failure");
  failureStage = "session";
  const { session } = await createAgentSession({
    cwd, agentDir: join(cwd, ".pi"), authStorage, modelRegistry, model,
    thinkingLevel: request.thinking, tools: [...allowedTools],
    resourceLoader, sessionManager: SessionManager.inMemory(cwd), settingsManager,
  });
  try {
    failureStage = "extension_binding";
    await session.bindExtensions({ onError: () => { fatalCode = "episode_extension_failure"; } });
    session.setActiveToolsByName([...allowedTools]);
    if (fatalCode) throw new TeachingEpisodeError(fatalCode);
    const stream = session.agent.streamFn;
    session.agent.streamFn = (streamModel, context, options) => {
      providerCalls += 1;
      if (providerCalls > request.limits.maxProviderCalls) {
        fatalCode = "episode_provider_call_limit";
        throw new TeachingEpisodeError(fatalCode);
      }
      return stream(streamModel, context, { ...options, maxTokens: request.limits.maxOutputTokens });
    };
    const prefix = request.messages.slice(0, -1).map((message) => historyMessage(message, request, model.api));
    session.agent.state.messages = prefix;
    failureStage = "prompt";
    await session.prompt(request.messages.at(-1)!.content, { expandPromptTemplates: false });
    if (fatalCode) throw new TeachingEpisodeError(fatalCode);
    if (session.systemPrompt !== request.systemPrompt) throw new TeachingEpisodeError("episode_prompt_mismatch");
    const fresh = session.messages.slice(prefix.length);
    const assistants = fresh.filter((message) => message.role === "assistant");
    if (assistants.some((message) => message.role === "assistant" && ["error", "aborted"].includes(message.stopReason))) {
      throw new TeachingEpisodeError("episode_provider_failure");
    }
    if (!assistants.some((message) => textContent(message.content).trim())) throw new TeachingEpisodeError("episode_empty_response");
    const calls: EpisodeToolCall[] = [];
    const byId = new Map<string, EpisodeToolCall>();
    for (const message of fresh) {
      if (message.role === "assistant") {
        for (const block of message.content) {
          if (block.type !== "toolCall") continue;
          const call: EpisodeToolCall = { name: block.name, arguments: block.arguments };
          calls.push(call);
          byId.set(block.id, call);
        }
      } else if (message.role === "toolResult") {
        const call = byId.get(message.toolCallId);
        if (call) call.result = `${message.isError ? "[tool error]\n" : ""}${textContent(message.content)}`;
      }
    }
    failureStage = "result";
    return {
      messages: session.messages.flatMap((message): EpisodeMessage[] => message.role === "user" || message.role === "assistant"
        ? [{ role: message.role, content: textContent(message.content) }] : []),
      toolCalls: calls,
      model: `${session.model?.provider}/${session.model?.id}`,
      runtime: `pi-sdk@${PI_VERSION};${request.mode === "teaching" ? "pedagogical-tools" : "no-tools"};frozen-prompt;isolated-state`,
    };
  } finally { session.dispose(); }
}

async function main(): Promise<void> {
  // Keep the protocol and failure reports free of provider diagnostics and credential values.
  console.log = console.warn = console.error = () => {};
  let source = "";
  for await (const chunk of process.stdin) {
    source += String(chunk);
    if (Buffer.byteLength(source) > 524_288) throw new TeachingEpisodeError("episode_input_limit");
  }
  let request: unknown;
  try { request = JSON.parse(source); } catch { throw new TeachingEpisodeError("episode_invalid_request"); }
  if (!validateTeachingEpisodeRequest(request)) throw new TeachingEpisodeError("episode_invalid_request");
  const execution = await executeEpisode(request);
  process.stdout.write(JSON.stringify({ ok: true, execution }));
}

main().then(() => process.exit(0)).catch((error: unknown) => {
  const errorCode = error instanceof TeachingEpisodeError ? error.code : `episode_${failureStage}_failure`;
  process.stdout.write(JSON.stringify({ ok: false, errorCode }));
  process.exit(1);
});
