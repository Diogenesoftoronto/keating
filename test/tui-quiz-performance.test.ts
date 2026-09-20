import { expect, test } from "bun:test";
import { HostController, type HostSurface, type TuiQuizPerformanceController, type UiDocumentControl } from "../src/tui/host-controller.js";
import { type UiAction, type UiDocument, validateUiActionAgainstDocument } from "../src/tui/learner-contracts.js";
import { uiDocumentPresentation } from "../src/tui/ui/render.js";

function lesson(): UiDocument {
  return { schemaVersion: 1, id: "prediction-quiz", revision: 0, lifecycle: "ready", supportedSurfaces: ["terminal"],
    createdAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z",
    nodes: [{ type: "quiz", id: "quiz", title: "Recall", questions: [
      { id: "q", kind: "choice", prompt: "Pick A", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], correctAnswer: "a", hint: "Secret hint", explanation: "Secret solution" },
    ] }] };
}
function harness(document = lesson()) {
  let listener: (event: unknown) => void = () => {};
  let controls: readonly UiDocumentControl[] = [];
  const events: string[] = [];
  const entries: string[] = [];
  const actions: UiAction[] = [];
  const predictions: Array<{ controller: TuiQuizPerformanceController; current: () => boolean }> = [];
  let failDispatch = false;
  let committed = false;
  let dispatchGate: Promise<void> | undefined;
  let dispatchEntered: (() => void) | undefined;
  let replacementResult: UiDocument | undefined;
  let restoredDocument: UiDocument | undefined;
  const surface: HostSurface = {
    hydrateEntries() {}, appendEntry(entry) { entries.push(entry.body); }, setStreaming() {}, setStatus() {},
    setHeaderState() {}, setEditorText() {}, setWidget() {}, setTitle() {},
    setUiDocument(_document, next) { controls = next; },
    async presentSelect(_title, options) { events.push("answer-open"); return options[0]; },
    async presentInput() { return "a"; }, async presentEditor() { events.push("answer-open"); return "answer"; },
    async presentConfirm(_title, message) { events.push(`reveal:${message}`); return false; },
  };
  const host = new HostController({
    onEvent(next) { listener = next; },
    async getMessages() { return [{ role: "assistant", content: `\`\`\`keating-ui\n${JSON.stringify(document)}\n\`\`\`` }]; },
  }, surface, {
    async restoreUiDocument(source) { return restoredDocument ?? source; },
    createQuizPerformance(_source, _nodeId, current) {
      const controller: TuiQuizPerformanceController = {
        async estimate() { events.push("estimate"); return { ok: true, expectedCorrect: 0.7, itemCount: 1 }; },
        touch() { events.push("touch"); }, hint(id) { events.push(`hint:${id}`); },
        prepareSubmission() { events.push("prepare"); },
        async collectCommitted() { expect(committed).toBe(true); events.push("collect"); },
        dispose() { events.push("dispose"); },
      };
      predictions.push({ controller, current });
      return controller;
    },
    async exportQuizPerformanceEvidence(id) { events.push(`export:${id}`); return { path: "/private/evidence.json" }; },
    uiActionDispatcher: { async dispatch(action, source) {
      actions.push(structuredClone(action)); expect(validateUiActionAgainstDocument(action, source)).toBe(true);
      events.push("dispatch"); dispatchEntered?.(); await dispatchGate; if (failDispatch) throw new Error("offline"); committed = true;
      return { schemaVersion: 1, documentId: source.id, sourceRevision: source.revision, actionIdempotencyKey: action.idempotencyKey,
        status: "completed", documentLifecycle: "completed", resultingDocument: replacementResult ?? { ...structuredClone(source), revision: source.revision + 1, lifecycle: "completed" } };
    } },
  });
  host.attach();
  return { host, events, entries, actions, predictions, surface,
    get controls() { return controls; },
    delayDispatch(gate: Promise<void>) { dispatchGate = gate; return new Promise<void>((resolve) => { dispatchEntered = resolve; }); },
    set failing(value: boolean) { failDispatch = value; },
    set resultingDocument(value: UiDocument) { replacementResult = value; },
    set restored(value: UiDocument) { restoredDocument = value; },
    activate(value = document) { listener({ type: "message_end", message: { role: "assistant", content: `\`\`\`keating-ui\n${JSON.stringify(value)}\n\`\`\`` } }); },
    async run(id: string) { await controls.find((control) => control.id === id)!.run(); },
  };
}

