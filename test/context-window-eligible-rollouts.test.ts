import { expect, test } from "bun:test";
import { eligibleRolloutCases } from "../scripts/context-window/eligible-rollouts.js";
import type { BenchmarkCase } from "../scripts/context-window/cases.js";
function fixture(gate: string): BenchmarkCase {
  const turn = { learnerMessage: "Continue this example", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none" as const, improvementRuns: null, domain: "general" as const };
  return { id: `saved-rollout-group-${gate}`, family: "saved-family", split: "holdout", kind: "rollout", labelSource: "deterministic-gate", turn, evidence: "recorded evidence", sourceSha256: "a".repeat(64), expected: { candidate_a: false, candidate_b: false }, request: { state: { turn }, questions: { candidate_a: { type: "noul", instructions: "Does candidate A violate the gate?", criteria: { true: "violation", false: "no violation" } }, candidate_b: { type: "noul", instructions: "Does candidate B violate the gate?" } } } };
}
test("keeps schema diagnostic and supplies proven parser facts without changing gold or frozen inputs", () => {
  const grammar = fixture("openui_valid"), stop = fixture("stop_after_checkpoint"), tool = fixture("available_tool");
  stop.expected.candidate_b = true;
  const input = [grammar, stop, tool], frozen = JSON.stringify(input);
  const result = eligibleRolloutCases(input);
  expect(result.protocol).toBe("keating-saved-gates/v2");
  expect(result.diagnostics).toEqual([{ case: grammar, reason: "full-schema-not-supplied" }]);
  expect(result.cases).toHaveLength(2);
  const updated = result.cases[0]!;
  expect(updated.id).toBe(`${stop.id}/parsed-valid-v2`);
  expect(updated.expected).toEqual(stop.expected);
  expect(updated.sourceSha256).toBe(stop.sourceSha256);
  expect(updated.request.state).toEqual(stop.request.state);
  for (const [id, question] of Object.entries(updated.request.questions)) {
    expect(question.instructions).toContain("All marked UI blocks in every candidate in this case passed");
    expect(question.instructions).toEndWith(stop.request.questions[id]!.instructions);
    expect(question.criteria).toEqual(stop.request.questions[id]!.criteria);
  }
  expect(result.cases[1]).toBe(tool);
  expect(JSON.stringify(input)).toBe(frozen);
});
test("requires independent parser passes for every candidate before supplying the fact", () => {
  const proof = fixture("openui_valid"), activity = fixture("one_activity");
  proof.expected.candidate_b = true;
  const invalid = eligibleRolloutCases([proof, activity]);
  expect(invalid.cases).toHaveLength(0);
  expect(invalid.diagnostics[1]!.reason).toBe("parse-validity-not-established");
  expect(eligibleRolloutCases([activity]).diagnostics[0]!.reason).toBe("parse-validity-not-established");
});
test("supports every requested parse gate and leaves authored cases unchanged", () => {
  const proof = fixture("openui_valid");
  for (const gate of ["one_activity", "activity_without_plan", "one_checkpoint", "checkpoint_last_node", "stop_after_checkpoint"]) expect(eligibleRolloutCases([proof, fixture(gate)]).cases[0]!.id).toEndWith("/parsed-valid-v2");
  const authored = { ...fixture("openui_valid"), labelSource: "authored-proxy" as const };
  expect(eligibleRolloutCases([authored]).cases[0]).toBe(authored);
});
