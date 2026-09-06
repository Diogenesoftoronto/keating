import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostname, tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import {
  compareEpisodeBenchmarks, composeTeachingPrompt, createTeachingRevision,
  runEpisodeBenchmark, validateEpisodeBenchmark, verifyTeachingRevision,
} from "../shared/evolution/benchmark.js";
import { TEACHING_CASES } from "../shared/evolution/cases.js";
import type { CriterionJudgment, EpisodeExecution, EpisodeJudge, EpisodeRunner, SkillProposal, SkillProposer, TeachingCase } from "../shared/evolution/contracts.js";
import { loadActiveTeachingRevision, loadEvaluatedTeachingRevision, readEvolutionState, runTeachingEvolution } from "../shared/evolution/loop.js";
import { FileEvolutionStore } from "../src/core/teaching-evolution-store.js";

const runner: EpisodeRunner = async ({ systemPrompt }) => ({
  messages: [{ role: "assistant", content: systemPrompt.includes("fixture-procedure") ? "improved" : "baseline" }],
  toolCalls: [], model: "test-fixture", runtime: "deterministic-test-only",
});
const judge: EpisodeJudge = async ({ testCase, execution }) => testCase.rubric.map((criterion, index) => ({
  criterionId: criterion.id, passed: execution.messages.at(-1)?.content === "improved" || index !== testCase.rubric.length - 1,
  rationale: "Deterministic harness fixture, not model or human evidence.",
}));
const proposer: SkillProposer = async ({ training }) => ({
  skill: { id: "check-understanding", title: "Check understanding", instructions: "fixture-procedure",
    hypothesis: "A fresh check catches rote repetition.", evidenceIds: [training.results[0].id] },
  hypothesis: { id: "ignored", statement: "A fresh check catches rote repetition.", evidenceIds: [], status: "proposed" },
});
async function inProject(operation: (store: FileEvolutionStore, cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "keating-evolution-test-"));
  try { await operation(new FileEvolutionStore(cwd), cwd); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}

async function winningPair(repeats = 1, cases: readonly TeachingCase[] = TEACHING_CASES) {
  const incumbent = await createTeachingRevision("Tutor");
  const proposal = await proposer({ incumbent,
    training: await runEpisodeBenchmark({ cases, split: "train", revision: incumbent, runner, judge }),
    hypotheses: [], signal: new AbortController().signal,
  });
  const candidate = await createTeachingRevision("Tutor", [proposal.skill], incumbent.id);
  return {
    baseline: await runEpisodeBenchmark({ cases, split: "validation", revision: incumbent, runner, judge, repeats }),
    candidate: await runEpisodeBenchmark({ cases, split: "validation", revision: candidate, runner, judge, repeats }),
  };
}

