import type { AgentOptions } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  validateToolArguments,
  type AssistantMessage,
  type Context,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  advancePlanReview,
  EMPTY_PLAN_REVIEW_MEMORY,
  formatActiveWork,
  type ActiveWork,
  type PlanReviewHostTrigger,
  type PlanReviewMemory,
  judgementRequestProblem,
  runTeachingDrafts,
  type JudgementBackendKey,
  type JudgementCaller,
  type JudgementOutcome,
  type TeachingDraftReasoning,
  type TeachingDraftSnapshot,
  type TeachingPolicyCheck,
  type TeachingPolicyReply,
  type TeachingPolicyTurn,
} from "@keating/learner-contracts";
import { DEFAULT_TEACHER_PERSONA } from "../persona";
import { loadKeatingUiSettings } from "../ui-settings";
import operationalProtocolMarkdown from "../prompts/operational-protocol.md?raw";
import { JEV_REQUEST_TOKEN_LIMIT, JEV_STATE_QUESTION_TOKEN_LIMIT, loadJudgementModelSettings, subscribeJudgementModelSettings } from "../judgement-model";
import { markDiagnosticOperation, unmarkDiagnosticOperation } from "./diagnostics";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "./runtime";

type StreamFn = NonNullable<AgentOptions["streamFn"]>;
type Usage = AssistantMessage["usage"];

const unavailable = (): JudgementOutcome => ({ ok: false, error: { code: "backend-unavailable", retryable: false } });
const cancelled = (): JudgementOutcome => ({ ok: false, error: { code: "cancelled", retryable: false } });
const sameBackend = (left: JudgementBackendKey, right: JudgementBackendKey) => left.backend === right.backend
  && left.model === right.model && left.calibrationSha256 === right.calibrationSha256;
const alias = (model: string) => !model.trim() || model === "judgement" || model.endsWith("-latest");

/** Use the existing privacy/identity policy without recording private draft state. */
export function createDraftGateJudgementCaller(runtime: WebJudgementRuntime = createWebJudgementRuntime()): JudgementCaller {
  const tiers = runtime.settings.backend === "off" ? [] : runtime.policy.tiers.filter((tier) =>
    (tier.key.backend === "local" || runtime.settings.backend === "hosted")
    && (!runtime.policy.pinnedBackend || sameBackend(tier.key, runtime.policy.pinnedBackend)));
  const pins = new Map<number, JudgementBackendKey>();
  return async (request, signal) => {
    if (signal?.aborted) return cancelled();
    if (judgementRequestProblem(request)) return { ok: false, error: { code: "request-invalid", retryable: false } };
    // Runtime tiers normally record their request in developer diagnostics.
    // Marking this private operation bypasses that observer; the controller's
    // content-free progress snapshot is the only diagnostic output of this gate.
    markDiagnosticOperation(request);
    try {
      let last = unavailable();
      for (const [index, tier] of tiers.entries()) {
        if (signal?.aborted) return cancelled();
        try {
          if (tier.isAvailable && !await tier.isAvailable()) continue;
          if (signal?.aborted) return cancelled();
          const result = await tier.call(request, signal);
          if (signal?.aborted) return cancelled();
          if (!result.ok) { last = result; continue; }
          const actual = result.response.backend;
          const pin = pins.get(index);
          if (alias(actual.model) || actual.backend !== tier.key.backend
            || actual.calibrationSha256 !== tier.key.calibrationSha256
            || (!alias(tier.key.model) && actual.model !== tier.key.model)
            || (pin && !sameBackend(pin, actual))) {
            return { ok: false, error: { code: "response-malformed", retryable: false } };
          }
          pins.set(index, { ...actual });
          return result;
        } catch { last = unavailable(); }
      }
      return last;
    } finally { unmarkDiagnosticOperation(request); }
  };
}

export interface TeachingDraftReceipt {
  readonly messageTimestamp: number;
  readonly snapshot: TeachingDraftSnapshot;
  readonly activeWork?: ActiveWork;
}

