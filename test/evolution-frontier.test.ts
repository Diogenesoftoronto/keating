import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileEvolutionStore } from "../src/core/teaching-evolution-store.js";
import { compareEpisodeBenchmarks, createTeachingRevision, runEpisodeBenchmark } from "../shared/evolution/benchmark.js";
import { judgeBackendTag, withPinnedJudgeIdentity } from "../shared/evolution/model-adapters.js";
import { placeMeasuredElite, placeInMapElitesGrid } from "../shared/pedagogy/map-elites.js";
import { TEACHING_CASES } from "../shared/evolution/cases.js";
import type { EpisodeJudge, EpisodeRunner, SkillProposer } from "../shared/evolution/contracts.js";
import { emptyEvolutionState, readEvolutionState, runTeachingEvolution, type EvolutionState, type EvolutionStore } from "../shared/evolution/loop.js";
import { FRONTIER_QUESTIONS, loadFrontierArchive, frontierProposalContext, frontierTrainingOutcome, readFrontier, reconcileFrontier, selectFrontierCandidate, type FrontierSelection } from "../shared/evolution/frontier.js";
import type { JudgementCaller, JudgementOutcome } from "../packages/learner-contracts/src/judgement/contracts.js";

class Store implements EvolutionStore {
  records = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return structuredClone(this.records.get(key) ?? null) as T | null; }
  async put(key: string, value: unknown) {
    if (this.records.has(key)) {
      const comparable = (value: unknown) => {
        if (key.startsWith("revisions/")) { const { createdAt, ...rest } = value as Record<string, unknown>; return rest; }
        return value;
      };
      expect(comparable(value)).toEqual(comparable(this.records.get(key)));
    } else this.records.set(key, structuredClone(value));
  }
  async writeState(state: EvolutionState) { this.records.set("state", structuredClone(state)); }
  async exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
const runner: EpisodeRunner = async ({ systemPrompt }) => ({
  messages: [{ role: "assistant", content: systemPrompt.includes("strategy-") ? "candidate" : "baseline" }],
  model: "fixture", runtime: "deterministic", toolCalls: [],
});
// Candidates improve training, but do not pass validation. Queued alternatives remain usable.
const judge: EpisodeJudge = async ({ testCase, execution }) => testCase.rubric.map((criterion, index) => ({
  criterionId: criterion.id, passed: index > 0 || (testCase.split === "train" && execution.messages[0].content === "candidate"),
  rationale: "Fixture only",
}));
const proposer: SkillProposer = async ({ training, exploration }) => {
  const slot = exploration?.slot ?? 0;
  return { skill: { id: `strategy-${slot}`, title: `Strategy ${slot}`, instructions: `Use strategy-${slot}`,
    hypothesis: "An alternative teaching strategy", evidenceIds: [training.results[slot].id] },
  hypothesis: { id: "ignored", statement: "Test an alternative", evidenceIds: [], status: "proposed" } };
};
function input(store = new Store()) { return { store, cases: TEACHING_CASES, runner, judge, proposer, basePrompt: "Tutor", force: true }; }
const answer = (value: number, model = "fixture-judge-v1"): JudgementOutcome => ({ ok: true, response: {
  backend: { backend: "system-one", model, calibrationSha256: null },
  answers: Object.fromEntries(Object.keys(FRONTIER_QUESTIONS).map(key => [key, { type: "noul", noul: value }])),
} });
const ranking: JudgementCaller = async request => {
  const title = (request.state as { candidate?: { title: string } }).candidate?.title;
  return answer(title === "Strategy 2" ? 0.9 : title === "Strategy 1" ? 0.6 : 0.1);
};

