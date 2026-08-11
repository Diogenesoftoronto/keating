import { describe, expect, it } from "bun:test";
import { isChatMessageVisible } from "../src/lib/message-visibility";
import type { ChatMessage } from "../src/lib/types";

function traceMessage(type: "reasoning-delta" | "tool-call"): ChatMessage {
  const base = {
    id: `assistant-${type}`,
    role: "assistant" as const,
    content: "",
    createdAt: 1,
  };
  return type === "reasoning-delta" ? {
    ...base,
    agentEvents: [{
      id: "event-reasoning",
      occurredAt: "2026-08-10T00:00:00.000Z",
      type,
      turnId: "turn-1",
      sequence: 0,
      text: "Checked the assumptions.",
    }],
  } : {
    ...base,
    agentEvents: [{
      id: "event-tool",
      occurredAt: "2026-08-10T00:00:00.000Z",
      type,
      turnId: "turn-1",
      sequence: 0,
      call: { id: "call-1", name: "quiz", arguments: {}, idempotencyKey: "call-1-key" },
    }],
  };
}

describe("chat message visibility", () => {
  it("hides only an empty placeholder", () => {
    expect(isChatMessageVisible({ id: "empty", role: "assistant", content: "", createdAt: 1 })).toBe(false);
    expect(isChatMessageVisible({ id: "text", role: "assistant", content: "Answer", createdAt: 1 })).toBe(true);
  });

  it("keeps reasoning-summary and tool-call-only turns visible", () => {
    expect(isChatMessageVisible(traceMessage("reasoning-delta"))).toBe(true);
    expect(isChatMessageVisible(traceMessage("tool-call"))).toBe(true);
  });
});
