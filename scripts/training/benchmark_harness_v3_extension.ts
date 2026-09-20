/** Benchmark-only transport/containment extension. The teaching extension is loaded by launchRpcClient. */
import { appendFileSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { getApiProvider, registerApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HARNESS_V3_BOUNDED_APIS, limitHarnessPayload } from "./benchmark_harness_v3_limits.js";
import { nativeSurfaceInstruction, nativeSurfaceSystemPrompt } from './native_surface.js';
import { applyExperimentInstruction, validateExperimentInstruction } from './native_experiment.js';
import { NATIVE_SOURCE_COMMAND, NATIVE_SOURCE_MESSAGE, decodeNativeSourceDelivery, nativeSourceMessage } from './native_source_document.js';

const installed = new Map<string, { original: ApiProviderInternal; wrapped: ApiProviderInternal }>();
type ApiProviderInternal = NonNullable<ReturnType<typeof getApiProvider>>;

export default function benchmarkHarnessExtension(pi: ExtensionAPI): void {
  const cwd = process.cwd();
  const directory = join(cwd, ".keating", "benchmark-harness");
  const request = JSON.parse(readFileSync(join(directory, "request.json"), "utf8"));
  const experiment = request.experiment_instruction === undefined ? undefined : validateExperimentInstruction(request.experiment_instruction);
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
    const customPromptHash = resourceOptions.customPrompt
      ? createHash("sha256").update(resourceOptions.customPrompt).digest("hex") : null;
    // The production launcher supplies Keating's shipped SYSTEM.md as its base
    // prompt. Accept only the exact bytes inventoried before the runtime starts.
    if (resourceOptions.contextFiles?.length || (customPromptHash !== null && customPromptHash !== request.system_prompt_sha256)
      || skills.some((skill) => !request.readonly_resources?.[skill.filePath])) {
      log("fatal", { code: "harness_unpinned_runtime_resources", context_count: resourceOptions.contextFiles?.length ?? 0,
        custom_prompt_present: Boolean(resourceOptions.customPrompt), unexpected_skills: skills.filter((skill) => !request.readonly_resources?.[skill.filePath]).map((skill) => skill.filePath) });
    } else {
      log("resources_verified", { context_files: [], custom_prompt_sha256: customPromptHash,
        skills: skills.map((skill) => ({ name: skill.name, path: skill.filePath, sha256: request.readonly_resources[skill.filePath] })) });
    }
  } });
  pi.registerCommand(NATIVE_SOURCE_COMMAND, { description: 'Deliver public benchmark source activity without an actor turn', handler: async (args, ctx) => {
    const delivery = decodeNativeSourceDelivery(String(args).trim());
    if (!ctx.isIdle() || delivery.surface !== (request.surface ?? 'interactive')) throw new Error('harness_source_document_busy_or_surface_mismatch');
    const message = nativeSourceMessage(delivery);
    const prior = ctx.sessionManager.getBranch().find(entry => entry.type === 'custom_message' && entry.customType === NATIVE_SOURCE_MESSAGE);
    if (prior) {
      if (prior.type !== 'custom_message' || (prior.details as { fingerprint?: string })?.fingerprint !== message.details.fingerprint)
        throw new Error('harness_source_document_conflict');
      log('source_document_reused', { fingerprint: message.details.fingerprint, entry_id: prior.id });
      return;
    }
    pi.sendMessage(message, { triggerTurn: false });
    const entry = ctx.sessionManager.getBranch().find(entry => entry.type === 'custom_message'
      && entry.customType === NATIVE_SOURCE_MESSAGE && (entry.details as { fingerprint?: string })?.fingerprint === message.details.fingerprint);
    if (!entry) throw new Error('harness_source_document_not_delivered');
    // Persist the actual session entry as delivery evidence even before Pi flushes its first assistant turn.
    log('source_document_delivered', { session_id: ctx.sessionManager.getSessionId(), entry });
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
        const stream = original[method](model, context, {
          ...options, maxTokens: cap, maxRetries: 0,
          onPayload: async (payload, payloadModel) => {
            if (++payloadCount > 1) throw new Error("harness_provider_retry_disabled");
            // Preserve the app hook, then enforce the final payload outside its error-swallowing event bus.
            const transformed = await options?.onPayload?.(payload, payloadModel);
            const bounded = limitHarnessPayload(model.api, transformed ?? payload, cap);
            log("provider_request", { index, model: { provider: model.provider, id: model.id, api: model.api }, context,
              payload: bounded.payload, output_limit: { field: bounded.field, maximum: bounded.maximum }, max_retries: 0 });
            return bounded.payload;
          },
        });
        // Preserve the native bridge's response identity at the transport boundary.
        // result() observes the terminal message without consuming stream events.
        void stream.result().then(message => {
          log("provider_response", { index, response_id: message.responseId ?? null,
            message_sha256: createHash("sha256").update(JSON.stringify(message)).digest("hex"),
            stop_reason: message.stopReason });
        }).catch(() => log("provider_response_failed", { index }));
        return stream;
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
    const instruction = request.surface === undefined ? null : nativeSurfaceInstruction(request.surface);
    const sourcePrompt = experiment === undefined ? event.systemPrompt : applyExperimentInstruction(event.systemPrompt, experiment);
    const systemPrompt = request.surface === undefined ? sourcePrompt : nativeSurfaceSystemPrompt(sourcePrompt, request.surface);
    log("system_prompt", { system_prompt: systemPrompt, resource_options: event.systemPromptOptions,
      ...(instruction === null ? {} : { surface: request.surface,
        surface_instruction_sha256: createHash('sha256').update(instruction).digest('hex') }),
      ...(experiment === undefined ? {} : { experiment_instruction: experiment }) });
    if (instruction !== null) return { systemPrompt };
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
