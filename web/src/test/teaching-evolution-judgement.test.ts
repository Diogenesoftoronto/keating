import { questionDigest, thresholdKey } from "@keating/learner-contracts";
import { EVOLUTION_SPEND_QUESTIONS } from "../../../shared/evolution/spend-review";
import { expect, test } from "bun:test";
import type { JudgementBackendKey, JudgementCaller, JudgementRequest, JudgementOutcome } from "@keating/learner-contracts";
import type { EpisodeRunner, SkillProposer, TeachingCase } from "../../../shared/evolution/contracts";
import { loadActiveTeachingRevision, type EvolutionState, type EvolutionStore, type TeachingExperiment } from "../../../shared/evolution/loop";
import { runBrowserTeachingExperiment } from "../keating/teaching-evolution";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

class MemoryStore implements EvolutionStore {
  readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return structuredClone(this.values.get(key) as T ?? null); }
  async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
  async writeState(value: EvolutionState) { this.values.set("state", structuredClone(value)); }
  async exclusive<T>(operation: () => Promise<T>) { return operation(); }
}
const cases: TeachingCase[] = ["train", "validation", "holdout"].flatMap((split) => Array.from({ length: split === "train" ? 1 : 6 }, (_, index) => ({
  id: `${split}-${index}`, family: `${split}-family-${index}`, domain: "mathematics", split: split as TeachingCase["split"],
  messages: [{ role: "user", content: `Help with ${split}-${index}.` }],
  rubric: [{ id: "accuracy", description: "Preserves accuracy.", critical: true }, { id: "diagnosis", description: "Diagnoses misunderstanding.", critical: false }, { id: "check", description: "Checks an independent attempt.", critical: false }],
})));
const proposer: SkillProposer = async ({ training }) => ({
  skill: { id: "web-repair", title: "Check reasoning", instructions: "WEB_REPAIR: check reasoning before continuing.", hypothesis: "Independent reasoning checks improve teaching behavior.", evidenceIds: [training.results[0]!.id] },
  hypothesis: { id: "web-hypothesis", statement: "Independent reasoning checks improve teaching behavior.", evidenceIds: [training.results[0]!.id], status: "proposed" },
});
const hosted: JudgementBackendKey = { backend: "system-one", model: "judgement", calibrationSha256: null };
const local: JudgementBackendKey = { backend: "local", model: "independent-local", calibrationSha256: null };
function runtime(tiers: WebJudgementRuntime["policy"]["tiers"], backend: "off" | "local" | "hosted" = "hosted"): WebJudgementRuntime {
  return { settings: { backend, localModelId: local.model, gatewayPath: "/api/judgement" }, policy: { tiers, calibration: { entries: {} } } };
}
function response(request: JudgementRequest, backend: JudgementBackendKey, mode: "ok" | "regression" | "uncertain" = "ok"): JudgementOutcome {
  const candidate = JSON.stringify(request.state).includes("candidate");
  return { ok: true, response: { backend, answers: Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    if (question.type === "noul") return [key, { type: "noul", noul: mode === "uncertain" ? 0.5 : (key.endsWith("accuracy") ? !(candidate && mode === "regression") : candidate) ? 0.97 : 0.03 }];
    if (question.type !== "choice") throw new Error("Unexpected primitive");
    const keys = Object.keys(question.criteria);
    return [key, { type: "choice", choice: keys[0], confidence: 1, probabilities: Object.fromEntries(keys.map((option, index) => [option, index === 0 ? 1 : 0])) }];
  })) } } as JudgementOutcome;
}
async function run(judgementRuntime: WebJudgementRuntime, store = new MemoryStore()) {
  let tutorCalls = 0;
  const runner: EpisodeRunner = async ({ systemPrompt }) => {
    tutorCalls++;
    return { messages: [{ role: "assistant", content: systemPrompt.includes("WEB_REPAIR") ? "candidate" : "baseline" }], toolCalls: [], model: "different-tutor-model", runtime: "browser-fixture" };
  };
  const report = await runBrowserTeachingExperiment({} as Parameters<typeof runBrowserTeachingExperiment>[0], {
    cases, store, judgementRuntime, proposer, basePrompt: "Teach clearly.",
    episodeAdapters: { runner, complete: async () => { throw new Error("Tutor completion must never judge"); } },
  });
  const experiment = [...store.values.entries()].find(([key]) => key.startsWith("experiments/"))![1] as TeachingExperiment;
  return { report, experiment, store, tutorCalls };
}

test("production web evolution resolves one independent concrete judge before the first recorded episode and preserves both gates", async () => {
  let calls = 0;
  const call: JudgementCaller = async (request) => { calls++; return response(request, { ...hosted, model: "jev-1.13.0" }); };
  const result = await run(runtime([{ key: local, call, isAvailable: () => false }, { key: hosted, call }]));
  expect(result.experiment.status).toBe("accepted");
  expect(result.experiment.validation?.decision.accepted).toBe(true); expect(result.experiment.holdout?.decision.accepted).toBe(true);
  // 26 episode judgments plus one frontier ranking request.
  expect(calls).toBe(27); expect(result.tutorCalls).toBe(26);
  expect(result.experiment.training?.results[0]?.execution?.model).toBe("different-tutor-model+judge:system-one/jev-1.13.0@uncalibrated");
  expect(result.report).toContain("jev-1.13.0; uncalibrated proxy estimates");
  expect((await loadActiveTeachingRevision(result.store))?.id ?? null).toBe(result.experiment.candidateRevisionId);
  const receipt = await result.store.read<any>(`raw/${result.experiment.id}-judgement`);
  expect(receipt.backend).toEqual({ ...hosted, model: "jev-1.13.0" }); expect(receipt.calibration).toBe("uncalibrated"); expect(receipt.observations).toHaveLength(26);
  expect(result.experiment.frontier?.mode).toBe("ranked");
});

