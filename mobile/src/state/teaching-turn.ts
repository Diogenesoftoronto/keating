/**
 * One teaching turn, from credential check to the settled assistant message.
 * The turn is a short chain of named steps over a shared `TurnRun`; durable
 * tool-effect commits happen before the tool loop continues, and a
 * cancellation is settled separately from a failure.
 */
import * as Haptics from "expo-haptics";
import { fetch as streamingFetch } from "expo/fetch";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentStreamEvent, NeedleSearchResult, UiDocument } from "@keating/learner-contracts";
import { assertOfflineModelMedia } from "@/lib/offline-model-contract";
import { hydrateMessageAttachments } from "@/lib/composer-attachments";
import { getProviderKey } from "@/lib/storage";
import { providerDefinition } from "@/lib/provider-config";
import { modelSupportsTemperature, modelSupportsToolCalls, resolveModelReasoningLevel, type CatalogModel } from "@/lib/model-catalog";
import { applyMobileToolArtifactEffects, runMobileToolLoop, type CommittedMobileToolCall } from "@/lib/provider-tool-loop";
import { unavailableMobileCapabilityPrompt } from "@/lib/mobile-tools";
import { restoreMobileToolReceipt } from "@/lib/mobile-tool-receipts";
import { isMobileKnowledgeTool } from "@/lib/knowledge-tools";
import { mobileKnowledgeAttemptReceipt } from "@/lib/knowledge-receipts";
import { extractUiDocuments, scopeUiDocument } from "@/lib/ui-document-wire";
import { createId, type ChatMessage, type ChatSession, type PersistedAppState, type ProviderSettings, type ProviderUsage } from "@/lib/types";
import type { MobileToolExecutionContext, MobileToolExecutionResult } from "@/lib/mobile-tools";
import { createStreamBuffer, type StreamBuffer } from "@/state/stream-buffer";
import { contractId, createTurnTrace, type TurnTrace } from "@/state/turn-trace";
import {
  type AccountPedagogy,
  buildTurnSystemPrompt,
  teacherSystemPrompt,
  cancelledTurnEnding,
  credentialFailure,
  failedTurnEnding,
  isAbortedTurn,
  turnErrorMessage,
} from "@/state/turn-policy";
import {
  type ActivityEnv,
  type ActivityRound,
  emptyActivityRound,
  prepareActivityRound,
  publishReleasedActivity,
} from "@/state/teaching-activity";
import type { MemoryAdmission, NeedleRecall } from "@/state/use-learner-evidence";

/** How often buffered stream deltas are committed to React state. */
export const STREAM_FLUSH_INTERVAL_MS = 60;

export interface TurnEnv extends ActivityEnv {
  personaRef: MutableRefObject<string>;
  activePedagogyRef: MutableRefObject<AccountPedagogy | null>;
  catalogRef: MutableRefObject<readonly CatalogModel[]>;
  memoryAdmissionRef: MutableRefObject<MemoryAdmission | null>;
  needleRecallRef: MutableRefObject<NeedleRecall | null>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  generationBusyRef: MutableRefObject<boolean>;
  setIsGenerating: Dispatch<SetStateAction<boolean>>;
  setRawGenerationError: Dispatch<SetStateAction<string | null>>;
  setStreamingMessageId: Dispatch<SetStateAction<string | null>>;
  updateSession(sessionId: string, update: (session: ChatSession) => ChatSession): PersistedAppState;
  commitState(next: PersistedAppState): void;
  persistLearnerState(next: PersistedAppState, required?: boolean): Promise<void>;
  refreshBackgroundActivity(): void;
  executeAgentTool(name: string, args: string | Readonly<Record<string, unknown>>, context: MobileToolExecutionContext): Promise<MobileToolExecutionResult>;
  hasOverlay(overlayId: string): boolean;
  executeKnowledgeTool(name: string, args: string | Readonly<Record<string, unknown>>, context: MobileToolExecutionContext): Promise<MobileToolExecutionResult>;
}

