/** Behavioral boundaries for untrusted learner documents, submissions, and replay receipts. */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  canonicalUiAction, receiptForUiAction, UiActionReplayConflictError,
  validateResponseCapture, validateSubmissionAttachment, validateUiAction,
  validateUiActionAgainstDocument, validateUiActionCorrelation, validateUiActionJournal,
  validateUiActionReceipt, validateUiActionResult, validateUiDocument,
  type UiDocument, type UiDocumentNode,
} from "../src/ui.js";
import { uiActionFixture, uiActionJournalFixture, uiActionResultFixture, uiDocumentFixture } from "./fixtures.js";

type Wire = Record<string, unknown>;
const resource = { id: "resource", title: "Field notes", format: "text", content: "Observations" };
const option = { id: "option", label: "Evidence" };
const question = { id: "question", prompt: "What changed?", kind: "text" };
const parameter = { id: "speed", label: "Speed", min: 0, max: 10, step: 1, value: 5 };
const task = { type: "task", id: "task", kind: "assignment", title: "Collect evidence", brief: "Record one observation." };
const coding = {
  type: "coding-challenge", id: "coding", title: "Double", prompt: "Double the input.", language: "javascript",
  starterCode: "function double(n) {}", entrypoint: "double", tests: [{ id: "case", label: "Positive", args: [2], expected: 4 }],
};
const nodes: Wire[] = [
  { type: "markdown", id: "markdown", markdown: "A lesson" },
  { type: "callout", id: "callout", markdown: "Check the evidence", tone: "hint" },
  { type: "question", ...question },
  { type: "question-group", id: "group", questions: [question] },
  { type: "quiz", id: "quiz", title: "Recall", questions: [question] },
  { type: "goal", id: "goal", title: "Learn", status: "active", steps: [{ id: "step", title: "Try", status: "not_started" }] },
  { type: "deck", id: "deck", title: "Recall", topic: "Evidence", cards: [{ id: "card", front: "Evidence?", back: "Observation" }] },
  { type: "study-plan", id: "plan", title: "Learn", items: [{ id: "item", title: "Read" }] },
  { type: "artifact", id: "artifact", resource },
  { type: "concept-map", id: "map", source: "graph TD; A-->B" },
  { type: "notes", id: "notes", title: "Notes", value: "" },
  { type: "image", id: "image", alt: "Evidence", resource: { ...resource, uri: "https://example.org/image.png" } },
  { type: "media", id: "media", kind: "audio", resource: { ...resource, uri: "artifact://audio-file" } },
  task,
  { type: "simulation", id: "simulation", title: "Motion", parameters: [parameter], readouts: [{ id: "distance", label: "Distance", expr: "speed * 2" }] },
  coding,
  { type: "music-lab", id: "music", title: "Rhythm", code: 'sound("bd")' },
  { type: "handoff", id: "handoff", target: "desktop", reason: "Use a larger screen", context: "Review the graph." },
  { type: "language-practice", id: "language", title: "Greetings", language: "French", rounds: [{ id: "round", kind: "translation", prompt: "Translate", text: "Hello", acceptedAnswers: ["Bonjour"] }] },
];
function documentWith(node: Wire): UiDocument {
  return { ...uiDocumentFixture(), nodes: [node as unknown as UiDocumentNode] };
}
function rejectChanges(node: Wire, changes: Wire[]): void {
  expect(validateUiDocument(documentWith(node))).toBe(true);
  for (const change of changes) expect(validateUiDocument(documentWith({ ...node, ...change }))).toBe(false);
}
function action(type: string, fields: Wire = {}): Wire {
  const { answer: _, ...base } = uiActionFixture();
  if (type === "retry") {
    const { nodeId: _, ...retryBase } = base;
    return { ...retryBase, type, ...fields };
  }
  return { ...base, type, ...fields };
}

