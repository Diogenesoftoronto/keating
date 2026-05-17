import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { runBenchmarkSuite } from "../src/core/benchmark.js";
import { DEFAULT_POLICY, clampPolicy } from "../src/core/policy.js";
import {
  arbPolicy,
  benchmarkScoresAreBounded,
  CANONICAL_TOPICS,
  suppressConsoleError
} from "./helpers.js";

// ─── Fuzz: benchmark scores stay bounded for random policies ───────────────

test("ALWAYS: benchmark scores stay in [0, 100] for random policies", async () => {
  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) return;
  await suppressConsoleError(async () => {
    await fc.assert(fc.asyncProperty(
      arbPolicy,
      fc.constantFrom(...CANONICAL_TOPICS),
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
  });
}, 60000);
