import { describe, expect, it } from "bun:test";
import type { AgentStreamEvent } from "@keating/learner-contracts";
import { durableAgentEvents, interruptedAgentTurn, stripEphemeralReasoning } from "../src/lib/durable-agent-events";
import type { PersistedAppState } from "../src/lib/types";

const events: AgentStreamEvent[] = [{
  id: "event-private",
  occurredAt: "2026-08-10T00:00:00.000Z",
  type: "reasoning-delta",
  turnId: "turn-1",
  sequence: 0,
  text: "untrusted historical thought",
}, {
  id: "event-tool",
  occurredAt: "2026-08-10T00:00:01.000Z",
  type: "tool-call",
  turnId: "turn-1",
  sequence: 1,
  call: { id: "call-1", name: "quiz", arguments: {}, idempotencyKey: "call-1-key" },
}, {
  id: "event-complete",
  occurredAt: "2026-08-10T00:00:02.000Z",
  type: "completed",
  turnId: "turn-1",
  sequence: 2,
}];

describe("durable agent events", () => {
  it("detects a force-killed turn but not an explicitly completed or cancelled turn", () => {
    expect(interruptedAgentTurn(events.slice(0, 2))).toBe(true);
    expect(interruptedAgentTurn([...events.slice(0, 2), {
      id: "event-done", occurredAt: "2026-08-10T00:00:03.000Z", type: "completed", turnId: "turn-1", sequence: 2,
    }])).toBe(false);
    expect(interruptedAgentTurn([{ id: "event-cancel", occurredAt: "2026-08-10T00:00:03.000Z", type: "cancelled", turnId: "turn-1", sequence: 0 }])).toBe(false);
  });
  it("drops unverifiable historical reasoning while preserving tool trace order", () => {
    expect(durableAgentEvents(events)?.map((event) => event.type)).toEqual(["tool-call", "completed"]);
    expect(events.map((event) => event.type)).toEqual(["reasoning-delta", "tool-call", "completed"]);
  });

  it("scrubs reasoning-only events from a compatibility-cache snapshot", () => {
    const state: PersistedAppState = {
      schemaVersion: 4,
      sessions: [{
        id: "session-1",
        title: "Lesson",
        createdAt: 1,
        updatedAt: 2,
        messages: [{ id: "assistant-1", role: "assistant", content: "Answer", createdAt: 1, agentEvents: [events[0]!] }],
      }],
      activeSessionId: "session-1",
      artifacts: [],
      providerSettings: { provider: "openai", model: "gpt-5.4", baseUrl: "https://api.openai.com/v1", temperature: 0.6 },
      learnerFeedback: { helpful: 0, missed: 0 },
    };
    const scrubbed = stripEphemeralReasoning(state);
    expect(scrubbed.sessions[0]?.messages[0]?.agentEvents).toBeUndefined();
    expect(state.sessions[0]?.messages[0]?.agentEvents?.[0]?.type).toBe("reasoning-delta");
  });
});