/** Everything one turn shares between its steps. */
interface TurnRun {
  env: TurnEnv;
  controller: AbortController;
  sessionId: string;
  settings: ProviderSettings;
  trace: TurnTrace;
  buffer: StreamBuffer;
  assistantId: string;
  round: ActivityRound;
  usage: ProviderUsage | undefined;
  recalledMemory: { result: NeedleSearchResult; current: () => boolean } | null;
  /** Stops the periodic flush once the provider stream is over. */
  stopFlush(): void;
  writeContent(content: string, usage?: ProviderUsage): PersistedAppState;
  dropPlaceholder(): PersistedAppState;
}

function beginTurn(env: TurnEnv, controller: AbortController): void {
  env.abortControllerRef.current = controller;
  env.generationBusyRef.current = true;
  env.setIsGenerating(true);
  env.setRawGenerationError(null);
}

/** Releases the turn before any stream started (credential problems, early abort). */
function finishBeforeStream(env: TurnEnv, controller: AbortController): void {
  if (env.abortControllerRef.current === controller) env.abortControllerRef.current = null;
  env.generationBusyRef.current = false;
  env.setIsGenerating(false);
}

/** The stored key, `null` for keyless providers, or `undefined` when the turn already ended. */
async function resolveApiKey(env: TurnEnv, controller: AbortController, settings: ProviderSettings): Promise<string | null | undefined> {
  const definition = providerDefinition(settings.provider);
  let apiKey: string | null;
  try {
    apiKey = settings.provider === "litert" ? null : await getProviderKey(settings.provider);
  } catch (error) {
    finishBeforeStream(env, controller);
    env.setRawGenerationError(error instanceof Error ? error.message : "Could not read the provider credential.");
    return undefined;
  }
  if (controller.signal.aborted) {
    finishBeforeStream(env, controller);
    return undefined;
  }
  const failure = credentialFailure(definition, apiKey);
  if (failure) {
    finishBeforeStream(env, controller);
    env.setRawGenerationError(failure);
    return undefined;
  }
  return apiKey;
}

/** Appends the empty assistant message immediately so streamed tokens land in a row the list already renders. */
function openTurn(
  env: TurnEnv,
  controller: AbortController,
  sessionId: string,
  settings: ProviderSettings,
  messages: ChatMessage[],
  trace: TurnTrace,
): TurnRun {
  const assistantId = createId("message");
  const startedAt = Date.now();
  env.updateSession(sessionId, (session) => ({
    ...session,
    messages: [...messages, { id: assistantId, role: "assistant", content: "", createdAt: startedAt }],
    updatedAt: startedAt,
  }));
  env.setStreamingMessageId(assistantId);
  return {
    env, controller, sessionId, settings, trace, assistantId,
    buffer: createStreamBuffer(),
    round: emptyActivityRound(),
    usage: undefined,
    recalledMemory: null,
    stopFlush: () => undefined,
    writeContent: (content, usage) => env.updateSession(sessionId, (session) => ({
      ...session,
      messages: session.messages.map((message) => message.id === assistantId ? {
        ...message,
        content,
        provider: settings.provider,
        model: settings.model,
        ...(trace.events().length ? { agentEvents: trace.cloneEvents() } : {}),
        ...(usage ? { usage } : {}),
      } : message),
      updatedAt: Date.now(),
    })),
    dropPlaceholder: () => env.updateSession(sessionId, (session) => ({
      ...session,
      messages: session.messages.filter((message) => message.id !== assistantId),
    })),
  };
}

