import { test, expect } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { learnerStatePath } from "../src/core/paths.js";
import { ensureProjectScaffold, timelineArtifact, dueTopicsArtifact } from "../src/core/project.js";
import { loadLearnerState, recordFeedback, saveLearnerState } from "../src/core/learner-state.js";
import type { LearnerState } from "../src/core/types.js";

function learnerStateWithTopics(): LearnerState {
  const now = Date.now();
  return {
    id: "learner-1",
    coveredTopics: [
      {
        slug: "derivative",
        domain: "math",
        lastSeen: new Date(now - 35 * 86_400_000).toISOString(),
        masteryEstimate: 0.4,
        sessionCount: 2
      },
      {
        slug: "recursion",
        domain: "code",
        lastSeen: new Date(now).toISOString(),
        masteryEstimate: 0.8,
        sessionCount: 1
      }
    ],
    identifiedMisconceptions: [],
    feedback: [],
    sessions: [],
    profile: {
      id: "default",
      priorKnowledge: 0.5,
      abstractionComfort: 0.5,
      analogyNeed: 0.5,
      dialoguePreference: 0.5,
      diagramAffinity: 0.5,
      persistence: 0.5,
      transferDesire: 0.5,
      anxiety: 0.3
    }
  };
}

test("timeline and due artifacts summarize persisted learner coverage", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-timeline-tools-"));
  await ensureProjectScaffold(workdir);
  await writeFile(learnerStatePath(workdir), `${JSON.stringify(learnerStateWithTopics(), null, 2)}\n`);

  const timeline = await timelineArtifact(workdir);
  const due = await dueTopicsArtifact(workdir);

  expect(timeline.markdown).toContain("# Engagement Timeline");
  expect(timeline.markdown).toContain("Derivative");
  expect(timeline.markdown).toContain("Recursion");
  expect(due.count).toBeGreaterThanOrEqual(1);
  expect(due.markdown).toContain("Derivative");
  expect(await readFile(timeline.reportPath, "utf8")).toBe(timeline.markdown);
  expect(await readFile(due.reportPath, "utf8")).toBe(due.markdown);
});

test("feedback can initialize learner state in a fresh scaffolded project", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "keating-feedback-tool-"));
  await ensureProjectScaffold(workdir);
  const statePath = learnerStatePath(workdir);
  const state = await loadLearnerState(statePath);

  recordFeedback(state, "derivative", "confused", "lost at chain rule");
  await saveLearnerState(statePath, state);

  const saved = await loadLearnerState(statePath);
  expect(saved.feedback).toHaveLength(1);
  expect(saved.feedback[0]).toMatchObject({
    topic: "derivative",
    signal: "confused",
    comment: "lost at chain rule"
  });

  const timeline = await timelineArtifact(workdir);
  expect(timeline.markdown).toContain("Derivative");
  expect(timeline.markdown).toContain("Topics tracked:** 1");
});
