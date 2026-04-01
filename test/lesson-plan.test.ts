import test from "node:test";
import assert from "node:assert/strict";

import { buildLessonPlan, lessonPlanToMarkdown } from "../src/core/lesson-plan.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import { Prng } from "../src/core/random.js";

test("lesson plans preserve phase order and non-empty bullets across randomized policies", () => {
  const prng = new Prng(42);
  const topics = ["derivative", "entropy", "bayes", "falsifiability", "stoicism", "complex systems"];

  for (let index = 0; index < 100; index += 1) {
    const policy = clampPolicy({
      ...DEFAULT_POLICY,
      name: `policy-${index}`,
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

    const plan = buildLessonPlan(prng.pick(topics), policy);
    assert.equal(plan.phases[0]?.title, "Orientation");
    assert.equal(plan.phases.at(-1)?.title, "Transfer and Reflection");
    assert.ok(plan.phases.some((phase) => phase.title === "Guided Practice"));
    for (const phase of plan.phases) {
      assert.ok(phase.bullets.length > 0);
      for (const bullet of phase.bullets) {
        assert.ok(bullet.length > 5);
      }
    }
    assert.ok(lessonPlanToMarkdown(plan).includes(`# Lesson Plan: ${plan.topic.title}`));
  }
});
