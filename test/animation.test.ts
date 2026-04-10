import test from "node:test";
import assert from "node:assert/strict";

import { animationSceneSource, buildAnimationManifest } from "../src/core/animation.js";
import { lessonPlanToMermaid } from "../src/core/map.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import { Prng } from "../src/core/random.js";

test("visual generators preserve meaning-map and animation invariants across randomized topics", async () => {
  const prng = new Prng(4242);

  for (let index = 0; index < 2; index += 1) {
    const policy = clampPolicy({
      ...DEFAULT_POLICY,
      name: `visual-${index}`,
      analogyDensity: prng.next(),
      socraticRatio: prng.next(),
      formalism: prng.next(),
      retrievalPractice: prng.next(),
      exerciseCount: prng.int(1, 5),
      diagramBias: prng.next(),
      reflectionBias: prng.next(),
      interdisciplinaryBias: prng.next(),
      challengeRate: prng.next()
    });
    const topic = index % 4 === 0 ? "derivative" : `concept ${index} ${Math.floor(prng.next() * 1000)}`;
    const mermaid = lessonPlanToMermaid(topic, policy);
    const manifest = buildAnimationManifest(topic, policy);
    const scene = await animationSceneSource(process.cwd(), topic, policy, "./vendor/manim-web.js");

    assert.ok(mermaid.startsWith("graph TD"));
    assert.ok(mermaid.includes('subgraph pedagogy["Teaching Loop"]'));
    assert.ok(mermaid.includes('subgraph meaning["Meaning Map"]'));
    assert.ok(mermaid.includes('subgraph friction["Misconceptions And Practice"]'));
    assert.ok(mermaid.includes('subgraph transfer["Transfer Hooks"]'));
    assert.ok(scene.includes('from "./vendor/manim-web.js"'));
    assert.ok(scene.includes("export async function construct(scene)"));
    assert.ok(manifest.rationale.length >= 4);
    assert.equal(manifest.focusMoments.length, 4);
  }
});

test("canonical topics select distinct animation grammars", () => {
  assert.equal(buildAnimationManifest("derivative", DEFAULT_POLICY).sceneKind, "function-graph");
  assert.equal(buildAnimationManifest("entropy", DEFAULT_POLICY).sceneKind, "distribution-bars");
  assert.equal(buildAnimationManifest("bayes", DEFAULT_POLICY).sceneKind, "belief-update");
  assert.equal(buildAnimationManifest("stoicism", DEFAULT_POLICY).sceneKind, "concept-card");
});
