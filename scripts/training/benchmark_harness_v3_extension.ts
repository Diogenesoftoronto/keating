/** Benchmark-only transport/containment extension. The teaching extension is loaded by launchRpcClient. */
import { appendFileSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { getApiProvider, registerApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HARNESS_V3_BOUNDED_APIS, limitHarnessPayload } from "./benchmark_harness_v3_limits.js";

const installed = new Map<string, { original: ApiProviderInternal; wrapped: ApiProviderInternal }>();
type ApiProviderInternal = NonNullable<ReturnType<typeof getApiProvider>>;

export default function benchmarkHarnessExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const directory = join(cwd, ".keating", "benchmark-harness");
  const request = JSON.parse(readFileSync(join(directory, "request.json"), "utf8"));
  const counterPath = join(directory, "counters.json");
  const counters = (): { provider: number; tool: number } => {
    try { return JSON.parse(readFileSync(counterPath, "utf8")); }
    catch { return { provider: 0, tool: 0 }; }
  };
  const log = (kind: string, data: unknown) => appendFileSync(join(directory, "events.jsonl"), `${JSON.stringify({ kind, data })}\n`, { mode: 0o600 });
  const increment = (kind: "provider" | "tool") => {
    const value = counters();
    value[kind] += 1;
    writeFileSync(counterPath, JSON.stringify(value), { mode: 0o600 });
    return value[kind];
  };
  const reserveProviderCall = () => {
    if (counters().provider >= request.limits.max_provider_calls) {
      log("provider_blocked", { code: "harness_provider_call_limit" });
      throw new Error("harness_provider_call_limit");
    }
    return increment("provider") - 1;
  };
  const tools: string[] = request.allowed_tools;
  const contained = (path: unknown): boolean => {
    if (typeof path !== "string" || !path || path.includes("\0")) return false;
    try {
      const target = realpathSync(resolve(cwd, path));
      const resourceHash = request.readonly_resources?.[target];
      if (resourceHash) {
        const actual = createHash("sha256").update(readFileSync(target)).digest("hex");
        if (actual !== resourceHash) return false;
        log("resource_read", { path: target, sha256: actual });
        return true;
      }
      if ((request.blocked_roots ?? []).some((root: string) => {
        const rel = relative(resolve(root), target);
        return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
      })) return false;
      const inside = relative(realpathSync(cwd), target);
      // The model must not read its response tape, evaluator inputs, auth, or private session receipts.
      return !isAbsolute(inside) && inside !== ".." && !inside.startsWith("../")
        && !inside.startsWith(".keating/benchmark-harness") && !inside.startsWith(".keating/pi-config")
        && !inside.startsWith(".keating/sessions");
    } catch { return false; }
  };

  if (request.transport.kind === "provider" && request.transport.endpoint) {
    const metadata = request.transport.modelMetadata;
    pi.registerProvider(request.transport.provider, {
      baseUrl: request.transport.endpoint, apiKey: `$${request.transport.apiKeyEnv}`, api: "openai-completions",
      models: [{ id: request.transport.model, name: metadata.name ?? request.transport.model, input: ["text"],
        reasoning: metadata.reasoning ?? false, contextWindow: metadata.contextWindow, maxTokens: metadata.maxTokens,
        compat: { maxTokensField: "max_tokens" },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
    log("custom_provider", { provider: request.transport.provider, model: request.transport.model, api: "openai-completions",
      pricing: "Unknown: zero registry placeholders are not cost measurements." });
  }
  pi.registerCommand("keating-benchmark-v3-ready", { description: "Private benchmark resource readiness check", handler: async (_args, ctx) => {
    const resourceOptions = ctx.getSystemPromptOptions();
    const skills = resourceOptions.skills ?? [];
    if (resourceOptions.contextFiles?.length || resourceOptions.customPrompt || skills.some((skill) => !request.readonly_resources?.[skill.filePath])) {
      log("fatal", { code: "harness_unpinned_runtime_resources", context_count: resourceOptions.contextFiles?.length ?? 0,
        custom_prompt_present: Boolean(resourceOptions.customPrompt), unexpected_skills: skills.filter((skill) => !request.readonly_resources?.[skill.filePath]).map((skill) => skill.filePath) });
    } else {
      log("resources_verified", { context_files: [], skills: skills.map((skill) => ({ name: skill.name, path: skill.filePath, sha256: request.readonly_resources[skill.filePath] })) });
    }
  } });
  pi.on("session_start", (_event, ctx) => {
    if (request.transport.kind === "provider") {
      const api = ctx.model?.api;
      if (!api || !(HARNESS_V3_BOUNDED_APIS as readonly string[]).includes(api)) {
        log("fatal", { code: "harness_unsupported_provider_api" });
        return;
      }
      const active = getApiProvider(api);
      if (!active) { log("fatal", { code: "harness_provider_transport_missing" }); return; }
      const prior = installed.get(api);
      const original = active === prior?.wrapped ? prior.original : active;
      const wrap = (method: "stream" | "streamSimple"): ApiProviderInternal["streamSimple"] => (model, context, options) => {
        if (model.provider !== request.transport.provider || model.id !== request.transport.model) throw new Error("harness_model_changed");
        const index = reserveProviderCall();
        const cap = Math.min(request.limits.max_output_tokens, model.maxTokens);
        let payloadCount = 0;
        log("provider_attempt", { index, model: { provider: model.provider, id: model.id, api: model.api }, context });
        return original[method](model, context, {
          ...options, maxTokens: cap, maxRetries: 0,
          onPayload: async (payload, payloadModel) => {
            if (++payloadCount > 1) throw new Error("harness_provider_retry_disabled");
            // Preserve the app hook, then enforce the final payload outside its error-swallowing event bus.
            const transformed = await options?.onPayload?.(payload, payloadModel);
            const bounded = limitHarnessPayload(model.api, transformed ?? payload, cap);
            log("provider_request", { index, model: { provider: model.provider, id: model.id, api: model.api },
              payload: bounded.payload, output_limit: { field: bounded.field, maximum: bounded.maximum }, max_retries: 0 });
            return bounded.payload;
          },
        });
      };
      registerApiProvider({ api, stream: wrap("stream"), streamSimple: wrap("streamSimple") }, "keating-benchmark-v3-limits");
      installed.set(api, { original, wrapped: getApiProvider(api)! });
      log("limits_installed", { api, max_provider_calls: request.limits.max_provider_calls, max_output_tokens: request.limits.max_output_tokens, max_retries: 0 });
    }
    pi.setActiveTools(tools);
    if (tools.some((name) => !pi.getActiveTools().includes(name))) {
      log("fatal", { code: "harness_requested_tool_missing" });
      return;
    }
    log("session_start", { session_file: ctx.sessionManager.getSessionFile(), model: ctx.model?.id,
      available_tools: pi.getAllTools().map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
      active_tools: pi.getActiveTools() });
  });
  pi.on("before_agent_start", (event) => {
    log("system_prompt", { system_prompt: event.systemPrompt, resource_options: event.systemPromptOptions });
  });
  pi.on("tool_call", async (event, ctx) => {
    const count = increment("tool");
    let reason: string | undefined;
    if (count > request.limits.max_tool_calls) reason = "harness_tool_call_limit";
    else if (event.toolName === "quiz") reason = "harness_interactive_quiz_requires_learner_input";
    else if (!tools.includes(event.toolName)) reason = "harness_tool_unavailable";
    else if (event.toolName === "read" && !contained(event.input.path)) reason = "harness_read_outside_allowed_workspace";
    log("tool_call", { name: event.toolName, arguments: event.input, blocked: reason ?? null });
    if (count > request.limits.max_tool_calls) ctx.abort();
    if (reason) return { block: true, reason };
    return undefined;
  });

  if (request.transport.kind === "tape") {
    pi.registerProvider("keating-benchmark-tape", {
      baseUrl: "https://offline.invalid", apiKey: "offline-fixture-no-credential", api: "keating-benchmark-tape",
      models: [{ id: "scripted", name: "Offline integration tape", reasoning: false, input: ["text"],
        contextWindow: 200_000, maxTokens: request.limits.max_output_tokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      streamSimple(model, context) {
        const stream = createAssistantMessageEventStream();
        let index: number;
        try { index = reserveProviderCall(); }
        catch {
          const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
            stopReason: "error", errorMessage: "harness_provider_call_limit", timestamp: Date.now(),
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: "error", reason: "error", error: message }); stream.end(message); return stream;
        }
        log("provider_request", { index, model: { provider: model.provider, id: model.id, api: model.api }, context,
          token_counting: "Not applicable: scripted responses have no model tokenizer or billed usage." });
        const response = request.transport.responses[index];
        const failed = index >= request.limits.max_provider_calls ? "harness_provider_call_limit" : !response ? "harness_tape_exhausted" : null;
        const content: AssistantMessage["content"] = failed ? [] : [
          ...(response.text !== undefined ? [{ type: "text" as const, text: response.text }] : []),
          ...(response.tool_calls ?? []).map((call: { id: string; name: string; arguments: Record<string, unknown> }) =>
            ({ type: "toolCall" as const, id: call.id, name: call.name, arguments: call.arguments })),
        ];
        const message: AssistantMessage = {
          role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
          stopReason: failed ? "error" : response.tool_calls?.length ? "toolUse" : "stop",
          ...(failed ? { errorMessage: failed } : {}), timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        stream.push({ type: "start", partial: message });
        if (failed) stream.push({ type: "error", reason: "error", error: message });
        else stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
        stream.end(message);
        return stream;
      },
    });
  }
}
