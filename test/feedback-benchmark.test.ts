import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runBenchmarkSuite } from "../src/core/benchmark.js";
import { DEFAULT_POLICY } from "../src/core/policy.js";
import { evolvePolicyArtifact, ensureProjectScaffold } from "../src/core/project.js";
import { learnerStatePath } from "../src/core/paths.js";
import { loadLearnerState, recordFeedback, saveLearnerState } from "../src/core/learner-state.js";

test("learner-state benchmark uses sparse feedback without synthetic learners", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-feedback-bench-"));
  const state = await loadLearnerState(learnerStatePath(workdir));
  recordFeedback(state, "derivative", "confused", "lost at the chain rule");

  const result = await runBenchmarkSuite(workdir, DEFAULT_POLICY, "derivative", 20260401, 3, undefined, state);

  expect(result.trace.dataSource).toBe("learner-feedback-sparse");
  expect(result.trace.realOutcomeCount).toBe(1);
  expect(result.trace.learnerCountPerTopic).toBe(1);
  expect(result.trace.topicTraces[0]!.topLearners[0]!.learnerId).toBe("real-learner");
  expect(result.trace.topicTraces[0]!.topLearners.some((entry) => entry.learnerId.startsWith("learner-"))).toBe(false);
});

test("benchmark includes inferred learner-turn signals from session files", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-turn-bench-"));
  await mkdir(join(workdir, ".keating", "sessions"), { recursive: true });
  const state = await loadLearnerState(learnerStatePath(workdir));
  recordFeedback(state, "derivative", "thumbs-up");
  await writeFile(
    join(workdir, ".keating", "sessions", "session.json"),
    JSON.stringify({
      messages: [
        { role: "user", content: "I am confused about why the derivative is a limit." },
        { role: "assistant", content: "Let's rebuild it from secants." }
      ]
    })
  );

  const result = await runBenchmarkSuite(workdir, DEFAULT_POLICY, "derivative", 20260401, 3, undefined, state);

  expect(result.trace.realOutcomeCount).toBe(2);
  expect(result.trace.dataSource).toBe("learner-feedback-sparse");
});

test("policy evolution refuses to run before learner feedback is sufficient", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-evolve-not-ready-"));
  await ensureProjectScaffold(workdir);

  await expect(evolvePolicyArtifact(workdir, "derivative")).rejects.toThrow("Not ready to evolve");
});