describe("submission boundaries", () => {
  const attachment = { id: "attachment_0123456789abcdef0123456789abcdef", name: "field-notes.txt", mimeType: "text/plain", sizeBytes: 1024 };
  test("accepts bounded attachment metadata and rejects malformed IDs, sizes, and unknown fields", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 25 * 1024 * 1024 }), sizeBytes => {
      expect(validateSubmissionAttachment({ ...attachment, sizeBytes })).toBe(true);
    }), { numRuns: 25 });
    for (const sizeBytes of [1, 25 * 1024 * 1024]) expect(validateSubmissionAttachment({ ...attachment, sizeBytes })).toBe(true);
    for (const patch of [
      { id: "attachment_" + "a".repeat(31) }, { id: "attachment_" + "a".repeat(33) },
      { id: "x" + attachment.id }, { id: attachment.id + "x" }, { id: "attachment_" + "G".repeat(32) }, { id: 1 },
      { name: "" }, { name: " \t" }, { name: "n".repeat(256) }, { mimeType: "" }, { mimeType: "m".repeat(161) },
      { sizeBytes: 0 }, { sizeBytes: -1 }, { sizeBytes: 0.5 }, { sizeBytes: 25 * 1024 * 1024 + 1 },
      { sizeBytes: "1024" }, { sizeBytes: Infinity }, { url: "https://example.org" },
    ]) expect(validateSubmissionAttachment({ ...attachment, ...patch })).toBe(false);
    for (const invalid of [null, [], false, "attachment"]) expect(validateSubmissionAttachment(invalid)).toBe(false);
    expect(validateSubmissionAttachment({ ...attachment, name: "n".repeat(255), mimeType: "m".repeat(160) })).toBe(true);
  });

  test("audio and video capture can be untimed or timed for 1–180 whole seconds", () => {
    for (const kind of ["audio", "video"]) {
      for (const timeLimitSeconds of [undefined, 1, 180]) expect(validateResponseCapture({ kind, timeLimitSeconds })).toBe(true);
      for (const timeLimitSeconds of [0, 181, -1, 1.5, "60", NaN]) expect(validateResponseCapture({ kind, timeLimitSeconds })).toBe(false);
    }
    for (const input of [null, [], { kind: "screen" }, { kind: "audio", token: "secret" }]) expect(validateResponseCapture(input)).toBe(false);
  });

  test("task submissions preserve capture compatibility, attachment limits, and draft round bounds", () => {
    for (const format of ["text", "link", "none"]) expect(validateUiDocument(documentWith({ ...task, submission: { format } }))).toBe(true);
    rejectChanges(task, [{ kind: "unknown" }, { title: "" }, { brief: "" }, { dueAt: "tomorrow" }, { availableFrom: "yesterday" }, { estimatedMinutes: -1 }, { estimatedMinutes: 100001 }, { round: 1001 }]);
    const submission = { format: "text", label: "Explain", placeholder: "Your evidence", targetWords: 100000, capture: { kind: "audio" } };
    expect(validateUiDocument(documentWith({ ...task, submission }))).toBe(true);
    for (const patch of [{ format: "link" }, { format: "none" }, { targetWords: -1 }, { targetWords: 100001 }, { label: 2 }, { placeholder: false }, { capture: { kind: "audio", timeLimitSeconds: 0 } }, { unknown: true }]) {
      expect(validateUiDocument(documentWith({ ...task, submission: { ...submission, ...patch } }))).toBe(false);
    }
    const submit = action("submit-task", { submission: "Here is my evidence.", attachments: [attachment], round: 1000 });
    expect(validateUiAction(submit)).toBe(true);
    expect(validateUiAction({ ...submit, attachments: Array(10).fill(attachment) })).toBe(true);
    for (const patch of [{ attachments: Array(11).fill(attachment) }, { attachments: [{ ...attachment, sizeBytes: 0 }] }, { attachments: "file" }, { round: -1 }, { round: 1001 }, { round: Infinity }, { submission: 1 }]) expect(validateUiAction({ ...submit, ...patch })).toBe(false);
  });
});

