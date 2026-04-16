import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { runBenchmarkSuite } from "../src/core/benchmark.js";
import { buildLessonPlan, lessonPlanToMarkdown } from "../src/core/lesson-plan.js";
import { lessonPlanToMermaid } from "../src/core/map.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import {
  arbPolicy,
  policyIsBounded,
  benchmarkScoresAreBounded
} from "./helpers.js";

const CANONICAL_TOPICS = [
  "derivative", "entropy", "bayes-rule", "falsifiability", "stoicism",
  "recursion", "precedent", "separation-of-powers", "cognitive-bias",
  "evidence-based-medicine", "counterpoint", "industrial-revolution",
  "relativity", "social-contract"
];

// ─── Lesson plan properties (pure, no I/O) ─────────────────────────────────

test("ALWAYS: lesson plans preserve phase order and non-empty bullets", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);

      expect(plan.phases[0]?.title).toBe("Orientation");
      expect(plan.phases.at(-1)?.title).toBe("Transfer and Reflection");
      expect(plan.phases.some((phase) => phase.title === "Guided Practice")).toBe(true);
      expect(plan.phases.length).toBeGreaterThanOrEqual(6);

      for (const phase of plan.phases) {
        expect(phase.bullets.length).toBeGreaterThan(0);
        for (const bullet of phase.bullets) {
          expect(bullet.length).toBeGreaterThan(5);
        }
      }
    }
  ));
});

test("ALWAYS: lesson plan markdown includes topic title header", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      const md = lessonPlanToMarkdown(plan);
      expect(md.includes(`# Lesson Plan: ${plan.topic.title}`)).toBe(true);
    }
  ));
});

test("ALWAYS: lesson plan topic matches input topic", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      expect(plan.topic.slug).toBe(topic);
    }
  ));
});

test("ALWAYS: lesson plan policy is bounded", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      expect(policyIsBounded(plan.policy)).toBe(true);
    }
  ));
});

// ─── Mermaid diagram properties (pure, no I/O) ─────────────────────────────

test("ALWAYS: mermaid output starts with graph TD and contains required subgraphs", () => {
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

// ─── Fuzz: benchmark scores stay bounded for random policies ───────────────

test("ALWAYS: benchmark scores stay in [0, 100] for random policies", async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const topics = CANONICAL_TOPICS;

    await fc.assert(fc.asyncProperty(
      arbPolicy,
      fc.constantFrom(...topics),
      fc.integer({ min: 1, max: 9999 }),
      async (policy, topic, seed) => {
        const p = clampPolicy(policy);
        const benchmark = await runBenchmarkSuite(process.cwd(), p, topic, seed, 3);
        expect(benchmarkScoresAreBounded(benchmark)).toBe(true);

        for (const entry of benchmark.topicBenchmarks) {
          expect(entry.meanConfusion).toBeGreaterThanOrEqual(0);
          expect(entry.meanConfusion).toBeLessThanOrEqual(1);
        }
      }
    ), { numRuns: 5 });
  } finally {
    console.error = origError;
  }
}, 60000);