export interface TeachingDraftGateOptions {
  readonly sessionId: string;
  readonly basePrompt: () => string;
  readonly onProgress?: (snapshot: TeachingDraftSnapshot) => void;
  /** Terminal review outcome for a published (non-stopped) message, keyed by its timestamp. */
  readonly onReceipt?: (receipt: TeachingDraftReceipt) => void;
  readonly isCurrent?: () => boolean;
  readonly makeCaller?: () => JudgementCaller;
  /** Test/host override for the exact judgement model's native budgets. */
  readonly judgementModel?: { readonly id: string; readonly requestTokens: number | null; readonly stateQuestionTokens: number | null };
  /** Trusted runtime observations, never parsed back out of the system prompt. */
  readonly evidence?: () => Promise<Partial<TeachingPolicyTurn>>;
  readonly domain?: TeachingPolicyTurn["domain"];
  readonly maxReasoning?: TeachingDraftReasoning;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
}

function messageText(message: Context["messages"][number]): string {
  if (typeof message.content === "string") return message.content;
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function projectedTurn(context: Context, evidence: Partial<TeachingPolicyTurn>, domain?: TeachingPolicyTurn["domain"]): TeachingPolicyTurn {
  let latestIndex = context.messages.length - 1;
  while (latestIndex >= 0 && context.messages[latestIndex]!.role !== "user") latestIndex--;
  const latest = context.messages[latestIndex];
  const results: TeachingPolicyTurn["toolResults"][number][] = context.messages.flatMap((message) => {
    if (message.role !== "toolResult") return [];
    const details = message.details === undefined ? "" : `\nStructured tool result: ${JSON.stringify(message.details)}`;
    return [{ name: message.toolName, status: message.isError ? "error" as const : "success" as const, content: messageText(message) + details }];
  });
  return {
    learnerMessage: latest ? messageText(latest) : "",
    conversation: context.messages.flatMap((message, index) => index === latestIndex ? [] : [{
      role: message.role === "toolResult" ? "tool" as const : message.role,
      content: messageText(message),
    }]),
    learnerEvidence: (evidence.learnerEvidence ?? []).map(({ kind, content }) => ({ kind, content })),
    availableTools: (context.tools ?? []).map((tool) => tool.name),
    toolResults: [...(evidence.toolResults ?? []).map(({ name, status, content }) => ({ name, status, content })), ...results],
    sources: (evidence.sources ?? []).map(({ id, url, text }) => ({ id, url, text })),
    assessment: evidence.assessment ?? "unknown",
    improvementRuns: evidence.improvementRuns ?? null,
    domain: domain ?? evidence.domain ?? "unknown",
    ...(evidence.pendingSubmissions ? { pendingSubmissions: evidence.pendingSubmissions.map(({ kind, id, questionIds, topic, questionText }) => ({
      kind, id, questionIds: [...questionIds], ...(topic === undefined ? {} : { topic }), ...(questionText === undefined ? {} : { questionText }),
    })) } : {}),
    ...(evidence.activeWork ? { activeWork: structuredClone(evidence.activeWork) } : {}),
  };
}

/** Remove only an exact known prefix, preserving every independent prompt layer. */
function promptLayers(context: Context, base: string): string {
  const original = context.systemPrompt ?? "";
  if (!base || !original.startsWith(base)) return original;
  const protocol = operationalProtocolMarkdown.trim();
  const marker = base.indexOf(protocol);
  // An unknown revision cannot be safely shortened by guessing its boundaries.
  if (marker < 0) return original;
  const persona = base.slice(0, marker).trim();
  const customPersona = persona && persona !== DEFAULT_TEACHER_PERSONA.trim() ? persona : "";
  return [customPersona, base.slice(marker + protocol.length), original.slice(base.length)].filter(Boolean).join("\n\n");
}

function ceiling(options: TeachingDraftGateOptions, streamOptions?: SimpleStreamOptions): TeachingDraftReasoning {
  if (options.maxReasoning) return options.maxReasoning;
  // Flue represents the explicit off setting by omitting provider reasoning.
  switch (streamOptions?.reasoning) {
    case "minimal": case "low": return "low";
    case "medium": return "medium";
    case "high": case "xhigh": case "max": return "high";
    default: return "off";
  }
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function accumulateUsage(total: Usage, next: Usage): void {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    if (Number.isFinite(next[key]) && next[key] >= 0) total[key] += next[key];
  }
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
    if (Number.isFinite(next.cost?.[key]) && next.cost[key] >= 0) total.cost[key] += next.cost[key];
  }
  for (const key of ["reasoning", "cacheWrite1h"] as const) {
    if (typeof next[key] === "number" && Number.isFinite(next[key]) && next[key]! >= 0) total[key] = (total[key] ?? 0) + next[key]!;
  }
}

