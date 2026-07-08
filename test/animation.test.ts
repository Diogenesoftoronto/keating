import { test, expect } from "bun:test";
import * as fc from "fast-check";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { animationSceneSource, buildAnimationManifest, writeLessonAnimation } from "../src/core/animation.js";
import { lessonPlanToMermaid } from "../src/core/map.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import { arbPolicy, CANONICAL_TOPICS, suppressConsoleError } from "./helpers.js";

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

test("ALWAYS: animation manifest slug is non-empty and valid", () => {
  fc.assert(fc.property(
    arbPolicy,
    fc.constantFrom(...CANONICAL_TOPICS),
    (policy, topic) => {
      const p = clampPolicy(policy);
      const manifest = buildAnimationManifest(topic, p);
      expect(manifest.slug.length).toBeGreaterThan(0);
      expect(manifest.domain.length).toBeGreaterThan(0);
    }
  ));
});

// ─── Canonical topic → scene-kind mapping (deterministic) ───────────────────

test("ALWAYS: canonical topics select distinct animation grammars", () => {
  expect(buildAnimationManifest("derivative", DEFAULT_POLICY).sceneKind).toBe("function-graph");
  expect(buildAnimationManifest("entropy", DEFAULT_POLICY).sceneKind).toBe("distribution-bars");
  expect(buildAnimationManifest("bayes-rule", DEFAULT_POLICY).sceneKind).toBe("belief-update");
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
  await suppressConsoleError(async () => {
    const scene = await animationSceneSource(process.cwd(), "derivative", DEFAULT_POLICY);
    expect(scene.includes("<!doctype html>")).toBe(true);
    expect(scene.includes("gsap")).toBe(true);
    expect(scene.includes("#0c1510")).toBe(true);
  });
});

test("animation player generation hooks in the shared artifact theme before local CSS", async () => {
  await suppressConsoleError(async () => {
    const workdir = await mkdtemp(join(tmpdir(), "keating-animation-theme-"));
    const artifact = await writeLessonAnimation(workdir, "derivative", DEFAULT_POLICY);
    const html = await readFile(artifact.playerPath, "utf8");
    const themeCss = await readFile(join(artifact.topicDir, "keating-artifact-theme.css"), "utf8");

    expect(html.includes('rel="stylesheet" href="./keating-artifact-theme.css"')).toBe(true);
    expect(html.indexOf("keating-artifact-theme.css")).toBeLessThan(html.indexOf("<style>"));
    expect(html.includes('class="keating-artifact keating-artifact-shell"')).toBe(true);
    expect(html.includes('data-action="toggle"')).toBe(true);
    expect(html.includes('data-action="replay"')).toBe(true);
    expect(html.includes('data-action="loop" aria-pressed="true"')).toBe(true);
    expect(artifact.scenePath.endsWith("scene.html")).toBe(true);
    expect(html.includes('data-keating-artifact-theme=')).toBe(true);
    expect(themeCss.includes(".keating-artifact-shell")).toBe(true);
    expect(themeCss.includes("--colors-accent: #1e9b50")).toBe(true);
  });
});
