import { expect, test } from "bun:test";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { posix } from "node:path";
import { createContext, Script } from "node:vm";
import { NODEPOD_BOOT_FILES as files } from "../web/src/keating/nodepod-boot-files.js";

/** Execute the emitted CJS itself, not source TS or a NodePod/browser process.
 * The only host boundaries are deterministic in-memory files and safe built-ins.
 * Unknown imports and every attempted network call fail the test immediately.
 */
function workspace() {
  const saved = new Map<string, string>();
  let networkCalls = 0;
  const unavailable = (path: string) => Object.assign(new Error(`Missing fixture: ${path}`), { code: "ENOENT" });
  const fs = {
    readFile: async (path: string) => { if (!saved.has(path)) throw unavailable(path); return saved.get(path)!; },
    writeFile: async (path: string, value: string) => { saved.set(path, value); },
    mkdir: async () => {},
    readdir: async (path: string) => [...saved.keys()].filter(key => posix.dirname(key) === path).map(key => posix.basename(key)),
  };
  const builtins: Record<string, unknown> = {
    "node:crypto": { createHash, randomUUID, webcrypto },
    "node:fs/promises": fs,
    "node:fs": { realpathSync: (path: string) => path },
    "node:path": posix,
    "node:async_hooks": { AsyncLocalStorage },
  };
  const context = createContext({ crypto: webcrypto, structuredClone, TextEncoder, TextDecoder, Buffer, Error,
    AbortController, AbortSignal, setTimeout, clearTimeout,
    process: { env: { KEATING_READINESS_JUDGE: "notorganic", KEATING_LESSON_PLAN_JUDGE: "notorganic", KEATING_PROMPT_JUDGE: "notorganic", ARIZE_ENABLED: "true" }, platform: "linux" },
    fetch: () => { networkCalls++; throw new Error("Unexpected network dispatch"); },
  });
  const cache = new Map<string, { exports: any }>();
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path)!.exports;
    const source = files[path];
    if (!source) throw new Error(`Missing bundled module: ${path}`);
    const module = { exports: {} };
    cache.set(path, module);
    const require = (specifier: string) => {
      if (Object.hasOwn(builtins, specifier)) return builtins[specifier];
      if (!specifier.startsWith(".")) throw new Error(`Unexpected external module: ${specifier}`);
      return load(posix.normalize(posix.join(posix.dirname(path), specifier)));
    };
    new Script(`(function(module, exports, require) {\n${source}\n})`, { filename: path }).runInContext(context)(module, module.exports, require);
    return module.exports;
  }
  return { load, saved, networkCalls: () => networkCalls };
}

test("generated review wrappers have their direct CJS dependencies, without new account or evolution modules", () => {
  for (const path of ["src/judgement/cli-readiness.js", "src/judgement/cli-lesson-plan.js", "src/judgement/cli-prompt-evaluation.js", "src/judgement/cli-prompt-evolution.js"]) {
    expect(files[path]).toBeDefined();
    for (const match of files[path]!.matchAll(/require\("(\.[^"]+)"\)/g)) {
      expect(files[posix.normalize(posix.join(posix.dirname(path), match[1]!))]).toBeDefined();
    }
  }
  expect(files["src/judgement/notorganic.js"]).toBeUndefined();
  expect(files["src/judgement/cli-evolution.js"]).toBeUndefined();
  expect(files["shared/evolution/model-adapters.js"]).toBeUndefined();
  expect(files["src/judgement/transport.ts"]).not.toContain("AuthStorage");
  expect(files["src/core/pi-agent.js"]).not.toContain("require(");
});

test("generated pure readiness, lesson-plan and learner-turn modules execute their real dependency closure", async () => {
  const sandbox = workspace();
  const readiness = sandbox.load("shared/pedagogy/readiness-review.js");
  const result = await readiness.reviewStudyCandidates([{ id: "review", title: "Review", requirements: ["Explain"], due: true, covered: true,
    prerequisites: [], prerequisiteGraphKnown: true, work: [{ question: "Explain?", answer: "Because of the cause.", result: "correct" }] }],
  async () => ({ ok: true, response: { backend: { backend: "local", model: "fixture-v1", calibrationSha256: null }, answers: { candidate_0: { type: "noul", noul: .9 } } } }));
  expect(result).toMatchObject({ status: "uncalibrated", selectedId: null });
  expect(result.estimates[0].probability).toBe(.9);
  const lesson = sandbox.load("shared/pedagogy/lesson-plan-judgement.js");
  const review = await lesson.reviewLessonPlan({ id: "plan", title: "Plan", content: "Explain your answer and test it on a new example." }, async (request: any) => ({
    ok: true, response: { backend: { backend: "local", model: "fixture-v1", calibrationSha256: null },
      answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        const options = Object.keys((question as any).criteria);
        const selected = options.includes("attention") ? "attention" : options[0];
        return [id, { type: "choice", choice: selected, probabilities: Object.fromEntries(options.map(option => [option, option === selected ? 1 : 0])), confidence: 1 }];
      })),
    },
  }));
  expect(review.status).toBe("estimated");
  expect(review.findings).toHaveLength(5);
  expect(review.findings.every((finding: any) => finding.verdict === "attention" && finding.evidenceBlockId.startsWith("plan:0-"))).toBe(true);
  const signals = sandbox.load("shared/pedagogy/learner-turn-signal.js");
  expect(signals.classifyLearnerTurnSignal("Still wrong, even though that helps")).toBe("thumbs-down");
  expect(sandbox.networkCalls()).toBe(0);
});

