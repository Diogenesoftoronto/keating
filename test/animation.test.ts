import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { animationSceneSource, buildAnimationManifest } from "../src/core/animation.js";
import { lessonPlanToMermaid } from "../src/core/map.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import { arbPolicy } from "./helpers.js";

const CANONICAL_TOPICS = [
  "derivative", "entropy", "bayes-rule", "falsifiability", "stoicism",
  "recursion", "precedent", "separation-of-powers", "cognitive-bias",
  "evidence-based-medicine", "counterpoint", "industrial-revolution",
  "relativity", "social-contract"
];

// ─── Mermaid diagram properties (pure, no I/O) ─────────────────────────────

test("ALWAYS: mermaid output contains required subgraphs for any policy+topic", () => {
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

// ─── Animation manifest properties ─────────────────────────────────────────

test("ALWAYS: animation manifest has sufficient rationale and 4 focus moments", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const manifest = buildAnimationManifest(topic, p);
      expect(manifest.rationale.length).toBeGreaterThanOrEqual(4);
      expect(manifest.focusMoments.length).toBe(4);
    }
  ));
});

test("ALWAYS: animation scene kind is never empty", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const manifest = buildAnimationManifest(topic, p);
      expect(manifest.sceneKind.length).toBeGreaterThan(0);
    }
  ));
});

// ─── Canonical topic → scene-kind mapping (deterministic) ───────────────────

test("ALWAYS: canonical topics select distinct animation grammars", () => {
  expect(buildAnimationManifest("derivative", DEFAULT_POLICY).sceneKind).toBe("function-graph");
  expect(buildAnimationManifest("entropy", DEFAULT_POLICY).sceneKind).toBe("distribution-bars");
  expect(buildAnimationManifest("bayes", DEFAULT_POLICY).sceneKind).toBe("belief-update");
  expect(buildAnimationManifest("stoicism", DEFAULT_POLICY).sceneKind).toBe("concept-card");
});

test("ALWAYS: animation manifest is deterministic for same inputs", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const m1 = buildAnimationManifest(topic, p);
      const m2 = buildAnimationManifest(topic, p);
      expect(m1).toEqual(m2);
    }
  ));
});

// ─── Scene source generation (involves I/O) ─────────────────────────────────

test("animation scene source contains expected boilerplate", async () => {
  const scene = await animationSceneSource(process.cwd(), "derivative", DEFAULT_POLICY, "./vendor/manim-web.js");
  expect(scene.includes('from "./vendor/manim-web.js"')).toBe(true);
  expect(scene.includes("export async function construct(scene)")).toBe(true);
});