test("practice presentation hides hints and explanations until an explicit tracked reveal", async () => {
  const document = lesson();
  const text = uiDocumentPresentation(document).body.join("\n");
  expect(text).not.toContain("Secret hint"); expect(text).not.toContain("Secret solution");
  const h = harness(document); h.activate();
  const staleEstimate = h.controls.find((control) => control.id === "quiz-estimate-quiz")!;
  await h.run("quiz-hint-quiz-q");
  expect(h.events).toEqual(["touch", "hint:q", "reveal:Secret hint"]);
  expect(h.controls.some((control) => control.id === "quiz-estimate-quiz")).toBe(false);
  await staleEstimate.run(); expect(h.events).not.toContain("estimate");
});

test("explicit estimate precedes answer interaction and collection follows durable delivery", async () => {
  const h = harness(); h.activate(); expect(h.events).toEqual([]);
  await h.run("quiz-estimate-quiz"); await h.run("quiz-quiz");
  expect(h.events).toEqual(["estimate", "touch", "answer-open", "prepare", "dispatch", "collect", "dispose"]);
  expect(h.actions[0]).toMatchObject({ score: 1, partialCreditPoints: 1, partialCredits: { q: 1 }, pendingGradeQuestionIds: [] });
  expect(h.entries.some((text) => text.includes("0.7 of 1"))).toBe(true);
});

test("fitted terminal estimate names its method and preserves the raw comparison", async () => {
  const h = harness(); h.activate();
  h.predictions[0]!.controller.estimate = async () => ({ ok: true, expectedCorrect: 0.4, itemCount: 1,
    rawExpectedCorrect: 0.8, estimateMethod: "boosting", fitSha256: "a".repeat(64) });
  await h.run("quiz-estimate-quiz");
  expect(h.entries.some(text => text.includes("Fitted ensemble estimate") && text.includes("0.4 of 1")
    && text.includes("Raw model estimate: 0.8 of 1"))).toBe(true);
});

test("opening and cancelling an answer permanently closes estimate eligibility for that source", async () => {
  const h = harness(); h.activate(); h.surface.presentSelect = async () => undefined;
  await h.run("quiz-quiz"); h.activate();
  expect(h.actions).toHaveLength(0); expect(h.events).toContain("touch");
  expect(h.controls.some((control) => control.id === "quiz-estimate-quiz")).toBe(false);
});

test("retry preserves exact prepared action and collects only after successful commit", async () => {
  const h = harness(); h.activate(); await h.run("quiz-estimate-quiz"); h.failing = true;
  await h.run("quiz-quiz"); expect(h.events).not.toContain("collect");
  h.failing = false; await h.controls.find((control) => control.id.startsWith("retry-last-"))!.run();
  expect(h.actions[1]).toEqual(h.actions[0]);
  expect(h.events.filter((event) => event === "prepare")).toHaveLength(1);
  expect(h.events.filter((event) => event === "collect")).toHaveLength(1);
});

test("new host never reuses action identity from an earlier process", async () => {
  const first = harness(); first.activate(); await first.run("quiz-quiz");
  const second = harness(); second.activate(); await second.run("quiz-quiz");
  expect(first.actions[0]!.idempotencyKey).not.toBe(second.actions[0]!.idempotencyKey);
  expect((first.actions[0] as any).resultId).not.toBe((second.actions[0] as any).resultId);
});

test("restored sources cannot produce false pre-answer predictions; export remains explicit", async () => {
  const h = harness(); await h.host.initialize();
  expect(h.controls.some((control) => control.id === "quiz-estimate-quiz")).toBe(false);
  expect(h.events).toEqual(["touch"]);
  await h.run("quiz-evidence-export"); expect(h.events).toContain("export:prediction-quiz");
});

test("source replacement invalidates in-flight prediction and stale controls", async () => {
  const h = harness(); h.activate();
  let resolve!: (value: { ok: true; expectedCorrect: number; itemCount: number }) => void;
  h.predictions[0]!.controller.estimate = () => new Promise((done) => { resolve = done; });
  const oldTake = h.controls.find((control) => control.id === "quiz-quiz")!;
  const estimating = h.run("quiz-estimate-quiz");
  const next = lesson(); next.revision = 1; h.activate(next);
  expect(h.predictions[0]!.current()).toBe(false);
  resolve({ ok: true, expectedCorrect: 0.5, itemCount: 1 }); await estimating; await oldTake.run();
  expect(h.actions).toHaveLength(0); expect(h.entries.some((text) => text.includes("0.5 of 1"))).toBe(false);
});

