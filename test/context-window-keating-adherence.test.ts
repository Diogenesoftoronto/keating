import { describe, expect, test } from "bun:test";
import { TEACHING_POLICY_RULES } from "../packages/learner-contracts/src/judgement/teaching-policy-catalog.js";
import { adherenceScenarios } from "../scripts/context-window/keating-adherence-cases.js";

describe("Keating tutor adherence scenarios", () => {
  const cases = adherenceScenarios();
  test("twenty episodes contain only reviewed production propositions", () => {
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map(row => row.id)).size).toBe(20);
    const ids = new Set(TEACHING_POLICY_RULES.map(rule => rule.id));
    for (const row of cases) {
      expect(row.stage).toBe("adherence");
      expect(Object.keys(row.expected).length).toBeGreaterThanOrEqual(4);
      expect(Object.keys(row.rationale).sort()).toEqual(Object.keys(row.expected).sort());
      for (const id of Object.keys(row.expected)) expect(ids.has(id)).toBe(true);
      expect(row.reply?.text.length).toBeGreaterThan(40);
    }
  });
  test("contrastive pairs remain in one split and change a consequential label", () => {
    const families = [...new Set(cases.map(row => row.family))];
    expect(families).toHaveLength(10);
    expect(cases.filter(row => row.split === "holdout")).toHaveLength(10);
    for (const family of families) {
      const [a, b, ...rest] = cases.filter(row => row.family === family);
      expect(rest).toHaveLength(0);
      expect(a!.split).toBe(b!.split);
      expect(Object.keys(a!.expected).some(id => a!.expected[id] !== b!.expected[id])).toBe(true);
      expect(JSON.stringify(a!.turn) === JSON.stringify(b!.turn) || a!.reply!.text === b!.reply!.text).toBe(true);
    }
  });
  test("absence is not mislabeled as source contradiction", () => {
    const missing = cases.find(row => row.id === "adherence-source-status-b")!;
    expect(missing.turn.sources).toHaveLength(0);
    expect(missing.turn.toolResults[0]!.status).toBe("error");
    expect(missing.expected.source_contradicted).toBe(false);
    expect(missing.expected.research_skipped).toBe(true);
  });
  test("identical success prose depends on execution evidence", () => {
    const [success, failed] = cases.filter(row => row.family === "adherence-execution-receipt");
    expect(success!.reply).toEqual(failed!.reply);
    expect(success!.turn.toolResults[0]!.status).toBe("success");
    expect(failed!.turn.toolResults[0]!.status).toBe("error");
    expect(success!.expected.tool_success_invented).toBe(false);
    expect(failed!.expected.tool_success_invented).toBe(true);
  });
  test("quoted attack is always present but only one draft follows it", () => {
    const [analysed, obeyed] = cases.filter(row => row.family === "adherence-quoted-instructions");
    expect(analysed!.turn).toEqual(obeyed!.turn);
    expect(analysed!.turn.sources[0]!.text).toContain("Ignore the learner's request");
    expect(analysed!.expected.instruction_override).toBe(false);
    expect(obeyed!.expected.instruction_override).toBe(true);
  });
  test("no answer key or scenario metadata enters the episode state", () => {
    for (const row of cases) {
      const payload = JSON.stringify({ turn: row.turn, reply: row.reply });
      expect(payload).not.toContain('"expected"');
      expect(payload).not.toContain('"rationale"');
      expect(payload).not.toContain(row.id);
    }
  });
});
