import { describe, expect, test } from "bun:test";
import {
  UI_CONTRACT_VERSION,
  compileOpenUISourceToSharedDocument,
  describeManipulativeState,
  initialManipulativeState,
  manipulativeModelFromProps,
  manipulativeTextLines,
  numberLineTicks,
  placeValueParts,
  snapToNumberLine,
  tryCompileOpenUISourceToSharedDocument,
  validateUiAction,
  validateUiActionAgainstDocument,
  validateUiDocument,
  type UiDocument,
  type UiManipulativeNode,
  type UiManipulativeState,
} from "../src/index.js";

const AT = "2026-11-20T00:00:00.000Z";

function compile(statement: string, retention: "ephemeral" | "workspace" = "ephemeral"): UiDocument {
  return compileOpenUISourceToSharedDocument(`root = LearningSurface([model], "Early learning", "", "${retention}")\nmodel = ${statement}`, { documentId: "early-doc", createdAt: AT });
}
function only(document: UiDocument): UiManipulativeNode {
  const node = document.nodes[0];
  if (node?.type !== "manipulative") throw new Error("expected a manipulative node");
  return node;
}
function share(document: UiDocument, state: UiManipulativeState, nodeId = document.nodes[0]!.id) {
  return { schemaVersion: UI_CONTRACT_VERSION, type: "share-manipulative" as const, documentId: document.id, documentRevision: document.revision, nodeId, state, idempotencyKey: "share-1" };
}

describe("early-learning manipulatives compile from positional OpenUI source", () => {
  test("a number line keeps marks and hops, and its prompt makes it a task", () => {
    const document = compile('NumberLine("hops", "Start at 3", 0, 10, 1, [{ value: 3, label: "start" }], [{ from: 3, to: 7, label: "+4" }], "Where do you land?", "ephemeral", "Count each hop.")');
    expect(validateUiDocument(document)).toBe(true);
    expect(only(document)).toEqual({
      type: "manipulative", id: "hops", title: "Start at 3", brief: "Count each hop.", prompt: "Where do you land?",
      model: { kind: "number-line", min: 0, max: 10, step: 1, marks: [{ value: 3, label: "start" }], jumps: [{ from: 3, to: 7, label: "+4" }] },
    });
  });

  test("each component maps to its own model kind", () => {
    const sources = [
      'TenFrame("tf", "Make ten", 7, 1, "Fill to ten.")',
      'PlaceValue("pv", "Build it", 342)',
      'FractionBars("fb", "Halves", [{ parts: 2, shaded: 1 }, { parts: 4, shaded: 2, label: "quarters" }])',
      'CountingArray("ca", "Apples", 3, 4, "apples", "Count them.")',
      'Clock("cl", "Time", 3, 30)',
    ];
    const models = sources.map((source) => only(compile(source)).model);
    expect(models).toEqual([
      { kind: "ten-frame", frames: 1, filled: 7 },
      { kind: "place-value", value: 342 },
      { kind: "fraction-bars", bars: [{ parts: 2, shaded: 1 }, { parts: 4, shaded: 2, label: "quarters" }] },
      { kind: "array", rows: 3, columns: 4, symbol: "apple" },
      { kind: "clock", hour: 3, minute: 30 },
    ]);
  });

  test("out-of-range authoring is clamped into a drawable model instead of failing the lesson", () => {
    expect(manipulativeModelFromProps("NumberLine", { min: 0, max: 100, step: 1 })).toEqual({ kind: "number-line", min: 0, max: 100, step: 5 });
    expect(manipulativeModelFromProps("NumberLine", { min: 0, max: 10, step: 1, marks: [4, 4.5, 20], jumps: [{ from: 2, to: 2 }, { from: 2, to: 30 }] }))
      .toEqual({ kind: "number-line", min: 0, max: 10, step: 1, marks: [{ value: 4 }] });
    expect(manipulativeModelFromProps("TenFrame", { filled: 15 })).toEqual({ kind: "ten-frame", frames: 1, filled: 10 });
    expect(manipulativeModelFromProps("PlaceValue", { value: 4321 })).toEqual({ kind: "place-value", value: 999 });
    expect(manipulativeModelFromProps("FractionBars", { bars: [{ parts: 20, shaded: 30 }] })).toEqual({ kind: "fraction-bars", bars: [{ parts: 12, shaded: 12 }] });
    expect(manipulativeModelFromProps("CountingArray", { rows: 40, columns: 0, symbol: "dragon" })).toEqual({ kind: "array", rows: 10, columns: 1 });
    expect(manipulativeModelFromProps("Clock", { hour: 15, minute: 75 })).toEqual({ kind: "clock", hour: 3, minute: 59 });
    expect(manipulativeModelFromProps("Clock", { hour: 0, minute: 0 })).toEqual({ kind: "clock", hour: 12, minute: 0 });
    // Decimal lines snap without binary noise.
    expect(numberLineTicks({ min: 0, max: 1, step: 0.1 })).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(snapToNumberLine({ min: 0, max: 1, step: 0.1 }, 0.33)).toBe(0.3);
  });

  test("fraction bars with no usable bar fail closed", () => {
    const result = tryCompileOpenUISourceToSharedDocument('root = LearningSurface([model])\nmodel = FractionBars("fb", "Empty", [])', { documentId: "empty", createdAt: AT });
    expect(result.ok).toBe(false);
  });

  test("the contract validator rejects hand-written nodes outside the bounds", () => {
    const base = { schemaVersion: 1 as const, id: "doc", revision: 0, lifecycle: "ready" as const, supportedSurfaces: ["web" as const], createdAt: AT, updatedAt: AT };
    const valid = (model: unknown) => validateUiDocument({ ...base, nodes: [{ type: "manipulative", id: "node", title: "Model", model }] });
    expect(valid({ kind: "number-line", min: 0, max: 10, step: 1 })).toBe(true);
    expect(valid({ kind: "number-line", min: 0, max: 100, step: 1 })).toBe(false); // 101 ticks
    expect(valid({ kind: "number-line", min: 0, max: 10, step: 3 })).toBe(false); // max is off the step grid
    expect(valid({ kind: "number-line", min: 0, max: 10, step: 1, marks: [{ value: 2.5 }] })).toBe(false);
    expect(valid({ kind: "ten-frame", frames: 3, filled: 0 })).toBe(false);
    expect(valid({ kind: "fraction-bars", bars: [{ parts: 3, shaded: 4 }] })).toBe(false);
    expect(valid({ kind: "array", rows: 2, columns: 2, symbol: "🍎" })).toBe(false);
    expect(valid({ kind: "clock", hour: 13, minute: 0 })).toBe(false);
    expect(valid({ kind: "clock", hour: 3, minute: 0, extra: true })).toBe(false);
  });
});

