import { describe, expect, test } from "bun:test";
import {
  INTERACTIVE_COMPONENTS,
  INTERACTIVE_COMPONENT_NAMES,
  INTERACTIVE_KINDS,
  INTERACTIVE_LIMITS,
  SHARED_OPENUI_COMPONENT_MAPPERS,
  UI_CONTRACT_VERSION,
  WEB_OPENUI_COMPONENTS,
  compileOpenUISourceToSharedDocument,
  interactiveKindForComponent,
  interactiveTextLines,
  isInteractiveConfig,
  tryCompileOpenUISourceToSharedDocument,
  validateInteractiveNode,
  validateInteractiveShare,
  validateUiAction,
  validateUiActionAgainstDocument,
  validateUiDocument,
  type UiDocument,
  type UiInteractiveNode,
  type UiInteractiveShare,
} from "../src/index.js";

const AT = "2026-11-24T00:00:00.000Z";

function compile(statement: string): UiDocument {
  return compileOpenUISourceToSharedDocument(`root = LearningSurface([reply], "Interactive", "", "ephemeral")\nreply = ${statement}`, { documentId: "interactive-doc", createdAt: AT });
}
function only(document: UiDocument): UiInteractiveNode {
  const node = document.nodes[0];
  if (node?.type !== "interactive") throw new Error("expected an interactive node");
  return node;
}
const SHARE: UiInteractiveShare = { learner: "I put the steps in order.", data: "Order: mix, knead, rise, bake.", analysis: "All four in order." };
function shareAction(document: UiDocument, overrides: Record<string, unknown> = {}) {
  const node = only(document);
  return {
    schemaVersion: UI_CONTRACT_VERSION, type: "share-interactive" as const, documentId: document.id, documentRevision: document.revision,
    nodeId: node.id, kind: node.kind, share: SHARE, idempotencyKey: "share-1", ...overrides,
  };
}
function node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "interactive", id: "board", title: "Bread steps", kind: "sort-board", config: { mode: "sequence", items: ["mix", "bake"] }, ...overrides };
}
function nested(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let level = 1; level < depth; level += 1) value = { child: value };
  return value;
}

describe("interactive reply registry", () => {
  test("every kind has one OpenUI name, registered with the web and the compiler", () => {
    expect(INTERACTIVE_KINDS.map((kind) => INTERACTIVE_COMPONENT_NAMES[kind])).toEqual([...INTERACTIVE_COMPONENTS]);
    for (const component of INTERACTIVE_COMPONENTS) {
      expect(WEB_OPENUI_COMPONENTS).toContain(component);
      expect(SHARED_OPENUI_COMPONENT_MAPPERS).toContain(component);
      expect(INTERACTIVE_COMPONENT_NAMES[interactiveKindForComponent(component)!]).toBe(component);
    }
    expect(interactiveKindForComponent("NumberLine")).toBeUndefined();
  });
});

describe("interactive nodes compile from OpenUI source", () => {
  test("the single-object form keeps title, brief and config", () => {
    const document = compile('SortBoard({ title: "Bread steps", brief: "Put them in order.", config: { mode: "sequence", items: ["mix", "knead", "rise", "bake"] } })');
    expect(validateUiDocument(document)).toBe(true);
    expect(only(document)).toEqual({
      type: "interactive", id: "reply", title: "Bread steps", kind: "sort-board", brief: "Put them in order.",
      config: { mode: "sequence", items: ["mix", "knead", "rise", "bake"] },
    });
  });

  test("the positional form is title, config, brief", () => {
    const document = compile('EquationWorkbench("Solve for x", { goal: "isolate", equation: "2x + 3 = 11" }, "Move one term at a time.")');
    expect(only(document)).toEqual({
      type: "interactive", id: "reply", title: "Solve for x", kind: "equation", brief: "Move one term at a time.",
      config: { goal: "isolate", equation: "2x + 3 = 11" },
    });
  });

  test("every component compiles to its kind", () => {
    for (const kind of INTERACTIVE_KINDS) {
      const document = compile(`${INTERACTIVE_COMPONENT_NAMES[kind]}("A ${kind}", { mode: "x" })`);
      expect(only(document).kind).toBe(kind);
    }
  });

  test("a missing or non-object config, or one over the bounds, is rejected", () => {
    const wrap = (statement: string) => tryCompileOpenUISourceToSharedDocument(`root = LearningSurface([reply], "I", "", "ephemeral")\nreply = ${statement}`, { documentId: "d", createdAt: AT });
    expect(wrap('SortBoard("Bread steps")').ok).toBe(false);
    expect(wrap('SortBoard("Bread steps", "not an object")').ok).toBe(false);
    expect(wrap('SortBoard("Bread steps", [1, 2])').ok).toBe(false);
    expect(wrap(`SortBoard("Big", { items: [${Array.from({ length: 60 }, () => JSON.stringify("x".repeat(1000))).join(",")}] })`).ok).toBe(false);
    expect(wrap('SortBoard("Too", { a: 1 }, "brief", "extra")').ok).toBe(false);
  });
});

