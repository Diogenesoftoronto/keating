import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { buildLessonPlan, lessonPlanToMarkdown } from "../src/core/lesson-plan.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import {
  arbPolicy,
  policyIsBounded
} from "./helpers.js";

const CANONICAL_TOPICS = [
  "derivative", "entropy", "bayes-rule", "falsifiability", "stoicism",
  "recursion", "precedent", "separation-of-powers", "cognitive-bias",
  "evidence-based-medicine", "counterpoint", "industrial-revolution",
  "relativity", "social-contract"
];

// ─── Phase order invariants (Antithesis: always properties) ─────────────────

test("ALWAYS: first phase is Orientation, last is Transfer and Reflection", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      expect(plan.phases[0]?.title).toBe("Orientation");
      expect(plan.phases.at(-1)?.title).toBe("Transfer and Reflection");
    }
  ));
});

test("ALWAYS: Guided Practice phase exists in every plan", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      expect(plan.phases.some((phase) => phase.title === "Guided Practice")).toBe(true);
    }
  ));
});

test("ALWAYS: every phase has non-empty bullets with meaningful content", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      for (const phase of plan.phases) {
        expect(phase.bullets.length).toBeGreaterThan(0);
        for (const bullet of phase.bullets) {
          expect(bullet.length).toBeGreaterThan(5);
        }
      }
    }
  ));
});

test("ALWAYS: plan has at least 6 phases", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      expect(plan.phases.length).toBeGreaterThanOrEqual(6);
    }
  ));
});

test("ALWAYS: topic slug matches input topic", () => {
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

test("ALWAYS: policy in plan is bounded", () => {
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

// ─── Markdown output properties ────────────────────────────────────────────

test("ALWAYS: markdown output includes topic title header", () => {
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

test("ALWAYS: markdown output is non-empty and contains phase content", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      const md = lessonPlanToMarkdown(plan);
      expect(md.length).toBeGreaterThan(100);
      for (const phase of plan.phases) {
        expect(md.includes(phase.title)).toBe(true);
      }
    }
  ));
});

// ─── Sometimes properties (Antithesis: sometimes true) ──────────────────────

test("SOMETIMES: plans include Socratic dialogue elements", () => {
  let foundSocratic = false;
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const plan = buildLessonPlan(topic, p);
      const md = lessonPlanToMarkdown(plan);
      if (md.includes("?") || md.toLowerCase().includes("ask") || md.toLowerCase().includes("question")) {
        foundSocratic = true;
      }
    }
  ), { numRuns: 30 });
  expect(foundSocratic).toBe(true);
});