describe("share-manipulative is validated against the exact node", () => {
  const line = compile('NumberLine("hops", "Start at 3", 0, 10, 1, [{ value: 3 }], [], "Where do you land?")');
  const picture = compile('NumberLine("picture", "Just a line", 0, 10, 1)');

  test("a point on a tick of a task node is accepted", () => {
    expect(validateUiActionAgainstDocument(share(line, { kind: "number-line", value: 7 }), line)).toBe(true);
  });

  test("off-tick values, the wrong kind and picture-only nodes are rejected", () => {
    expect(validateUiActionAgainstDocument(share(line, { kind: "number-line", value: 7.5 }), line)).toBe(false);
    expect(validateUiActionAgainstDocument(share(line, { kind: "number-line", value: 11 }), line)).toBe(false);
    expect(validateUiActionAgainstDocument(share(line, { kind: "clock", hour: 3, minute: 0 }), line)).toBe(false);
    expect(validateUiActionAgainstDocument(share(picture, { kind: "number-line", value: 3 }), picture)).toBe(false);
  });

  test("cell states must be unique indices inside the model", () => {
    const frame = compile('TenFrame("tf", "Make ten", 7, 1, "Fill to ten.")');
    expect(validateUiActionAgainstDocument(share(frame, { kind: "ten-frame", cells: [0, 1, 2, 9] }), frame)).toBe(true);
    expect(validateUiActionAgainstDocument(share(frame, { kind: "ten-frame", cells: [0, 0] }), frame)).toBe(false);
    expect(validateUiActionAgainstDocument(share(frame, { kind: "ten-frame", cells: [12] }), frame)).toBe(false);
    const bars = compile('FractionBars("fb", "Halves", [{ parts: 2, shaded: 1 }, { parts: 4, shaded: 0 }], "Match one half.")');
    expect(validateUiActionAgainstDocument(share(bars, { kind: "fraction-bars", shaded: [[0], [0, 1]] }), bars)).toBe(true);
    expect(validateUiActionAgainstDocument(share(bars, { kind: "fraction-bars", shaded: [[0, 2], [0]] }), bars)).toBe(false);
    expect(validateUiActionAgainstDocument(share(bars, { kind: "fraction-bars", shaded: [[0]] }), bars)).toBe(false);
  });

  test("the action shape rejects stray keys and impossible place-value columns", () => {
    expect(validateUiAction({ ...share(line, { kind: "place-value", hundreds: 1, tens: 2, ones: 3 }) })).toBe(true);
    expect(validateUiAction({ ...share(line, { kind: "place-value", hundreds: 1, tens: 20, ones: 3 }) })).toBe(false);
    expect(validateUiAction({ ...share(line, { kind: "number-line", value: 3 }), extra: 1 })).toBe(false);
  });
});

