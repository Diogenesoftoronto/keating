import { describe, expect, test } from "bun:test";

import {
  EMPTY_HEADER_STATE,
  activityText,
  headerText,
  sanitizeDiagnostic,
  showActivityRail,
  transcriptEntriesFromMessages,
  transcriptText,
} from "../src/tui/view-model.js";

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

  test("sanitizes and bounds runtime diagnostics", () => {
    const result = sanitizeDiagnostic(`{"ANTHROPIC_API_KEY":"secret-json-value","authorization":"Bearer abc.def.ghi"} ${"x".repeat(900)}`);
    expect(result).toContain('"ANTHROPIC_API_KEY":"[redacted]"');
    expect(result).not.toContain("secret-json-value");
    expect(result).toContain("Bearer [redacted]");
    expect(result.length).toBeLessThanOrEqual(700);
  });

  test("summarizes header state and only shows the activity rail when there is room", () => {
    const state = { ...EMPTY_HEADER_STATE, model: "google/gemini", thinking: "high", session: "limits", busy: true };
    expect(headerText(state)).toBe("KEATING  ·  THINKING  ·  google/gemini  ·  thinking high  ·  limits");
    expect(activityText([{ id: "1", kind: "tool", title: "read", body: "package.json" }], state)).toContain("read");
    expect(showActivityRail(99)).toBe(false);
    expect(showActivityRail(100)).toBe(true);
  });
});