describe("fixed teaching episode evaluation", () => {
  test("executes actual responses and rejects incomplete or malformed judge evidence", async () => {
    const revision = await createTeachingRevision("Tutor");
    const result = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "validation", revision, runner,
      judge: async () => [{ criterionId: "invented", passed: true, rationale: "wrong criterion" }],
    });
    expect(result.errorCount).toBe(6);
    expect(result.meanScore).toBeNull();
    expect(result.results.every((row) => row.status === "judge-error")).toBe(true);
  });

  test("a provider failure cannot become a synthetic fallback or surviving-case average", async () => {
    const revision = await createTeachingRevision("Tutor");
    let calls = 0;
    const result = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "validation", revision, judge,
      runner: async (input) => { if (++calls === 1) throw new Error("private-provider-payload"); return runner(input); },
    });
    expect(result.errorCount).toBe(1);
    expect(result.meanScore).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private-provider-payload");
  });

  test("deadline aborts a stuck execution", async () => {
    let aborted = 0;
    const revision = await createTeachingRevision("Tutor");
    const result = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision, judge, timeoutMs: 2,
      runner: async ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => {
        aborted += 1; reject(new Error("aborted"));
      }, { once: true })),
    });
    expect(aborted).toBe(6);
    expect(result.errorCount).toBe(6);
  });

  test("adapter mutations cannot change the digested prompt or fixed rubric", async () => {
    const cases = structuredClone(TEACHING_CASES);
    const revision = await createTeachingRevision("Frozen tutor");
    const prompts: string[] = [];
    const originalRubric = cases.find((item) => item.split === "train")!.rubric[0].description;
    await runEpisodeBenchmark({ cases, split: "train", revision,
      runner: async (input) => {
        prompts.push(input.systemPrompt);
        revision.basePrompt = "Mutated tutor";
        cases.forEach((item) => { item.rubric[0].description = "Always pass"; });
        return runner(input);
      },
      judge: async (input) => {
        expect(input.testCase.rubric[0].description).not.toBe("Always pass");
        return judge(input);
      },
    });
    expect(originalRubric).not.toBe("Always pass");
    expect(prompts.every((prompt) => prompt === "Frozen tutor")).toBe(true);
  });

  test("paired gate rejects critical failures, changed models, repeated-case inflation and missing rows", async () => {
    const incumbent = await createTeachingRevision("Tutor");
    const proposal = await proposer({ incumbent, training: await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision: incumbent, runner, judge }), hypotheses: [], signal: new AbortController().signal });
    const candidate = await createTeachingRevision("Tutor", [proposal.skill], incumbent.id);
    const baseline = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "validation", revision: incumbent, runner, judge });
    const after = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "validation", revision: candidate, runner, judge });
    expect(compareEpisodeBenchmarks(baseline, after).accepted).toBe(true);
    expect(compareEpisodeBenchmarks(baseline, after).pValue).toBe(1 / 64);
    for (const mutate of [
      (value: typeof after) => { value.results[0].criticalPassed = false; },
      (value: typeof after) => { value.results[0].execution!.model = "different-model"; },
      (value: typeof after) => { value.results.pop(); },
      (value: typeof after) => { value.results[1] = value.results[0]; },
    ]) {
      const changed = structuredClone(after); mutate(changed);
      expect(compareEpisodeBenchmarks(baseline, changed).accepted).toBe(false);
    }
    const sameFamilyBefore = structuredClone(baseline);
    const sameFamilyAfter = structuredClone(after);
    [...sameFamilyBefore.results, ...sameFamilyAfter.results].forEach((row) => { row.family = "one-family"; });
    [...sameFamilyBefore.caseManifest, ...sameFamilyAfter.caseManifest].forEach((item) => { item.family = "one-family"; });
    expect(compareEpisodeBenchmarks(sameFamilyBefore, sameFamilyAfter).reasons).toContain("insufficient_independent_cases");
  });

  test("fresh executions have distinct evidence IDs while retaining pairable case identities", async () => {
    const revision = await createTeachingRevision("Tutor");
    const first = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision, runner, judge });
    const second = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision, runner, judge });
    expect(first.runId).not.toBe(second.runId);
    expect(first.results.some((row) => second.results.some((other) => row.id === other.id))).toBe(false);
    expect(first.results.map((row) => [row.caseId, row.repeat])).toEqual(second.results.map((row) => [row.caseId, row.repeat]));
    expect(first.caseManifest.every((item) => item.split === "train")).toBe(true);
  });

  test("jointly omitted repeats and whole cases cannot masquerade as complete experiments", async () => {
    const pair = await winningPair(2);
    expect(compareEpisodeBenchmarks(pair.baseline, pair.candidate).accepted).toBe(true);
    for (const benchmark of [pair.baseline, pair.candidate]) {
      benchmark.results = benchmark.results.filter((row) => row.repeat === 0);
    }
    expect(compareEpisodeBenchmarks(pair.baseline, pair.candidate).reasons).toContain("incomplete_evidence");

    const extra = structuredClone(TEACHING_CASES.find((item) => item.split === "validation")!);
    extra.id = "validation-additional-fixture";
    extra.family = "additional-fixture-family";
    const larger = await winningPair(1, [...TEACHING_CASES, extra]);
    expect(compareEpisodeBenchmarks(larger.baseline, larger.candidate).pairedCases).toBe(7);
    for (const benchmark of [larger.baseline, larger.candidate]) {
      benchmark.results = benchmark.results.filter((row) => row.caseId !== extra.id);
    }
    expect(compareEpisodeBenchmarks(larger.baseline, larger.candidate).reasons).toContain("incomplete_evidence");
  });

  test("fixed criteria and row metadata determine scores, not cached summaries", async () => {
    const { baseline, candidate } = await winningPair();
    for (const mutate of [
      (value: typeof candidate) => { value.results[0].judgments[0].passed = false; },
      (value: typeof candidate) => { value.results[0].judgments[0].criterionId = "invented"; },
      (value: typeof candidate) => { value.results[0].score = 0.5; },
      (value: typeof candidate) => { value.meanScore = 0.5; },
      (value: typeof candidate) => { value.errorCount = 1; },
      (value: typeof candidate) => { value.results[0].repeat = value.repeats; },
      (value: typeof candidate) => { value.results[0].family = "invented"; },
      (value: typeof candidate) => { value.results[0].split = "holdout"; },
      (value: typeof candidate) => { value.results[0].id = "invented"; },
      (value: typeof candidate) => { delete value.results[0].execution; },
    ]) {
      const changed = structuredClone(candidate);
      mutate(changed);
      expect(compareEpisodeBenchmarks(baseline, changed).accepted).toBe(false);
    }
  });

  test("returned adapter objects cannot mutate completed raw evidence", async () => {
    const executions: EpisodeExecution[] = [];
    const judgments: CriterionJudgment[][] = [];
    const revision = await createTeachingRevision("Tutor");
    const benchmark = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision,
      runner: async (input) => { const value = await runner(input); executions.push(value); return value; },
      judge: async (input) => { const value = await judge(input); judgments.push(value); return value; },
    });
    executions.forEach((value) => { value.messages[0].content = "changed afterward"; });
    judgments.forEach((values) => { values[0].passed = false; });
    expect(benchmark.results.every((row) => row.execution!.messages[0].content === "baseline")).toBe(true);
    expect(benchmark.results.every((row) => row.judgments[0].passed)).toBe(true);
    expect(() => validateEpisodeBenchmark(benchmark)).not.toThrow();
  });
});