test("generates three alternatives, ranks without calibration, and records predictions before execution", async () => {
  const args = input(); let proposals = 0; let candidateCalls = 0;
  const report = await runTeachingEvolution({ ...args, frontierReviewer: { call: ranking },
    proposer: async arg => { proposals++; expect(arg.exploration!.alternatives).toHaveLength(arg.exploration!.slot); return proposer(arg); },
    runner: async arg => {
      if (arg.systemPrompt.includes("strategy-")) {
        candidateCalls++;
        const selection = [...args.store.records.entries()].find(([key]) => key.endsWith("-frontier-selection"));
        expect(selection).toBeDefined();
        expect((selection![1] as FrontierSelection).mode).toBe("ranked");
      }
      return runner(arg);
    },
  });
  expect(proposals).toBe(3); expect(candidateCalls).toBe(12);
  expect(report.status).toBe("rejected"); expect(report.holdout).toBeNull();
  const state = await readEvolutionState(args.store);
  expect(state.active).toBeNull(); expect(state.frontier!.candidates.filter(item => item.status === "queued")).toHaveLength(2);
  const selection = await args.store.read<FrontierSelection>(report.frontier!.selectionKey);
  expect(selection!.predictions).toHaveLength(3);
  expect(selection!.selectedId).toBe(report.candidateRevisionId!);
  expect(selection!.predictions.find(item => item.candidateId === selection!.selectedId)!.values!.useful).toBe(0.9);
  expect(await args.store.read(report.frontier!.outcomeKey)).toMatchObject({ evidenceKind: "synthetic", humanLearning: "unmeasured", useful: true });
});

test("reuses persisted alternatives without another proposal batch and feeds completed training outcomes into the next batch", async () => {
  const args = input(); let proposals = 0; const priorTrials: number[] = [];
  const run = () => runTeachingEvolution({ ...args, proposer: async arg => {
    proposals++; priorTrials.push(arg.exploration!.priorTrials!.length); return proposer(arg);
  } });
  const first = await run(); const second = await run(); const third = await run();
  expect(proposals).toBe(3);
  expect(new Set([first.candidateRevisionId, second.candidateRevisionId, third.candidateRevisionId]).size).toBe(3);
  await run(); expect(proposals).toBe(6); expect(priorTrials.slice(3).every(count => count === 3)).toBe(true);
});

test("every fourth selection explores a less visited failure family regardless of model ranking", async () => {
  const args = input(); const first = await runTeachingEvolution(args);
  const state = await readEvolutionState(args.store);
  state.frontier!.selections = 3;
  const queued = state.frontier!.candidates.filter(item => item.status === "queued");
  queued[0].cell = state.frontier!.candidates.find(item => item.status === "rejected")!.cell;
  const selection = await selectFrontierCandidate({ frontier: state.frontier!, store: args.store, training: first.training!, call: ranking });
  expect(selection.mode).toBe("exploration"); expect(selection.selectedId).toBe(queued[1].id);
});

test("incomplete answers and backend drift fall back to FIFO without skipping an experiment", async () => {
  for (const drift of [false, true]) {
    const args = input(); let calls = 0;
    const report = await runTeachingEvolution({ ...args, frontierReviewer: { call: async () => {
      calls++;
      if (!drift) return { ok: false, error: { code: "backend-unavailable", retryable: false } };
      return answer(0.9, `fixture-${calls}`);
    } } });
    expect(report.frontier!.mode).toBe("fifo"); expect(report.validation).not.toBeNull();
    expect(report.candidateTraining!.errorCount).toBe(0);
  }
});

test("ranking gets stable questions and train-only projections, and cannot mutate saved executions", async () => {
  const args = input();
  const report = await runTeachingEvolution({ ...args, frontierReviewer: { call: async request => {
    expect(request.questions).toEqual(FRONTIER_QUESTIONS);
    const text = JSON.stringify(request.state);
    expect(text).not.toContain("suiteDigest"); expect(text).not.toContain('"holdout"'); expect(text).not.toContain('"validation"');
    for (const item of TEACHING_CASES.filter(item => item.split !== "train")) expect(text).not.toContain(item.messages[0].content);
    (request.state as any).training.results[0].messages[0].content = "mutated-by-caller";
    return answer(0.5);
  } } });
  expect(JSON.stringify(report.training)).not.toContain("mutated-by-caller");
});

