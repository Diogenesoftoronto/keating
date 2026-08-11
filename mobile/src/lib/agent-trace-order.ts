import type { AgentStreamEvent, ToolCall, ToolResult, UiDocument } from "@keating/learner-contracts";
import { extractUiDocuments, hideUiDocumentWireWhileStreaming } from "./ui-document-wire";

export type OrderedAgentTraceItem =
  | { type: "text"; id: string; text: string }
  | { type: "reasoning"; id: string; text: string }
  | { type: "tool"; id: string; call: ToolCall; result?: ToolResult }
  | { type: "document"; id: string; document: UiDocument }
  | { type: "error"; id: string; message: string };

/** New streamed tool turns render from their event log instead of hoisting tools above prose. */
export function hasOrderedToolTrace(events: readonly AgentStreamEvent[] | undefined): boolean {
  return Boolean(events?.some((event) => event.type === "tool-call")
    && events.some((event) => event.type === "text-delta"));
}

/** Projects durable stream events into learner-visible rows without exposing raw OpenUI wire JSON. */
export function orderedAgentTraceItems(events: readonly AgentStreamEvent[]): OrderedAgentTraceItem[] {
  const results = new Map(events
    .filter((event): event is Extract<AgentStreamEvent, { type: "tool-result" }> => event.type === "tool-result")
    .map((event) => [event.result.toolCallId, event.result]));
  const items: OrderedAgentTraceItem[] = [];
  const terminal = events.some((event) => event.type === "completed" || event.type === "cancelled");
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex]!;
    if (event.type === "text-delta") {
      let textRun = event.text;
      let nextIndex = eventIndex + 1;
      while (events[nextIndex]?.type === "text-delta") {
        textRun += (events[nextIndex] as Extract<AgentStreamEvent, { type: "text-delta" }>).text;
        nextIndex += 1;
      }
      eventIndex = nextIndex - 1;
      const text = (terminal
        ? extractUiDocuments(textRun).content
        : hideUiDocumentWireWhileStreaming(textRun)).trim();
      if (text) items.push({ type: "text", id: event.id, text });
    } else if (event.type === "reasoning-delta") {
      const previous = items.at(-1);
      if (previous?.type === "reasoning") previous.text += event.text;
      else items.push({ type: "reasoning", id: event.id, text: event.text });
    } else if (event.type === "tool-call") {
      items.push({ type: "tool", id: event.id, call: event.call, result: results.get(event.call.id) });
    } else if (event.type === "ui-document") {
      items.push({ type: "document", id: event.id, document: event.document });
    } else if (event.type === "error") {
      items.push({ type: "error", id: event.id, message: event.message });
    }
  }
  return items;
}
