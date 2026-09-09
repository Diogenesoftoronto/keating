import { expect, test } from "bun:test";
import { HostController, type HostSurface, type UiDocumentControl } from "../src/tui/host-controller.js";
import { validateUiActionAgainstDocument, type UiDocument, type UiDocumentNode, type UiAction } from "../src/tui/learner-contracts.js";
import { gradeTerminalAnswer } from "../src/tui/ui/grading.js";
import { uiDocumentPresentation } from "../src/tui/ui/render.js";

export function lesson(nodes: UiDocumentNode[]): UiDocument {
  return { schemaVersion: 1, id: "regression-lesson", revision: 0, lifecycle: "ready", supportedSurfaces: ["terminal"], nodes,
    createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z" };
}
function host(document: UiDocument) {
  let listener: (event: unknown) => void = () => {};
  let controls: readonly UiDocumentControl[] = [];
  let entries: any[] = [];
  const choices: string[][] = [];
  const actions: UiAction[] = [];
  const confirmations: string[] = [];
  const wire = `Before\n\n\`\`\`keating-ui\n${JSON.stringify(document)}\n\`\`\`\n\nAfter`;
  const messages: any[] = [{ role: "assistant", content: wire }];
  const surface: HostSurface = {
    hydrateEntries(value) { entries = value; }, appendEntry(value) { entries.push(value); },
    setStreaming() {}, setStatus() {}, setHeaderState() {}, setEditorText() {}, setWidget() {}, setTitle() {},
    setUiDocument(_document, value) { controls = value; },
    async presentSelect(_title, options) { choices.push(options); return options[0]; },
    async presentInput() { return "An observed property"; }, async presentEditor() { return "My explanation"; },
    async presentConfirm(_title, message) { confirmations.push(message); return true; },
  };
  const controller = new HostController({ onEvent(next) { listener = next; }, async getMessages() { return messages; }, async getState() { return { sessionId: "test" }; } }, surface, {
    uiActionDispatcher: { async dispatch(action, source) {
      expect(validateUiActionAgainstDocument(action, source)).toBe(true); actions.push(action);
      return { schemaVersion: 1, documentId: source.id, sourceRevision: source.revision, actionIdempotencyKey: action.idempotencyKey, status: "accepted", documentLifecycle: source.lifecycle };
    } },
  });
  controller.attach();
  return { controller, choices, actions, confirmations, messages, surface, get controls() { return controls; }, get entries() { return entries; },
    activate() { listener({ type: "message_end", message: messages[0] }); } };
}

test("local grading compares multi-select sets and positional blanks, and defers explanations", () => {
  const question = { id: "q", prompt: "Primes", kind: "multi_select" as const, multiSelect: true,
    choices: [{ id: "two", label: "2" }, { id: "three", label: "3" }, { id: "four", label: "4" }], correctAnswers: ["two", "three"] };
  expect(gradeTerminalAnswer(question, ["three", "two"])).toBe(true);
  expect(gradeTerminalAnswer(question, "two, three")).toBe(true);
  expect(gradeTerminalAnswer(question, ["two"])).toBe(false);
  expect(gradeTerminalAnswer(question, ["two", "three", "four"])).toBe(false);
  expect(gradeTerminalAnswer({ id: "b", prompt: "Complete", kind: "blanks", correctAnswers: ["prior", "posterior"] }, ["prior", "posterior"])).toBe(true);
  expect(gradeTerminalAnswer({ id: "b", prompt: "Complete", kind: "blanks", correctAnswers: ["prior", "posterior"] }, ["posterior", "prior"])).toBe(false);
  expect(gradeTerminalAnswer({ id: "why", prompt: "Explain", kind: "short_answer", correctAnswer: "The reference wording" }, "The reference wording")).toBeNull();
});

test("matching and classification collect every row and preserve reasons", async () => {
  for (const grouped of [false, true]) {
    const q = { id: "matching", kind: "matching" as const, prompt: "Match", items: ["salmon", "sparrow"], requireReasons: true,
      choices: [{ id: "fish", label: "Fish" }, { id: "bird", label: "Bird" }] };
    const h = host(lesson(grouped ? [{ type: "question-group", id: "group", questions: [q] }] : [{ ...q, type: "question" }]));
    h.activate(); await h.controls[0]!.run();
    expect(h.actions).toHaveLength(1);
    const action = h.actions[0]!;
    const rows = action.type === "submit-question-group" ? (action.responses[0] as any).rows : (action as any).answer;
    expect(rows).toEqual([{ item: "salmon", optionId: "fish", reason: "An observed property" }, { item: "sparrow", optionId: "bird", reason: "An observed property" }]);
    expect(h.choices[1]).toEqual(["bird · Bird"]);
  }
});

test("reopening assistant OpenUI restores controls without exposing wire JSON", async () => {
  const document = lesson([{ type: "question", id: "q", prompt: "Explain the choice" }]);
  const h = host(document);
  h.messages.push({ role: "toolResult", toolName: "read", content: "Unrelated file" });
  await h.controller.initialize();
  expect(h.controller.getActiveUiDocument()).toEqual(document);
  expect(h.controls).toHaveLength(1);
  expect(h.entries.some((entry) => entry.body.includes('schemaVersion'))).toBe(false);
  await h.controls[0]!.run();
  expect(h.actions).toHaveLength(1);
});

test("quiz explanations and card backs stay hidden until explicit reveal", async () => {
  const document = lesson([
    { type: "quiz", id: "quiz", title: "Retrieval", questions: [{ id: "q", prompt: "Why?", explanation: "Secret solution" }] },
    { type: "deck", id: "deck", title: "Recall", topic: "Test", cards: [{ id: "card", front: "Prompt", back: "Secret back" }] },
  ]);
  const rendered = uiDocumentPresentation(document).body.join("\n");
  expect(rendered).not.toContain("Secret solution");
  expect(rendered).not.toContain("Secret back");
  const h = host(document); h.activate();
  await h.controls.find((control) => control.id === "deck-rate-deck-card")!.run();
  expect(h.confirmations[0]).not.toContain("Secret back");
  expect(h.confirmations[1]).toContain("Secret back");
  expect(h.actions[0]?.type).toBe("rate-card");
});

test("multi_select kind permits selecting multiple options without redundant flags", () => {
  const document = lesson([{ type: "question", id: "q", kind: "multi_select", prompt: "Select both", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }]);
  expect(validateUiActionAgainstDocument({ schemaVersion: 1, type: "choose-option", documentId: document.id, documentRevision: 0, nodeId: "q", optionIds: ["a", "b"], idempotencyKey: "both" }, document)).toBe(true);
});

test("cancelling flashcard reveal never exposes its answer or records a rating", async () => {
  const h = host(lesson([{ type: "deck", id: "deck", title: "Deck", topic: "Recall", cards: [{ id: "card", front: "Prompt", back: "Secret answer" }] }]));
  const shown: string[] = [];
  h.surface.presentConfirm = async (_title, message) => { shown.push(message); return false; };
  h.activate(); await h.controls[0]!.run();
  expect(shown.join("\n")).not.toContain("Secret answer");
  expect(h.actions).toHaveLength(0);
});

test("restored submission snapshots retain the completed revision and readable learner work", async () => {
  const h = host(lesson([{ type: "question", id: "q", prompt: "Why?" }]));
  const document = lesson([{ type: "callout", id: "result", tone: "check", markdown: "Saved for feedback" }]);
  document.revision = 1;
  h.messages.push({ role: "custom", customType: "keating-ui-submission", content: '{"internal":"wire"}', details: { document, learnerSummary: "Why?\nBecause of evidence." } });
  await h.controller.initialize();
  expect(h.controller.getActiveUiDocument()).toEqual(document);
  expect(h.controls).toHaveLength(0);
  expect(h.entries.at(-1).body).toBe("Why?\nBecause of evidence.");
});