describe("interactive node bounds", () => {
  test("accepts a well-formed node, with or without a brief", () => {
    expect(validateInteractiveNode(node())).toBe(true);
    expect(validateInteractiveNode(node({ brief: "Framing." }))).toBe(true);
    expect(validateInteractiveNode(node({ config: {} }))).toBe(true);
  });

  test("rejects unknown keys, unknown kinds and bad titles", () => {
    expect(validateInteractiveNode(node({ prompt: "extra" }))).toBe(false);
    expect(validateInteractiveNode(node({ kind: "number-line" }))).toBe(false);
    expect(validateInteractiveNode(node({ title: "  " }))).toBe(false);
    expect(validateInteractiveNode(node({ title: "x".repeat(INTERACTIVE_LIMITS.title + 1) }))).toBe(false);
    expect(validateInteractiveNode(node({ brief: "x".repeat(INTERACTIVE_LIMITS.brief + 1) }))).toBe(false);
    expect(validateInteractiveNode(node({ id: "not an id" }))).toBe(false);
  });

  test("config must be JSON-safe", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const withGetter = Object.defineProperty({}, "x", { get: () => 1, enumerable: true });
    const sparse = [1, , 3];
    class Shape { side = 1; }
    for (const config of [
      { run: () => 1 }, { value: undefined }, { value: Number.NaN }, { value: Infinity }, { value: 1n },
      { value: Symbol("s") }, { date: new Date(0) }, { shape: new Shape() }, cyclic, withGetter, { list: sparse },
      JSON.parse('{"__proto__": {"polluted": true}}'), { constructor: 1 }, [], "text", null,
    ]) {
      expect(isInteractiveConfig(config)).toBe(false);
      expect(validateInteractiveNode(node({ config }))).toBe(false);
    }
    expect(isInteractiveConfig({ [Symbol("hidden")]: 1 })).toBe(false);
  });

  test("a shared, non-cyclic reference is fine", () => {
    const point = { x: 1, y: 2 };
    expect(isInteractiveConfig({ a: point, b: point, list: [point, point] })).toBe(true);
  });

  test("config depth is at most 12 levels", () => {
    expect(isInteractiveConfig(nested(INTERACTIVE_LIMITS.configDepth))).toBe(true);
    expect(isInteractiveConfig(nested(INTERACTIVE_LIMITS.configDepth + 1))).toBe(false);
  });

  test("config is at most 48 KB serialised, in UTF-8 bytes", () => {
    const overhead = JSON.stringify({ s: "" }).length;
    const fits = { s: "x".repeat(INTERACTIVE_LIMITS.configBytes - overhead) };
    expect(JSON.stringify(fits).length).toBe(INTERACTIVE_LIMITS.configBytes);
    expect(isInteractiveConfig(fits)).toBe(true);
    expect(isInteractiveConfig({ s: "x".repeat(INTERACTIVE_LIMITS.configBytes - overhead + 1) })).toBe(false);
    // Under the limit in UTF-16 code units, over it in bytes.
    expect(isInteractiveConfig({ s: "σ".repeat(30_000) })).toBe(false);
  });
});