/** Recent history with attachments re-read from disk, and the learner message that triggered the turn. */
async function providerHistory(messages: ChatMessage[]) {
  const providerMessages = await Promise.all(messages.slice(-40).map(async (message) => (
    message.attachments?.length
      ? { ...message, attachments: await hydrateMessageAttachments(message.attachments) }
      : message
  )));
  const triggeringMessage = [...providerMessages].reverse().find((message) => message.role === "user");
  if (!triggeringMessage) throw new Error("The tool loop requires a triggering learner message.");
  return { providerMessages, triggeringMessage };
}

/** Local needle recall plus the saved-memory capture, both bound to the current identity. */
async function recallContext(run: TurnRun, triggeringMessage: ChatMessage, recallIdentity: string) {
  const { env, controller, sessionId } = run;
  env.memoryAdmissionRef.current?.cancel();
  const admission = env.memoryAdmissionRef.current!;
  const capture = admission.captureRequest();
  const savedMemory = await admission.prompt();
  const localRecall = await env.needleRecallRef.current!.prompt(env.stateRef.current.sessions, {
    sessionId, messageId: triggeringMessage.id, createdAt: triggeringMessage.createdAt, query: triggeringMessage.content,
  }, {
    signal: controller.signal,
    currentSessions: () => env.stateRef.current.sessions,
    current: () => env.quizIdentityRef.current === recallIdentity && !env.repo.evidenceChanging.current
      && !env.repo.clearing.current && env.stateRef.current.activeSessionId === sessionId,
    onResult: (result, current) => { run.recalledMemory = { result, current }; },
  });
  controller.signal.throwIfAborted();
  return { localRecall, savedMemory, memoryCurrent: () => admission.requestCurrent(capture) };
}

/** Persists the call intent of an external knowledge tool before it dispatches, so it cannot replay after a crash. */
async function persistKnowledgeIntent(run: TurnRun, toolName: string): Promise<void> {
  if (toolName !== "call_knowledge_tool") return;
  const { env, sessionId, assistantId, trace, controller } = run;
  const current = env.stateRef.current;
  const next = { ...current, sessions: current.sessions.map(session => session.id === sessionId ? {
    ...session, messages: session.messages.map(message => message.id === assistantId ? { ...message, agentEvents: trace.cloneEvents() } : message),
  } : session) };
  await env.persistLearnerState(next, true);
  if (controller.signal.aborted) throw new DOMException("The response was cancelled.", "AbortError");
}

/** Commits a tool's effect durably before the loop may continue; a failed commit leaves no trace of it. */
async function commitToolEffect(run: TurnRun, committed: CommittedMobileToolCall): Promise<void> {
  const { env, sessionId, assistantId, settings, trace } = run;
  const eventsBeforeResult = trace.events();
  trace.appendToolResult(committed);
  const current = env.stateRef.current;
  const next: PersistedAppState = {
    ...current,
    artifacts: applyMobileToolArtifactEffects(current.artifacts, committed.execution),
    sessions: current.sessions.map((session) => session.id === sessionId ? {
      ...session,
      messages: session.messages.map((message) => message.id === assistantId ? {
        ...message,
        provider: settings.provider,
        model: settings.model,
        agentEvents: trace.cloneEvents(),
      } : message),
      updatedAt: Date.now(),
    } : session),
  };
  try {
    await env.persistLearnerState(next, true);
  } catch (error) {
    trace.restore(eventsBeforeResult);
    throw error;
  }
  env.commitState(next);
}

function lookupReceipt(run: TurnRun, replayEvents: readonly AgentStreamEvent[] | undefined) {
  return (idempotencyKey: string, call: { name: string }) => isMobileKnowledgeTool(call.name)
    ? call.name === "call_knowledge_tool" ? mobileKnowledgeAttemptReceipt(replayEvents, contractId(idempotencyKey, "tool-key")) : null
    : restoreMobileToolReceipt(
      replayEvents,
      run.env.stateRef.current.artifacts,
      contractId(idempotencyKey, "tool-key"),
      call.name,
      run.env.hasOverlay,
    );
}