test("cancellation while ranking preserves queued revisions and spends no candidate executions", async () => {
  const args = input(); const controller = new AbortController();
  const report = await runTeachingEvolution({ ...args, signal: controller.signal, frontierReviewer: { call: async () => {
    controller.abort(); return answer(0.9);
  } } });
  expect(report.status).toBe("failed"); expect(report.candidateRevisionId).toBeNull();
  const state = await readEvolutionState(args.store);
  expect(state.frontier!.candidates.every(item => item.status === "queued")).toBe(true);
  expect(state.consumedHoldouts).toEqual([]);
});

test("hung ranking calls time out into deterministic scheduling", async () => {
  const args = input();
  const report = await runTeachingEvolution({ ...args, frontierReviewer: { timeoutMs: 2, call: () => new Promise(() => {}) } });
  expect(report.frontier!.mode).toBe("fifo"); expect(report.validation).not.toBeNull();
});

test("duplicate proposals do not create duplicate queued behavior", async () => {
  const args = input(); const report = await runTeachingEvolution({ ...args, proposer: arg => proposer({ ...arg, exploration: undefined }) });
  expect(report.status).toBe("rejected");
  expect((await readEvolutionState(args.store)).frontier!.candidates).toHaveLength(1);
});

test("a later proposer failure preserves the first saved alternative", async () => {
  const args = input();
  const report = await runTeachingEvolution({ ...args, proposer: arg => {
    if (arg.exploration!.slot > 0) throw Error("private provider error");
    return proposer(arg);
  } });
  expect(report.status).toBe("rejected"); expect(report.candidateRevisionId).not.toBeNull();
  expect(JSON.stringify([...args.store.records.values()])).not.toContain("private provider error");
});

test("interrupted runs never replay and incompatible parents supersede queued revisions", async () => {
  const args = input(); await runTeachingEvolution(args);
  const state = await readEvolutionState(args.store); const frontier = state.frontier!;
  const [first, second] = frontier.candidates.filter(item => item.status === "queued");
  first.status = "running"; first.experimentId = crypto.randomUUID();
  await reconcileFrontier(frontier, args.store, second.parentId, second.trainingDigest);
  expect(first.status).toBe("failed"); expect(second.status).toBe("queued");
  await reconcileFrontier(frontier, args.store, `sha256:${"f".repeat(64)}`, second.trainingDigest);
  expect(second.status).toBe("superseded");
  expect(readFrontier()).toEqual({ schemaVersion: 1, selections: 0, candidates: [] });
  expect(() => readFrontier({ ...frontier, selections: -1 })).toThrow("invalid_evolution_frontier");
});

test("missing candidate evidence fails closed before validation", async () => {
  const args = input(); await runTeachingEvolution(args);
  const state = await readEvolutionState(args.store);
  const queued = state.frontier!.candidates.find(item => item.status === "queued")!;
  args.store.records.delete(queued.proposalKey);
  const report = await runTeachingEvolution(args);
  expect(report.status).toBe("failed"); expect(report.validation).toBeNull();
});

test("training failures stay unknown and never become false calibration labels", async () => {
  const args = input();
  const report = await runTeachingEvolution({ ...args, runner: async arg => {
    if (arg.systemPrompt.includes("strategy-")) throw Error("provider unavailable");
    return runner(arg);
  } });
  expect(report.status).toBe("failed"); expect(report.validation).toBeNull();
  expect(await args.store.read(report.frontier!.outcomeKey)).toMatchObject({ useful: null, delta: null });
});

test("a changed tutor model cannot turn a training difference into calibration evidence or proceed to validation", async () => {
  const args = input();
  const report = await runTeachingEvolution({ ...args, runner: async arg => ({
    ...await runner(arg), model: arg.systemPrompt.includes("strategy-") ? "changed-tutor" : "original-tutor",
  }) });
  expect(report.status).toBe("failed"); expect(report.validation).toBeNull();
  expect(await args.store.read(report.frontier!.outcomeKey)).toMatchObject({ useful: null, delta: null });
});

