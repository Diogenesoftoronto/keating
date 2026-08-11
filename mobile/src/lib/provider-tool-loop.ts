import {
  continueProviderTurn,
  requestProviderRound,
  type FetchLike,
  type ProviderRequestOptions,
  type ProviderRound,
  type ProviderToolCall,
  type ProviderToolDefinition,
  type ProviderToolResult,
} from "./provider-client";
import { validateToolCall } from "@keating/learner-contracts";
import {
  MOBILE_TOOL_DEFINITIONS,
  executeMobileTool,
  mobileToolIdempotencyKey,
  type MobileToolExecutionResult,
} from "./mobile-tools";
import type { ChatMessage, ProviderSettings, ProviderUsage, StudyArtifact } from "./types";

export const MAX_PROVIDER_TOOL_ROUNDS = 4;
export const MAX_PROVIDER_CALLS_PER_ROUND = 8;
const TOOL_TIMEOUT_MS = 10_000;

export interface CommittedMobileToolCall {
  call: ProviderToolCall;
  idempotencyKey: string;
  execution: MobileToolExecutionResult;
  /** True when a durable semantic receipt supplied the result without executing the effect. */
  replayed?: boolean;
}

export interface MobileToolLoopResult {
  text: string;
  usage: ProviderUsage | null;
  rounds: number;
  toolCalls: number;
}

export interface RunMobileToolLoopOptions extends Omit<ProviderRequestOptions, "tools" | "continuation"> {
  fetchImpl?: FetchLike;
  sessionId: string;
  triggeringMessageId: string;
  createdAt: number;
  /** Custom compatible endpoints default false because tool support is not implied. */
  advertiseTools?: boolean;
  /** Visible provider deltas in exact arrival order, including final rounds. */
  onTextDelta?: (delta: string, round: number) => void;
  /** Provider-designated reasoning summaries only; private thought is never emitted. */
  onReasoningDelta?: (delta: string, round: number) => void;
  /** Compatibility callback for a non-streamed intermediate round. */
  onIntermediateText?: (text: string, round: number) => void;
  onUsage?: (usage: ProviderUsage) => void;
  onToolCall?: (call: ProviderToolCall, idempotencyKey: string) => void;
  lookupToolReceipt?: (
    idempotencyKey: string,
    call: ProviderToolCall,
  ) => MobileToolExecutionResult | null | Promise<MobileToolExecutionResult | null>;
  commitToolCall: (committed: CommittedMobileToolCall) => Promise<void>;
  requestRound?: typeof requestProviderRound;
}

function sumUsage(current: ProviderUsage | null, next: ProviderUsage | null): ProviderUsage | null {
  if (!next) return current;
  if (!current) return next;
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    ...(current.costUsd === undefined && next.costUsd === undefined
      ? {}
      : { costUsd: (current.costUsd ?? 0) + (next.costUsd ?? 0) }),
  };
}

function providerResult(
  call: ProviderToolCall,
  execution: MobileToolExecutionResult,
): ProviderToolResult {
  return {
    callId: call.id,
    ...(call.nativeId ? { nativeCallId: call.nativeId } : {}),
    name: call.name,
    output: execution.ok
      ? { ok: true, ...execution.output }
      : { ok: false, code: execution.code, message: execution.message, retryable: execution.retryable },
    ...(!execution.ok ? { isError: true } : {}),
  };
}

const PROVIDER_TOOL_DEFINITIONS: ProviderToolDefinition[] = MOBILE_TOOL_DEFINITIONS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: { ...tool.inputSchema },
}));

/** Applies proposed artifact effects as idempotent upserts, newest effect first. */
export function applyMobileToolArtifactEffects(
  current: readonly StudyArtifact[],
  execution: MobileToolExecutionResult,
): StudyArtifact[] {
  if (!execution.ok) return [...current];
  const proposed = execution.effects.map((effect) => effect.artifact);
  const proposedIds = new Set(proposed.map((artifact) => artifact.id));
  return [...proposed, ...current.filter((artifact) => !proposedIds.has(artifact.id))];
}

