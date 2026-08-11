import { describe, expect, test } from "bun:test";
import {
  OPENUI_SOURCE_PARITY_FIXTURE,
  SHARED_OPENUI_COMPONENT_MAPPERS,
  WEB_OPENUI_COMPONENTS,
  compileOpenUISourceToSharedDocument,
  tryCompileOpenUISourceToSharedDocument,
  validateUiDocument,
} from "../src/index.js";

const AT = "2026-08-10T00:00:00.000Z";

describe("trusted OpenUI source compiler", () => {
  test("compiles fixture pack v2 through every registered component mapper", () => {
    const document = compileOpenUISourceToSharedDocument(OPENUI_SOURCE_PARITY_FIXTURE, {
      documentId: "session-1-message-1-openui-1",
      createdAt: AT,
      updatedAt: AT,
    });
    expect(SHARED_OPENUI_COMPONENT_MAPPERS).toEqual(WEB_OPENUI_COMPONENTS);
    expect(validateUiDocument(document)).toBe(true);
    expect(document.retention).toBe("workspace");
    expect(document.nodes.map((node) => node.type)).toEqual([
      "markdown", "callout", "question-group", "quiz", "deck", "study-plan",
      "concept-map", "image", "handoff", "notes",
    ]);
    const handoff = document.nodes.find((node) => node.type === "handoff");
    expect(handoff?.type === "handoff" ? handoff.context : "").not.toContain("<html>");
  });

  test("accepts the browser object form without evaluating it", () => {
    const source = [
      'root = LearningSurface({ content: [explanation], title: "Object form", lifecycle: "resumable" })',
      'explanation = Explanation({ markdown: "A literal explanation." })',
    ].join("\n");
    const result = tryCompileOpenUISourceToSharedDocument(source, { documentId: "object-form", createdAt: AT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe("Object form");
    expect(result.document.retention).toBe("resumable");
    expect(result.document.nodes).toEqual([{ type: "markdown", id: "explanation", markdown: "A literal explanation." }]);
  });

  test("matches the browser root lifecycle default", () => {
    const document = compileOpenUISourceToSharedDocument(
      'root = LearningSurface([x], "Default lifecycle")\nx = Explanation("Safe")',
      { documentId: "default-lifecycle", createdAt: AT },
    );
    expect(document.retention).toBe("ephemeral");
  });

  test("classifies partial, malformed, unsafe, and future source distinctly", () => {
    expect(tryCompileOpenUISourceToSharedDocument(
      'root = LearningSurface([explanation], "Partial',
      { documentId: "partial", createdAt: AT },
    )).toMatchObject({ ok: false, kind: "partial" });
    expect(tryCompileOpenUISourceToSharedDocument(
      'root = LearningSurface([,], "Malformed")',
      { documentId: "malformed", createdAt: AT },
    )).toMatchObject({ ok: false, kind: "invalid" });
    expect(tryCompileOpenUISourceToSharedDocument(
      '@include file:///private/state\nroot = LearningSurface([], "Unsafe")',
      { documentId: "unsafe", createdAt: AT },
    )).toMatchObject({ ok: false, kind: "unsafe" });
    expect(tryCompileOpenUISourceToSharedDocument(
      'root = LearningSurface([future], "Future")\nfuture = FutureWidget({ value: "unknown" })',
      { documentId: "future", createdAt: AT },
    )).toMatchObject({ ok: false, kind: "unsupported" });
  });

  test("never evaluates model-authored expressions or HTML", () => {
    const scope = globalThis as typeof globalThis & { __openUiCompilerExecuted?: boolean };
    scope.__openUiCompilerExecuted = false;
    try {
      const active = tryCompileOpenUISourceToSharedDocument(
        'root = LearningSurface([x], "Unsafe")\nx = Explanation(globalThis.__openUiCompilerExecuted = true)',
        { documentId: "active", createdAt: AT },
      );
      expect(active).toMatchObject({ ok: false });
      expect(scope.__openUiCompilerExecuted).toBe(false);

      const html = compileOpenUISourceToSharedDocument([
        'root = LearningSurface([animation], "HTML data")',
        'animation = LearningAnimation("topic", "<script>globalThis.__openUiCompilerExecuted = true</script>")',
      ].join("\n"), { documentId: "html-data", createdAt: AT });
      expect(html.nodes[0]?.type).toBe("handoff");
      expect(JSON.stringify(html)).not.toContain("<script>");
      expect(scope.__openUiCompilerExecuted).toBe(false);
    } finally {
      delete scope.__openUiCompilerExecuted;
    }
  });

  test("uses caller-owned session scope without cross-session identity reuse", () => {
    const source = 'root = LearningSurface([x], "Scoped")\nx = Explanation("Safe")';
    const first = compileOpenUISourceToSharedDocument(source, { documentId: "session-a-message-1", createdAt: AT });
    const replay = compileOpenUISourceToSharedDocument(source, { documentId: "session-a-message-1", createdAt: AT });
    const fork = compileOpenUISourceToSharedDocument(source, { documentId: "session-b-message-1", createdAt: AT });
    expect(first.id).toBe(replay.id);
    expect(first.id).not.toBe(fork.id);
  });
});
