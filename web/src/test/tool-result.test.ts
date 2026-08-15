import { describe, expect, it } from "bun:test";
import {
  hasMeaningfulToolResult,
  toolExecutionSucceeded,
} from "../keating/tool-result";

describe("tool result contract", () => {
  it("requires a meaningful result before reporting success", () => {
    expect(toolExecutionSucceeded({ result: "done", isError: false })).toBe(true);
    expect(toolExecutionSucceeded({ result: undefined, isError: false })).toBe(false);
    expect(toolExecutionSucceeded({ result: null })).toBe(false);
    expect(toolExecutionSucceeded({ result: "  " })).toBe(false);
    expect(toolExecutionSucceeded({ result: {}, isError: false })).toBe(false);
    expect(toolExecutionSucceeded({ result: [], isError: false })).toBe(false);
    expect(toolExecutionSucceeded({ result: "done", isError: true })).toBe(false);
  });

  it("accepts structured non-empty tool results", () => {
    expect(hasMeaningfulToolResult({ content: [] })).toBe(true);
    expect(hasMeaningfulToolResult([{ type: "image" }])).toBe(true);
  });
});