test("new frontier state does not migrate or alter existing active-session defaults", async () => {
  const store = new Store(); await store.writeState(emptyEvolutionState());
  expect(await readEvolutionState(store)).toEqual(emptyEvolutionState());
});

test("switching both sides to another model at validation still fails the experiment pin", async () => {
  const args = input();
  const trainIds = new Set(TEACHING_CASES.filter(item => item.split === "train").map(item => item.id));
  const report = await runTeachingEvolution({ ...args, runner: async arg => ({
    ...await runner(arg), model: trainIds.has(arg.caseId) ? "original-tutor" : "changed-tutor",
  }) });
  expect(report.status).toBe("failed"); expect(report.reasons).toEqual(["experiment_model_changed"]);
  expect(report.holdout).toBeNull(); expect((await readEvolutionState(args.store)).active).toBeNull();
});


test("measured MAP-Elites replaces only with better finite quality and preserves equal-score incumbents", () => {
  const cells = new Map<string, { score: number; id: string }>();
  expect(placeMeasuredElite(cells, "failure-a", { score: 0.4, id: "first" })).toBe("inserted");
  expect(placeMeasuredElite(cells, "failure-a", { score: 0.3, id: "worse" })).toBe("retained");
  expect(placeMeasuredElite(cells, "failure-a", { score: 0.4, id: "tie" })).toBe("retained");
  expect(cells.get("failure-a")!.id).toBe("first");
  expect(placeMeasuredElite(cells, "failure-a", { score: 0.8, id: "better" })).toBe("replaced");
  for (const score of [NaN, Infinity, -Infinity]) expect(() => placeMeasuredElite(cells, "failure-a", { score, id: "invalid" })).toThrow();
  expect(cells.get("failure-a")!.id).toBe("better");
});

test("production loop archives actual best-per-cell quality despite surrogate ranking and protected rejection", async () => {
  const args = input();
  const run = () => runTeachingEvolution({ ...args, frontierReviewer: { call: ranking },
    // All variants address the same observed failure, so compete for one elite cell.
    proposer: async arg => { const proposal = await proposer(arg); proposal.skill.evidenceIds = [arg.training.results[0].id]; return proposal; },
    runner: async arg => ({ ...await runner(arg), messages: [{ role: "assistant", content: arg.systemPrompt }] }),
    judge: async ({ testCase, execution }) => testCase.rubric.map((criterion, index) => ({ criterionId: criterion.id,
      passed: testCase.split === "train" ? index > (execution.messages[0].content.includes("strategy-1") ? -1 : 0) : index > 0,
      rationale: "Measured fixture score; no protected improvement" })),
  });
  const reports = [await run(), await run(), await run()];
  const state = await readEvolutionState(args.store);
  const archive = await loadFrontierArchive(args.store, state.frontier!.archiveRevisionId);
  expect(archive.measurements).toHaveLength(3); expect(archive.elites).toHaveLength(1);
  expect(archive.elites[0].score).toBe(1);
  // Jev ranks strategy-2 highest, but strategy-1's real execution wins the cell.
  expect(archive.elites[0].candidateId).toBe(reports[1].candidateRevisionId!);
  expect(archive.elites[0].candidateId).not.toBe(reports[0].candidateRevisionId!);
  expect(reports.every(report => report.status === "rejected" && report.holdout === null)).toBe(true);
  expect(state.active).toBeNull();
  const context = await frontierProposalContext(args.store, archive, reports[0].training!);
  expect(context.elites[0].instructions).toBe("Use strategy-1");
  expect(context.priorTrials).toHaveLength(3);
  expect(JSON.stringify(context)).not.toContain("validation"); expect(JSON.stringify(context)).not.toContain("holdout");
});

