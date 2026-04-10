import test from "node:test";
import assert from "node:assert/strict";

import { runBenchmarkSuite } from "../src/core/benchmark.js";
import { buildLessonPlan } from "../src/core/lesson-plan.js";
import { lessonPlanToMermaid } from "../src/core/map.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import { Prng } from "../src/core/random.js";

test("fuzzed topics and policies stay bounded and renderable", () => {
  const prng = new Prng(2026);

  for (let index = 0; index < 200; index += 1) {
    const policy = clampPolicy({
      ...DEFAULT_POLICY,
      name: `fuzz-${index}`,
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
    const topic = `topic ${index} ${Math.floor(prng.next() * 1000)}`;
    const plan = buildLessonPlan(topic, policy);
    const mermaid = lessonPlanToMermaid(topic, policy);
    const benchmark = await runBenchmarkSuite(process.cwd(), policy, topic, index + 1);

    assert.ok(plan.phases.length >= 6);
    assert.ok(mermaid.startsWith("graph TD"));
    assert.ok(benchmark.overallScore >= 0);
    assert.ok(benchmark.overallScore <= 100);
    for (const entry of benchmark.topicBenchmarks) {
      assert.ok(entry.meanConfusion >= 0);
      assert.ok(entry.meanConfusion <= 1);
    }
  }
});