describe("interactive share bounds", () => {
  test("accepts bounded text, with empty analysis allowed", () => {
    expect(validateInteractiveShare(SHARE)).toBe(true);
    expect(validateInteractiveShare({ ...SHARE, analysis: "" })).toBe(true);
  });

  test("rejects missing, empty, oversize and unknown fields", () => {
    expect(validateInteractiveShare({ learner: SHARE.learner, data: SHARE.data })).toBe(false);
    expect(validateInteractiveShare({ ...SHARE, learner: " " })).toBe(false);
    expect(validateInteractiveShare({ ...SHARE, data: "" })).toBe(false);
    expect(validateInteractiveShare({ ...SHARE, learner: "x".repeat(INTERACTIVE_LIMITS.shareLearner + 1) })).toBe(false);
    expect(validateInteractiveShare({ ...SHARE, data: "x".repeat(INTERACTIVE_LIMITS.shareData + 1) })).toBe(false);
    expect(validateInteractiveShare({ ...SHARE, analysis: "x".repeat(INTERACTIVE_LIMITS.shareAnalysis + 1) })).toBe(false);
    expect(validateInteractiveShare({ ...SHARE, reply: "extra" })).toBe(false);
    expect(validateInteractiveShare({ ...SHARE, data: { moves: 3 } })).toBe(false);
  });
});

describe("share-interactive is validated against the exact node", () => {
  const document = compile('SortBoard("Bread steps", { mode: "sequence", items: ["mix", "bake"] })');

  test("a share for the node's own kind is accepted", () => {
    expect(validateUiAction(shareAction(document))).toBe(true);
    expect(validateUiActionAgainstDocument(shareAction(document), document)).toBe(true);
  });

  test("a kind mismatch, an unknown kind or a non-interactive target is rejected", () => {
    expect(validateUiActionAgainstDocument(shareAction(document, { kind: "plan-timeline" }), document)).toBe(false);
    expect(validateUiAction(shareAction(document, { kind: "number-line" }))).toBe(false);
    const other = compileOpenUISourceToSharedDocument('root = LearningSurface([note], "N", "", "ephemeral")\nnote = Explanation("Just text.")', { documentId: "interactive-doc", createdAt: AT });
    expect(validateUiActionAgainstDocument({ ...shareAction(document), nodeId: other.nodes[0]!.id }, other)).toBe(false);
  });

  test("unknown keys and malformed shares are rejected", () => {
    expect(validateUiAction(shareAction(document, { state: {} }))).toBe(false);
    expect(validateUiAction(shareAction(document, { share: { ...SHARE, extra: 1 } }))).toBe(false);
    expect(validateUiAction(shareAction(document, { share: undefined }))).toBe(false);
  });

  test("a stale revision is rejected", () => {
    expect(validateUiActionAgainstDocument(shareAction(document, { documentRevision: document.revision + 1 }), document)).toBe(false);
  });
});

describe("interactive text fallback", () => {
  test("is a calm summary, never raw JSON", () => {
    const lines = interactiveTextLines(only(compile('SortBoard("Bread steps", { mode: "sequence", goal: "Put the steps in baking order.", items: ["mix", "knead", "rise", "bake"], perfectReply: { a: 1 } })')));
    expect(lines).toEqual([
      "Sort board · sequence",
      "Put the steps in baking order.",
      "Holds 4 items.",
    ]);
    expect(lines.join("\n")).not.toMatch(/[{}[\]"]/);
  });

  test("a config title that differs from the node title is kept, and long text is clipped", () => {
    const lines = interactiveTextLines({ type: "interactive", id: "m", title: "HTTP", kind: "state-machine", config: { title: "Request lifecycle", goal: "trace it ".repeat(60), states: [1, 2, 3], events: [1], startOrder: [1] } });
    expect(lines[0]).toBe("State machine");
    expect(lines[1]).toBe("Request lifecycle");
    expect(lines[2]!.length).toBeLessThanOrEqual(160);
    expect(lines[3]).toBe("Holds 3 states, 1 event.");
  });
});