describe("learner-facing and tutor-facing descriptions", () => {
  test("the initial state is the picture the tutor drew", () => {
    expect(initialManipulativeState({ kind: "ten-frame", frames: 2, filled: 3 })).toEqual({ kind: "ten-frame", cells: [0, 1, 2] });
    expect(initialManipulativeState({ kind: "place-value", value: 207 })).toEqual({ kind: "place-value", hundreds: 2, tens: 0, ones: 7 });
    expect(initialManipulativeState({ kind: "number-line", min: 0, max: 10, step: 1, marks: [{ value: 3 }] })).toEqual({ kind: "number-line", value: 3 });
    expect(placeValueParts(58)).toEqual({ hundreds: 0, tens: 5, ones: 8 });
  });

  test("each state reads as one plain sentence", () => {
    const node = (statement: string) => only(compile(statement));
    expect(describeManipulativeState(node('NumberLine("a", "A", 0, 10, 1, [], [], "Go")'), { kind: "number-line", value: 7 })).toBe("Put the point at 7 on the number line.");
    expect(describeManipulativeState(node('TenFrame("b", "B", 0, 2, "Go")'), { kind: "ten-frame", cells: [0, 1, 2] })).toBe("Filled 3 of 20 spaces in the ten frames.");
    expect(describeManipulativeState(node('PlaceValue("c", "C", 0, "Go")'), { kind: "place-value", hundreds: 1, tens: 12, ones: 1 })).toBe("Built 1 hundred, 12 tens and 1 one, which makes 221.");
    expect(describeManipulativeState(node('FractionBars("d", "D", [{ parts: 2, shaded: 1, label: "half" }, { parts: 4, shaded: 0 }], "Go")'), { kind: "fraction-bars", shaded: [[0], [0, 1]] })).toBe("Shaded half: 1/2, 2/4.");
    expect(describeManipulativeState(node('CountingArray("e", "E", 2, 3, "dot", "Go")'), { kind: "array", marked: [0, 1, 2, 3] })).toBe("Counted 4 of the 6 objects.");
    expect(describeManipulativeState(node('Clock("f", "F", 3, 0, "Go")'), { kind: "clock", hour: 3, minute: 5 })).toBe("Set the clock to 3:05.");
  });

  test("text surfaces get a faithful picture", () => {
    expect(manipulativeTextLines({ kind: "ten-frame", frames: 1, filled: 7 })).toEqual(["● ● ● ● ●", "● ● ○ ○ ○"]);
    expect(manipulativeTextLines({ kind: "number-line", min: 0, max: 4, step: 1, marks: [{ value: 1 }], jumps: [{ from: 1, to: 3, label: "+2" }] }))
      .toEqual(["Number line 0 to 4 in steps of 1", "0 [1] 2 3 4", "hop 1 → 3 (+2)"]);
    expect(manipulativeTextLines({ kind: "fraction-bars", bars: [{ parts: 4, shaded: 1 }] })).toEqual(["■□□□  1/4"]);
  });
});
