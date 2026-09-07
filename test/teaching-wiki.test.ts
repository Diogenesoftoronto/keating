import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileEvolutionStore } from "../src/core/teaching-evolution-store.js";
import { TEACHING_CASES } from "../shared/evolution/cases.js";
import { readEvolutionState, runTeachingEvolution } from "../shared/evolution/loop.js";
import { applyWikiMaintenance, emptyWiki, loadWiki, registerTrainingTrace, wikiAccess, type WikiMaintainer } from "../shared/evolution/wiki.js";
import { createSkillProposer, createWikiMaintainer } from "../shared/evolution/model-adapters.js";
import { createTeachingRevision, runEpisodeBenchmark } from "../shared/evolution/benchmark.js";
import type { EpisodeJudge, EpisodeRunner, SkillProposer } from "../shared/evolution/contracts.js";

const runner: EpisodeRunner = async ({ systemPrompt }) => {
  expect(systemPrompt).not.toContain("PRIVATE_WIKI_SENTINEL");
  return { messages: [{ role: "assistant", content: "baseline" }], toolCalls: [], model: "fixture", runtime: "test" };
};
const judge: EpisodeJudge = async ({ testCase }) => testCase.rubric.map(c => ({ criterionId: c.id, passed: true, rationale: "fixture" }));
const maintainer: WikiMaintainer = async ({ wiki, training }) => {
  const index = JSON.parse(wiki.index);
  expect(index.traces.every((t: { key: string }) => t.key.endsWith("-train-incumbent"))).toBe(true);
  const old = index.patterns.find((p: { id: string }) => p.id === "check-reasoning");
  if (old) expect(await wiki.read(old.path)).toContain("PRIVATE_WIKI_SENTINEL");
  return { summary: "Refined a recurring teaching pattern.", patches: [{
    id: "check-reasoning", title: "Check reasoning", summary: "A diagnostic distinguishes recall from understanding.",
    markdown: "PRIVATE_WIKI_SENTINEL\n## Conditions\nWhen a learner claims understanding.\n## Counterexamples\nRespect a request for explanation.",
    evidenceIds: [training.results[0].id], expectedRevision: old?.revision ?? 0,
  }] };
};
const proposer: SkillProposer = async ({ wiki, training }) => {
  expect(wiki).toBeDefined();
  expect(await wiki!.read("wiki/patterns/check-reasoning.md")).toContain("PRIVATE_WIKI_SENTINEL");
  await expect(wiki!.read("../../SYSTEM.md")).rejects.toThrow("not_allowed");
  await expect(wiki!.read("raw/anything-holdout-incumbent")).rejects.toThrow("not_allowed");
  return { skill: { id: "check-reasoning", title: "Check reasoning", instructions: "Ask one diagnostic then wait.", hypothesis: "A check reveals uncertainty.",
    evidenceIds: [training.results[0].id], patternIds: ["check-reasoning"] },
    hypothesis: { id: "ignored", statement: "A check reveals uncertainty.", evidenceIds: [], status: "proposed" } };
};
async function project(fn: (store: FileEvolutionStore, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "keating-wiki-"));
  try { await fn(new FileEvolutionStore(dir), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("rejected skills retain patterns and impact history; a later run refines the same page", () => project(async store => {
  const input = { store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, maintainer, proposer };
  const first = await runTeachingEvolution(input);
  expect(first.status).toBe("rejected");
  const prior = await loadWiki(store, first.wikiRevisionId, "Tutor");
  expect(prior.patterns).toHaveLength(1);
  expect(prior.impacts[0].status).toBe("rejected");
  const second = await runTeachingEvolution({ ...input, force: true, proposer: async args => {
    const index = JSON.parse(args.wiki!.index);
    expect(JSON.parse(await args.wiki!.read(index.impacts[0].path)).status).toBe("rejected");
    return proposer(args);
  } });
  const wiki = await loadWiki(store, second.wikiRevisionId, "Tutor");
  expect(wiki.patterns).toHaveLength(1);
  expect(wiki.patterns[0].revision).toBe(2);
  expect(wiki.patterns[0].evidenceIds).toHaveLength(2);
  expect(wiki.logs).toHaveLength(2);
  expect(wiki.impacts).toHaveLength(2);
  expect((await readEvolutionState(store)).active).toBeNull();
  expect((await loadWiki(store, first.wikiRevisionId, "Tutor")).patterns[0].revision).toBe(1);
  expect((await loadWiki(store, second.wikiRevisionId, "Different persona")).patterns).toHaveLength(0);
}));

test("a failed proposer cannot erase committed wiki work or activate a procedure", () => project(async store => {
  const report = await runTeachingEvolution({ store, cases: TEACHING_CASES, basePrompt: "Tutor", runner, judge, maintainer,
    proposer: async () => { throw Error("provider failed"); } });
  expect(report.status).toBe("failed");
  const state = await readEvolutionState(store);
  expect(state.active).toBeNull();
  expect((await loadWiki(store, state.wikiRevisionId, "Tutor")).patterns).toHaveLength(1);
}));

test("maintenance rejects stale revisions, invented evidence and held-out trace registration", () => project(async store => {
  const revision = await createTeachingRevision("Tutor");
  const training = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision, runner, judge });
  const key = "raw/abc-train-incumbent";
  await store.put(key, training);
  const wiki = await registerTrainingTrace(await emptyWiki("Tutor"), key, training);
  const update = await maintainer({ wiki: wikiAccess(store, wiki), training, signal: new AbortController().signal });
  const next = applyWikiMaintenance(wiki, update, training, "abc", new Date().toISOString());
  expect(() => applyWikiMaintenance(next, update, training, "def", new Date().toISOString())).toThrow("conflict");
  const forged = structuredClone(update); forged.patches[0].evidenceIds = ["invented"];
  expect(() => applyWikiMaintenance(wiki, forged, training, "def", new Date().toISOString())).toThrow("fresh_evidence");
  const holdout = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "holdout", revision, runner, judge });
  await expect(registerTrainingTrace(wiki, "raw/abc-holdout-incumbent", holdout)).rejects.toThrow("training_only");
  // Even valid-looking raw evidence cannot be substituted after registration.
  training.results[0].execution!.messages[0].content = "tampered";
  await writeFile(join(store.directory, `${key}.json`), JSON.stringify(training));
  await expect(wikiAccess(store, wiki).read(key)).rejects.toThrow("mismatch");
}));

