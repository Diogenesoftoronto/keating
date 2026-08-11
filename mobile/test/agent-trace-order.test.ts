import { describe, expect, it } from "bun:test";
import type { AgentStreamEvent, UiDocument } from "@keating/learner-contracts";
import { hasOrderedToolTrace, orderedAgentTraceItems } from "../src/lib/agent-trace-order";

const document: UiDocument = {
  schemaVersion: 1,
  id: "document-1",
  revision: 0,
  title: "Check understanding",
  lifecycle: "completed",
  supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
  nodes: [{ type: "markdown", id: "node-1", markdown: "Ready." }],
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

const events: AgentStreamEvent[] = [
  { id: "event-1", occurredAt: "2026-08-10T00:00:00.000Z", type: "text-delta", turnId: "turn-1", sequence: 0, text: "I will build it." },
  { id: "event-2", occurredAt: "2026-08-10T00:00:01.000Z", type: "tool-call", turnId: "turn-1", sequence: 1, call: { id: "call-1", name: "generate_study_plan", arguments: { topic: "Bayes" }, idempotencyKey: "tool-key-1" } },
  { id: "event-3", occurredAt: "2026-08-10T00:00:02.000Z", type: "tool-result", turnId: "turn-1", sequence: 2, result: { toolCallId: "call-1", idempotencyKey: "tool-key-1", status: "success", text: "Created." } },
  { id: "event-4", occurredAt: "2026-08-10T00:00:03.000Z", type: "text-delta", turnId: "turn-1", sequence: 3, text: "Now test the first step." },
  { id: "event-5", occurredAt: "2026-08-10T00:00:04.000Z", type: "ui-document", turnId: "turn-1", sequence: 4, document },
  { id: "event-6", occurredAt: "2026-08-10T00:00:05.000Z", type: "completed", turnId: "turn-1", sequence: 5 },
];

describe("orderedAgentTraceItems", () => {
  it("preserves visible text/tool/text/document order and attaches the committed result", () => {
    expect(hasOrderedToolTrace(events)).toBe(true);
    const items = orderedAgentTraceItems(events);
    expect(items.map((item) => item.type)).toEqual(["text", "tool", "text", "document"]);
    expect(items[1]).toMatchObject({ type: "tool", result: { status: "success", text: "Created." } });
  });

  it("removes canonical OpenUI wire JSON from text while retaining its explicit document event", () => {
    const withWire = events.map((event) => event.id === "event-4" ? {
      ...event,
      text: `${event.type === "text-delta" ? event.text : ""}\n\n\`\`\`keating-ui\n${JSON.stringify(document)}\n\`\`\``,
    } as AgentStreamEvent : event);
    const items = orderedAgentTraceItems(withWire);
    expect(items.filter((item) => item.type === "text").map((item) => item.text)).toEqual([
      "I will build it.",
      "Now test the first step.",
    ]);
    expect(items.filter((item) => item.type === "document")).toHaveLength(1);
  });

  it("filters a complete OpenUI fence split across text deltas without double rendering", () => {
    const splitWire: AgentStreamEvent[] = [
      { id: "split-1", occurredAt: "2026-08-10T00:00:00.000Z", type: "text-delta", turnId: "turn-split", sequence: 0, text: "Before\n```ope" },
      { id: "split-2", occurredAt: "2026-08-10T00:00:01.000Z", type: "text-delta", turnId: "turn-split", sequence: 1, text: `nui id=split\n${JSON.stringify(document)}\n\`\`\`\nAfter` },
      { id: "split-3", occurredAt: "2026-08-10T00:00:02.000Z", type: "ui-document", turnId: "turn-split", sequence: 2, document },
      { id: "split-4", occurredAt: "2026-08-10T00:00:03.000Z", type: "completed", turnId: "turn-split", sequence: 3 },
    ];
    const items = orderedAgentTraceItems(splitWire);
    expect(items.filter((item) => item.type === "text")).toEqual([{ type: "text", id: "split-1", text: "Before\nAfter" }]);
    expect(items.filter((item) => item.type === "document")).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain("```openui");
    expect(JSON.stringify(items).match(/Check understanding/g)).toHaveLength(1);
  });

  it("withholds split and fully closed wire during streaming before canonical emission", () => {
    const streaming: AgentStreamEvent[] = [
      { id: "stream-1", occurredAt: "2026-08-10T00:00:00.000Z", type: "text-delta", turnId: "turn-stream", sequence: 0, text: "Visible\n```ope" },
      { id: "stream-2", occurredAt: "2026-08-10T00:00:01.000Z", type: "text-delta", turnId: "turn-stream", sequence: 1, text: `nui\n${JSON.stringify(document)}\n\`\`\`` },
    ];
    expect(orderedAgentTraceItems(streaming)).toEqual([{ type: "text", id: "stream-1", text: "Visible" }]);
  });

  it("leaves plain streamed answers on the established message renderer", () => {
    expect(hasOrderedToolTrace(events.filter((event) => event.type !== "tool-call" && event.type !== "tool-result"))).toBe(false);
  });
});