test("archive survives 64-summary pruning and is used by the next real proposal batch", async () => {
  const args = input(); await runTeachingEvolution(args); await runTeachingEvolution(args); await runTeachingEvolution(args);
  const state = await readEvolutionState(args.store); const previousArchive = state.frontier!.archiveRevisionId!;
  const exemplar = state.frontier!.candidates[0];
  state.frontier!.candidates = Array.from({ length: 64 }, (_, index) => ({ ...exemplar,
    id: `sha256:${index.toString(16).padStart(64, "0")}`, status: "failed" as const }));
  await args.store.writeState(state);
  const seen: number[] = [];
  const report = await runTeachingEvolution({ ...args, proposer: async arg => {
    seen.push(arg.exploration!.elites!.length); expect(arg.exploration!.priorTrials).toHaveLength(3); return proposer(arg);
  } });
  expect(report.status).toBe("rejected"); expect(seen.every(count => count === 3)).toBe(true);
  const next = await readEvolutionState(args.store);
  expect(next.frontier!.candidates.length).toBeLessThanOrEqual(64);
  expect((await loadFrontierArchive(args.store, previousArchive)).measurements).toHaveLength(3);
  expect((await loadFrontierArchive(args.store, next.frontier!.archiveRevisionId)).measurements).toHaveLength(4);
});

test("proposal memory is isolated by parent revision, training cases, repeats, and execution identity", async () => {
  const args = input(); const report = await runTeachingEvolution(args);
  const state = await readEvolutionState(args.store);
  const archive = await loadFrontierArchive(args.store, state.frontier!.archiveRevisionId);
  const baseline = await args.store.read<any>(`revisions/${report.baselineRevisionId.slice(7)}`);
  for (const changed of ["parent", "cases", "repeats", "model", "runtime"]) {
    const cases = structuredClone(TEACHING_CASES);
    if (changed === "cases") cases.find(item => item.split === "train")!.messages[0].content += " A new training prompt.";
    const training = await runEpisodeBenchmark({ cases, split: "train",
      revision: changed === "parent" ? await createTeachingRevision("Different base tutor") : baseline,
      repeats: changed === "repeats" ? 2 : 1, judge,
      runner: async arg => ({ ...await runner(arg), model: changed === "model" ? "another-model" : "fixture",
        runtime: changed === "runtime" ? "another-runtime" : "deterministic" }) });
    expect(await frontierProposalContext(args.store, archive, training)).toEqual({ priorTrials: [], elites: [] });
  }
});

test("failed, mismatched, nonfinite, and replayed training evidence cannot create measured elites", async () => {
  const args = input();
  const failed = await runTeachingEvolution({ ...args, runner: async arg => {
    if (arg.systemPrompt.includes("strategy-")) throw Error("unavailable"); return runner(arg);
  } });
  expect((await readEvolutionState(args.store)).frontier!.archiveRevisionId).toBeUndefined();
  expect(frontierTrainingOutcome(failed.training!, failed.candidateTraining!)).toEqual({ useful: null, delta: null });
  const good = await runTeachingEvolution(args);
  for (const candidate of [good.training!, { ...good.candidateTraining!, meanScore: NaN },
    { ...good.candidateTraining!, split: "validation" as const }, { ...good.candidateTraining!, runId: good.training!.runId }]) {
    expect(frontierTrainingOutcome(good.training!, candidate)).toEqual({ useful: null, delta: null });
  }
  const state = await readEvolutionState(args.store);
  const rawKey = `raw/${good.id}-train-candidate`;
  const raw = args.store.records.get(rawKey) as any;
  raw.meanScore = 0.001;
  await expect(loadFrontierArchive(args.store, state.frontier!.archiveRevisionId)).rejects.toThrow();
});


test("legacy MAP-Elites wrapper preserves new-cell return semantics with nullable cells", () => {
  const grid = { descriptors: ["exampleRatio"], resolution: 2, cells: new Map() };
  const policy = { exampleRatio: 0.2 } as any;
  const weights = {} as any; const benchmark = {} as any;
  grid.cells.set("0", null);
  expect(placeInMapElitesGrid(grid, policy, weights, 0.2, benchmark, 1)).toBe(true);
  expect(placeInMapElitesGrid(grid, policy, weights, 0.8, benchmark, 2)).toBe(false);
  expect(grid.cells.get("0").score).toBe(0.8);
  expect(placeInMapElitesGrid(grid, policy, weights, 0.1, benchmark, 3)).toBe(false);
  expect(grid.cells.get("0").iteration).toBe(2);
});

