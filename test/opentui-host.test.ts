import { describe, expect, test } from "bun:test";

import { cardLines, toolResultCardLines } from "../src/core/cards.js";
import { HostController, type HostSurface } from "../src/tui/host-controller.js";
import type { TranscriptEntry } from "../src/tui/view-model.js";

function deferredTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function harness() {
  let listener: ((event: unknown) => void) | undefined;
  const sent: Array<Record<string, unknown>> = [];
  const entries: TranscriptEntry[] = [];
  const hydrated: TranscriptEntry[][] = [];
  const headers: Array<Record<string, unknown>> = [];
  const client = {
    onEvent(next: (event: unknown) => void) { listener = next; },
    async send(command: Record<string, unknown>) { sent.push(command); },
    async getMessages() { return [{ role: "user", content: "Earlier question", timestamp: 1 }]; },
    async getState() {
      return { model: { provider: "google", id: "gemini" }, thinkingLevel: "high", sessionName: "Limits", sessionId: "s1", isStreaming: false };
    },
    async cycleModel() { return { model: { provider: "openai", id: "gpt" }, thinkingLevel: "medium" }; },
    async cycleThinkingLevel() { return { level: "low" }; },
    async newSession() { return { cancelled: false }; },
    async abort() {},
  };
  const surface: HostSurface = {
    hydrateEntries(next) { hydrated.push(next); },
    appendEntry(entry) { entries.push(entry); },
    setStreaming() {},
    setStatus() {},
    setHeaderState(state) { headers.push(state); },
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
  return { emit: (event: unknown) => listener?.(event), sent, entries, hydrated, headers, controller };
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
    expect(h.entries.map((entry) => entry.body).join("\n")).toContain("Goal: Calculus");
    expect(h.entries.map((entry) => entry.body).join("\n")).toContain("Limits");
  });

  test("hydrates the existing session and publishes header state", async () => {
    const h = harness();
    await h.controller.initialize();
    expect(h.hydrated.at(-1)?.[0]).toMatchObject({ kind: "user", title: "You", body: "Earlier question" });
    expect(h.headers.at(-1)).toEqual({ model: "google/gemini", thinking: "high", session: "Limits", busy: false });
  });

  test("exposes model, thinking, session, and abort controls to the host", async () => {
    const h = harness();
    await h.controller.cycleModel();
    await h.controller.cycleThinking();
    await h.controller.newSession();
    await h.controller.abort();

    expect(h.headers).toContainEqual({ model: "openai/gpt", thinking: "medium" });
    expect(h.headers).toContainEqual({ thinking: "low" });
    expect(h.hydrated.at(-1)).toEqual([]);
    expect(h.entries.map((entry) => entry.title)).toContain("Response stopped");
  });

  test("shows sanitized tool failures instead of silently dropping them", () => {
    const h = harness();
    h.emit({
      type: "tool_execution_end",
      toolName: "read",
      result: "ANTHROPIC_API_KEY=verysecretvalue",
      isError: true,
    });
    expect(h.entries.at(-1)).toMatchObject({ kind: "error", title: "read failed" });
    expect(h.entries.at(-1)?.body).toContain("ANTHROPIC_API_KEY=[redacted]");
    expect(h.entries.at(-1)?.body).not.toContain("verysecretvalue");
  });

  test("explicitly answers unsupported custom UI requests", async () => {
    const h = harness();
    h.emit({ type: "extension_ui_request", id: "custom-1", method: "custom", title: "Rich form" });
    await deferredTick();
    expect(h.entries.at(-1)).toMatchObject({ kind: "error", title: "Unsupported Pi UI request" });
    expect(h.entries.at(-1)?.body).toContain("custom");
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