test("the model maintainer and proposer can inspect allowlisted evidence across bounded rounds", async () => {
  let reads = 0; let calls = 0;
  const wiki = { index: JSON.stringify({ patterns: [{ path: "wiki/patterns/check.md" }] }),
    read: async (path: string) => { expect(path).toBe("wiki/patterns/check.md"); reads++; return "evidence"; } };
  const training = await runEpisodeBenchmark({ cases: TEACHING_CASES, split: "train", revision: await createTeachingRevision("Tutor"), runner, judge });
  const complete = async ({ prompt }: { prompt: string }) => {
    calls++;
    if (calls % 2 === 1) return JSON.stringify({ read: ["wiki/patterns/check.md"] });
    expect(prompt).toContain('"content":"evidence"');
    return JSON.stringify({ summary: "No update justified", patches: [] });
  };
  await createWikiMaintainer(complete)({ wiki, training, signal: new AbortController().signal });
  await createSkillProposer(complete)({ wiki, training, incumbent: await createTeachingRevision("Tutor"), hypotheses: [], signal: new AbortController().signal });
  expect(reads).toBe(2); expect(calls).toBe(4);
  const repeating = createWikiMaintainer(async () => JSON.stringify({ read: ["wiki/patterns/check.md"] }));
  await expect(repeating({ wiki, training, signal: new AbortController().signal })).rejects.toThrow("budget");
});
