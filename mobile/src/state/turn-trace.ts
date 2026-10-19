/**
 * Buffered agent-event trace for one teaching turn. Events are appended
 * immutably so a failed durable commit can roll back to an earlier snapshot.
 */
import { createId } from "@/lib/types";
import type { AgentStreamEvent } from "@keating/learner-contracts";
import type { CommittedMobileToolCall } from "@/lib/provider-tool-loop";

const MAX_TEXT_EVENT_LENGTH = 65_536;

export interface TraceClock {
  id(): string;
  now(): string;
}

const defaultClock: TraceClock = {
  id: () => createId("event"),
  now: () => new Date().toISOString(),
};

/** Provider ids may be unsafe for the shared contract, so ids are cleaned and capped. */
export function contractId(value: string, fallbackPrefix: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : createId(fallbackPrefix);
}

export function toolResultStatus(execution: CommittedMobileToolCall["execution"]): "success" | "retryable" | "error" {
  return execution.ok ? "success" : execution.retryable ? "retryable" : "error";
}

export function toolResultText(execution: CommittedMobileToolCall["execution"]): string {
  return JSON.stringify(execution.ok
    ? execution.output
    : { code: execution.code, message: execution.message, retryable: execution.retryable });
}

export interface TurnTrace {
  /** Current immutable event list; replaced, never mutated, on every append. */
  events(): AgentStreamEvent[];
  /** Deep copy for persisting on a message. */
  cloneEvents(): AgentStreamEvent[];
  hasToolResult(): boolean;
  lastOccurredAt(): string | undefined;
  /** Returns whether anything changed since the last call, and clears the flag. */
  takeDirty(): boolean;
  /** Rolls back to an earlier `events()` snapshot and marks the trace dirty. */
  restore(events: AgentStreamEvent[]): void;
  appendText(type: "text-delta" | "reasoning-delta", text: string): void;
  appendToolCall(call: { id: string; name: string; arguments: Record<string, unknown> }, idempotencyKey: string): void;
  appendToolResult(committed: CommittedMobileToolCall): void;
  appendUiDocument(document: Extract<AgentStreamEvent, { type: "ui-document" }>["document"]): void;
  appendError(message: string, retryable?: boolean): void;
  appendTerminal(type: "completed" | "cancelled"): void;
}

export function createTurnTrace(turnId: string, clock: TraceClock = defaultClock): TurnTrace {
  let sequence = 0;
  let events: AgentStreamEvent[] = [];
  let dirty = false;
  // Key order matches the persisted wire shape: id, occurredAt, type, turnId, sequence, payload.
  const head = <Type extends AgentStreamEvent["type"]>(type: Type) =>
    ({ id: clock.id(), occurredAt: clock.now(), type, turnId, sequence: sequence++ });
  const push = (event: AgentStreamEvent) => {
    events = [...events, event];
    dirty = true;
  };
  return {
    events: () => events,
    cloneEvents: () => structuredClone(events),
    hasToolResult: () => events.some((event) => event.type === "tool-result"),
    lastOccurredAt: () => events.at(-1)?.occurredAt,
    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },
    restore(snapshot) {
      events = snapshot;
      dirty = true;
    },
    appendText(type, text) {
      if (!text) return;
      const previous = events.at(-1);
      if (previous?.type === type && previous.text.length + text.length <= MAX_TEXT_EVENT_LENGTH) {
        events = [...events.slice(0, -1), { ...previous, text: previous.text + text }];
        dirty = true;
      } else {
        push({ ...head(type), text });
      }
    },
    appendToolCall(call, idempotencyKey) {
      // Provider ids may be optional, unsafe for the shared contract, or repeat
      // across rounds. The semantic key is stable and unique within this turn;
      // the exact native id stays private in the provider continuation.
      const callId = contractId(`call-${idempotencyKey}`, "call");
      push({
        ...head("tool-call"),
        call: {
          id: callId,
          name: call.name.slice(0, 128) || "unknown",
          arguments: call.arguments,
          idempotencyKey: contractId(idempotencyKey, "tool-key"),
        },
      });
    },
    appendToolResult(committed) {
      push({
        ...head("tool-result"),
        result: {
          toolCallId: contractId(`call-${committed.idempotencyKey}`, "call"),
          idempotencyKey: contractId(committed.idempotencyKey, "tool-key"),
          status: toolResultStatus(committed.execution),
          text: toolResultText(committed.execution),
        },
      });
    },
    appendUiDocument(document) {
      push({ ...head("ui-document"), document: structuredClone(document) });
    },
    appendError(message, retryable = false) {
      push({ ...head("error"), message: message.slice(0, MAX_TEXT_EVENT_LENGTH), retryable });
    },
    appendTerminal(type) {
      push({ ...head(type) });
    },
  };
}
