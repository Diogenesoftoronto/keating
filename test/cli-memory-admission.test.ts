import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createCliMemoryAdmissionController } from "../src/judgement/cli-memory-admission.js";
import { loadLearnerMemory, rememberLearnerMemory, type LearnerMemorySession } from "../src/core/learner-memory.js";
import { memoryAdmissionQuestions } from "../packages/learner-contracts/src/judgement/memory-admission.js";
import { questionDigest, type JudgementCaller } from "../packages/learner-contracts/src/judgement/contracts.js";
import { thresholdKey } from "../packages/learner-contracts/src/judgement/projections.js";
import type { NeedleMemoryResult } from "../src/retrieval/needle-memory.js";
import { loadLearnerContext } from "../src/core/learner-context.js";
import { configDir } from "../src/core/paths.js";
import { needleModelIdentity } from "../src/retrieval/needle-runtime.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const cwd = await mkdtemp(join(tmpdir(), "memory-admission-")); directories.push(cwd); return cwd; }
const TEXT = "I enjoy baking bread.";
const backend = { backend: "system-one" as const, model: "jev-1.13.0", calibrationSha256: "a".repeat(64) };
const questions = memoryAdmissionQuestions();
const calibration = { entries: Object.fromEntries(Object.values(questions).map(question => [thresholdKey(backend, questionDigest(question)), { deferBelow: 0.9, actAtOrAbove: 0.9 }])) };
function source() {
  let text = TEXT;
  const session: LearnerMemorySession = { getSessionId: () => "session", getBranch: () => [
    { type: "message", id: "assistant", message: { role: "assistant", content: "Do not retain assistant prose." } },
    { type: "message", id: "message", message: { role: "user", content: text } },
  ] };
  return { session, edit: (value: string) => { text = value; } };
}
function retrieval(): NeedleMemoryResult {
  return { facts: [], sourceSpans: [], model: "needle-pinned-model", proposals: [{ category: "interest", evidence: TEXT,
    quoteSha256: createHash("sha256").update(TEXT).digest("hex"), source: "observed", status: "tentative-not-saved",
    provenance: { sessionId: "session", messageId: "message", start: 0, end: TEXT.length } }] };
}
const caller: JudgementCaller = async () => ({ ok: true, response: { backend, answers: {
  worth: { type: "noul", noul: 0.97 }, category: { type: "choice", choice: "interest", confidence: 0.96,
    probabilities: Object.fromEntries(Object.keys(questions.category.criteria).map(key => [key, key === "interest" ? 1 : 0])) },
} } });
const options = { env: { KEATING_MEMORY_JUDGE: "notorganic" }, calibration, needleCurrent: async () => true,
  runtime: () => ({ call: caller, current: () => true }) };

test("calibrated background review persists exact observed memory with separate proxy provenance", async () => {
  const cwd = await directory(), { session } = source();
  const controller = createCliMemoryAdmissionController(cwd, options);
  expect(controller.enqueue(retrieval(), session)).toBeUndefined(); await controller.settled();
  expect(controller.status()).toMatchObject({ phase: "saved", savedCount: 1 });
  const facts = await loadLearnerMemory(cwd);
  expect(facts).toHaveLength(1); expect(facts[0]).toMatchObject({ value: TEXT, evidence: TEXT, source: "observed", confidence: 0.65 });
  expect(JSON.stringify(facts[0])).toContain('"source":"proxy"');
  expect(facts[0].provenance.messageId).toBe("message");
  const receipt = controller.status().receiptPath!;
  expect((await stat(receipt)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(receipt, "utf8"))).toMatchObject({ source: "proxy", outcome: { savedIds: [facts[0].id] } });
});

test("uncalibrated reviews retain raw decisions but cannot save memory", async () => {
  const cwd = await directory(), { session } = source();
  const controller = createCliMemoryAdmissionController(cwd, { ...options, calibration: undefined });
  controller.enqueue(retrieval(), session); await controller.settled();
  expect(controller.status()).toMatchObject({ phase: "reviewed", savedCount: 0 });
  expect(await loadLearnerMemory(cwd)).toEqual([]);
  expect(JSON.parse(await readFile(controller.status().receiptPath!, "utf8"))).toMatchObject({ decisions: [{ accepted: false, reason: "uncalibrated", probability: 0.97 }] });
});

