import { describe, expect, test } from "bun:test";

import { cardLines, toolResultCardLines } from "../src/core/cards.js";
import { HostController, type HostClientLike, type HostSurface, type UiDocumentControl } from "../src/tui/host-controller.js";
import type { TranscriptEntry } from "../src/tui/view-model.js";
import type { UiAction, UiActionDispatcher, UiDocument } from "@keating/learner-contracts";

function deferredTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function documentFixture(lifecycle: UiDocument["lifecycle"] = "ready"): UiDocument {
  return {
    schemaVersion: 1,
    id: "terminal-doc",
    revision: 3,
    lifecycle,
    supportedSurfaces: ["terminal", "web"],
    title: "Terminal learning",
    nodes: [
      { type: "question", id: "choice-question", prompt: "Choose", choices: [{ id: "right", label: "Right" }, { id: "wrong", label: "Wrong" }] },
      { type: "question-group", id: "group", title: "Grouped", questions: [{ id: "group-text", prompt: "Explain" }] },
      { type: "quiz", id: "quiz", title: "Quiz", questions: [{ id: "quiz-text", prompt: "Why?" }] },
      { type: "goal", id: "goal", title: "Goal", status: "active", steps: [{ id: "goal-step", title: "Do it", status: "not_started" }] },
      { type: "study-plan", id: "plan", title: "Plan", items: [{ id: "plan-item", title: "Read", status: "not_started" }] },
      { type: "notes", id: "notes", title: "Notes", value: "Draft" },
      { type: "deck", id: "deck", title: "Deck", topic: "Topic", cards: [{ id: "card", front: "Front", back: "Back" }] },
      { type: "artifact", id: "artifact", resource: { id: "resource", title: "Plan", format: "markdown", content: "# Plan" } },
      { type: "concept-map", id: "map", source: "flowchart TD\nA-->B" },
      { type: "media", id: "media", kind: "video", resource: { id: "video", title: "Video", format: "uri", uri: "https://example.test/video" } },
      { type: "handoff", id: "handoff", target: "web", reason: "Interactive view", context: "session=1" },
    ],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

function harness(dispatcher?: UiActionDispatcher, clientOverrides: Partial<HostClientLike> = {}) {
  let listener: ((event: unknown) => void) | undefined;
  const sent: Array<Record<string, unknown>> = [];
  const entries: TranscriptEntry[] = [];
  const hydrated: TranscriptEntry[][] = [];
  const headers: Array<Record<string, unknown>> = [];
  const editorTexts: string[] = [];
  const documents: Array<{ document: UiDocument | null; controls: readonly UiDocumentControl[] }> = [];
    const client = {
      onEvent(next: (event: unknown) => void) { listener = next; },
      async respondToExtensionUI(command: Record<string, unknown>) { sent.push(command); },
    async getMessages() { return [{ role: "user", content: "Earlier question", timestamp: 1 }]; },
    async getState() {
      return { model: { provider: "google", id: "gemini" }, thinkingLevel: "high", sessionName: "Limits", sessionId: "s1", isStreaming: false };
    },
    async cycleModel() { return { model: { provider: "openai", id: "gpt" }, thinkingLevel: "medium" }; },
    async cycleThinkingLevel() { return { level: "low" }; },
    async newSession() { return { cancelled: false }; },
    async abort() {},
    ...clientOverrides,
  };
  const surface: HostSurface = {
    hydrateEntries(next) { hydrated.push(next); },
    appendEntry(entry) { entries.push(entry); },
    setStreaming() {},
    setStatus() {},
    setHeaderState(state) { headers.push(state); },
    setEditorText(text) { editorTexts.push(text); },
    setWidget() {},
    setTitle() {},
    setUiDocument(document, controls) { documents.push({ document, controls }); },
    async presentSelect(_title, options) { return options.at(-1); },
    async presentConfirm() { return true; },
    async presentInput() { return "typed"; },
    async presentEditor() { return undefined; },
  };
  const controller = new HostController(client, surface, { uiActionDispatcher: dispatcher });
  controller.attach();
  return { emit: (event: unknown) => listener?.(event), sent, entries, hydrated, headers, editorTexts, documents, controller };
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
    expect(h.controller.getActiveUiDocument()?.nodes[0]).toMatchObject({ type: "goal", title: "Calculus" });
    expect(h.documents.at(-1)?.controls.map((control) => control.label)).toContain("Complete goal step: Limits");
  });

  test("activates a canonical OpenUI document carried by a real tool result", () => {
    const h = harness();
    const document = documentFixture();
    h.emit({ type: "tool_execution_end", toolName: "keating_ui", result: { uiDocument: document }, isError: false });

    expect(h.controller.getActiveUiDocument()).toEqual(document);
    expect(h.documents.at(-1)?.document).toEqual(document);
    expect(h.entries.at(-1)).toMatchObject({ kind: "artifact", title: "Terminal learning" });
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

  test("resumes, renames, clones, and forks through the real Pi RPC session operations", async () => {
    const calls: Array<[string, string?]> = [];
    let state = {
      model: { provider: "google", id: "gemini" },
      thinkingLevel: "high",
      sessionName: "Original",
      sessionId: "s1",
      sessionFile: "/sessions/original.jsonl",
      isStreaming: false,
    };
    const h = harness(undefined, {
      async getMessages() { return [{ role: "user", content: `Question in ${state.sessionName}`, timestamp: 1 }]; },
      async getState() { return state; },
      async switchSession(path) {
        calls.push(["switch", path]);
        state = { ...state, sessionName: "Resumed", sessionId: "s2", sessionFile: path };
        return { cancelled: false };
      },
      async setSessionName(name) {
        calls.push(["rename", name]);
        state = { ...state, sessionName: name };
      },
      async clone() {
        calls.push(["clone"]);
        state = { ...state, sessionName: "Fork", sessionId: "s3", sessionFile: "/sessions/fork.jsonl" };
        return { cancelled: false };
      },
      async getForkMessages() {
        calls.push(["fork-messages"]);
        return [{ entryId: "turn-1", text: "Earlier exact prompt" }];
      },
      async fork(entryId) {
        calls.push(["fork-turn", entryId]);
        return { text: "Earlier exact prompt", cancelled: false };
      },
    });

    await h.controller.initialize();
    expect(h.controller.getCurrentSessionPath()).toBe("/sessions/original.jsonl");
    expect(await h.controller.resumeSession("/sessions/resumed.jsonl")).toBe(true);
    expect(h.controller.getCurrentSessionPath()).toBe("/sessions/resumed.jsonl");
    expect(h.documents.at(-1)).toEqual({ document: null, controls: [] });
    expect(await h.controller.renameCurrentSession("  Calculus branch  ")).toBe(true);
    expect(await h.controller.cloneCurrentSession()).toBe(true);
    expect(h.controller.getCurrentSessionPath()).toBe("/sessions/fork.jsonl");
    expect(await h.controller.forkMessages()).toEqual([{ entryId: "turn-1", text: "Earlier exact prompt" }]);
    expect(await h.controller.forkFromMessage("turn-1")).toBe(true);
    expect(h.editorTexts.at(-1)).toBe("Earlier exact prompt");
    expect(calls).toEqual([
      ["switch", "/sessions/resumed.jsonl"],
      ["rename", "Calculus branch"],
      ["clone"],
      ["fork-messages"],
      ["fork-turn", "turn-1"],
    ]);
    expect(h.entries.map((entry) => entry.title)).toEqual(expect.arrayContaining([
      "Session resumed", "Session renamed", "Session forked", "Fork ready",
    ]));
  });

  test("keeps the active session when switching is cancelled or a rename is empty", async () => {
    const h = harness(undefined, {
      async switchSession() { return { cancelled: true }; },
    });
    await h.controller.initialize();

    expect(await h.controller.resumeSession("/sessions/blocked.jsonl")).toBe(false);
    expect(await h.controller.renameCurrentSession("   ")).toBe(false);
    expect(h.controller.getCurrentSessionPath()).toBeUndefined();
    expect(h.entries.map((entry) => entry.title)).toEqual(expect.arrayContaining([
      "Session switch cancelled", "Session name unchanged",
    ]));
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

  test("presents a focused canonical document with discoverable controls for every terminal action", () => {
    const h = harness();
    const document = documentFixture();
    h.emit({ type: "ui_document", document });

    expect(h.controller.getActiveUiDocument()).toEqual(document);
    expect(h.entries.at(-1)).toMatchObject({ kind: "artifact", title: "Terminal learning" });
    const labels = h.documents.at(-1)?.controls.map((control) => control.label) ?? [];
    expect(labels.join("\n")).toContain("Answer question");
    expect(labels.join("\n")).toContain("Submit question group");
    expect(labels.join("\n")).toContain("Take quiz");
    expect(labels.join("\n")).toContain("Complete goal step");
    expect(labels.join("\n")).toContain("Complete plan item");
    expect(labels.join("\n")).toContain("Edit notes");
    expect(labels.join("\n")).toContain("Rate card");
    expect(labels.join("\n")).toContain("Complete deck");
    expect(labels.join("\n")).toContain("Save artifact");
    expect(labels.join("\n")).toContain("Map handoff");
    expect(labels.join("\n")).toContain("Open handoff");
  });

  test("keeps the current document visible when a future document cannot be rendered", () => {
    const h = harness();
    const current = documentFixture();
    h.emit({ type: "ui_document", document: current });

    h.emit({
      type: "ui_document",
      document: { ...current, schemaVersion: 999, id: "future-document" },
    });

    expect(h.controller.getActiveUiDocument()).toEqual(current);
    expect(h.entries.at(-1)).toMatchObject({
      kind: "error",
      title: "Interactive document needs attention",
    });
    expect(h.documents.at(-1)?.document).toEqual(current);
  });

  test("constructs and dispatches the exact canonical choice action through the injected seam", async () => {
    const dispatched: UiAction[] = [];
    const h = harness({
      async dispatch(action) {
        dispatched.push(action);
        return {
          schemaVersion: 1,
          documentId: action.documentId,
          sourceRevision: action.documentRevision,
          actionIdempotencyKey: action.idempotencyKey,
          status: "accepted",
          documentLifecycle: "ready",
        };
      },
    });
    h.emit({ type: "ui_document", document: documentFixture() });
    const control = h.documents.at(-1)?.controls.find((candidate) => candidate.id === "question-choice-question");
    await control?.run();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      schemaVersion: 1,
      type: "choose-option",
      documentId: "terminal-doc",
      documentRevision: 3,
      nodeId: "choice-question",
      optionIds: ["wrong"],
    });
    expect(dispatched[0]?.idempotencyKey).toMatch(/^tui-ui-terminal-doc-3-choice-question-choose-option-/);
  });

  test("cancel keeps the focused document and sends no action", async () => {
    const dispatched: UiAction[] = [];
    const h = harness({
      async dispatch(action) {
        dispatched.push(action);
        throw new Error("must not dispatch");
      },
    });
    h.emit({ type: "ui_document", document: documentFixture() });
    const control = h.documents.at(-1)?.controls.find((candidate) => candidate.id === "notes-notes");
    await control?.run();

    expect(dispatched).toEqual([]);
    expect(h.controller.getActiveUiDocument()).toMatchObject({ id: "terminal-doc", revision: 3 });
  });

  test("retains a failed action and retries its exact payload and idempotency key", async () => {
    const dispatched: UiAction[] = [];
    let attempts = 0;
    const h = harness({
      async dispatch(action) {
        dispatched.push(action);
        attempts += 1;
        if (attempts === 1) throw new Error("offline");
        return {
          schemaVersion: 1,
          documentId: action.documentId,
          sourceRevision: action.documentRevision,
          actionIdempotencyKey: action.idempotencyKey,
          status: "accepted",
          documentLifecycle: "ready",
        };
      },
    });
    h.emit({ type: "ui_document", document: documentFixture() });
    await h.documents.at(-1)?.controls.find((candidate) => candidate.id === "question-choice-question")?.run();
    const retry = h.documents.at(-1)?.controls.find((candidate) => candidate.label === "Retry last entered action");
    await retry?.run();

    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toEqual(dispatched[0]);
    expect(h.entries.map((entry) => entry.title)).toContain("Entered work preserved");
  });

  test("creates the canonical retry action for a failed document", async () => {
    const dispatched: UiAction[] = [];
    const h = harness({
      async dispatch(action) {
        dispatched.push(action);
        return {
          schemaVersion: 1,
          documentId: action.documentId,
          sourceRevision: action.documentRevision,
          actionIdempotencyKey: action.idempotencyKey,
          status: "accepted",
          documentLifecycle: "failed",
        };
      },
    });
    h.emit({ type: "ui_document", document: documentFixture("failed") });
    await h.documents.at(-1)?.controls.find((candidate) => candidate.label === "Retry document")?.run();

    expect(dispatched[0]).toMatchObject({ type: "retry", documentId: "terminal-doc", documentRevision: 3 });
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