interface ToolLoopInputs {
  apiKey: string | null;
  providerMessages: ChatMessage[];
  triggeringMessage: ChatMessage;
  systemPrompt: string;
  replayEvents: readonly AgentStreamEvent[] | undefined;
}

async function runToolLoop(run: TurnRun, inputs: ToolLoopInputs) {
  const { env, controller, settings, trace, buffer, sessionId } = run;
  const { triggeringMessage } = inputs;
  return runMobileToolLoop(settings, inputs.apiKey, inputs.providerMessages, {
    sessionId,
    triggeringMessageId: triggeringMessage.id,
    // The learner turn timestamp is stable across Retry; using the new
    // assistant placeholder timestamp would rewrite an exactly-once effect.
    createdAt: triggeringMessage.createdAt,
    advertiseTools: settings.provider !== "custom" && modelSupportsToolCalls(env.catalogRef.current, settings),
    signal: controller.signal,
    systemPrompt: inputs.systemPrompt,
    reasoningLevel: resolveModelReasoningLevel(env.catalogRef.current, settings, env.uiSettingsRef.current.reasoningLevel),
    supportsTemperature: modelSupportsTemperature(env.catalogRef.current, settings),
    fetchImpl: streamingFetch as unknown as typeof fetch,
    ...(run.round.privateRound ? { requestRound: run.round.privateRound } : {}),
    onTextDelta: (delta) => {
      buffer.append(delta);
      trace.appendText("text-delta", delta);
    },
    onReasoningDelta: (delta) => trace.appendText("reasoning-delta", delta),
    // Keep teaching prose from adjacent provider rounds visually distinct;
    // the tool call/result events remain between those text segments.
    onIntermediateText: () => buffer.separateRound(),
    onUsage: (usage) => { run.usage = usage; },
    onToolCall: (call, key) => trace.appendToolCall(call, key),
    beforeToolExecution: (call) => persistKnowledgeIntent(run, call.name),
    executeTool: (name, args, context) => env.executeAgentTool(name, args, { ...context, knowledge: env.executeKnowledgeTool }),
    lookupToolReceipt: lookupReceipt(run, inputs.replayEvents),
    commitToolCall: (committed) => commitToolEffect(run, committed),
  });
}