test("the production default does no work without explicit opt-in and cannot use direct API overrides", async () => {
  const cwd = await directory(), { session } = source(); let calls = 0;
  const off = createCliMemoryAdmissionController(cwd, { ...options, env: {}, runtime: () => { calls++; return options.runtime(); } });
  off.enqueue(retrieval(), session); await off.settled(); expect(off.status().phase).toBe("off");
  const unavailable = createCliMemoryAdmissionController(cwd, { env: { KEATING_MEMORY_JUDGE: "notorganic", TYPESAFE_API_KEY: "do-not-send", KEATING_JUDGEMENT_DIRECT: "true" },
    needleCurrent: async () => true, transport: { loadCredential: () => null, fetch: async () => { calls++; throw new Error("must not call"); } } });
  unavailable.enqueue(retrieval(), session); await unavailable.settled(); expect(unavailable.status().phase).toBe("unavailable");
  expect(calls).toBe(0); expect(await loadLearnerMemory(cwd)).toEqual([]);
});

test("edited learner source, replaced account, configuration and reset invalidate late review", async () => {
  for (const changed of ["source", "account", "config", "reset"] as const) {
    const cwd = await directory(), s = source(); let current = true;
    const env = { KEATING_MEMORY_JUDGE: "notorganic" };
    let release!: () => void, begin!: () => void;
    const began = new Promise<void>(resolve => { begin = resolve; });
    const controller = createCliMemoryAdmissionController(cwd, { ...options, env,
      runtime: () => ({ current: () => current, call: async request => {
        begin(); await new Promise<void>(resolve => { release = resolve; }); return caller(request);
      } }) });
    controller.enqueue(retrieval(), s.session); await began;
    if (changed === "source") s.edit("I no longer enjoy baking bread.");
    if (changed === "account") current = false;
    if (changed === "config") env.KEATING_MEMORY_JUDGE = "off";
    if (changed === "reset") controller.reset();
    release(); await controller.settled(); expect(await loadLearnerMemory(cwd)).toEqual([]);
    expect(controller.status().phase).not.toBe("saved");
  }
});

test("concurrent explicit memory changes cannot be overwritten by a pending admission", async () => {
  const cwd = await directory(), { session } = source();
  const controller = createCliMemoryAdmissionController(cwd, { ...options, runtime: () => ({ current: () => true, call: async request => {
    await rememberLearnerMemory(cwd, { category: "interest", value: TEXT, evidence: TEXT, source: "explicit" }, session);
    return caller(request);
  } }) });
  controller.enqueue(retrieval(), session); await controller.settled();
  const facts = await loadLearnerMemory(cwd); expect(facts).toHaveLength(1); expect(facts[0].source).toBe("explicit");
  expect(controller.status().phase).not.toBe("saved");
});

test("default Needle freshness rejects config changes during judgement even when model identity stays the same", async () => {
  for (const changed of [false, true]) {
    const cwd = await directory(), { session } = source();
    const needle = { python: join(cwd, "python"), engine: join(cwd, "needle.so"), weights: join(cwd, "weights.cact"),
      engineSha256: "b".repeat(64), weightsSha256: "c".repeat(64) };
    const configPath = join(configDir(cwd), "needle-runtime.json");
    await mkdir(configDir(cwd), { recursive: true });
    await writeFile(configPath, JSON.stringify(needle));
    const result = { ...retrieval(), model: needleModelIdentity(needle) };
    let release!: () => void, begin!: () => void, calls = 0;
    const began = new Promise<void>(resolve => { begin = resolve; });
    const controller = createCliMemoryAdmissionController(cwd, { ...options, needleCurrent: undefined,
      runtime: () => ({ current: () => true, call: async request => {
        calls++; begin(); await new Promise<void>(resolve => { release = resolve; }); return caller(request);
      } }) });
    try {
      controller.enqueue(result, session); await began;
      if (changed) {
        const replacement = { ...needle, python: join(cwd, "replacement-python") };
        expect(needleModelIdentity(replacement)).toBe(result.model);
        await writeFile(configPath, JSON.stringify(replacement));
      }
      release(); await controller.settled();
      expect(calls).toBe(1);
      expect(await loadLearnerMemory(cwd)).toHaveLength(changed ? 0 : 1);
      if (changed) {
        expect(controller.status()).toMatchObject({ phase: "cancelled", reason: "source-changed" });
        expect(controller.status().receiptPath).toBeUndefined();
      } else expect(controller.status()).toMatchObject({ phase: "saved", savedCount: 1 });
    } finally { release?.(); controller.dispose(); }
  }
});

