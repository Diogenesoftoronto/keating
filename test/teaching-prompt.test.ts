import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeTeachingPrompt, teachingBasePrompt } from "../src/core/teaching-evolution.js";
import { FileEvolutionStore } from "../src/core/teaching-evolution-store.js";
import { createTeachingRevision } from "../shared/evolution/benchmark.js";
import { revisionKey, runTeachingEvolution } from "../shared/evolution/loop.js";
import { TEACHING_CASES } from "../shared/evolution/cases.js";

test("baseline teaching revisions can be pinned and resumed without inventing an experiment", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-teaching-pin-"));
  try {
    const baseline = await activeTeachingPrompt(cwd);
    expect(baseline.prompt).toBe(await teachingBasePrompt());
    const resumed = await activeTeachingPrompt(cwd, { revisionId: baseline.revisionId });
    expect(resumed).toEqual(baseline);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("a saved skill candidate cannot be loaded through a forged session pin", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-teaching-pin-"));
  try {
    const revision = await createTeachingRevision(await teachingBasePrompt(), [{
      id: "unvalidated", title: "Unvalidated", instructions: "An untested procedure.", hypothesis: "Unmeasured.", evidenceIds: ["fixture"],
    }]);
    await new FileEvolutionStore(cwd).put(revisionKey(revision.id), revision);
    await expect(activeTeachingPrompt(cwd, { revisionId: revision.id })).rejects.toThrow("evidence_missing");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("a changed host prompt uses its own baseline while historical sessions keep their evaluated revision", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-teaching-base-"));
  try {
    const report = await runTeachingEvolution({
      store: new FileEvolutionStore(cwd), cases: TEACHING_CASES, basePrompt: "Previous teaching base",
      runner: async ({ systemPrompt }) => ({ messages: [{ role: "assistant", content: systemPrompt.includes("new-procedure") ? "improved" : "baseline" }], toolCalls: [], model: "fixture", runtime: "test-only" }),
      judge: async ({ testCase, execution }) => testCase.rubric.map((criterion, index) => ({ criterionId: criterion.id,
        passed: execution.messages[0].content === "improved" || index < testCase.rubric.length - 1, rationale: "Fixture." })),
      proposer: async ({ training }) => ({ skill: { id: "check-understanding", title: "Check", instructions: "new-procedure",
        hypothesis: "Check understanding.", evidenceIds: [training.results[0].id] },
        hypothesis: { id: "ignored", statement: "Check understanding.", evidenceIds: [], status: "proposed" } }),
    });
    expect(report.status).toBe("accepted");
    expect((await activeTeachingPrompt(cwd)).prompt).toBe(await teachingBasePrompt());
    const pinned = await activeTeachingPrompt(cwd, { revisionId: report.candidateRevisionId!, experimentId: report.id });
    expect(pinned.basePrompt).toBe("Previous teaching base");
    expect(pinned.prompt).toContain("new-procedure");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