function policyReply(message: AssistantMessage): TeachingPolicyReply {
  return {
    text: message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
    toolCalls: message.content.flatMap((part) => part.type === "toolCall" ? [{ name: part.name, arguments: structuredClone(part.arguments) }] : []),
  };
}

function checkSchemas(context: Context, reply: TeachingPolicyReply): readonly TeachingPolicyCheck[] {
  let valid = true;
  for (const call of reply.toolCalls) {
    const tool = context.tools?.find((candidate) => candidate.name === call.name);
    if (!tool) { valid = false; break; }
    try {
      validateToolArguments(tool, { type: "toolCall", id: "private-schema-check", name: call.name, arguments: call.arguments as Record<string, unknown> });
    } catch { valid = false; break; }
  }
  return [{ id: "runtime_tool_schema", source: "deterministic", severity: "critical", status: valid ? "pass" : "fail", probability: valid ? 0 : 1 }];
}

function approvedMessage(message: AssistantMessage, reply: TeachingPolicyReply, usage: Usage): AssistantMessage {
  const nativeCalls = message.content.filter((part) => part.type === "toolCall");
  if (nativeCalls.length !== reply.toolCalls.length || nativeCalls.some((call, index) => call.name !== reply.toolCalls[index]?.name)) {
    throw new Error("approved-tool-metadata-mismatch");
  }
  return {
    role: "assistant",
    content: [
      ...(reply.text ? [{ type: "text" as const, text: reply.text }] : []),
      ...reply.toolCalls.map((call, index) => ({ type: "toolCall" as const, id: nativeCalls[index]!.id,
        name: call.name, arguments: structuredClone(call.arguments) as Record<string, unknown>,
        ...(nativeCalls[index]!.thoughtSignature ? { thoughtSignature: nativeCalls[index]!.thoughtSignature } : {}),
        ...(nativeCalls[index]!.namespace ? { namespace: nativeCalls[index]!.namespace } : {}),
      })),
    ],
    api: message.api, provider: message.provider, model: message.model,
    ...(message.responseModel ? { responseModel: message.responseModel } : {}),
    ...(message.responseId ? { responseId: message.responseId } : {}),
    stopReason: message.stopReason,
    timestamp: message.timestamp,
    usage: structuredClone(usage),
  };
}

