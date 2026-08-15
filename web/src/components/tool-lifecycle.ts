export type ToolVisualState = "running" | "success" | "error";

import {
  hasMeaningfulToolResult,
  MISSING_TOOL_RESULT_MESSAGE,
} from "../keating/tool-result";

export { hasMeaningfulToolResult, MISSING_TOOL_RESULT_MESSAGE };

export function resolveToolVisualState({
  result,
  isError,
  status,
}: {
  result: unknown;
  isError?: boolean;
  status?: { type?: string };
}): ToolVisualState {
  if (isError || status?.type === "incomplete") return "error";
  if (hasMeaningfulToolResult(result)) return "success";
  return "running";
}

export function toolCallIsPending(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const value = part as Record<string, unknown>;
  return (
    value.type === "toolCall" &&
    value.__toolResultReceived !== true &&
    !hasMeaningfulToolResult(value.__toolResult) &&
    !hasMeaningfulToolResult(value.__toolDetails) &&
    value.__toolError !== true
  );
}

export function foldedToolResult(part: Record<string, unknown>): unknown {
  if (hasMeaningfulToolResult(part.__toolResult)) return part.__toolResult;
  if (hasMeaningfulToolResult(part.__toolDetails)) return part.__toolDetails;
  return undefined;
}

export function toolCallEndedWithoutResult(
  part: Record<string, unknown>,
  callIsActive: boolean,
): boolean {
  if (part.__toolError === true) return false;
  if (foldedToolResult(part) !== undefined) return false;
  return part.__toolResultReceived === true || !callIsActive;
}
