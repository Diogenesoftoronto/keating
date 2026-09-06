import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { BrowserEvolutionStore } from "../keating/teaching-evolution-store";
import { KeatingStorage } from "../keating/storage";
import { KEATING_SYSTEM_PROMPT, getActiveKeatingPrompt } from "../keating/browser-tools/prompt";
import { TEACHING_CASES } from "../../../shared/evolution/cases";
import { composeTeachingPrompt } from "../../../shared/evolution/benchmark";
import { loadActiveTeachingRevision, runTeachingEvolution } from "../../../shared/evolution/loop";

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

test("browser persistence activates only the exact revision with complete evaluated evidence", async () => {
  const store = new BrowserEvolutionStore();
  // The fixture has one client. Browser production uses the Web Locks API across tabs.
  store.exclusive = async (operation) => operation();
  const report = await runTeachingEvolution({
    store, cases: TEACHING_CASES, basePrompt: KEATING_SYSTEM_PROMPT,
    runner: async ({ systemPrompt }) => ({
      messages: [{ role: "assistant", content: systemPrompt.includes("fixture-procedure") ? "improved" : "baseline" }],
      toolCalls: [], model: "fixture", runtime: "test-only",
    }),
    judge: async ({ testCase, execution }) => testCase.rubric.map((criterion, index) => ({
      criterionId: criterion.id, passed: execution.messages[0].content === "improved" || index < testCase.rubric.length - 1,
      rationale: "Deterministic storage integration fixture.",
    })),
    proposer: async ({ training }) => ({
      skill: { id: "check-understanding", title: "Check understanding", instructions: "fixture-procedure",
        hypothesis: "A fresh check reveals repetition.", evidenceIds: [training.results[0].id] },
      hypothesis: { id: "ignored", statement: "A fresh check reveals repetition.", evidenceIds: [], status: "proposed" },
    }),
  });
  expect(report.status).toBe("accepted");
  const revision = (await loadActiveTeachingRevision(store))!;
  const active = await getActiveKeatingPrompt(new KeatingStorage(), "learn", store);
  expect(active).toBe(composeTeachingPrompt(revision));
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