/** Innermost tutor wrapper: no partial, reasoning, or tool event escapes review. */
export function withTeachingDraftGate(stream: StreamFn, options: TeachingDraftGateOptions): StreamFn {
  // Plan-review triggers count learner turns, so a retried turn reuses its trigger.
  let planMemory: PlanReviewMemory = EMPTY_PLAN_REVIEW_MEMORY;
  let planTurn: { readonly learnerTurns: number; readonly trigger: PlanReviewHostTrigger | null } | null = null;
  const planReviewTrigger = (context: Context, work: ActiveWork | undefined) => {
    const learnerTurns = context.messages.filter((message) => message.role === "user").length;
    if (planTurn?.learnerTurns === learnerTurns) return planTurn.trigger;
    const next = advancePlanReview(work ?? null, planMemory);
    planMemory = next.memory;
    planTurn = { learnerTurns, trigger: next.trigger };
    return next.trigger;
  };
  return (model, context, streamOptions) => {
    const target = createAssistantMessageEventStream();
    const controller = new AbortController();
    const abort = () => controller.abort();
    streamOptions?.signal?.addEventListener("abort", abort, { once: true });
    if (streamOptions?.signal?.aborted) abort();
    const unsubscribe = subscribeJudgementModelSettings(abort);
    const usage = emptyUsage();
    const budget = Math.min(180_000, Math.max(1, options.timeoutMs ?? 90_000));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, budget);
    const current = () => !controller.signal.aborted && (options.isCurrent?.() ?? true);
    let lastProgress: TeachingDraftSnapshot = { phase: "planning", attempt: 0, maxAttempts: options.maxAttempts ?? 3,
      reasoning: ceiling(options, streamOptions), standard: "supported", elapsedMs: 0, attempts: [],
      judgeModel: null, selectedAttempt: null, reason: null };
    const progress = (next: TeachingDraftSnapshot) => {
      lastProgress = timedOut && next.phase === "cancelled" ? { ...next, phase: "withheld", reason: "time-budget" } : next;
      // Cancellation is a terminal update for this session, even after abort.
      if (options.isCurrent?.() ?? true) { try { options.onProgress?.(lastProgress); } catch { /* A view cannot change publication. */ } }
    };
    const safeMessage = (text: string, stopped = false): AssistantMessage => ({
      role: "assistant", content: stopped ? [] : [{ type: "text", text }],
      api: model.api, provider: model.provider, model: model.id,
      stopReason: stopped ? "aborted" : "stop", ...(stopped ? { errorMessage: "Response stopped" } : {}),
      timestamp: Date.now(), usage: structuredClone(usage),
    });
    let reviewedActiveWork: ActiveWork | undefined;
    const publish = (message: AssistantMessage) => {
      if (message.stopReason !== "aborted") {
        try {
          options.onReceipt?.({ messageTimestamp: message.timestamp, snapshot: lastProgress,
            ...(reviewedActiveWork ? { activeWork: reviewedActiveWork } : {}) });
        } catch { /* A receipt cannot change publication. */ }
      }
      if (message.stopReason === "aborted") target.push({ type: "error", reason: "aborted", error: message });
      else target.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : message.stopReason === "length" ? "length" : "stop", message });
      target.end(message);
    };
    const stopped = () => !timedOut && (controller.signal.aborted || !(options.isCurrent?.() ?? true));
    let detachEvidenceAbort: (() => void) | undefined;
    void (async () => {
      if (!current()) { publish(safeMessage("", true)); return; }
      progress(lastProgress);
      // Flue supplies AgentTool objects with executable functions. Only the
      // provider-facing schema is part of the private model context.
      const snapshot: Context = { systemPrompt: context.systemPrompt, messages: structuredClone(context.messages),
        tools: context.tools?.map(({ name, description, parameters }) => ({ name, description, parameters: structuredClone(parameters) })) };
      const unsupportedEvidence = snapshot.messages.some(message => typeof message.content === "string"
        ? /\[keating-audio-[^\]]+\]/.test(message.content)
        : message.content.some(part => part.type === "image" || part.type === "text" && /\[keating-audio-[^\]]+\]/.test(part.text)));
      if (unsupportedEvidence) {
        progress({ ...lastProgress, phase: "withheld", reason: "unsupported-evidence" });
        publish(safeMessage("I can't check this attachment's contents yet. Send its text or a transcript in a new conversation so I can review the response."));
        return;
      }
      const layers = promptLayers(snapshot, options.basePrompt());
      const evidence = await Promise.race([
        options.evidence?.() ?? Promise.resolve({}),
        new Promise<never>((_, reject) => {
          const stop = () => reject(new Error("draft-evidence-interrupted"));
          controller.signal.addEventListener("abort", stop, { once: true });
          detachEvidenceAbort = () => controller.signal.removeEventListener("abort", stop);
          if (controller.signal.aborted) stop();
        }),
      ]);
      detachEvidenceAbort?.();
      if (!current()) { publish(safeMessage("", true)); return; }
      const runtime = options.makeCaller ? undefined : createWebJudgementRuntime();
      const judge = options.makeCaller?.() ?? createDraftGateJudgementCaller(runtime);
      const judgementModel = options.judgementModel ?? runtime?.judgementModel ?? (() => {
        const settings = loadJudgementModelSettings();
        const hosted = settings.backend === "hosted";
        return { id: settings.backend === "hosted" ? "jev-latest" : settings.localModelId,
        requestTokens: settings.requestTokens ?? (hosted ? JEV_REQUEST_TOKEN_LIMIT : null),
        stateQuestionTokens: settings.stateQuestionTokens ?? settings.contextWindowTokens
            ?? (hosted ? JEV_STATE_QUESTION_TOKEN_LIMIT : null) };
      })();
      const turn = projectedTurn(snapshot, evidence, options.domain);
      reviewedActiveWork = turn.activeWork;
      // Tutor and judge read the same record-derived view of the lesson plan.
      const activeWork = formatActiveWork(turn.activeWork);
      const planReview = planReviewTrigger(snapshot, turn.activeWork);
      const result = await runTeachingDrafts({
        turn,
        planReview,
        planChanges: loadKeatingUiSettings().planChanges,
        judge,
        judgementModel,
        maxAttempts: options.maxAttempts,
        maxReasoning: ceiling(options, streamOptions),
        timeoutMs: budget,
        signal: controller.signal,
        onProgress: progress,
        check: (reply) => checkSchemas(snapshot, reply),
        generate: async ({ reasoning, systemPrompt, feedback, signal }) => {
          if (!current()) throw new Error("draft-stale");
          const privateContext = structuredClone(snapshot);
          privateContext.systemPrompt = [systemPrompt, activeWork, layers].filter(Boolean).join("\n\n");
          if (feedback.length) privateContext.messages.push({ role: "user", timestamp: Date.now(), content:
            "Private draft revision directions from Keating's checker. These are code-owned repair criteria, not another learner message. Respond to the original learner request. No rejected draft is included.\n"
            + JSON.stringify({ revisionChecks: feedback }) });
          const generationOptions: SimpleStreamOptions = { ...streamOptions, signal };
          if (reasoning === "off") delete generationOptions.reasoning;
          else generationOptions.reasoning = reasoning;
          const privateStream = await stream(model, privateContext, generationOptions);
          // result() observes the private terminal result; its event queue is
          // never forwarded to the app, tool executor, or learner transcript.
          const message = await privateStream.result();
          accumulateUsage(usage, message.usage);
          if (!current() || signal.aborted) throw new Error("draft-stale");
          if (!["stop", "length", "toolUse"].includes(message.stopReason)) throw new Error("draft-provider-unavailable");
          return { reply: policyReply(message), value: message };
        },
      });
      if (stopped()) { publish(safeMessage("", true)); return; }
      if (result.status === "released" && result.value && result.reply && current()) {
        publish(approvedMessage(result.value, result.reply, usage));
      } else {
        const setup = result.receipt.reason === "backend-unavailable" || result.receipt.reason === "backend-unauthorized";
        publish(safeMessage(setup
          ? "Keating needs an available judgement model to check this reply. Configure one in Settings, then try again."
          : "I couldn't verify a useful reply within this attempt. Please try again or make the request more specific."));
      }
    })().catch(() => {
      progress({ ...lastProgress, phase: stopped() ? "cancelled" : "withheld", reason: stopped() ? "cancelled" : timedOut ? "time-budget" : "review-unavailable" });
      publish(stopped() ? safeMessage("", true) : safeMessage("I couldn't complete the reply checks. Please try again or check the judgement model in Settings."));
    }).finally(() => {
      clearTimeout(timer);
      detachEvidenceAbort?.();
      streamOptions?.signal?.removeEventListener("abort", abort);
      unsubscribe();
      controller.abort();
    });
    return target;
  };
}