test("exploration uses retained measured visits after scheduling summaries are pruned", async () => {
  const args = input(); const report = await runTeachingEvolution(args);
  const state = await readEvolutionState(args.store); const frontier = state.frontier!;
  const archive = await loadFrontierArchive(args.store, frontier.archiveRevisionId);
  frontier.candidates = frontier.candidates.filter(item => item.status === "queued");
  frontier.candidates[0].cell = archive.elites[0].cell;
  frontier.selections = 3;
  const selection = await selectFrontierCandidate({ frontier, archive, store: args.store, training: report.training!, call: ranking });
  expect(selection.mode).toBe("exploration"); expect(selection.selectedId).toBe(frontier.candidates[1].id);
});


test("measured archive persists through the production filesystem store and a fresh store instance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "keating-measured-elites-"));
  try {
    const store = new FileEvolutionStore(directory);
    const report = await runTeachingEvolution({ ...input(), store });
    expect(report.status).toBe("rejected");
    const reopened = new FileEvolutionStore(directory);
    const state = await readEvolutionState(reopened);
    const archive = await loadFrontierArchive(reopened, state.frontier!.archiveRevisionId);
    expect(archive.measurements).toHaveLength(1);
    expect(archive.elites[0].candidateId).toBe(report.candidateRevisionId!);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test("corrupt archive stops before spending or changing cooldown state", async () => {
  const args = input(); await runTeachingEvolution(args);
  const before = await readEvolutionState(args.store);
  const key = `raw/frontier-archive-${before.frontier!.archiveRevisionId!.slice(7)}`;
  (args.store.records.get(key) as any).elites[0].score = 0.123;
  let executions = 0;
  await expect(runTeachingEvolution({ ...args, runner: async arg => { executions++; return runner(arg); } })).rejects.toThrow("frontier_archive_invalid");
  expect(executions).toBe(0); expect(await readEvolutionState(args.store)).toEqual(before);
});


test("full calibration pins separate measured scopes and fixed promotion gates even when prefixes match", async () => {
  const args = input();
  const first = { backend: "system-one" as const, model: "jev-concrete-v1", calibrationSha256: "a".repeat(64) };
  const changed = { ...first, calibrationSha256: "a".repeat(12) + "b".repeat(52) };
  expect(judgeBackendTag(first)).not.toBe(judgeBackendTag(changed));
  expect(judgeBackendTag(first)).toContain(first.calibrationSha256);
  expect(judgeBackendTag({ ...first, calibrationSha256: null })).toEndWith("@uncalibrated");
  const report = await runTeachingEvolution({ ...args, runner: withPinnedJudgeIdentity(runner, first) });
  const state = await readEvolutionState(args.store);
  const archive = await loadFrontierArchive(args.store, state.frontier!.archiveRevisionId);
  const revision = await args.store.read<any>(`revisions/${report.baselineRevisionId.slice(7)}`);
  for (const backend of [changed, { ...first, calibrationSha256: null }]) {
    const fresh = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision,
      runner: withPinnedJudgeIdentity(runner, backend), judge });
    expect(await frontierProposalContext(args.store, archive, fresh)).toEqual({ priorTrials: [], elites: [] });
  }
  const candidateRevision = await args.store.read<any>(`revisions/${report.candidateRevisionId!.slice(7)}`);
  const baseline = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "validation", revision,
    runner: withPinnedJudgeIdentity(runner, first), judge });
  const candidate = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "validation", revision: candidateRevision,
    runner: withPinnedJudgeIdentity(runner, changed), judge });
  expect(compareEpisodeBenchmarks(baseline, candidate).reasons).toContain("runtime_or_model_changed");
});
