import { expect, test } from "bun:test";
import { summarizeOpenUiDiagnostics, type OpenUiDiagnosticTurn } from "../src/openui-diagnostics.js";

function observation(arm: "baseline" | "guided", model: string | null, components: string[], name = arm + "-" + model): OpenUiDiagnosticTurn {
  return {
    schemaVersion: 1, turnId: "turn-1", conversationId: name, turnIndex: 0, mode: arm,
    model: "tutor", decisionModel: model, cue: {kind:"implicit-action", targets:["question"]},
    experiment: {experimentId:"matched", caseId:"prediction", pairId:"repeat-1"},
    guidance: arm === "guided" ? {source:model === "jev-1.14.0" ? "jev" : "other", action:"create", delivered:true, targets:["question"]} : null,
    reply:"unknown", attempted:components.length > 0, compiled:components, selected:null, rendered:null,
  };
}

const baseline = observation("baseline", null, []);
const jev = observation("guided", "jev-1.14.0", ["question"]);
const gemini = observation("guided", "gemini-decision-1", []);

test("two explicitly named decision models each get the same matched unguided control", () => {
  const {comparisons, overall} = summarizeOpenUiDiagnostics([baseline, jev, gemini]);
  expect(overall.turns).toBe(3);
  expect(comparisons.map(c => [c.decisionModel, c.matchedPairs, c.compiled.guidedOnly, c.compiled.neither])).toEqual([
    ["gemini-decision-1", 1, 0, 1], ["jev-1.14.0", 1, 1, 0],
  ]);
  expect(comparisons.every(c => c.selected.pairs === 0 && c.rendered.pairs === 0)).toBe(true);
});

test("filtering a decision model keeps its control for pairing and excludes it from ordinary counts", () => {
  const {comparisons, overall} = summarizeOpenUiDiagnostics([baseline, jev, gemini], {decisionModel:"gemini-decision-1"});
  expect(overall.turns).toBe(1);
  expect(comparisons).toMatchObject([{decisionModel:"gemini-decision-1",matchedPairs:1,compiled:{neither:1}}]);
});

test("duplicates affect just that judge, and any confirmed guidance makes a baseline ineligible", () => {
  const same = observation("guided","gemini-decision-1",[],"duplicate-google");
  const results = summarizeOpenUiDiagnostics([baseline, jev, gemini, same]).comparisons;
  expect(results.map(c => [c.decisionModel, c.ambiguous, c.matchedPairs])).toEqual([
    ["gemini-decision-1",1,0],["jev-1.14.0",0,1],
  ]);
  expect(summarizeOpenUiDiagnostics([{...baseline,guidance:gemini.guidance}, jev]).comparisons[0])
    .toMatchObject({matchedPairs:0, ineligibleGuidance:1});
});
