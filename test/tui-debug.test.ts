import { describe, expect, test } from "bun:test";
import {
  captureTuiDebugEvent,
  tuiDebugMessagesMarkdown,
  tuiDebugSummary,
  tuiProcessDiagnosticsMarkdown,
} from "../src/tui/debug.js";

describe("OpenTUI debug service", () => {
  test("summarizes runtime, context size, provider breadth, and the latest event", () => {
    const event = captureTuiDebugEvent(
      { type: "tool_execution_end", toolName: "search", isError: true },
      "2026-08-26T00:00:00.000Z",
    );
    expect(event).not.toBeNull();
    const markdown = tuiDebugSummary({
      state: {
        model: { provider: "openai-codex", id: "gpt-5" },
        thinkingLevel: "high",
        sessionId: "session-1",
        steeringMode: "all",
        followUpMode: "one-at-a-time",
      },
      messages: [
        { role: "user", content: "Question" },
        { role: "assistant", content: [{ type: "text", text: "Answer" }] },
      ],
      models: [
        { provider: "openai-codex", id: "gpt-5" },
        { provider: "anthropic", id: "claude" },
      ],
      commands: [{ name: "trace", source: "extension" }],
      sessionStats: { tokens: 42 },
      events: [event!],
      processDiagnostics: "",
    });

    expect(markdown).toContain("openai-codex/gpt-5");
    expect(markdown).toContain("user:1 · assistant:1");
    expect(markdown).toContain("2** across **2** providers");
    expect(markdown).toContain("tool_execution_end");
    expect(markdown).toContain("not exposed by this Pi RPC version");
  });

  test("redacts credential-shaped fields from explicit message inspection", () => {
    const markdown = tuiDebugMessagesMarkdown([
      { role: "toolResult", details: { apiKey: "sk-never-show", value: "safe" } },
    ]);
    expect(markdown).not.toContain("sk-never-show");
    expect(markdown).toContain("[credential omitted]");
    expect(markdown).toContain("safe");
  });

  test("sanitizes process diagnostics", () => {
    const markdown = tuiProcessDiagnosticsMarkdown("Authorization: Bearer abc.def\nfailed");
    expect(markdown).not.toContain("abc.def");
    expect(markdown).toContain("Bearer [redacted]");
  });
});