test("optional collection failure cannot convert delivered work into retry", async () => {
  const h = harness(); h.activate(); h.predictions[0]!.controller.collectCommitted = async () => { throw new Error("disk"); };
  await h.run("quiz-quiz");
  expect(h.host.getActiveUiDocument()?.lifecycle).toBe("completed");
  expect(h.controls.some((control) => control.id.startsWith("retry-last-"))).toBe(false);
});

test("open-ended answers remain pending while objective answers retain real scores", async () => {
  const document = lesson(); const quiz = document.nodes[0]!;
  if (quiz.type !== "quiz") throw new Error("fixture");
  quiz.questions.push({ id: "open", kind: "short_answer", prompt: "Explain", correctAnswer: "answer" });
  const h = harness(document); h.activate(); await h.run("quiz-quiz");
  expect(h.actions[0]).toMatchObject({ score: 1, partialCredits: { q: 1, open: 0 }, pendingGradeQuestionIds: ["open"] });
});

test("reactivating an exposed older source does not create a fresh clean prediction", async () => {
  const h = harness(); h.activate(); h.surface.presentSelect = async () => undefined;
  await h.run("quiz-quiz"); const other = lesson(); other.id = "other"; h.activate(other); h.activate();
  expect(h.controls.some((control) => control.id === "quiz-estimate-quiz")).toBe(false);
});

test("preparation failure disables collection but preserves successful answer delivery", async () => {
  const h = harness(); h.activate(); h.predictions[0]!.controller.prepareSubmission = () => { throw new Error("bad source"); };
  await h.run("quiz-quiz");
  expect(h.host.getActiveUiDocument()?.lifecycle).toBe("completed"); expect(h.events).not.toContain("collect");
});


test("evidence export is absent on non-quiz documents", () => {
  const document = lesson(); document.nodes = [{ type: "markdown", id: "note", markdown: "Read this" }];
  const h = harness(document); h.activate();
  expect(h.controls.some((control) => control.id === "quiz-evidence-export")).toBe(false);
});

test("delayed delivery failure cannot add a retry action to a replaced same-id document", async () => {
  const h = harness(); h.activate();
  let reject!: (reason: Error) => void;
  const entered = h.delayDispatch(new Promise<void>((_resolve, fail) => { reject = fail; }));
  const sending = h.run("quiz-quiz"); await entered;
  // Even the same IDs/revision can be different source content.
  const replacement = lesson(); replacement.title = "New source"; h.activate(replacement);
  reject(new Error("late failure")); await sending;
  expect(h.host.getActiveUiDocument()?.title).toBe("New source");
  expect(h.controls.some((control) => control.id.startsWith("retry-last-"))).toBe(false);
  expect(h.entries.some((text) => text.includes("late failure"))).toBe(false);
});


function completedQuizCallout(): UiDocument {
  return { ...lesson(), lifecycle: "completed", revision: 1, nodes: [
    { type: "callout", id: "quiz-result-1", tone: "check", title: "Quiz submitted", markdown: "1 response recorded." },
  ] };
}

test("quiz evidence export survives the receiver replacing quiz with result callout", async () => {
  const h = harness(); h.resultingDocument = completedQuizCallout(); h.activate(); await h.run("quiz-quiz");
  expect(h.host.getActiveUiDocument()?.nodes.some((node) => node.type === "quiz")).toBe(false);
  await h.run("quiz-evidence-export"); expect(h.events).toContain("export:prediction-quiz");
});

test("restoring a quiz source from a completed journal preserves export without quiz nodes", async () => {
  const h = harness(); h.restored = completedQuizCallout(); await h.host.initialize();
  expect(h.controls.map((control) => control.id)).toEqual(["quiz-evidence-export"]);
  await h.run("quiz-evidence-export"); expect(h.events).toContain("export:prediction-quiz");
});

test("same document ID with a different creation identity does not inherit export eligibility", () => {
  const h = harness(); h.activate();
  const unrelated = completedQuizCallout(); unrelated.createdAt = unrelated.updatedAt = "2026-09-19T01:00:00.000Z"; h.activate(unrelated);
  expect(h.controls.some((control) => control.id === "quiz-evidence-export")).toBe(false);
});
