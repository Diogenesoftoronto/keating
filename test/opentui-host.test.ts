import { describe, expect, test } from "bun:test";

import { cardLines, toolResultCardLines } from "../src/core/cards.js";
import { HostController, type HostSurface } from "../src/tui/host-controller.js";

function deferredTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function harness() {
  let listener: ((event: unknown) => void) | undefined;
  const sent: Array<Record<string, unknown>> = [];
  const turns: string[] = [];
  const client = {
    onEvent(next: (event: unknown) => void) { listener = next; },
    async send(command: Record<string, unknown>) { sent.push(command); },
  };
  const surface: HostSurface = {
    appendTurn(text) { turns.push(text); },
    setStreaming() {},
    setStatus() {},
    setBusy() {},
    setEditorText() {},
    setWidget() {},
    setTitle() {},
    async presentSelect(_title, options) { return options.at(-1); },
    async presentConfirm() { return true; },
    async presentInput() { return "typed"; },
    async presentEditor() { return undefined; },
  };
  const controller = new HostController(client, surface);
  controller.attach();
  return { emit: (event: unknown) => listener?.(event), sent, turns };
}

describe("OpenTUI host controller", () => {
  test("answers RPC dialogs instead of cancelling Pi extension UI", async () => {
    const h = harness();
    h.emit({ type: "extension_ui_request", id: "s", method: "select", title: "Pick", options: ["a", "b"] });
    h.emit({ type: "extension_ui_request", id: "i", method: "input", title: "Why?" });
    h.emit({ type: "extension_ui_request", id: "e", method: "editor", title: "Edit" });
    await deferredTick();

    expect(h.sent).toEqual([
      { type: "extension_ui_response", id: "s", value: "b" },
      { type: "extension_ui_response", id: "i", value: "typed" },
      { type: "extension_ui_response", id: "e", cancelled: true },
    ]);
  });

  test("turns finished tool results into generative cards", () => {
    const h = harness();
    h.emit({
      type: "tool_execution_end",
      toolName: "set_learner_goal",
      result: { details: { goal: { title: "Calculus", status: "active", steps: [{ order: 0, title: "Limits", status: "in_progress" }] } } },
      isError: false,
    });
    expect(h.turns.join("\n")).toContain("Goal: Calculus");
    expect(h.turns.join("\n")).toContain("Limits");
  });

  test("explicitly answers unsupported custom UI requests", async () => {
    const h = harness();
    h.emit({ type: "extension_ui_request", id: "custom-1", method: "custom", title: "Rich form" });
    await deferredTick();
    expect(h.turns.join("\n")).toContain("Unsupported Pi UI request: custom");
    expect(h.sent).toContainEqual({ type: "extension_ui_response", id: "custom-1", cancelled: true, reason: "unsupported_ui_request" });
  });

  test("renders every serializable UI document family with a generic fallback", () => {
    const fixtures = [
      ["quiz", { topic: "Math", questions: [{ prompt: "Why?" }] }],
      ["question", { fields: [{ prompt: "Explain" }] }],
      ["goal", { title: "Learn", steps: [{ title: "Start", status: "active" }] }],
      ["deck", { title: "Cards", cards: [{ front: "A", back: "B" }] }],
      ["image", { title: "Diagram", alt: "A graph", url: "https://example.test/a.png" }],
      ["scene", { topic: "Motion", summary: "Moving point" }],
      ["artifact", { label: "Plan", uri: "artifact://plan/1" }],
      ["generic", { format: "json", data: { ok: true } }],
    ] as const;
    for (const [kind, payload] of fixtures) {
      const lines = toolResultCardLines("ui_document", { protocol: "keating.ui", version: 1, id: kind, revision: 0, kind, payload });
      expect(lines?.length).toBeGreaterThan(3);
    }
  });
});

describe("plain terminal cards", () => {
  test("keep a stable width and render search citations", () => {
    expect(new Set(cardLines("Heading", ["body"]).map((line) => line.length))).toEqual(new Set([76]));
    const lines = toolResultCardLines("web_search", {
      details: { query: "full duplex", citations: [{ title: "Realtime docs", url: "https://example.test" }] },
    });
    expect(lines?.join("\n")).toContain("Web Search: full duplex");
    expect(lines?.join("\n")).toContain("Realtime docs");
  });
});