test("deadline releases background status while retaining the uncooperative provider lease", async () => {
  const cwd = await directory(), { session } = source(); let calls = 0, release!: () => void;
  const controller = createCliMemoryAdmissionController(cwd, { ...options, timeoutMs: 8,
    runtime: () => ({ current: () => true, call: async request => { calls++; await new Promise<void>(resolve => { release = resolve; }); return caller(request); } }) });
  controller.enqueue(retrieval(), session); await controller.settled();
  expect(controller.status().phase).toBe("cancelled");
  controller.enqueue(retrieval(), session); expect(controller.status().reason).toBe("review-busy");
  expect(calls).toBe(1); release(); await Promise.resolve();
  expect(await loadLearnerMemory(cwd)).toEqual([]);
});

test("forged hashes, assistant sources, incorrect offsets and oversized source messages never call judgement", async () => {
  for (const invalid of ["hash", "assistant", "offset", "large"] as const) {
    const cwd = await directory(), s = source(), result = retrieval(); let calls = 0;
    if (invalid === "hash") result.proposals[0].quoteSha256 = "0".repeat(64);
    if (invalid === "assistant") result.proposals[0].provenance.messageId = "assistant";
    if (invalid === "offset") result.proposals[0].provenance.start = 1;
    if (invalid === "large") s.edit(TEXT + "a".repeat(4000));
    const controller = createCliMemoryAdmissionController(cwd, { ...options, runtime: () => ({ current: () => true, call: async request => { calls++; return caller(request); } }) });
    controller.enqueue(result, s.session); await controller.settled(); expect(calls).toBe(0); expect(await loadLearnerMemory(cwd)).toEqual([]);
  }
});

test("changed or invalid configured calibration cannot fall back to an injected table", async () => {
  const cwd = await directory(), { session } = source(); let calls = 0;
  const controller = createCliMemoryAdmissionController(cwd, { ...options, env: { KEATING_MEMORY_JUDGE: "notorganic", KEATING_MEMORY_CALIBRATION_FILE: "missing.json", KEATING_MEMORY_CALIBRATION_FILE_SHA256: "a".repeat(64) },
    runtime: () => ({ current: () => true, call: async request => { calls++; return caller(request); } }) });
  controller.enqueue(retrieval(), session); await controller.settled(); expect(calls).toBe(0);
  expect(controller.status().phase).toBe("unavailable"); expect(await loadLearnerMemory(cwd)).toEqual([]);
});

test("actual learner-context retrieval callback admits a quote for subsequent context without waiting for review", async () => {
  const cwd = await directory(), { session } = source(); let release!: () => void, started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const controller = createCliMemoryAdmissionController(cwd, { ...options, runtime: () => ({ current: () => true, call: async request => {
    started(); await new Promise<void>(resolve => { release = resolve; }); return caller(request);
  } }) });
  const first = await loadLearnerContext(cwd, { query: "bread", session, runtime: { model: "needle-pinned-model", call: async input => ({
    model: "needle-pinned-model", vectors: input.texts.map(() => [1, 0, 0]),
    selections: (input.sources ?? []).map(source => ({ sourceId: source.id, quote: TEXT, category: "interest" })),
  }) }, onRetrieved: result => controller.enqueue(result, session) });
  expect(first).toContain("tentative-not-saved"); await began;
  expect(await loadLearnerMemory(cwd)).toEqual([]);
  release(); await controller.settled();
  const second = await loadLearnerContext(cwd);
  expect(second).toContain(TEXT); expect(second).toContain('"source":"observed"');
  expect(controller.status()).toMatchObject({ phase: "saved", savedCount: 1 });
});
