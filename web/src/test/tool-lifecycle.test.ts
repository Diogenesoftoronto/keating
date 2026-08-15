import { describe, expect, it } from "bun:test";
import {
  foldedToolResult,
  MISSING_TOOL_RESULT_MESSAGE,
  resolveToolVisualState,
  toolCallEndedWithoutResult,
  toolCallIsPending,
} from "../components/tool-lifecycle";

describe("tool lifecycle", () => {
  it("does not infer tool success from the assistant message status", () => {
    expect(
      resolveToolVisualState({ result: undefined, status: { type: "running" } }),
    ).toBe("running");
    expect(
      resolveToolVisualState({ result: undefined, status: { type: "complete" } }),
    ).toBe("running");
    expect(
      resolveToolVisualState({
        result: undefined,
        status: { type: "incomplete" },
      }),
    ).toBe("error");
    expect(resolveToolVisualState({ result: "ok", isError: true })).toBe(
      "error",
    );
  });

  it("treats an acknowledged empty result as a terminal error", () => {
    const pending = { type: "toolCall" };
    const emptyResult = {
      type: "toolCall",
      __toolResultReceived: true,
      __toolResult: undefined,
      __toolDetails: undefined,
    };

    expect(toolCallIsPending(pending)).toBe(true);
    expect(toolCallIsPending(emptyResult)).toBe(false);
    expect(foldedToolResult(emptyResult)).toBeUndefined();
    expect(toolCallEndedWithoutResult(emptyResult, true)).toBe(true);
    expect(MISSING_TOOL_RESULT_MESSAGE).toContain("without returning a result");
  });

  it("keeps active calls pending and fails unresolved calls after the run", () => {
    const unresolved = { type: "toolCall", __toolError: false };

    expect(toolCallIsPending(unresolved)).toBe(true);
    expect(toolCallEndedWithoutResult(unresolved, true)).toBe(false);
    expect(toolCallEndedWithoutResult(unresolved, false)).toBe(true);
  });

  it("accepts a meaningful legacy result without a receipt marker", () => {
    const legacy = { type: "toolCall", __toolResult: "done" };

    expect(toolCallIsPending(legacy)).toBe(false);
    expect(foldedToolResult(legacy)).toBe("done");
    expect(toolCallEndedWithoutResult(legacy, false)).toBe(false);
  });
});
