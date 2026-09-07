import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { BrowserEvolutionStore } from "../keating/teaching-evolution-store";
import { KeatingStorage } from "../keating/storage";
import { KEATING_SYSTEM_PROMPT, getActiveKeatingPrompt } from "../keating/browser-tools/prompt";
import { TEACHING_CASES } from "../../../shared/evolution/cases";
import { composeTeachingPrompt } from "../../../shared/evolution/benchmark";
import { loadActiveTeachingRevision, runTeachingEvolution } from "../../../shared/evolution/loop";
import { loadWiki, wikiAccess } from "../../../shared/evolution/wiki";

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

test("browser persistence activates only the exact revision with complete evaluated evidence", async () => {
  const store = new BrowserEvolutionStore();
  // The fixture has one client. Browser production uses the Web Locks API across tabs.
  store.exclusive = async (operation) => operation();
  const report = await runTeachingEvolution({
    store, cases: TEACHING_CASES, basePrompt: KEATING_SYSTEM_PROMPT,
    runner: async ({ systemPrompt }) => {
      expect(systemPrompt).not.toContain("PRIVATE_WIKI_SENTINEL");
      return ({
      messages: [{ role: "assistant", content: systemPrompt.includes("fixture-procedure") ? "improved" : "baseline" }],
      toolCalls: [], model: "fixture", runtime: "test-only",
    }); },
    judge: async ({ testCase, execution }) => testCase.rubric.map((criterion, index) => ({
      criterionId: criterion.id, passed: execution.messages[0].content === "improved" || index < testCase.rubric.length - 1,
      rationale: "Deterministic storage integration fixture.",
    })),
    maintainer: async ({ training }) => ({ summary: "Keep diagnostic checks grounded in observed reasoning.", patches: [{
      id: "diagnostic-check", title: "Diagnostic check", summary: "Probe reasoning before advancing.",
      markdown: "PRIVATE_WIKI_SENTINEL: distinguish remembered words from explained reasoning.",
      evidenceIds: [training.results[0].id], expectedRevision: 0,
    }] }),
    proposer: async ({ training, wiki }) => {
      expect(await wiki!.read("wiki/patterns/diagnostic-check.md")).toContain("PRIVATE_WIKI_SENTINEL");
      return ({
      skill: { id: "check-understanding", title: "Check understanding", instructions: "fixture-procedure",
        hypothesis: "A fresh check reveals repetition.", evidenceIds: [training.results[0].id], patternIds: ["diagnostic-check"] },
      hypothesis: { id: "ignored", statement: "A fresh check reveals repetition.", evidenceIds: [], status: "proposed" },
    }); },
  });
  expect(report.status).toBe("accepted");
  const revision = (await loadActiveTeachingRevision(store))!;
  expect(revision.skills[0].patternIds).toEqual(["diagnostic-check"]);
  const reopened = new BrowserEvolutionStore();
  const wiki = await loadWiki(reopened, report.wikiRevisionId, KEATING_SYSTEM_PROMPT);
  expect(wiki.impacts[0].status).toBe("accepted");
  expect(wiki.impacts[0].after).toEqual(revision.skills[0]);
  expect(await wikiAccess(reopened, wiki).read("wiki/patterns/diagnostic-check.md")).toContain("PRIVATE_WIKI_SENTINEL");
  const active = await getActiveKeatingPrompt(new KeatingStorage(), "learn", store);
  expect(active).toBe(composeTeachingPrompt(revision));
  expect(active).not.toContain("PRIVATE_WIKI_SENTINEL");
  expect(await getActiveKeatingPrompt(new KeatingStorage(), "learn", store, "A different chosen persona")).toBe("A different chosen persona");
  await expect(store.put(`experiments/${report.id}`, { ...report, status: "rejected" })).rejects.toThrow("immutable");
});

test("prompt proposals cannot activate themselves", async () => {
  const store = new BrowserEvolutionStore();
  const storage = new KeatingStorage();
  await storage.savePromptEvolution("learn", { bestScore: 100, bestPrompt: "Unvalidated candidate", report: "heuristic" });
  expect(await getActiveKeatingPrompt(storage, "learn", store)).toBe(KEATING_SYSTEM_PROMPT);
});

test("destroying an evaluation database cannot delete or reopen learner storage", async () => {
  const learner = new KeatingStorage();
  await learner.saveLessonPlan("Retain", "Learner data");
  await expect(learner.destroyIsolatedDatabase()).rejects.toThrow("isolated");
  const isolated = new KeatingStorage("keating-eval-lifecycle");
  await isolated.init();
  await isolated.destroyIsolatedDatabase();
  await expect(isolated.init()).rejects.toThrow("destroyed");
  expect((await learner.listArtifacts()).length).toBe(1);
});