/** Runs a bounded provider-native call/result loop and commits each effect before continuation. */
export async function runMobileToolLoop(
  settings: ProviderSettings,
  apiKey: string | null,
  messages: ChatMessage[],
  options: RunMobileToolLoopOptions,
): Promise<MobileToolLoopResult> {
  const {
    fetchImpl,
    sessionId,
    triggeringMessageId,
    createdAt,
    advertiseTools = settings.provider !== "custom",
    onTextDelta,
    onReasoningDelta,
    onIntermediateText,
    onUsage,
    onToolCall,
    lookupToolReceipt,
    commitToolCall,
    requestRound = requestProviderRound,
    ...providerOptions
  } = options;
  let continuation: ProviderRequestOptions["continuation"];
  let usage: ProviderUsage | null = null;
  let totalCalls = 0;
  const executionBySemanticKey = new Map<string, MobileToolExecutionResult>();
  const visibleSegments: string[] = [];

  for (let roundIndex = 0; roundIndex < MAX_PROVIDER_TOOL_ROUNDS; roundIndex += 1) {
    if (providerOptions.signal?.aborted) throw new DOMException("The response was cancelled.", "AbortError");
    let streamedText = "";
    const round: ProviderRound = await requestRound(settings, apiKey, messages, {
      ...providerOptions,
      fetchImpl,
      stream: true,
      tools: advertiseTools ? PROVIDER_TOOL_DEFINITIONS : [],
      continuation,
      onTextDelta: (delta) => {
        streamedText += delta;
        onTextDelta?.(delta, roundIndex);
      },
      onReasoningDelta: (delta) => onReasoningDelta?.(delta, roundIndex),
      });
    usage = sumUsage(usage, round.usage);
    if (usage) onUsage?.(usage);
    if (round.text.trim()) visibleSegments.push(round.text.trim());
    if (round.text.trim() && !streamedText) {
      onTextDelta?.(round.text, roundIndex);
      if (round.calls.length) onIntermediateText?.(round.text, roundIndex);
    }
    if (round.calls.length === 0) {
      if (!round.text.trim()) throw new Error("The provider finished the tool loop without a teaching response.");
      return { text: visibleSegments.join("\n\n"), usage, rounds: roundIndex + 1, toolCalls: totalCalls };
    }
    if (!round.assistantTurn) throw new Error("The provider omitted the assistant turn required to continue tool results.");
    if (round.calls.length > MAX_PROVIDER_CALLS_PER_ROUND) {
      throw new Error(`The provider requested ${round.calls.length} tools in one round; the mobile safety limit is ${MAX_PROVIDER_CALLS_PER_ROUND}.`);
    }
    if (round.text.trim() && streamedText) onIntermediateText?.(round.text, roundIndex);

    const prepared = round.calls.map((call) => {
      const idempotencyKey = mobileToolIdempotencyKey(
        sessionId,
        triggeringMessageId,
        call.name,
        call.arguments,
      );
      if (!validateToolCall({
        id: `call-${idempotencyKey}`,
        name: call.name,
        arguments: call.arguments,
        idempotencyKey,
      })) {
        throw new Error("The provider returned a tool call outside the mobile trace safety bounds.");
      }
      return { call, idempotencyKey };
    });
    const results: ProviderToolResult[] = [];
    for (const { call, idempotencyKey } of prepared) {
      if (providerOptions.signal?.aborted) throw new DOMException("The response was cancelled.", "AbortError");
      const alreadyResolved = executionBySemanticKey.get(idempotencyKey);
      if (alreadyResolved) {
        results.push(providerResult(call, alreadyResolved));
        totalCalls += 1;
        continue;
      }
      onToolCall?.(call, idempotencyKey);
      const receipt = await lookupToolReceipt?.(idempotencyKey, call) ?? null;
      const execution = receipt ?? executeMobileTool(call.name, call.arguments, {
          idempotencyKey,
          createdAt,
          sessionId,
          messageId: triggeringMessageId,
          signal: providerOptions.signal,
          deadlineAt: Date.now() + TOOL_TIMEOUT_MS,
        });
      executionBySemanticKey.set(idempotencyKey, execution);
      await commitToolCall({ call, idempotencyKey, execution, ...(receipt ? { replayed: true } : {}) });
      results.push(providerResult(call, execution));
      totalCalls += 1;
    }
    continuation = continueProviderTurn(round.assistantTurn, results, continuation);
  }

  throw new Error(`The provider exceeded the ${MAX_PROVIDER_TOOL_ROUNDS}-round mobile tool safety limit.`);
}
