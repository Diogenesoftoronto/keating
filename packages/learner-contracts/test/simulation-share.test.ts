import { describe, expect, test } from "bun:test";
import {
  canonicalUiAction,
  validateUiAction,
  validateUiActionAgainstDocument,
  type UiAction,
  type UiDocument,
  type UiSimulationNode,
} from "../src/index.js";

const at = "2026-11-10T12:00:00.000Z";
const node: UiSimulationNode = {
  type: "simulation",
  id: "ohm",
  title: "Ohm's law",
  parameters: [
    { id: "voltage", label: "Voltage", unit: "V", min: 0, max: 24, step: 0.5, value: 12 },
    { id: "resistance", label: "Resistance", unit: "ohm", min: 1, max: 100, step: 1, value: 10 },
  ],
  readouts: [
    { id: "current", label: "Current", unit: "A", expr: "voltage / resistance", emphasis: true },
    { id: "inverse", label: "Inverse voltage", expr: "1 / voltage" },
  ],
};
const document: UiDocument = { schemaVersion: 1, id: "ohm-doc", revision: 3, lifecycle: "ready", supportedSurfaces: ["web"], createdAt: at, updatedAt: at, nodes: [node] };
type Share = Extract<UiAction, { type: "share-simulation" }>;
const share: Share = {
  schemaVersion: 1,
  type: "share-simulation",
  documentId: "ohm-doc",
  documentRevision: 3,
  nodeId: "ohm",
  idempotencyKey: "share-1",
  parameters: [{ parameterId: "voltage", value: 0 }, { parameterId: "resistance", value: 10 }],
  readouts: [{ readoutId: "current", value: 0 }, { readoutId: "inverse", value: null }],
  changedParameterIds: ["voltage"],
  selectedParameterId: "voltage",
  selectedReadoutId: "current",
};

describe("share-simulation action contract", () => {
  test("accepts a share whose numbers match the authored model", () => {
    expect(validateUiAction(share)).toBe(true);
    expect(validateUiActionAgainstDocument(share, document)).toBe(true);
    const { selectedParameterId: _p, selectedReadoutId: _r, ...minimal } = share;
    expect(validateUiActionAgainstDocument(minimal, document)).toBe(true);
    expect(canonicalUiAction(share)).toContain("share-simulation");
  });

  test("accepts an unchanged share at the defaults", () => {
    const defaults: Share = { ...share, parameters: [{ parameterId: "voltage", value: 12 }, { parameterId: "resistance", value: 10 }], readouts: [{ readoutId: "current", value: 1.2 }, { readoutId: "inverse", value: 1 / 12 }], changedParameterIds: [] };
    expect(validateUiActionAgainstDocument(defaults, document)).toBe(true);
  });

  const malformed: Array<[string, unknown]> = [
    ["no parameters", { ...share, parameters: [] }],
    ["a non-finite value", { ...share, parameters: [{ parameterId: "voltage", value: Number.NaN }, share.parameters[1]] }],
    ["a string value", { ...share, parameters: [{ parameterId: "voltage", value: "0" }, share.parameters[1]] }],
    ["duplicate parameters", { ...share, parameters: [share.parameters[0], share.parameters[0]] }],
    ["an extra parameter key", { ...share, parameters: [{ ...share.parameters[0], unit: "V" }, share.parameters[1]] }],
    ["an extra action key", { ...share, note: "hi" }],
    ["a missing readouts list", { ...share, readouts: undefined }],
    ["a non-numeric readout", { ...share, readouts: [{ readoutId: "current", value: "0" }, share.readouts[1]] }],
    ["duplicate readouts", { ...share, readouts: [share.readouts[0], share.readouts[0]] }],
    ["a changed id that was not shared", { ...share, changedParameterIds: ["power"] }],
    ["duplicate changed ids", { ...share, changedParameterIds: ["voltage", "voltage"] }],
    ["an unknown selected parameter", { ...share, selectedParameterId: "power" }],
    ["an unknown selected readout", { ...share, selectedReadoutId: "power" }],
    ["no node id", { ...share, nodeId: undefined }],
    ["too many parameters", { ...share, parameters: Array.from({ length: 9 }, (_, index) => ({ parameterId: `p${index}`, value: 1 })), changedParameterIds: [] }],
  ];
  for (const [label, action] of malformed) {
    test(`rejects ${label}`, () => {
      expect(validateUiAction(action)).toBe(false);
      expect(validateUiActionAgainstDocument(action, document)).toBe(false);
    });
  }

  const inapplicable: Array<[string, Share, UiDocument?]> = [
    ["a value outside the authored range", { ...share, parameters: [{ parameterId: "voltage", value: 30 }, share.parameters[1]!], changedParameterIds: ["voltage"] }],
    ["parameters out of authored order", { ...share, parameters: [share.parameters[1]!, share.parameters[0]!] }],
    ["a missing parameter", { ...share, parameters: [share.parameters[0]!], changedParameterIds: ["voltage"] }],
    ["a readout that the expression does not produce", { ...share, readouts: [{ readoutId: "current", value: 5 }, share.readouts[1]!] }],
    ["a finite value where the expression is undefined", { ...share, readouts: [share.readouts[0]!, { readoutId: "inverse", value: 0 }] }],
    ["a changed list that hides a change", { ...share, changedParameterIds: [] }],
    ["a changed list that claims an unchanged parameter", { ...share, changedParameterIds: ["voltage", "resistance"] }],
    ["a stale revision", { ...share, documentRevision: 2 }],
    ["a non-simulation target", share, { ...document, nodes: [{ type: "markdown", id: "ohm", markdown: "Not a simulation" }] }],
    ["a document that is not ready", share, { ...document, lifecycle: "completed" }],
  ];
  for (const [label, action, target] of inapplicable) {
    test(`does not apply ${label}`, () => {
      expect(validateUiActionAgainstDocument(action, target ?? document)).toBe(false);
    });
  }
});