describe("document schemas", () => {
  test("every node rejects a single unrecognized field without rejecting valid content", () => {
    for (const node of nodes) expect(validateUiDocument(documentWith(node))).toBe(true);
    fc.assert(fc.property(fc.string({ maxLength: 24 }), suffix => {
      for (const node of nodes) expect(validateUiDocument(documentWith({ ...node, [`unknown_${suffix}`]: true }))).toBe(false);
    }), { numRuns: 12 });
  });

  test("node identifiers, document revisions, lifecycle, timestamps and surfaces form a portable envelope", () => {
    const document = uiDocumentFixture();
    for (const lifecycle of ["draft", "streaming", "ready", "submitted", "completed", "failed", "cancelled"]) expect(validateUiDocument({ ...document, lifecycle })).toBe(true);
    for (const retention of ["ephemeral", "resumable", "workspace"]) expect(validateUiDocument({ ...document, retention })).toBe(true);
    expect(validateUiDocument({ ...document, supportedSurfaces: ["web", "desktop", "mobile", "terminal"], revision: 0 })).toBe(true);
    expect(validateUiDocument({ ...document, updatedAt: document.createdAt })).toBe(true);
    for (const patch of [{ schemaVersion: 2 }, { id: "" }, { revision: -1 }, { revision: 0.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { title: 1 }, { description: false }, { lifecycle: "unknown" }, { retention: "forever" }, { supportedSurfaces: [] }, { supportedSurfaces: ["web", "web"] }, { supportedSurfaces: ["watch"] }, { nodes: "lesson" }, { createdAt: "yesterday" }, { updatedAt: "2026-08-09T00:00:00.000Z" }]) expect(validateUiDocument({ ...document, ...patch })).toBe(false);
    const markdown = { type: "markdown", id: "m", markdown: "" };
    expect(validateUiDocument({ ...document, nodes: Array.from({ length: 64 }, (_, i) => ({ ...markdown, id: `m-${i}` })) })).toBe(true);
    expect(validateUiDocument({ ...document, nodes: Array.from({ length: 65 }, (_, i) => ({ ...markdown, id: `m-${i}` })) })).toBe(false);
    for (const patch of [{ id: "" }, { type: "unknown" }, { markdown: false }, { markdown: "x".repeat(65537) }]) expect(validateUiDocument(documentWith({ ...markdown, ...patch }))).toBe(false);
  });

  test("resource nodes accept portable locations and reject credentials, URL suffixes and unsafe schemes", () => {
    for (const uri of ["https://example.org/a", "http://localhost/a", "http://127.0.0.1/a", "http://[::1]/a", "artifact://resource-id"]) {
      expect(validateUiDocument(documentWith({ type: "artifact", id: "artifact", resource: { ...resource, format: "uri", uri } }))).toBe(true);
    }
    for (const uri of ["not a URL", "http://example.org/a", "javascript:alert(1)", "https://user@example.org/a", "https://user:pass@example.org/a", "https://example.org/a?token=secret", "https://example.org/a#fragment", "artifact://", "file:///tmp/a"]) {
      expect(validateUiDocument(documentWith({ type: "artifact", id: "artifact", resource: { ...resource, uri } }))).toBe(false);
    }
    for (const patch of [{ title: "" }, { id: "" }, { format: "html" }, { content: 1 }, { content: "x".repeat(131073) }, { mimeType: "" }, { mimeType: "x".repeat(257) }, { extra: true }]) expect(validateUiDocument(documentWith({ type: "artifact", id: "artifact", resource: { ...resource, ...patch } }))).toBe(false);
    expect(validateUiDocument(documentWith({ type: "artifact", id: "artifact", resource: { id: "r", title: "R", format: "text" } }))).toBe(false);
    expect(validateUiDocument(documentWith({ type: "artifact", id: "artifact", resource: { ...resource, format: "uri" } }))).toBe(false);
    for (const type of ["image", "media"]) {
      const media = nodes.find(node => node.type === type)!;
      expect(validateUiDocument(documentWith({ ...media, resource }))).toBe(false);
    }
  });

  test("question metadata cannot smuggle malformed choices, ranges or grading fields", () => {
    const q = { type: "question", ...question, choices: [option], kind: "choice" };
    rejectChanges(q, [{ prompt: "" }, { prompt: "x".repeat(4097) }, { kind: "unknown" }, { level: "expert" }, { choices: [] }, { choices: [option, option] }, { choices: [{ ...option, label: "" }] }, { choices: [{ ...option, extra: true }] }, { choices: [null] }, { timeLimit: 0 }, { timeLimit: 0.5 }, { min: 1, max: 1 }, { min: 1, max: 0 }, { step: 0 }, { min: Infinity }, { step: "1" }]);
    for (const kind of ["choice", "multiple_choice", "multi_select", "dropdown"]) {
      expect(validateUiDocument(documentWith({ ...q, kind, choices: undefined }))).toBe(false);
      expect(validateUiDocument(documentWith({ ...q, kind, choices: undefined, allowText: true }))).toBe(true);
    }
    for (const level of ["recall", "comprehension", "application", "analysis", "transfer"]) expect(validateUiDocument(documentWith({ ...q, level }))).toBe(true);
    for (const key of ["header", "hint", "itemLabel", "choiceLabel", "reasonLabel", "correctAnswer", "explanation", "rubric"]) {
      expect(validateUiDocument(documentWith({ ...q, [key]: "" }))).toBe(true);
      expect(validateUiDocument(documentWith({ ...q, [key]: 1 }))).toBe(false);
      expect(validateUiDocument(documentWith({ ...q, [key]: "x".repeat(8193) }))).toBe(false);
    }
    for (const key of ["allowText", "multiSelect", "requireReasons", "uniqueMatches"]) {
      for (const value of [true, false]) expect(validateUiDocument(documentWith({ ...q, [key]: value }))).toBe(true);
      expect(validateUiDocument(documentWith({ ...q, [key]: "true" }))).toBe(false);
    }
    for (const key of ["correctAnswers", "correctMatches"]) {
      expect(validateUiDocument(documentWith({ ...q, [key]: ["option"] }))).toBe(true);
      expect(validateUiDocument(documentWith({ ...q, [key]: [1] }))).toBe(false);
    }
    const blanks = { ...q, kind: "blanks", choices: undefined, blanks: [{ placeholder: "", hint: "" }] };
    rejectChanges(blanks, [{ blanks: [{ placeholder: 1 }] }, { blanks: [{ hint: false }] }, { blanks: [{ extra: true }] }, { blanks: [{ placeholder: "x".repeat(513) }] }, { blanks: [{ hint: "x".repeat(1025) }] }]);
    const matching = { ...q, kind: "matching", items: ["Evidence"], correctMatches: ["option"] };
    rejectChanges(matching, [{ items: undefined }, { choices: undefined }, { items: [] }, { items: [1] }, { items: ["x".repeat(2049)] }, { correctMatches: [] }, { correctMatches: ["missing"] }]);
  });

  test("simulation controls use finite ranges and readouts reference only declared parameters", () => {
    const simulation = nodes.find(node => node.type === "simulation")!;
    rejectChanges(simulation, [{ parameters: [] }, { readouts: [] }, { parameters: Array(9).fill(parameter) }, { brief: false }]);
    for (const patch of [{ id: "" }, { label: "" }, { unit: 1 }, { min: NaN }, { max: Infinity }, { max: 0 }, { min: 11 }, { value: -1 }, { value: 11 }, { value: "5" }, { step: 0 }, { step: -1 }, { extra: true }]) expect(validateUiDocument(documentWith({ ...simulation, parameters: [{ ...parameter, ...patch }] }))).toBe(false);
    for (const value of [0, 10]) expect(validateUiDocument(documentWith({ ...simulation, parameters: [{ ...parameter, value }] }))).toBe(true);
    for (const patch of [{ id: "" }, { label: "" }, { unit: false }, { precision: -1 }, { precision: 7 }, { precision: 0.5 }, { emphasis: "yes" }, { expr: "unknown * 2" }, { expr: "Math.random()" }, { extra: true }]) expect(validateUiDocument(documentWith({ ...simulation, readouts: [{ id: "r", label: "R", expr: "speed", ...patch }] }))).toBe(false);
    for (const precision of [0, 6]) expect(validateUiDocument(documentWith({ ...simulation, readouts: [{ id: "r", label: "R", expr: "speed", precision, emphasis: true }] }))).toBe(true);
  });

  test("coding exercises carry bounded data cases and valid callable names", () => {
    rejectChanges(coding, [{ language: "python" }, { title: "" }, { prompt: "" }, { starterCode: false }, { entrypoint: "1double" }, { entrypoint: "double()" }, { entrypoint: "a".repeat(129) }, { entrypoint: "" }, { tests: [] }, { tests: Array(25).fill({ id: "c", label: "C", args: [], expected: 1 }) }, { hint: 1 }]);
    for (const entrypoint of ["$double", "_double", "d".repeat(128)]) expect(validateUiDocument(documentWith({ ...coding, entrypoint }))).toBe(true);
    expect(validateUiDocument(documentWith({ ...coding, language: "typescript", starterCode: "" }))).toBe(true);
    for (const patch of [{ id: "" }, { label: "" }, { args: "2" }, { args: Array(17).fill(1) }, { expected: Infinity }, { expected: () => 1 }, { expected: "x".repeat(4097) }, { extra: true }]) expect(validateUiDocument(documentWith({ ...coding, tests: [{ id: "case", label: "C", args: [], expected: null, ...patch }] }))).toBe(false);
    expect(validateUiDocument(documentWith({ ...coding, tests: [{ id: "c", label: "C", args: [null, false, { n: [1] }], expected: { n: [2] } }] }))).toBe(true);
  });
});

describe("actions and acknowledgements", () => {
  test("coding runs preserve timings and complete case identity without permitting forged failures", () => {
    const run = action("run-coding-challenge", { nodeId: "coding", runId: "run", code: "double(2)", durationMs: 0, cases: [{ testId: "case", passed: true, actual: "4" }], timing: { workingMs: 10, sinceLastRunMs: 10, runNumber: 1 } });
    expect(validateUiAction(run)).toBe(true);
    expect(validateUiActionAgainstDocument(run, documentWith(coding))).toBe(true);
    for (const patch of [{ runId: "" }, { code: "" }, { durationMs: -1 }, { durationMs: Infinity }, { cases: [] }, { cases: [{ testId: "case", passed: "true" }] }, { cases: [{ testId: "case", passed: true, error: "Failed" }] }, { cases: [{ testId: "case", passed: false, error: "" }] }, { cases: [{ testId: "case", passed: true, actual: 4 }] }, { timing: { workingMs: 1, sinceLastRunMs: 2, runNumber: 1 } }, { timing: { workingMs: -1, sinceLastRunMs: 0, runNumber: 1 } }, { timing: { workingMs: 10, sinceLastRunMs: 1, runNumber: 0 } }, { timing: { workingMs: 10, sinceLastRunMs: 1, runNumber: 1, extra: true } }]) expect(validateUiAction({ ...run, ...patch })).toBe(false);
    expect(validateUiAction({ ...run, timing: undefined, cases: [{ testId: "case", passed: false, error: "Timed out" }] })).toBe(true);
    expect(validateUiActionAgainstDocument({ ...run, cases: [{ testId: "missing", passed: true }] }, documentWith(coding))).toBe(false);
    expect(validateUiActionAgainstDocument({ ...run, cases: [{ testId: "case", passed: true }, { testId: "extra", passed: true }] }, documentWith(coding))).toBe(false);
  });

  test("results acknowledge only their source revision and completed documents advance it", () => {
    const result = uiActionResultFixture();
    const source = uiDocumentFixture();
    const request = uiActionFixture();
    expect(validateUiActionCorrelation(request, result, source)).toBe(true);
    for (const patch of [{ schemaVersion: 2 }, { documentId: "" }, { sourceRevision: -1 }, { actionIdempotencyKey: "" }, { status: "unknown" }, { documentLifecycle: "unknown" }, { message: 1 }, { message: "x".repeat(4097) }, { resultingDocument: undefined }, { retryAfterMs: 1 }]) expect(validateUiActionResult({ ...result, ...patch })).toBe(false);
    for (const patch of [{ id: "other" }, { revision: 2 }, { revision: 1 }, { lifecycle: "ready" }]) expect(validateUiActionResult({ ...result, resultingDocument: { ...result.resultingDocument, ...patch } })).toBe(false);
    for (const status of ["accepted", "rejected", "retryable"]) {
      const acknowledgement = { ...result, status, documentLifecycle: source.lifecycle, resultingDocument: undefined, ...(status === "retryable" ? { retryAfterMs: 0 } : {}) };
      expect(validateUiActionResult(acknowledgement)).toBe(true);
      expect(validateUiActionCorrelation(request, acknowledgement as typeof result, source)).toBe(true);
      expect(validateUiActionResult({ ...acknowledgement, resultingDocument: result.resultingDocument })).toBe(false);
      if (status === "retryable") for (const retryAfterMs of [undefined, -1, 0.5, "1", Infinity]) expect(validateUiActionResult({ ...acknowledgement, retryAfterMs })).toBe(false);
      else expect(validateUiActionResult({ ...acknowledgement, retryAfterMs: 0 })).toBe(false);
    }
    for (const patch of [{ documentId: "other" }, { sourceRevision: 1 }, { actionIdempotencyKey: "other" }]) expect(validateUiActionCorrelation(request, { ...result, ...patch })).toBe(false);
    expect(validateUiActionCorrelation(request, result, { ...source, revision: 1 })).toBe(false);
  });

  test("receipts bind their state, fingerprint, timestamps and document, and replay rejects key collisions", () => {
    const journal = uiActionJournalFixture();
    const receipt = journal.receipts[0]!;
    const request = uiActionFixture();
    expect(validateUiActionReceipt(receipt)).toBe(true);
    expect(receiptForUiAction(journal, request)).toEqual(receipt);
    expect(receiptForUiAction(journal, { ...request, idempotencyKey: "new-action" })).toBeUndefined();
    expect(receiptForUiAction({ ...journal, receipts: [] }, request)).toBeUndefined();
    for (const patch of [{ schemaVersion: 2 }, { actionFingerprint: "forged" }, { state: "unknown" }, { createdAt: "yesterday" }, { updatedAt: "2026-08-09T00:00:00.000Z" }, { result: undefined }, { result: { ...receipt.result, status: "accepted", resultingDocument: undefined } }]) expect(validateUiActionReceipt({ ...receipt, ...patch })).toBe(false);
    const pending = { ...receipt, state: "pending", result: undefined };
    expect(validateUiActionReceipt(pending)).toBe(true);
    expect(validateUiActionReceipt({ ...pending, result: receipt.result })).toBe(false);
    expect(validateUiActionJournal({ ...journal, receipts: [receipt, receipt] })).toBe(false);
    expect(validateUiActionJournal({ ...journal, documentId: "other" })).toBe(false);
    expect(validateUiActionJournal({ ...journal, kind: "other" })).toBe(false);
    expect(() => receiptForUiAction({ ...journal, receipts: [receipt, receipt] }, request)).toThrow(UiActionReplayConflictError);
    expect(() => receiptForUiAction(journal, { ...request, answer: "different" })).toThrow(UiActionReplayConflictError);
    expect(() => receiptForUiAction(journal, { ...request, documentId: "other" })).toThrow(UiActionReplayConflictError);
    expect(canonicalUiAction({ ...request, answer: ["second", "first"] })).not.toBe(canonicalUiAction({ ...request, answer: ["first", "second"] }));
    const { answer, ...rest } = request;
    expect(canonicalUiAction({ answer, ...rest })).toBe(canonicalUiAction(request));
  });
});


describe("nested learning content", () => {
  test("study plans reject unresolved, cyclic, duplicate and malformed nested work", () => {
    const item = { id: "first", title: "Read", detail: "Read the source", estimatedMinutes: 600, outcomes: ["Name the evidence"], status: "in_progress" };
    const plan = { type: "study-plan", id: "plan", title: "Research", overview: "A reading path", items: [item, { id: "second", title: "Explain", dependsOn: ["first"] }], relatedPlans: [{ planId: "related", title: "Further reading", relation: "related", detail: "An extension" }], resource };
    rejectChanges(plan, [{ title: "" }, { overview: 1 }, { items: [] }, { items: [item, item] }, { items: [{ ...item, dependsOn: ["first"] }] }, { items: [{ ...item, dependsOn: ["missing"] }] }, { items: [{ ...item, dependsOn: ["second"] }, { id: "second", title: "Explain", dependsOn: ["first"] }] }, { resource: { ...resource, format: "unknown" } }]);
    for (const patch of [{ id: "" }, { title: "" }, { detail: 1 }, { estimatedMinutes: 0 }, { estimatedMinutes: 601 }, { estimatedMinutes: 0.5 }, { status: "pending" }, { dependsOn: ["second", "second"] }, { dependsOn: ["bad id"] }, { outcomes: [false] }, { children: [] }, { children: [{ id: "first", title: "Duplicate" }] }, { unknown: true }]) expect(validateUiDocument(documentWith({ ...plan, items: [{ ...item, ...patch }] }))).toBe(false);
    for (const relation of ["prerequisite", "follow-up", "related"]) expect(validateUiDocument(documentWith({ ...plan, relatedPlans: [{ planId: "related", title: "Further reading", relation }] }))).toBe(true);
    const link = { planId: "related", title: "Further reading" };
    for (const patch of [{ planId: "" }, { title: "" }, { relation: "parent" }, { detail: 1 }, { unknown: true }]) expect(validateUiDocument(documentWith({ ...plan, relatedPlans: [{ ...link, ...patch }] }))).toBe(false);
    expect(validateUiDocument(documentWith({ ...plan, relatedPlans: [link, link] }))).toBe(false);
    expect(validateUiDocument(documentWith({ type: "study-plan", id: "legacy-plan", resource }))).toBe(true);
    expect(validateUiDocument(documentWith({ type: "study-plan", id: "empty-plan" }))).toBe(false);
    expect(validateUiDocument(documentWith({ ...plan, items: [{ id: "parent", title: "Parent", children: [item] }] }))).toBe(true);
  });

  test("goal steps, deck cards and task checklists keep bounded learner text and distinct IDs", () => {
    const step = { id: "step", title: "Explain", status: "not_started", successCriteria: ["Use evidence"] };
    const goal = { type: "goal", id: "goal", title: "Explain the result", description: "A learning objective", status: "active", steps: [step] };
    rejectChanges(goal, [{ status: "unknown" }, { title: "" }, { description: 1 }, { steps: [step, step] }]);
    for (const status of ["active", "completed", "paused"]) expect(validateUiDocument(documentWith({ ...goal, status }))).toBe(true);
    for (const status of ["not_started", "in_progress", "done"]) expect(validateUiDocument(documentWith({ ...goal, steps: [{ ...step, status }] }))).toBe(true);
    for (const patch of [{ id: "" }, { title: "" }, { status: "unknown" }, { successCriteria: [1] }, { successCriteria: ["x".repeat(1025)] }, { unknown: true }]) expect(validateUiDocument(documentWith({ ...goal, steps: [{ ...step, ...patch }] }))).toBe(false);
    const card = { id: "card", front: "What changed?", back: "The evidence", tags: ["recall"] };
    const deck = { type: "deck", id: "deck", title: "Evidence", topic: "Research", description: "Recall practice", cards: [card] };
    rejectChanges(deck, [{ title: "" }, { topic: "" }, { description: 1 }, { cards: [card, card] }]);
    for (const patch of [{ id: "" }, { front: "" }, { back: "" }, { tags: [1] }, { tags: ["x".repeat(257)] }, { tags: Array(33).fill("recall") }, { unknown: true }]) expect(validateUiDocument(documentWith({ ...deck, cards: [{ ...card, ...patch }] }))).toBe(false);
    const item = { id: "item", title: "Observe", detail: "Watch carefully", status: "done", note: "The water boiled." };
    expect(validateUiDocument(documentWith({ ...task, items: [item], criteria: ["Record a temperature"] }))).toBe(true);
    for (const kind of ["assignment", "practice", "draft", "fieldwork"]) expect(validateUiDocument(documentWith({ ...task, kind }))).toBe(true);
    for (const patch of [{ id: "" }, { title: "" }, { detail: 1 }, { status: "unknown" }, { note: 1 }, { unknown: true }]) expect(validateUiDocument(documentWith({ ...task, items: [{ ...item, ...patch }] }))).toBe(false);
    rejectChanges(task, [{ items: [item, item] }, { criteria: [1] }, { criteria: [""] }, { criteria: Array(33).fill("Observe") }]);
  });

  test("optional titles, presentation hints and media kinds stay portable", () => {
    const cases: Array<[Wire, Wire[]]> = [
      [{ type: "callout", id: "c", markdown: "", title: "", tone: "warning" }, [{ tone: "danger" }, { title: 1 }]],
      [{ type: "concept-map", id: "c", source: "graph TD; A-->B", title: "" }, [{ source: "" }, { title: 1 }]],
      [{ type: "notes", id: "n", title: "Notes", value: "", placeholder: "" }, [{ title: "" }, { value: 1 }, { placeholder: 1 }]],
      [{ type: "question-group", id: "g", title: "", intro: "", topic: "", questions: [question] }, [{ title: 1 }, { intro: 1 }, { topic: 1 }, { questions: [] }, { questions: [question, question] }, { questions: [{ ...question, unknown: true }] }]],
      [{ type: "music-lab", id: "m", title: "Music", code: 'sound("bd")', brief: "", visualization: "scope", controls: [{ ...parameter, unit: "Hz" }] }, [{ title: "" }, { code: "" }, { brief: 1 }, { visualization: "webgl" }, { controls: [parameter, parameter] }]],
      [{ type: "handoff", id: "h", target: "mobile", reason: "Continue on mobile", context: "Listen to the recording" }, [{ target: "watch" }, { reason: "" }, { context: "" }]],
    ];
    for (const [node, changes] of cases) rejectChanges(node, changes);
    for (const tone of ["info", "hint", "check", "warning"]) expect(validateUiDocument(documentWith({ type: "callout", id: "c", markdown: "", tone }))).toBe(true);
    for (const kind of ["animation", "audio", "video"]) expect(validateUiDocument(documentWith({ type: "media", id: "m", kind, resource: { ...resource, uri: "https://example.org/media" } }))).toBe(true);
  });

  test("ordering questions accept a learner's permutation and reject dropped or invented items", () => {
    const doc = documentWith({ type: "question", id: "node-1", prompt: "Arrange the stages", kind: "ordering", items: ["Observe", "Explain"] });
    expect(validateUiDocument(doc)).toBe(true);
    expect(validateUiActionAgainstDocument({ ...uiActionFixture(), answer: ["Explain", "Observe"] }, doc)).toBe(true);
    expect(validateUiActionAgainstDocument({ ...uiActionFixture(), answer: ["Observe", "Observe"] }, doc)).toBe(false);
  });

  test("a malformed null node is rejected without throwing at the document boundary", () => {
    expect(validateUiDocument({ ...uiDocumentFixture(), nodes: [null] })).toBe(false);
  });
});


describe("learner action evidence", () => {
  test("grouped responses preserve choice permissions, blank counts and row identity", () => {
    const questions = [
      { id: "text", prompt: "Explain", kind: "text" },
      { id: "choice", prompt: "Select", kind: "choice", choices: [option, { id: "other", label: "Other" }], allowText: true },
      { id: "blanks", prompt: "Fill", kind: "blanks", blanks: [{}, {}] },
      { id: "rows", prompt: "Match", kind: "matching", items: ["A", "B"], choices: [option, { id: "other", label: "Other" }], requireReasons: true },
    ];
    const doc = documentWith({ type: "question-group", id: "group", questions });
    const responses = [
      { questionId: "text", type: "text", answer: "Evidence" },
      { questionId: "choice", type: "choice", optionIds: ["option"], text: "Because" },
      { questionId: "blanks", type: "blanks", answers: ["One", "Two"] },
      { questionId: "rows", type: "rows", rows: [{ item: "A", optionId: "option", reason: "First" }, { item: "B", optionId: "other", reason: "Second" }] },
    ];
    const submit = action("submit-question-group", { nodeId: "group", responses });
    expect(validateUiActionAgainstDocument(submit, doc)).toBe(true);
    for (const [index, patches] of [
      [0, [{ answer: 1 }, { questionId: "missing" }, { type: "unknown" }, { unexpected: true }]],
      [1, [{ optionIds: ["missing"] }, { optionIds: ["option", "other"] }, { optionIds: ["option", "option"] }, { text: false }]],
      [2, [{ answers: ["One"] }, { answers: [1, 2] }, { unexpected: true }]],
      [3, [{ rows: [] }, { rows: [{ item: "B", optionId: "option", reason: "First" }, { item: "A", optionId: "other", reason: "Second" }] }, { rows: [{ item: "A", optionId: "missing", reason: "First" }, { item: "B", optionId: "other", reason: "Second" }] }, { rows: [{ item: "A", optionId: "option", reason: "First" }, { item: "B", optionId: "option", reason: "Second" }] }, { rows: [{ item: "A", optionId: "option", reason: " " }, { item: "B", optionId: "other", reason: "Second" }] }]],
    ] as Array<[number, Wire[]]>) {
      for (const patch of patches) expect(validateUiActionAgainstDocument({ ...submit, responses: responses.map((response, i) => i === index ? { ...response, ...patch } : response) }, doc)).toBe(false);
    }
    expect(validateUiActionAgainstDocument({ ...submit, responses: responses.slice(1) }, doc)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...submit, responses: [...responses].reverse() }, doc)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...submit, responses: responses.map((r, i) => i === 1 ? { ...r, optionIds: [] } : r) }, doc)).toBe(true);
    const noText = documentWith({ type: "question-group", id: "group", questions: questions.map(q => q.id === "choice" ? { ...q, allowText: false } : q) });
    expect(validateUiActionAgainstDocument(submit, noText)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...submit, responses: responses.map((r, i) => i === 1 ? { questionId: "choice", type: "choice", optionIds: [] } : r) }, noText)).toBe(false);
  });

  test("quiz results accept bounded partial credit and reject foreign evidence and impossible scores", () => {
    const doc = documentWith({ type: "quiz", id: "quiz", title: "Evidence", questions: [{ id: "one", prompt: "Explain" }, { id: "two", prompt: "Apply" }] });
    const complete = action("complete-quiz", { nodeId: "quiz", resultId: "result", answers: [{ questionId: "one", answer: "Evidence" }], score: 1, partialCreditPoints: 0.5, partialCredits: { one: 0.5, two: 0 }, timing: { totalMs: 0, perQuestionMs: { one: 0 } }, flaggedQuestionIds: ["two"], pendingGradeQuestionIds: ["one"], skippedQuestionIds: ["two"], timedOutQuestionIds: ["two"], examTimedOut: false });
    expect(validateUiActionAgainstDocument(complete, doc)).toBe(true);
    for (const patch of [{ resultId: "" }, { score: -1 }, { score: Infinity }, { score: 3 }, { partialCreditPoints: -1 }, { partialCreditPoints: 3 }, { partialCredits: { one: -0.1 } }, { partialCredits: { one: 1.1 } }, { partialCredits: { one: "1" } }, { partialCredits: { missing: 0.5 } }, { partialCredits: [] }, { timing: { totalMs: -1, perQuestionMs: {} } }, { timing: { totalMs: 0.5, perQuestionMs: {} } }, { timing: { totalMs: 0, perQuestionMs: { one: -1 } } }, { timing: { totalMs: 0, perQuestionMs: { missing: 0 } } }, { timing: { totalMs: 0, perQuestionMs: {}, unknown: 1 } }, { flaggedQuestionIds: ["missing"] }, { pendingGradeQuestionIds: ["missing"] }, { skippedQuestionIds: ["one"] }, { timedOutQuestionIds: ["two", "two"] }, { examTimedOut: "yes" }, { answers: [{ questionId: "missing", answer: "Evidence" }] }, { answers: [{ questionId: "one", answer: 1 }] }, { answers: [{ questionId: "one", answer: "A", extra: true }] }]) expect(validateUiActionAgainstDocument({ ...complete, ...patch }, doc)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...complete, partialCredits: { one: 1 }, score: 2, partialCreditPoints: 2 }, doc)).toBe(true);
  });

  test("deck completion carries real ordered card reviews with honest counts and finite scheduling data", () => {
    const cards = [{ id: "a", front: "A", back: "Answer A" }, { id: "b", front: "B", back: "Answer B" }];
    const doc = documentWith({ type: "deck", id: "deck", title: "Recall", topic: "Evidence", cards });
    const rating = { cardId: "a", rating: 0, appliedIntervalDays: 0, easeAfter: 0 };
    const complete = action("complete-deck", { nodeId: "deck", ratings: [rating, { ...rating, cardId: "b", rating: 3 }], summary: { reviewed: 2, lapses: 1 } });
    expect(validateUiActionAgainstDocument(complete, doc)).toBe(true);
    for (const value of [0, 1, 2, 3]) expect(validateUiAction({ ...complete, ratings: [{ ...rating, rating: value }] })).toBe(true);
    for (const patch of [{ cardId: "" }, { cardId: "missing" }, { rating: -1 }, { rating: 4 }, { rating: 0.5 }, { appliedIntervalDays: -1 }, { appliedIntervalDays: Infinity }, { easeAfter: -1 }, { easeAfter: NaN }, { unknown: true }]) expect(validateUiActionAgainstDocument({ ...complete, ratings: [{ ...rating, ...patch }, { ...rating, cardId: "b" }] }, doc)).toBe(false);
    for (const summary of [{ reviewed: 1, lapses: 0 }, { reviewed: 2, lapses: 3 }, { reviewed: -1, lapses: 0 }, { reviewed: 2, lapses: -1 }, { reviewed: 2.5, lapses: 0 }, { reviewed: 2, lapses: 0, unknown: true }]) expect(validateUiActionAgainstDocument({ ...complete, summary }, doc)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...complete, ratings: [{ ...rating, cardId: "b" }, rating] }, doc)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...complete, ratings: [rating, rating] }, doc)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...complete, ratings: [], summary: { reviewed: 0, lapses: 0 } }, doc)).toBe(true);
  });

  test("actions cannot escape their target, lifecycle, revision or requested interaction kind", () => {
    const request = uiActionFixture();
    const doc = uiDocumentFixture();
    expect(validateUiActionAgainstDocument(request, doc)).toBe(true);
    for (const patch of [{ schemaVersion: 2 }, { documentId: "other" }, { documentRevision: 1 }, { nodeId: "missing" }, { idempotencyKey: "" }, { answer: 1 }, { unknown: true }]) expect(validateUiActionAgainstDocument({ ...request, ...patch }, doc)).toBe(false);
    for (const lifecycle of ["draft", "streaming", "submitted", "completed", "failed", "cancelled"]) expect(validateUiActionAgainstDocument(request, { ...doc, lifecycle })).toBe(false);
    for (const lifecycle of ["failed", "cancelled"]) expect(validateUiActionAgainstDocument(action("retry"), { ...doc, lifecycle })).toBe(true);
    expect(validateUiActionAgainstDocument(action("retry"), doc)).toBe(false);
    expect(validateUiActionAgainstDocument(action("choose-option", { optionIds: ["option"] }), doc)).toBe(false);
    const choiceDoc = documentWith({ type: "question", id: "node-1", prompt: "Select", choices: [option, { id: "other", label: "Other" }] });
    expect(validateUiActionAgainstDocument(action("choose-option", { optionIds: ["option"] }), choiceDoc)).toBe(true);
    expect(validateUiActionAgainstDocument(action("choose-option", { optionIds: ["missing"] }), choiceDoc)).toBe(false);
    expect(validateUiActionAgainstDocument(action("choose-option", { optionIds: ["option", "other"] }), choiceDoc)).toBe(false);
    expect(validateUiActionAgainstDocument(request, choiceDoc)).toBe(false);
    const taskDoc = documentWith({ ...task, id: "node-1", items: [{ id: "item", title: "Record" }], submission: { format: "none" } });
    expect(validateUiActionAgainstDocument(action("complete-task-item", { itemId: "item", completed: false, note: "" }), taskDoc)).toBe(true);
    expect(validateUiActionAgainstDocument(action("complete-task-item", { itemId: "missing", completed: true }), taskDoc)).toBe(false);
    expect(validateUiActionAgainstDocument(action("submit-task", { submission: "Notes" }), taskDoc)).toBe(false);
  });
});
