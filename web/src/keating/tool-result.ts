export const MISSING_TOOL_RESULT_MESSAGE =
  "Tool execution ended without returning a result.";

export function hasMeaningfulToolResult(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function toolExecutionSucceeded(event: {
  result?: unknown;
  isError?: boolean;
}): boolean {
  return event.isError !== true && hasMeaningfulToolResult(event.result);
}
