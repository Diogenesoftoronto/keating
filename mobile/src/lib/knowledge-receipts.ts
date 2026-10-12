import type { AgentStreamEvent } from "@keating/learner-contracts";
import type { MobileToolExecutionResult } from "./mobile-tools";

/** A durable call intent is enough to forbid uncertain side-effect replay after restart. */
export function mobileKnowledgeAttemptReceipt(events: readonly AgentStreamEvent[] | undefined, key: string): MobileToolExecutionResult | null {
  if (!events?.some(event => event.type === "tool-call" && event.call.name === "call_knowledge_tool" && event.call.idempotencyKey === key)) return null;
  return { ok: false, toolName: "call_knowledge_tool", idempotencyKey: key, code: "execution_failed", message: "This remote call was already requested. Check the external service before starting a new request; returned content is not replayed.", retryable: false, effects: [] };
}
