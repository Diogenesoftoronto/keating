import { describe, expect, test } from "bun:test";
import {
  NESTED_RENDERING_DOCUMENT_FIXTURE,
  OPENUI_JSON_PARITY_FIXTURE,
  OPENUI_SOURCE_PARITY_FIXTURE,
  RENDERING_FIXTURE_PACK_VERSION,
  RENDERING_NEGATIVE_DOCUMENT_FIXTURES,
  RENDERING_SOURCE_RECOVERY_FIXTURES,
  RENDERING_VALID_DOCUMENT_FIXTURES,
} from "@keating/learner-contracts";
import { extractUiDocuments, hideUiDocumentWireWhileStreaming, hideUnclosedUiDocumentFence, scopeUiDocument } from "../src/lib/ui-document-wire";

const DOCUMENT = {
  schemaVersion: 1,
  id: "check-1",
  revision: 0,
  lifecycle: "ready",
  supportedSurfaces: ["mobile", "web"],
  nodes: [{ type: "question", id: "question-1", prompt: "What changes the posterior?" }],
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

function documentFence(document: unknown): string {
  return `\`\`\`keating-ui\n${JSON.stringify(document)}\n\`\`\``;
}

describe("mobile OpenUI document wire", () => {
  test("extracts multiple versioned documents without leaking their wire source", () => {
    const parsed = extractUiDocuments([
      "Before",
      documentFence(OPENUI_JSON_PARITY_FIXTURE),
      documentFence(NESTED_RENDERING_DOCUMENT_FIXTURE),
      "After",
    ].join("\n"));

    expect(RENDERING_FIXTURE_PACK_VERSION).toBe(2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.documents).toEqual([OPENUI_JSON_PARITY_FIXTURE, NESTED_RENDERING_DOCUMENT_FIXTURE]);
    expect(parsed.content).toBe("Before\nAfter");
    expect(parsed.content).not.toContain("keating-ui");
    expect(parsed.content).not.toContain("schemaVersion");
  });

  test("accepts every versioned positive document fixture independently", () => {
    for (const fixture of RENDERING_VALID_DOCUMENT_FIXTURES) {
      const parsed = extractUiDocuments(documentFence(fixture.payload));
      expect(parsed.errors, fixture.id).toEqual([]);
      expect(parsed.documents, fixture.id).toEqual([fixture.payload]);
      expect(parsed.content, fixture.id).toBe("");
    }
  });

  test("fails closed for every negative document fixture with one inert recovery surface", () => {
    for (const fixture of RENDERING_NEGATIVE_DOCUMENT_FIXTURES) {
      const parsed = extractUiDocuments(documentFence(fixture.payload));
      expect(parsed.documents, fixture.id).toEqual([]);
      expect(parsed.errors.length, fixture.id).toBeGreaterThan(0);
      expect(parsed.content, fixture.id).toContain("Interactive document recovery");
      expect(parsed.content, fixture.id).toContain("was not executed");
      expect(parsed.content, fixture.id).not.toContain("```keating-ui");
      expect(parsed.content.match(/Interactive document recovery/g), fixture.id)?.toHaveLength(1);
    }
  });

  test("compiles the closed browser fixture once without leaking its source wire", () => {
    const parsed = extractUiDocuments([
      "Before",
      `\`\`\`openui lifecycle=workspace id=source-parity revision=3\n${OPENUI_SOURCE_PARITY_FIXTURE}\n\`\`\``,
      "After",
    ].join("\n"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0]?.id).toBe("source-parity");
    expect(parsed.documents[0]?.revision).toBe(3);
    expect(parsed.documents[0]?.retention).toBe("workspace");
    expect(parsed.documents[0]?.nodes.map((node) => node.type)).toEqual([
      "markdown", "callout", "question-group", "quiz", "deck", "study-plan",
      "concept-map", "image", "handoff", "notes",
    ]);
    expect(parsed.content).toBe("Before\nAfter");
    expect(parsed.content).not.toContain("LearningSurface");
  });

  test("preserves active-looking source as inert recovery text without evaluating it", () => {
    const globalScope = globalThis as typeof globalThis & { __keatingOpenUiExecuted?: boolean };
    globalScope.__keatingOpenUiExecuted = false;
    try {
      const source = `\`\`\`openui\nroot = (globalThis.__keatingOpenUiExecuted = true)\n\`\`\``;
      const parsed = extractUiDocuments(source);
      expect(parsed.documents).toEqual([]);
      expect(parsed.errors[0]).toContain("Interactive document is");
      expect(parsed.content).toContain("globalThis.__keatingOpenUiExecuted = true");
      expect(parsed.content).toContain("was not executed");
      expect(parsed.content).not.toContain("```openui");
      expect(globalScope.__keatingOpenUiExecuted).toBe(false);
    } finally {
      delete globalScope.__keatingOpenUiExecuted;
    }
  });

  test("hides partial and truncated OpenUI fences while retaining visible prose", () => {
    const partial = RENDERING_SOURCE_RECOVERY_FIXTURES.find((fixture) => fixture.expectation === "partial");
    expect(partial).toBeDefined();
    const source = `Visible before the response.\n${String(partial?.payload)}`;
    expect(hideUnclosedUiDocumentFence(source)).toBe("Visible before the response.");

    const truncatedJson = "Visible JSON\n```keating-ui\n{\"schemaVersion\":";
    expect(hideUnclosedUiDocumentFence(truncatedJson)).toBe("Visible JSON");
    const complete = `Visible\n${documentFence(DOCUMENT)}`;
    expect(hideUnclosedUiDocumentFence(complete)).toBe(complete);
    expect(hideUiDocumentWireWhileStreaming(complete)).toBe("Visible");
    expect(hideUiDocumentWireWhileStreaming("Visible\n```ope")).toBe("Visible");
  });

  test("preserves partial source after completion and hides it while streaming", () => {
    const partial = RENDERING_SOURCE_RECOVERY_FIXTURES.find((fixture) => fixture.expectation === "partial");
    expect(partial).toBeDefined();
    const source = `Visible before the response.\n${String(partial?.payload)}`;
    expect(hideUnclosedUiDocumentFence(source)).toBe("Visible before the response.");
    const completedTurn = extractUiDocuments(source);
    expect(completedTurn.documents).toEqual([]);
    expect(completedTurn.errors[0]).toContain("incomplete");
    expect(completedTurn.content).toContain("Visible before the response.");
    expect(completedTurn.content).toContain("Partial rendering");
    expect(completedTurn.content).not.toContain("```openui");
  });

  test("rejects completed malformed, unsafe, and future source as inert text", () => {
    for (const fixture of RENDERING_SOURCE_RECOVERY_FIXTURES.filter((candidate) => candidate.expectation === "rejected")) {
      const parsed = extractUiDocuments(String(fixture.payload));
      expect(parsed.documents, fixture.id).toEqual([]);
      expect(parsed.errors.length, fixture.id).toBeGreaterThan(0);
      expect(parsed.content, fixture.id).toContain("Interactive document recovery");
      expect(parsed.content, fixture.id).toContain("was not executed");
      expect(parsed.content, fixture.id).not.toContain("```openui");
    }
    const future = extractUiDocuments([
      "```openui lifecycle=workspace id=future-source",
      'root = LearningSurface([future], "Future")',
      'future = FutureWidget({ value: "unknown" })',
      "```",
    ].join("\n"));
    expect(future.documents).toEqual([]);
    expect(future.errors[0]).toContain("unsupported");
    expect(future.content).toContain("FutureWidget");
  });

  test("rejects unsafe documents and non-mobile surfaces", () => {
    const webOnly = extractUiDocuments(documentFence({ ...DOCUMENT, supportedSurfaces: ["web"] }));
    expect(webOnly.documents).toEqual([]);
    expect(webOnly.errors[0]).toContain("does not declare mobile support");
  });

  test("namespaces every model-authored document to its persisted session event", () => {
    const sourceDocuments = [OPENUI_JSON_PARITY_FIXTURE, NESTED_RENDERING_DOCUMENT_FIXTURE];
    const first = sourceDocuments.map((document, index) => scopeUiDocument(document, `session-1:message-1:${index}`));
    const replay = sourceDocuments.map((document, index) => scopeUiDocument(document, `session-1:message-1:${index}`));
    const otherSession = sourceDocuments.map((document, index) => scopeUiDocument(document, `session-2:message-1:${index}`));

    expect(first.map((document) => document.id)).toEqual(replay.map((document) => document.id));
    expect(first.map((document) => document.id)).not.toEqual(otherSession.map((document) => document.id));
    expect(new Set(first.map((document) => document.id)).size).toBe(sourceDocuments.length);
    expect(first[0]?.id).toStartWith(`${OPENUI_JSON_PARITY_FIXTURE.id}--`);
    expect(first[1]?.id).toStartWith(`${NESTED_RENDERING_DOCUMENT_FIXTURE.id}--`);
    expect(OPENUI_JSON_PARITY_FIXTURE.id).toBe("rendering-parity-document");
    expect(NESTED_RENDERING_DOCUMENT_FIXTURE.id).toBe("nested-rendering-document");
  });

  test("keeps compiled source identity isolated across sessions without double scoping", () => {
    const wire = `\`\`\`openui id=shared-source\nroot = LearningSurface([x], "Scoped")\nx = Explanation("Safe")\n\`\`\``;
    const parsed = extractUiDocuments(wire);
    expect(parsed.documents).toHaveLength(1);
    const document = parsed.documents[0]!;
    const first = scopeUiDocument(document, "session-a:message-1:0");
    const replay = scopeUiDocument(document, "session-a:message-1:0");
    const fork = scopeUiDocument(document, "session-b:message-1:0");
    expect(first.id).toBe(replay.id);
    expect(first.id).not.toBe(fork.id);
    expect(first.id.match(/--/g)).toHaveLength(1);
    expect(parsed.content).toBe("");
  });
});
