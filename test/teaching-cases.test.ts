import { describe, expect, test } from "bun:test";
import { TEACHING_CASES, TEACHING_SUITE_VERSION } from "../shared/evolution/cases.js";
import type { EpisodeSplit } from "../shared/evolution/contracts.js";

const splits: EpisodeSplit[] = ["train", "validation", "holdout"];

describe("fixed teaching-behavior corpus", () => {
  test("keeps balanced domain coverage in all three independent partitions", () => {
    expect(TEACHING_SUITE_VERSION.length).toBeGreaterThan(0);
    expect(TEACHING_CASES).toHaveLength(18);
    for (const split of splits) {
      const partition = TEACHING_CASES.filter((entry) => entry.split === split);
      expect(partition).toHaveLength(6);
      expect(partition.filter((entry) => entry.domain === "mathematics")).toHaveLength(3);
      expect(partition.filter((entry) => entry.domain === "programming")).toHaveLength(3);
    }
  });

  test("never shares a problem family or duplicated conversation across partitions", () => {
    const familyPartitions = new Map<string, EpisodeSplit>();
    const conversations = new Set<string>();
    for (const entry of TEACHING_CASES) {
      expect(entry.family.trim().length).toBeGreaterThan(0);
      // Even two cases within a partition must represent different families in v1.
      expect(familyPartitions.has(entry.family)).toBe(false);
      familyPartitions.set(entry.family, entry.split);
      const conversation = entry.messages.map((message) =>
        `${message.role}:${message.content.trim().replace(/\s+/g, " ").toLowerCase()}`
      ).join("\n");
      expect(conversations.has(conversation)).toBe(false);
      conversations.add(conversation);
    }
    for (const left of splits) {
      for (const right of splits) {
        if (left === right) continue;
        const leftFamilies = new Set(TEACHING_CASES.filter((entry) => entry.split === left).map((entry) => entry.family));
        const rightFamilies = TEACHING_CASES.filter((entry) => entry.split === right).map((entry) => entry.family);
        expect(rightFamilies.some((family) => leftFamilies.has(family))).toBe(false);
      }
    }
  });

  test("provides valid conversation prefixes ending at the learner's tutoring decision", () => {
    expect(TEACHING_CASES.some((entry) => entry.messages.length > 1)).toBe(true);
    for (const entry of TEACHING_CASES) {
      expect(entry.messages.length).toBeGreaterThan(0);
      expect(entry.messages[0]!.role).toBe("user");
      expect(entry.messages.at(-1)!.role).toBe("user");
      for (const [index, message] of entry.messages.entries()) {
        expect(message.content.trim().length).toBeGreaterThan(0);
        expect(message.role).toBe(index % 2 === 0 ? "user" : "assistant");
      }
      // Inputs must contain a concrete problem, rather than only a topic label.
      expect(entry.messages.at(-1)!.content.length).toBeGreaterThan(80);
    }
  });

  test("uses unique stable identifiers and explicit critical gates in every rubric", () => {
    const caseIds = new Set<string>();
    const criterionIds = new Set<string>();
    for (const entry of TEACHING_CASES) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(caseIds.has(entry.id)).toBe(false);
      caseIds.add(entry.id);
      expect(entry.rubric.length).toBeGreaterThanOrEqual(3);
      expect(entry.rubric.length).toBeLessThanOrEqual(5);
      expect(entry.rubric.some((criterion) => criterion.critical)).toBe(true);
      expect(entry.rubric.some((criterion) => criterion.id.endsWith(":correctness") && criterion.critical)).toBe(true);
      const descriptions = new Set<string>();
      for (const criterion of entry.rubric) {
        expect(criterion.id.startsWith(`${entry.id}:`)).toBe(true);
        expect(criterionIds.has(criterion.id)).toBe(false);
        criterionIds.add(criterion.id);
        expect(typeof criterion.critical).toBe("boolean");
        expect(criterion.description.trim().length).toBeGreaterThan(20);
        expect(descriptions.has(criterion.description)).toBe(false);
        descriptions.add(criterion.description);
      }
    }
  });

  test("covers the initial misconception families and both interpreted languages", () => {
    const families = new Set(TEACHING_CASES.map((entry) => entry.family));
    for (const family of [
      "unit-fraction-part-size",
      "multiplicative-fraction-equivalence",
      "signed-number-order",
      "array-exclusive-upper-bound",
      "assignment-versus-equality",
      "shared-reference-mutation",
      "perimeter-versus-area-reasoning",
    ]) expect(families.has(family)).toBe(true);

    const programming = TEACHING_CASES.filter((entry) => entry.domain === "programming");
    expect(programming.some((entry) => entry.messages.some((message) => message.content.includes("JavaScript")))).toBe(true);
    expect(programming.some((entry) => entry.messages.some((message) => message.content.includes("Python")))).toBe(true);
  });

  test("treats learner-requested hints as answer boundaries and permits direct explanations", () => {
    const hintCases = TEACHING_CASES.filter((entry) =>
      entry.messages.at(-1)!.content.toLowerCase().includes("one hint") ||
      entry.messages.at(-1)!.content.toLowerCase().includes("one debugging hint")
    );
    expect(hintCases.length).toBeGreaterThanOrEqual(3);
    for (const entry of hintCases) {
      expect(entry.rubric.some((criterion) => criterion.id.endsWith(":answer-boundary") && criterion.critical)).toBe(true);
    }
    const directCases = TEACHING_CASES.filter((entry) =>
      entry.rubric.some((criterion) => criterion.id.endsWith(":explain-first"))
    );
    expect(directCases.some((entry) => entry.domain === "mathematics")).toBe(true);
    expect(directCases.some((entry) => entry.domain === "programming")).toBe(true);
    const reasoningCase = TEACHING_CASES.find((entry) => entry.family === "perimeter-versus-area-reasoning")!;
    expect(reasoningCase.messages.at(-1)!.content).toContain("answer matches");
    expect(reasoningCase.rubric.some((criterion) => criterion.id.endsWith(":reasoning"))).toBe(true);
    expect(reasoningCase.rubric.find((criterion) => criterion.critical)!.description).toContain("rejects");
  });
});
