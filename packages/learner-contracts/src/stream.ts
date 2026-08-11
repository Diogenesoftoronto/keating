import type { LearnerArtifact } from "./learning.js";
import { validateLearnerArtifact } from "./learning.js";
import { validateUiDocument, type UiDocument } from "./ui.js";
import { hasOnlyKeys, hasUniqueIds, isBoundedArray, isBoundedJsonValue, isBoundedString, isContractId, isContractTimestamp, isRecord } from "./validation.js";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ToolResult {
  toolCallId: string;
  idempotencyKey: string;
  status: "success" | "error" | "retryable";
  text: string;
}

export type AgentStreamEvent =
  | { id: string; occurredAt: string; type: "text-delta"; turnId: string; sequence: number; text: string }
  | { id: string; occurredAt: string; type: "reasoning-delta"; turnId: string; sequence: number; text: string }
  | { id: string; occurredAt: string; type: "tool-call"; turnId: string; sequence: number; call: ToolCall }
  | { id: string; occurredAt: string; type: "tool-result"; turnId: string; sequence: number; result: ToolResult }
  | { id: string; occurredAt: string; type: "ui-document"; turnId: string; sequence: number; document: UiDocument }
  | { id: string; occurredAt: string; type: "artifact-emitted"; turnId: string; sequence: number; artifact: LearnerArtifact }
  | { id: string; occurredAt: string; type: "usage"; turnId: string; sequence: number; inputTokens: number; outputTokens: number }
  | { id: string; occurredAt: string; type: "error"; turnId: string; sequence: number; message: string; retryable: boolean }
  | { id: string; occurredAt: string; type: "completed"; turnId: string; sequence: number }
  | { id: string; occurredAt: string; type: "cancelled"; turnId: string; sequence: number };

const MAX_STREAM_EVENTS = 10_000;
const MAX_STREAM_TEXT = 65_536;
const MAX_TOOL_ARGUMENTS = 128;
const MAX_USAGE_TOKENS = 100_000_000;
const TOOL_CALL_KEYS = new Set(["id", "name", "arguments", "idempotencyKey"]);
const TOOL_RESULT_KEYS = new Set(["toolCallId", "idempotencyKey", "status", "text"]);
const EVENT_KEYS: Readonly<Record<AgentStreamEvent["type"], ReadonlySet<string>>> = {
  "text-delta": new Set(["id", "occurredAt", "type", "turnId", "sequence", "text"]),
  "reasoning-delta": new Set(["id", "occurredAt", "type", "turnId", "sequence", "text"]),
  "tool-call": new Set(["id", "occurredAt", "type", "turnId", "sequence", "call"]),
  "tool-result": new Set(["id", "occurredAt", "type", "turnId", "sequence", "result"]),
  "ui-document": new Set(["id", "occurredAt", "type", "turnId", "sequence", "document"]),
  "artifact-emitted": new Set(["id", "occurredAt", "type", "turnId", "sequence", "artifact"]),
  usage: new Set(["id", "occurredAt", "type", "turnId", "sequence", "inputTokens", "outputTokens"]),
  error: new Set(["id", "occurredAt", "type", "turnId", "sequence", "message", "retryable"]),
  completed: new Set(["id", "occurredAt", "type", "turnId", "sequence"]),
  cancelled: new Set(["id", "occurredAt", "type", "turnId", "sequence"]),
};

export function validateToolCall(value: unknown): value is ToolCall {
  return isRecord(value) && hasOnlyKeys(value, TOOL_CALL_KEYS) && isContractId(value.id) && isBoundedString(value.name, 128, false)
    && isRecord(value.arguments) && isBoundedJsonValue(value.arguments, { maximumDepth: 8, maximumItems: MAX_TOOL_ARGUMENTS, maximumStringLength: MAX_STREAM_TEXT })
    && isContractId(value.idempotencyKey);
}

export function validateToolResult(value: unknown): value is ToolResult {
  return isRecord(value) && hasOnlyKeys(value, TOOL_RESULT_KEYS) && isContractId(value.toolCallId) && isContractId(value.idempotencyKey)
    && (value.status === "success" || value.status === "error" || value.status === "retryable")
    && isBoundedString(value.text, MAX_STREAM_TEXT);
}

export function validateAgentStreamEvent(value: unknown): value is AgentStreamEvent {
  if (!isRecord(value) || !isContractId(value.id) || !isContractTimestamp(value.occurredAt)
    || !isContractId(value.turnId) || typeof value.sequence !== "number"
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0) return false;
  if (typeof value.type !== "string" || !(value.type in EVENT_KEYS) || !hasOnlyKeys(value, EVENT_KEYS[value.type as AgentStreamEvent["type"]])) return false;
  switch (value.type) {
    case "text-delta": case "reasoning-delta": return isBoundedString(value.text, MAX_STREAM_TEXT);
    case "tool-call": return validateToolCall(value.call);
    case "tool-result": return validateToolResult(value.result);
    case "ui-document": return validateUiDocument(value.document);
    case "artifact-emitted": return validateLearnerArtifact(value.artifact);
    case "usage": return typeof value.inputTokens === "number" && Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 0 && value.inputTokens <= MAX_USAGE_TOKENS
      && typeof value.outputTokens === "number" && Number.isSafeInteger(value.outputTokens) && value.outputTokens >= 0 && value.outputTokens <= MAX_USAGE_TOKENS;
    case "error": return isBoundedString(value.message, MAX_STREAM_TEXT, false) && typeof value.retryable === "boolean";
    case "completed": case "cancelled": return true;
    default: return false;
  }
}

/** A turn must have unique event/call/result identities and results can acknowledge only preceding calls. */
export function validateAgentStream(events: unknown): events is AgentStreamEvent[] {
  if (!isBoundedArray(events, MAX_STREAM_EVENTS) || !events.every(validateAgentStreamEvent) || !hasUniqueIds(events)) return false;
  const calls = new Map<string, ToolCall>();
  const callIdempotencyKeys = new Set<string>();
  const resultCallIds = new Set<string>();
  const resultIdempotencyKeys = new Set<string>();
  const sequences = new Set<number>();
  const turnId = events[0]?.turnId;
  let previousSequence = -1;
  let terminal = false;
  for (const event of events) {
    if (event.turnId !== turnId || terminal || sequences.has(event.sequence) || event.sequence <= previousSequence) return false;
    sequences.add(event.sequence);
    previousSequence = event.sequence;
    if (event.type === "tool-call") {
      if (calls.has(event.call.id) || callIdempotencyKeys.has(event.call.idempotencyKey)) return false;
      calls.set(event.call.id, event.call);
      callIdempotencyKeys.add(event.call.idempotencyKey);
    }
    if (event.type === "tool-result") {
      const call = calls.get(event.result.toolCallId);
      if (!call || call.idempotencyKey !== event.result.idempotencyKey
        || resultCallIds.has(event.result.toolCallId)
        || resultIdempotencyKeys.has(event.result.idempotencyKey)) return false;
      resultCallIds.add(event.result.toolCallId);
      resultIdempotencyKeys.add(event.result.idempotencyKey);
    }
    if (event.type === "completed" || event.type === "cancelled") terminal = true;
  }
  return true;
}