test("a critical regression rejects uncalibrated estimates despite positive aggregate improvement", async () => {
  const result = await run(runtime([{ key: hosted, call: async (request) => response(request, { ...hosted, model: "jev-1.13.0" }, "regression") }]));
  expect(result.experiment.status).toBe("rejected"); expect(result.experiment.reasons).toContain("critical_criterion_failed");
  expect(result.experiment.holdout).toBeNull(); expect(await loadActiveTeachingRevision(result.store)).toBeNull();
});

test("off and local-only settings never invoke hosted judgement or generate speculative tutor episodes", async () => {
  let tutor = 0, hostedCalls = 0;
  for (const backend of ["off", "local"] as const) {
    const judgementRuntime = runtime([{ key: hosted, call: async (request) => { hostedCalls++; return response(request, { ...hosted, model: "jev-1.13.0" }); } }], backend);
    await expect(runBrowserTeachingExperiment({} as Parameters<typeof runBrowserTeachingExperiment>[0], {
      cases, store: new MemoryStore(), judgementRuntime, episodeAdapters: { runner: async () => { tutor++; throw new Error(); }, complete: async () => "" },
    })).rejects.toThrow("evolution_judgement_unavailable");
  }
  expect(tutor).toBe(0); expect(hostedCalls).toBe(0);
});

test("a pinned experiment never escalates after its chosen local tier fails", async () => {
  let localCalls = 0, hostedCalls = 0;
  const result = await run(runtime([
    { key: local, call: async (request) => ++localCalls === 1 ? response(request, local) : { ok: false, error: { code: "backend-unavailable", retryable: false } } },
    { key: hosted, call: async (request) => { hostedCalls++; return response(request, { ...hosted, model: "jev-1.13.0" }); } },
  ]));
  expect(hostedCalls).toBe(0); expect(result.experiment.status).not.toBe("accepted");
  expect(result.experiment.candidateTraining?.meanScore).toBeNull(); expect(await loadActiveTeachingRevision(result.store)).toBeNull();
});

for (const failure of ["uncertain", "changed-model"] as const) test(`${failure} abstains without inventing a score or changing active revision`, async () => {
  let calls = 0;
  const result = await run(runtime([{ key: hosted, call: async (request) => {
    calls++;
    return response(request, { ...hosted, model: failure === "changed-model" && calls > 1 ? "jev-other" : "jev-1.13.0" }, failure === "uncertain" ? "uncertain" : "ok");
  } }]));
  expect(result.experiment.status).not.toBe("accepted"); expect(await loadActiveTeachingRevision(result.store)).toBeNull();
  const benchmark = failure === "uncertain" ? result.experiment.training : result.experiment.candidateTraining;
  expect(benchmark?.meanScore).toBeNull(); expect(benchmark?.results[0]?.status).toBe("judge-error");
});

test("production web spending review can defer before tutor generation using separately fitted skip evidence", async () => {
  const previous = await run(runtime([{ key: hosted, call: async request => response(request, { ...hosted, model: "jev-1.13.0" }, "regression") }]));
  const key: JudgementBackendKey = { backend: "system-one", model: "jev-1.13.0", calibrationSha256: "b".repeat(64) };
  let judgeCalls = 0, tutorCalls = 0;
  const initialRuntime = runtime([{ key, call: async request => {
    judgeCalls++;
    expect(Object.keys(request.questions).sort()).toEqual(["addressable", "failure", "skip"]);
    expect(JSON.stringify(request.state)).not.toContain("holdout-family");
    return { ok: true, response: { backend: key, answers: { skip: { type: "noul", noul: 0.99 }, failure: { type: "noul", noul: 0.01 }, addressable: { type: "noul", noul: 0.01 } } } };
  } }]);
  const configured = { ...initialRuntime, policy: { ...initialRuntime.policy, calibration: { entries: Object.fromEntries(Object.values(EVOLUTION_SPEND_QUESTIONS).map(question => [thresholdKey(key, questionDigest(question)), { deferBelow: 0.5, actAtOrAbove: 0.95 }])) } } };
  const markdown = await runBrowserTeachingExperiment({} as Parameters<typeof runBrowserTeachingExperiment>[0], {
    force: true, cases, store: previous.store, basePrompt: "Teach clearly.", judgementRuntime: configured, proposer,
    episodeAdapters: { runner: async () => { tutorCalls++; throw new Error("Must not generate"); }, complete: async () => { throw new Error("Must not propose"); } },
  });
  expect(judgeCalls).toBe(1); expect(tutorCalls).toBe(0); expect(markdown).toContain("spend_review_defer");
  const report = [...previous.store.values.entries()].filter(([name]) => name.startsWith("experiments/")).at(-1)![1] as TeachingExperiment;
  expect(report.spendReview?.status).toBe("defer"); expect(report.holdout).toBeNull(); expect(report.training).toBeNull();
});
