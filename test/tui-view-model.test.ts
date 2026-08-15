import { describe, expect, test } from "bun:test";

import {
  EMPTY_HEADER_STATE,
  TUI_COMMANDS,
  activityText,
  headerText,
  sanitizeDiagnostic,
  showActivityRail,
  transcriptEntriesFromMessages,
  transcriptMarkdown,
  transcriptText,
} from "../src/tui/view-model.js";
import { createTuiPresentationProfile } from "../src/tui/terminal-profile.js";

describe("TUI view model", () => {
  test("hydrates user, assistant, artifact, and failure entries from RPC history", () => {
    const entries = transcriptEntriesFromMessages([
      { role: "user", content: "Explain limits", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "Start with approach." }], stopReason: "stop", timestamp: 2 },
      {
        role: "toolResult",
        toolCallId: "goal-1",
        toolName: "set_learner_goal",
        content: [{ type: "text", text: "Goal saved" }],
        details: { goal: { title: "Calculus", steps: [{ title: "Limits", status: "active" }] } },
        isError: false,
        timestamp: 3,
      },
      {
        role: "toolResult",
        toolCallId: "read-1",
        toolName: "read",
        content: [{ type: "text", text: "OPENAI_API_KEY=supersecretvalue\u001b[31m" }],
        isError: true,
        timestamp: 4,
      },
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(["user", "assistant", "artifact", "error"]);
    expect(transcriptText(entries)).toContain("Goal: Calculus");
    expect(transcriptText(entries)).toContain("read failed");
    expect(transcriptText(entries)).toContain("OPENAI_API_KEY=[redacted]");
    expect(transcriptText(entries)).not.toContain("supersecretvalue");
  });

  test("hydrates an empty tool result as a failure instead of completion", () => {
    const entries = transcriptEntriesFromMessages([
      {
        role: "toolResult",
        toolCallId: "search-1",
        toolName: "web_search",
        content: undefined,
        details: undefined,
        isError: false,
        timestamp: 1,
      },
    ]);

    expect(entries).toEqual([
      expect.objectContaining({
        kind: "error",
        title: "web_search failed",
        body: "Tool execution ended without returning a result.",
      }),
    ]);
  });

  test("sanitizes and bounds runtime diagnostics", () => {
    const result = sanitizeDiagnostic(`{"ANTHROPIC_API_KEY":"secret-json-value","authorization":"Bearer abc.def.ghi"} ${"x".repeat(900)}`);
    expect(result).toContain('"ANTHROPIC_API_KEY":"[redacted]"');
    expect(result).not.toContain("secret-json-value");
    expect(result).toContain("Bearer [redacted]");
    expect(result.length).toBeLessThanOrEqual(700);
  });

  test("truncates transcript chrome while preserving the full response body", () => {
    const title = "A tool response title that is much wider than the available terminal transcript";
    const body = "This complete response must remain available even when its label is shortened.";
    const markdown = transcriptMarkdown(
      [{ id: "wide", kind: "tool", title, body }],
      null,
      createTuiPresentationProfile({ TERM: "xterm", KEATING_ASCII: "1" }),
      36,
    );
    expect(markdown).toContain("…");
    expect(markdown).not.toContain(title);
    expect(markdown).toContain(body);
  });

  test("summarizes header state and only shows the activity rail when there is room", () => {
    const state = { ...EMPTY_HEADER_STATE, model: "google/gemini", thinking: "high", session: "limits", busy: true };
    const profile = createTuiPresentationProfile({ TERM: "xterm-256color", LANG: "en_CA.UTF-8" });
    expect(headerText(state, profile)).toBe("◆ keating  limits  ·  google/gemini  ·  high  ·  ◐ working");
    expect(activityText([{ id: "1", kind: "tool", title: "read", body: "package.json" }], state, profile)).toContain("read");
    expect(showActivityRail(99)).toBe(false);
    expect(showActivityRail(100)).toBe(true);
  });

  test("exposes the connected product surfaces through the command catalog", () => {
    expect(TUI_COMMANDS.map((command) => command.id)).toEqual([
      "setup",
      "sessions",
      "library",
      "review",
      "courses",
      "share",
      "settings",
      "model",
      "thinking",
      "new-session",
      "abort",
      "retry",
      "shell",
    ]);
    expect(TUI_COMMANDS.find((command) => command.id === "library")?.shortcut).toBe("Ctrl+L");
  });
});
