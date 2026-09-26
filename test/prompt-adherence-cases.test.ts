import { describe, expect, test } from "bun:test";
import {
  TEACHING_POLICY_DECISIONS,
  TEACHING_POLICY_DETERMINISTIC_RULES,
  TEACHING_POLICY_RULES,
} from "../packages/learner-contracts/src/judgement/teaching-policy-catalog.js";
import { validateUiDocument } from "../packages/learner-contracts/src/ui.js";
import { JUDGE_FIXTURES, POLICY_CASES } from "../scripts/prompt-adherence/cases.js";

describe("authored teaching policy benchmark evidence", () => {
  test("uses unique cases and keeps whole families in one split across both datasets", () => {
    expect(new Set(POLICY_CASES.map((entry) => entry.id)).size).toBe(POLICY_CASES.length);
    expect(new Set(JUDGE_FIXTURES.map((entry) => entry.id)).size).toBe(JUDGE_FIXTURES.length);
    const splits = new Map<string, string>();
    for (const entry of [...POLICY_CASES, ...JUDGE_FIXTURES]) {
      const previous = splits.get(entry.family);
      expect(previous === undefined || previous === entry.split).toBe(true);
      splits.set(entry.family, entry.split);
    }
    for (const dataset of [POLICY_CASES, JUDGE_FIXTURES]) {
      expect(dataset.some((entry) => entry.split === "development")).toBe(true);
      expect(dataset.some((entry) => entry.split === "holdout")).toBe(true);
    }
  });

  test("every expected decision and narrow rule has a definition", () => {
    const decisions = new Set(TEACHING_POLICY_DECISIONS.map((entry) => entry.id));
    const semanticRules = new Set(TEACHING_POLICY_RULES.map((entry) => entry.id));
    const allRules = new Set([...semanticRules, ...TEACHING_POLICY_DETERMINISTIC_RULES]);
    for (const entry of POLICY_CASES) {
      expect(entry.turn.learnerMessage.trim().length).toBeGreaterThan(0);
      expect(entry.ruleIds.length).toBeGreaterThan(0);
      for (const id of entry.ruleIds) expect(allRules.has(id)).toBe(true);
      for (const [id, label] of Object.entries(entry.expectedDecisions)) {
        expect(decisions.has(id)).toBe(true);
        expect(typeof label).toBe("boolean");
      }
    }
    for (const entry of JUDGE_FIXTURES) {
      expect(Object.keys(entry).sort()).toEqual(["family", "id", "reply", "split", "turn", "violations"]);
      expect(Object.keys(entry.violations)).toHaveLength(1);
      for (const id of Object.keys(entry.violations)) expect(semanticRules.has(id)).toBe(true);
    }
  });

  test("all 54 semantic rules have one positive and one negative authored fixture", () => {
    expect(JUDGE_FIXTURES).toHaveLength(108);
    const labels = new Map<string, boolean[]>();
    for (const fixture of JUDGE_FIXTURES) {
      for (const [id, present] of Object.entries(fixture.violations)) {
        labels.set(id, [...(labels.get(id) ?? []), present]);
      }
    }
    expect([...labels.keys()].sort()).toEqual(TEACHING_POLICY_RULES.map((rule) => rule.id).sort());
    for (const observed of labels.values()) expect(observed).toEqual([false, true]);
  });

  test("each judge pair preserves the evidence and flips only its narrow authored label", () => {
    const pairs = new Map<string, typeof JUDGE_FIXTURES[number][]>();
    for (const fixture of JUDGE_FIXTURES) {
      const id = fixture.id.replace(/\/(?:compliant|violating)$/, "");
      const group = pairs.get(id) ?? [];
      group.push(fixture);
      pairs.set(id, group);
    }
    for (const fixtures of pairs.values()) {
      expect(fixtures).toHaveLength(2);
      const compliant = fixtures.find((entry) => entry.id.endsWith("/compliant"));
      const violating = fixtures.find((entry) => entry.id.endsWith("/violating"));
      expect(compliant).toBeDefined();
      expect(violating).toBeDefined();
      if (!compliant || !violating) continue;
      expect(compliant.turn).toEqual(violating.turn);
      expect(compliant.family).toBe(violating.family);
      expect(compliant.split).toBe(violating.split);
      expect(Object.keys(compliant.violations)).toEqual(Object.keys(violating.violations));
      expect(Object.values(compliant.violations)).toEqual([false]);
      expect(Object.values(violating.violations)).toEqual([true]);
      expect(compliant.reply).not.toEqual(violating.reply);
    }
  });

  test("checkpoint fixtures contain valid shared OpenUI and test behavior beyond syntax", () => {
    const checkpoints = JUDGE_FIXTURES.filter((entry) => entry.family === "protocol-unanswered-checkpoint");
    expect(checkpoints.length).toBeGreaterThan(0);
    for (const fixture of checkpoints) {
      const fences = [...fixture.reply.text.matchAll(/```keating-ui\s*\n([\s\S]*?)```/g)];
      expect(fences).toHaveLength(1);
      const document = JSON.parse(fences[0]![1]!);
      expect(validateUiDocument(document)).toBe(true);
      expect(document.nodes.some((node: { type: string }) => node.type === "question")).toBe(true);
    }
  });

  test("every activity and artifact fixture uses valid canonical OpenUI", () => {
    let documents = 0;
    for (const fixture of JUDGE_FIXTURES) {
      for (const match of fixture.reply.text.matchAll(/```keating-ui\s*\n([\s\S]*?)```/g)) {
        expect(validateUiDocument(JSON.parse(match[1]!))).toBe(true);
        documents++;
      }
    }
    expect(documents).toBeGreaterThan(6);
  });

  test("CLI-only domain obligations are visibly separated from the web protocol families", () => {
    const domainRules = new Set(TEACHING_POLICY_RULES.filter((entry) => entry.domain).map((entry) => entry.id));
    for (const entry of POLICY_CASES) {
      if (entry.ruleIds.some((id) => domainRules.has(id))) {
        expect(entry.family.startsWith("cli-domain-")).toBe(true);
        expect(entry.turn.domain).not.toBe("general");
      }
    }
  });
});