test("opted-in generated wrappers abstain without loading credentials, network or a host Pi runtime", async () => {
  const sandbox = workspace();
  let credentialReads = 0;
  let fetches = 0;
  const options = { env: { KEATING_READINESS_JUDGE: "notorganic", KEATING_LESSON_PLAN_JUDGE: "notorganic", KEATING_PROMPT_JUDGE: "notorganic" },
    transport: { loadCredential: () => { credentialReads++; throw new Error("Credential access is forbidden"); }, fetch: async () => { fetches++; throw new Error("Network is forbidden"); } } };
  const transport = sandbox.load("src/judgement/transport.js");
  expect(transport.createCliJudgementBackend({ ...options.transport, env: options.env, cwd: "/workspace" })).toBeNull();
  const topics = sandbox.load("src/core/topics.js");
  const topic = topics.benchmarkTopics()[0];
  expect(topic).toBeDefined();
  const coveredTopics = [topic.slug, ...topic.prerequisites.map((name: string) => topics.resolveTopic(name).slug)].map(slug => ({ slug, sessionCount: 1 }));
  sandbox.saved.set("/workspace/.keating/state/learner.json", JSON.stringify({ coveredTopics }));
  sandbox.saved.set("/workspace/.keating/state/quiz-submissions/quiz-abcdefgh.json", JSON.stringify({ schemaVersion: 1, id: "quiz-abcdefgh", createdAt: "2026-09-01T00:00:00Z",
    quiz: { slug: topic.slug, questions: [{ id: "q1", question: "Explain the concept" }] }, answers: { q1: "An explanation" }, objectiveResults: { q1: true } }));
  const readiness = await sandbox.load("src/judgement/cli-readiness.js").reviewCliDueTopics("/workspace", [{ slug: topic.slug, title: topic.title, isDue: true }], options);
  expect(readiness).toMatchObject({ status: "unavailable", selectedId: null, stale: false, attempts: [] });
  expect(sandbox.saved.has(readiness.receiptPath)).toBe(true);
  const planPath = "/workspace/plan.md";
  sandbox.saved.set(planPath, "Explain the topic and show an example.");
  const lesson = await sandbox.load("src/judgement/cli-lesson-plan.js").reviewCliLessonPlan("/workspace", planPath, "Topic", options);
  expect(lesson.reviewStatus).toBe("unavailable");
  expect(JSON.parse(sandbox.saved.get(lesson.reviewReceiptPath)!)).toMatchObject({ reason: "backend-unavailable", findings: [] });
  const prompt = await sandbox.load("src/judgement/cli-prompt-evaluation.js").evaluateCliPrompt("/workspace", "Ask the learner to explain in their own words.", options);
  expect(prompt.judgement).toMatchObject({ status: "unavailable", reason: "backend-unavailable" });
  const evolution = sandbox.load("src/judgement/cli-prompt-evolution.js").createCliPromptEvolutionEvaluator("/workspace", options);
  await evolution.evaluator("/workspace", "/workspace/prompt.md", "Explain in your own words.");
  expect(evolution.receipt().source).toBe("heuristic");
  const pi = sandbox.load("src/core/pi-agent.js");
  await expect(pi.piComplete("/workspace", "prompt")).rejects.toThrow("host-execution-unavailable");
  await expect(pi.piCompleteJson("/workspace", "prompt")).rejects.toThrow("host-execution-unavailable");
  expect(credentialReads).toBe(0); expect(fetches).toBe(0); expect(sandbox.networkCalls()).toBe(0);
});

test("generated observation boundary retains normalization but never emits", async () => {
  const sandbox = workspace();
  const telemetry = sandbox.load("src/observability/arize.js");
  expect(sandbox.load("src/observability/types.js").EVALUATION_OBSERVATION_VERSION).toBe(2);
  expect(telemetry.classifyObservationError(new Error("cooldown"))).toBe("rejected");
  expect(telemetry.classifyObservationError(new Error("JSON parse failed"))).toBe("parse");
  await telemetry.exportEvaluationObservation({}); await telemetry.exportProviderCompletion({});
  expect(sandbox.networkCalls()).toBe(0);
});


test("generated lazy evolution import resolves to an explicit host boundary without evaluator authority", async () => {
  const sandbox = workspace();
  const module = sandbox.load("src/core/teaching-evolution.js");
  await expect(module.teachingEvolutionArtifact("/workspace", { force: true })).rejects.toThrow("host-execution-unavailable");
  await expect(module.teachingBenchmarkArtifact("/workspace")).rejects.toThrow("host-execution-unavailable");
  expect(files["src/core/teaching-evolution.js"]).not.toContain("require(");
  expect(files["src/core/teaching-evolution-store.js"]).toBeUndefined();
  expect(files["shared/evolution/cases.js"]).toBeUndefined();
  expect(sandbox.networkCalls()).toBe(0);
});