describe("persistent teaching evolution", () => {
  test("promotes the exact evaluated revision and seals the consumed release holdout", async () => inProject(async (store) => {
    const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, proposer });
    expect(report.status).toBe("accepted");
    expect(report.humanLearning).toBe("unmeasured");
    const revision = await loadActiveTeachingRevision(store);
    expect(revision?.id).toBe(report.candidateRevisionId!);
    expect(composeTeachingPrompt(revision!)).toContain("fixture-procedure");
    expect((await readEvolutionState(store)).hypotheses[0].status).toBe("supported-offline");
    await expect(runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, proposer, force: true })).rejects.toThrow("holdout_consumed");
    const reordered = [...structuredClone(TEACHING_CASES)].reverse();
    reordered.find((item) => item.split === "train")!.messages[0].content = "Changed training only";
    await expect(runTeachingEvolution({ store, cases: reordered, basePrompt: "Tutor", runner, judge, proposer, force: true })).rejects.toThrow("holdout_consumed");
  }));

  test("rejected proposals retain evidence but never become active, and holdout stays hidden", async () => inProject(async (store) => {
    const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner,
      judge: async ({ testCase }) => testCase.rubric.map((criterion) => ({ criterionId: criterion.id, passed: true, rationale: "both already pass" })),
      proposer: async (input) => {
        expect(input.training.results.every((row) => row.split === "train")).toBe(true);
        expect(input.training.caseManifest.every((item) => item.split === "train")).toBe(true);
        return proposer(input);
      },
    });
    expect(report.status).toBe("rejected");
    expect(report.holdout).toBeNull();
    expect(await loadActiveTeachingRevision(store)).toBeNull();
    const state = await readEvolutionState(store);
    expect(state.hypotheses[0].status).toBe("rejected");
    expect(state.consumedHoldouts).toEqual([]);
    expect(await store.read(`raw/${report.id}-train-incumbent`)).not.toBeNull();
  }));

  test("concurrent runs and invented evidence cannot activate", async () => inProject(async (store) => {
    await store.exclusive(async () => {
      await expect(store.exclusive(async () => {})).rejects.toThrow("already_running");
    });
    const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge,
      proposer: async (input) => { const proposal = await proposer(input); proposal.skill.evidenceIds = ["fabricated"]; return proposal; },
    });
    expect(report.status).toBe("failed");
    expect(report.reasons).toEqual(["proposal_evidence_invalid"]);
    expect(await loadActiveTeachingRevision(store)).toBeNull();
  }));

  test("digest changes and missing activation evidence fail closed", async () => inProject(async (store) => {
    const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, proposer });
    const revision = (await loadActiveTeachingRevision(store))!;
    revision.skills[0].instructions = "changed after evaluation";
    await expect(verifyTeachingRevision(revision)).rejects.toThrow("digest_mismatch");
    await expect(store.put(`revisions/${revision.id.slice(7)}`, revision)).rejects.toThrow("immutable");
    const path = join(store.directory, "experiments", `${report.id}.json`);
    const stored = JSON.parse(await readFile(path, "utf8"));
    stored.holdout = null;
    await writeFile(path, JSON.stringify(stored));
    await expect(loadActiveTeachingRevision(store)).rejects.toThrow("evidence_invalid");
  }));

  test("activation rejects swapped split evidence and another revision's accepted report", async () => inProject(async (store) => {
    const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, proposer });
    const path = join(store.directory, "experiments", `${report.id}.json`);
    const swapped = structuredClone(report);
    swapped.holdout = structuredClone(report.validation);
    await writeFile(path, JSON.stringify(swapped));
    await expect(loadActiveTeachingRevision(store)).rejects.toThrow("evidence");
    await writeFile(path, JSON.stringify(report));

    const evaluated = (await loadActiveTeachingRevision(store))!;
    const unevaluated = await createTeachingRevision("Tutor", [{ ...evaluated.skills[0], instructions: "Never evaluated" }], evaluated.parentId);
    await store.put(`revisions/${unevaluated.id.slice(7)}`, unevaluated);
    await expect(loadEvaluatedTeachingRevision(store, { revisionId: unevaluated.id, experimentId: report.id })).rejects.toThrow("evidence");
    const state = await readEvolutionState(store);
    state.active!.revisionId = unevaluated.id;
    await store.writeState(state);
    await writeFile(path, JSON.stringify({ ...report, candidateRevisionId: unevaluated.id }));
    await expect(loadActiveTeachingRevision(store)).rejects.toThrow("evidence");
  }));

  test("pinned accepted revisions retain complete evidence validation after active state changes", async () => inProject(async (store) => {
    const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, proposer });
    const reference = { revisionId: report.candidateRevisionId!, experimentId: report.id };
    const state = await readEvolutionState(store);
    state.active = null;
    await store.writeState(state);
    expect((await loadEvaluatedTeachingRevision(store, reference)).id).toBe(reference.revisionId);
    await rm(join(store.directory, "raw", `${report.id}-train-incumbent.json`));
    await expect(loadEvaluatedTeachingRevision(store, reference)).rejects.toThrow("evidence");
  }));

  test("raw/report agreement cannot replace the independent immutable suite manifest", async () => inProject(async (store) => {
    const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, proposer });
    const changed = structuredClone(report);
    for (const variant of ["baseline", "candidate"] as const) {
      changed.validation![variant].caseManifest[0].rubric[0].description = "Always award credit";
      await writeFile(join(store.directory, "raw", `${report.id}-validation-${variant === "baseline" ? "incumbent" : "candidate"}.json`), JSON.stringify(changed.validation![variant]));
    }
    expect(compareEpisodeBenchmarks(changed.validation!.baseline, changed.validation!.candidate).accepted).toBe(true);
    await writeFile(join(store.directory, "experiments", `${report.id}.json`), JSON.stringify(changed));
    await expect(loadActiveTeachingRevision(store)).rejects.toThrow("evidence_mismatch");
    await expect(store.put(`suites/${report.suiteDigest.slice(7)}`, { cases: [] })).rejects.toThrow("immutable");
  }));

  test("incomplete validation and holdout results preserve an unresolved hypothesis", async () => {
    for (const failingSplit of ["validation", "holdout"] as const) {
      await inProject(async (store) => {
        const failedCase = TEACHING_CASES.find((item) => item.split === failingSplit)!.id;
        const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", judge, proposer,
          runner: async (input) => { if (input.caseId === failedCase) throw new Error("fixture unavailable"); return runner(input); },
        });
        expect(report.status).toBe("failed");
        expect(report.reasons).toContain(`${failingSplit}_execution_incomplete`);
        expect((await readEvolutionState(store)).hypotheses[0].status).toBe("proposed");
        expect(await loadActiveTeachingRevision(store)).toBeNull();
        if (failingSplit === "holdout") {
          await expect(runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, proposer, force: true })).rejects.toThrow("holdout_consumed");
        }
      });
    }
  });

  test("execution budgets account for both sides before any callback or state write", async () => inProject(async (store) => {
    const cases = [...structuredClone(TEACHING_CASES), ...TEACHING_CASES.map((item) => ({
      ...structuredClone(item), id: `${item.id}-copy`, family: `${item.family}-copy`,
    }))];
    const extra = structuredClone(TEACHING_CASES.find((item) => item.split === "validation")!);
    cases.push({ ...extra, id: "validation-budget-extra", family: "budget-extra" });
    let executions = 0;
    await expect(runTeachingEvolution({ store, cases, basePrompt: "Tutor", judge, proposer,
      runner: async (input) => { executions += 1; return runner(input); },
    })).rejects.toThrow("experiment_budget_exceeded");
    expect(executions).toBe(0);
    expect(await store.read("state")).toBeNull();
  }));

  test("proposer-owned references cannot replace validated evidence during persistence", async () => inProject(async (store) => {
    let returned: SkillProposal | undefined;
    const report = await runTeachingEvolution({
      store: {
        read: store.read.bind(store), put: store.put.bind(store), exclusive: store.exclusive.bind(store),
        writeState: async (state) => {
          if (returned) returned.skill.evidenceIds = ["fabricated-after-validation"];
          await store.writeState(state);
        },
      },
      cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge,
      proposer: async (input) => { returned = await proposer(input); return returned; },
    });
    expect(report.status).toBe("accepted");
    expect((await loadActiveTeachingRevision(store))!.skills[0].evidenceIds).not.toContain("fabricated-after-validation");
  }));

  test("a terminated lock owner can be recovered without resetting experiment state", async () => inProject(async (store, cwd) => {
    const state = await readEvolutionState(store);
    state.consumedHoldouts = [`sha256:${"0".repeat(64)}`];
    state.consumedHoldoutFamilies = ["previously-consumed-family"];
    await store.writeState(state);
    const moduleUrl = new URL("../src/core/teaching-evolution-store.ts", import.meta.url).href;
    const script = `const { FileEvolutionStore } = await import(${JSON.stringify(moduleUrl)});\n`
      + `await new FileEvolutionStore(${JSON.stringify(cwd)}).exclusive(async () => {\n`
      + `process.stdout.write("locked\\n"); setInterval(() => {}, 1000); await new Promise(() => {});\n});`;
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    const exited = once(child, "exit");
    try {
      const [chunk] = await once(child.stdout, "data", { signal: AbortSignal.timeout(3000) });
      expect(String(chunk)).toContain("locked");
      child.kill("SIGKILL");
      await exited;
      expect(await store.exclusive(async () => "recovered")).toBe("recovered");
      expect(await readEvolutionState(store)).toEqual(state);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  }));

  test("an old lock with a live or reused PID remains protected", async () => inProject(async (store) => {
    const lockPath = join(store.directory, "experiment.lock");
    const ownerName = `owner-${randomUUID()}.json`;
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, ownerName), JSON.stringify({
      schemaVersion: 1, pid: process.pid, host: hostname(), startedAt: "2000-01-01T00:00:00.000Z",
    }));
    await expect(store.exclusive(async () => "must not enter")).rejects.toThrow("already_running");
    expect(await readdir(lockPath)).toEqual([ownerName]);
  }));
});
