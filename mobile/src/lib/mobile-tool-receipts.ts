import type { AgentStreamEvent } from "@keating/learner-contracts";
import type { MobileToolExecutionResult } from "./mobile-tools";
import type { StudyArtifact } from "./types";

const FAILURE_CODES = new Set<Extract<MobileToolExecutionResult, { ok: false }>["code"]>([
  "unknown_tool",
  "malformed_json",
  "invalid_arguments",
  "aborted",
  "timeout",
  "execution_failed",
]);

function parsedRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Rehydrates a previously committed semantic result without reapplying its
 * effect. The durable artifact is required for successful artifact receipts;
 * a missing artifact fails closed instead of acknowledging an effect that no
 * longer exists.
 */
export function restoreMobileToolReceipt(
  events: readonly AgentStreamEvent[] | undefined,
  artifacts: readonly StudyArtifact[],
  idempotencyKey: string,
  toolName: string,
  hasWorkspaceOverlay: (overlayId: string) => boolean = () => false,
): MobileToolExecutionResult | null {
  const call = events?.find((event): event is Extract<AgentStreamEvent, { type: "tool-call" }> => (
    event.type === "tool-call" && event.call.idempotencyKey === idempotencyKey
  ));
  if (!call || call.call.name !== toolName) return null;
  const result = events?.find((event): event is Extract<AgentStreamEvent, { type: "tool-result" }> => (
    event.type === "tool-result"
    && event.result.toolCallId === call.call.id
    && event.result.idempotencyKey === idempotencyKey
  ));
  if (!result) return null;

  const payload = parsedRecord(result.result.text);
  if (result.result.status === "success") {
    if (!payload) return null;
    const artifactId = typeof payload.artifactId === "string" ? payload.artifactId : null;
    const overlayId = typeof payload.overlayId === "string" ? payload.overlayId : null;
    const durableEffectExists = artifactId
      ? artifacts.some((candidate) => candidate.id === artifactId)
      : overlayId ? hasWorkspaceOverlay(overlayId) : toolName === "inspect_mobile_workspace";
    if (!durableEffectExists) return null;
    return {
      ok: true,
      toolName,
      idempotencyKey,
      output: payload,
      // The receipt proves the original effect is already durable. Replaying
      // the provider result must not propose another state mutation.
      effects: [],
    };
  }

  const code = typeof payload?.code === "string" && FAILURE_CODES.has(payload.code as any)
    ? payload.code as Extract<MobileToolExecutionResult, { ok: false }>["code"]
    : "execution_failed";
  const message = typeof payload?.message === "string" && payload.message.trim()
    ? payload.message
    : result.result.text;
  return {
    ok: false,
    toolName,
    idempotencyKey,
    code,
    message,
    retryable: result.result.status === "retryable" || payload?.retryable === true,
    effects: [],
  };
}