/** Publishes the final reply: extracts documents, closes the trace, persists, then records released activity. */
async function publishReply(run: TurnRun, text: string): Promise<void> {
  const { env, trace, buffer, sessionId, assistantId } = run;
  const uiOutput = extractUiDocuments(text);
  buffer.set(uiOutput.content);
  const published: UiDocument[] = [];
  for (const [index, document] of uiOutput.documents.entries()) {
    const scoped = scopeUiDocument(document, `${sessionId}:${assistantId}:${index}`);
    published.push(scoped);
    trace.appendUiDocument(scoped);
  }
  for (const message of uiOutput.errors) trace.appendError(message);
  trace.appendTerminal("completed");
  const publishedAt = Date.parse(trace.lastOccurredAt()!);
  await env.persistLearnerState(run.writeContent(uiOutput.content, run.usage));
  await publishReleasedActivity(env, run.round, {
    sessionId, assistantId, publishedAt, published, parsed: uiOutput.documents, hadDocumentErrors: uiOutput.errors.length > 0,
  });
  env.refreshBackgroundActivity();
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** A stopped response keeps whatever was already streamed; nothing half-finished is shown as complete. */
async function settleCancelled(run: TurnRun): Promise<void> {
  run.trace.appendTerminal("cancelled");
  const pending = run.buffer.pending().trim();
  if (cancelledTurnEnding(pending, run.trace.hasToolResult()) === "keep-partial") {
    await run.env.persistLearnerState(run.writeContent(pending));
  } else {
    await run.env.persistLearnerState(run.dropPlaceholder());
  }
}

/** A failed response leaves no half-message unless tools committed or usage was billed. */
async function settleFailed(run: TurnRun, error: unknown): Promise<void> {
  const errorMessage = turnErrorMessage(error);
  if (failedTurnEnding(run.trace.hasToolResult(), !!run.usage) === "record-failure") {
    run.trace.appendError(errorMessage, true);
    await run.env.persistLearnerState(run.writeContent(run.buffer.pending().trim(), run.usage));
  } else {
    await run.env.persistLearnerState(run.dropPlaceholder());
  }
  run.env.setRawGenerationError(errorMessage);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

/** Always runs: releases the turn and hands any recalled memory to a source-bound review. */
function releaseTurn(run: TurnRun): void {
  const { env, controller, assistantId } = run;
  run.round.stopPreference?.();
  if (env.activityControllerRef.current === controller) env.activityControllerRef.current = null;
  env.setStreamingMessageId((current) => current === assistantId ? null : current);
  if (env.abortControllerRef.current === controller) env.abortControllerRef.current = null;
  env.generationBusyRef.current = false;
  env.setIsGenerating(false);
  // Optional local review must not take the native inference lease ahead of
  // the learner's tutor reply. The callback is source-bound and unawaited.
  if (run.recalledMemory && !controller.signal.aborted) {
    env.memoryAdmissionRef.current?.review(run.recalledMemory.result, run.recalledMemory.current);
  }
}

async function runTurnBody(run: TurnRun, apiKey: string | null, messages: ChatMessage[], replayEvents: readonly AgentStreamEvent[] | undefined) {
  const { env, controller, settings, sessionId } = run;
  if (settings.provider === "litert") assertOfflineModelMedia(messages.slice(-40), settings.model);
  const { providerMessages, triggeringMessage } = await providerHistory(messages);
  const recallIdentity = env.quizIdentityRef.current;
  const teacherPrompt = teacherSystemPrompt({
    persona: env.personaRef.current,
    learnerContext: env.learnerContextRef.current,
    showToolUi: env.uiSettingsRef.current.showToolUi,
    accountPedagogy: env.activePedagogyRef.current,
  });
  const { localRecall, savedMemory, memoryCurrent } = await recallContext(run, triggeringMessage, recallIdentity);
  await prepareActivityRound(env, { controller, sessionId, triggeringMessage, recallIdentity }, run.round);
  const systemPrompt = buildTurnSystemPrompt({
    teacherPrompt,
    localRecall,
    savedMemory: memoryCurrent() ? savedMemory : "",
    unavailableCapabilities: unavailableMobileCapabilityPrompt(),
  });
  const toolLoop = await runToolLoop(run, { apiKey, providerMessages, triggeringMessage, systemPrompt, replayEvents });
  run.usage = toolLoop.usage ?? undefined;
  run.buffer.set(toolLoop.text);
  run.stopFlush();
  await publishReply(run, toolLoop.text);
}

export async function runTeachingTurn(
  env: TurnEnv,
  sessionId: string,
  messages: ChatMessage[],
  replayEvents?: readonly AgentStreamEvent[],
): Promise<void> {
  const settings = env.stateRef.current.providerSettings;
  const controller = new AbortController();
  const trace = createTurnTrace(createId("turn"));
  beginTurn(env, controller);
  const apiKey = await resolveApiKey(env, controller, settings);
  if (apiKey === undefined) return;

  const run = openTurn(env, controller, sessionId, settings, messages, trace);
  const flushTimer = setInterval(() => run.buffer.flush(() => trace.takeDirty(), run.writeContent), STREAM_FLUSH_INTERVAL_MS);
  run.stopFlush = () => clearInterval(flushTimer);
  try {
    await runTurnBody(run, apiKey, messages, replayEvents);
  } catch (error) {
    run.stopFlush();
    if (isAbortedTurn(error, controller.signal.aborted)) {
      await settleCancelled(run);
      return;
    }
    await settleFailed(run, error);
  } finally {
    run.stopFlush();
    releaseTurn(run);
  }
}

