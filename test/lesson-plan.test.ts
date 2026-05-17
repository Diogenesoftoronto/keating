import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { buildLessonPlan, lessonPlanToMarkdown } from "../src/core/lesson-plan.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import {
  arbPolicy,
  policyIsBounded,
  CANONICAL_TOPICS
} from "./helpers.js";

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

test("ALWAYS: high diagramBias policy includes a Diagram phase", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const highDiagramPolicy = { ...DEFAULT_POLICY, diagramBias: 0.9 };
      const plan = buildLessonPlan(topic, highDiagramPolicy);
      expect(plan.phases.some((phase) => phase.title === "Diagram")).toBe(true);
    }
  ));
});

test("ALWAYS: low diagramBias policy omits the Diagram phase", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const lowDiagramPolicy = { ...DEFAULT_POLICY, diagramBias: 0.3 };
      const plan = buildLessonPlan(topic, lowDiagramPolicy);
      expect(plan.phases.some((phase) => phase.title === "Diagram")).toBe(false);
    }
  ));
});

test("ALWAYS: high socraticRatio adds diagnostic question to Orientation", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const highSocratic = { ...DEFAULT_POLICY, socraticRatio: 0.8 };
      const plan = buildLessonPlan(topic, highSocratic);
      const orientBullets = plan.phases.find(p => p.id === "orient")?.bullets ?? [];
      expect(orientBullets.some(b => b.includes("diagnostic question"))).toBe(true);
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
