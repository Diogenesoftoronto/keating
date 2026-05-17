import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { lessonPlanToMermaid } from "../src/core/map.js";
import { clampPolicy } from "../src/core/policy.js";
import { arbPolicy, CANONICAL_TOPICS } from "./helpers.js";

// ─── Mermaid output structural properties ──────────────────────────────────

test("ALWAYS: mermaid output starts with graph TD for canonical topics", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const mermaid = lessonPlanToMermaid(topic, p);
      expect(mermaid.startsWith("graph TD")).toBe(true);
      expect(mermaid.includes('subgraph pedagogy["Teaching Loop"]')).toBe(true);
      expect(mermaid.includes('subgraph meaning["Meaning Map"]')).toBe(true);
      expect(mermaid.includes('subgraph friction["Misconceptions And Practice"]')).toBe(true);
      expect(mermaid.includes('subgraph transfer["Transfer Hooks"]')).toBe(true);
    }
  ));
});

test("ALWAYS: mermaid output is deterministic for same inputs", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const m1 = lessonPlanToMermaid(topic, p);
      const m2 = lessonPlanToMermaid(topic, p);
      expect(m1).toBe(m2);
    }
  ));
});

test("ALWAYS: mermaid output handles canonical topics without crashing", () => {
  for (const topic of CANONICAL_TOPICS) {
    const mermaid = lessonPlanToMermaid(topic, clampPolicy({ name: "test", analogyDensity: 0.5, socraticRatio: 0.5, formalism: 0.5, retrievalPractice: 0.5, exerciseCount: 3, diagramBias: 0.5, reflectionBias: 0.5, interdisciplinaryBias: 0.5, challengeRate: 0.5 }));
    expect(mermaid.startsWith("graph TD")).toBe(true);
  }
});

test("ALWAYS: mermaid output handles fallback topics (unknown slugs) without crashing", () => {
  const fallbackTopics = ["quantum-computing", "bioethics", "game-theory", "monetary-policy"];
  for (const topic of fallbackTopics) {
    const mermaid = lessonPlanToMermaid(topic, clampPolicy({ name: "test", analogyDensity: 0.5, socraticRatio: 0.5, formalism: 0.5, retrievalPractice: 0.5, exerciseCount: 3, diagramBias: 0.5, reflectionBias: 0.5, interdisciplinaryBias: 0.5, challengeRate: 0.5 }));
    expect(mermaid.startsWith("graph TD")).toBe(true);
  }
});
