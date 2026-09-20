import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitJudgedLearnerMemory, learnerMemoryDigest, loadLearnerMemory, rememberLearnerMemory, type LearnerMemoryFact } from "../src/core/learner-memory.js";
import { learnerMemoryPath } from "../src/core/paths.js";
import { memoryAdmissionQuestions, type MemoryAdmissionDecision } from "../packages/learner-contracts/src/judgement/memory-admission.js";
import { questionDigest, type JudgementBackendKey } from "../packages/learner-contracts/src/judgement/contracts.js";
import { thresholdKey, type CalibrationTable } from "../packages/learner-contracts/src/judgement/projections.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const backend: JudgementBackendKey = { backend: "system-one", model: "jev-1.13.0", calibrationSha256: "a".repeat(64) };
function calibration(key = backend): CalibrationTable {
  return { entries: Object.fromEntries(Object.values(memoryAdmissionQuestions()).map(question => [thresholdKey(key, questionDigest(question)), { deferBelow: 0.5, actAtOrAbove: 0.8 }])) };
}
function decision(id: string, probability = 0.9, key = backend): MemoryAdmissionDecision {
  const evidence = `I prefer ${id} examples.`; const questions = memoryAdmissionQuestions();
  return { candidate: { id, evidence, message: evidence, sessionId: "session", messageId: `message-${id}`, start: 0, end: evidence.length },
    source: "proxy", accepted: true, reason: "accepted", category: "learning-preference", probability, backend: key, questions,
    answers: { worth: { type: "noul", noul: probability }, category: { type: "choice", choice: "learning-preference", confidence: 1,
      probabilities: Object.fromEntries(Object.keys(questions.category.criteria).map(key => [key, key === "learning-preference" ? 1 : 0])) } },
    thresholds: { worth: { deferBelow: 0.5, actAtOrAbove: 0.8 }, category: { deferBelow: 0.5, actAtOrAbove: 0.8 } } };
}
function session(decisions: MemoryAdmissionDecision[]) {
  return { getSessionId: () => "session", getBranch: () => decisions.map(decision => ({ id: decision.candidate.messageId, type: "message",
    message: { role: "user", content: [{ type: "text", text: decision.candidate.message }] } })) };
}
async function workspace() { const cwd = await mkdtemp(join(tmpdir(), "keating-memory-admit-")); directories.push(cwd); return cwd; }
const options = () => ({ calibration: calibration(), isCurrent: () => true });

test("admission preserves uncapped proxy judgement, exact selected source and capped observed confidence", async () => {
  const cwd = await workspace(); const row = decision("diagrams", 0.97);
  const result = await admitJudgedLearnerMemory(cwd, [row], session([row]), { ...options(), expectedMemorySha256: learnerMemoryDigest([]) });
  expect(result.saved).toHaveLength(1); expect(result.evictedIds).toEqual([]);
  expect(result.saved[0]).toMatchObject({ value: row.candidate.evidence, source: "observed", confidence: 0.65,
    judgement: { source: "proxy", probability: 0.97, backend } });
  expect(await loadLearnerMemory(cwd)).toEqual(result.saved);
  const before = await readFile(learnerMemoryPath(cwd), "utf8");
  expect((await admitJudgedLearnerMemory(cwd, [decision("diagrams", 0.9)], session([row]), options())).skipped).toBe(1);
  expect(await readFile(learnerMemoryPath(cwd), "utf8")).toBe(before);
});

test("capacity evicts only strictly lower comparable observed rank and protects explicit, unknown and other-model facts", async () => {
  const cwd = await workspace(); const seed = decision("seed", 0.81);
  const first = (await admitJudgedLearnerMemory(cwd, [seed], session([seed]), options())).saved[0]!;
  const explicit: LearnerMemoryFact = { ...structuredClone(first), id: `lm-${randomUUID()}`, source: "explicit", confidence: 1 }; delete explicit.judgement;
  const unknown: LearnerMemoryFact = { ...structuredClone(explicit), id: `lm-${randomUUID()}`, source: "observed", confidence: 0.65 };
  const facts = [first, unknown, ...Array.from({ length: 126 }, (_, i) => ({ ...structuredClone(explicit), id: `lm-${randomUUID()}`, value: `Explicit ${i}` }))];
  await writeFile(learnerMemoryPath(cwd), JSON.stringify({ schemaVersion: 1, facts }));
  const next = decision("new", 0.99);
  const result = await admitJudgedLearnerMemory(cwd, [next], session([next]), options());
  expect(result.evictedIds).toEqual([first.id]); expect(result.saved).toHaveLength(1);
  const loaded = await loadLearnerMemory(cwd); expect(loaded).toHaveLength(128); expect(loaded.some(fact => fact.id === unknown.id)).toBe(true);
  expect(loaded.filter(fact => fact.source === "explicit")).toHaveLength(126);
  const other = decision("other", 1, { ...backend, model: "jev-1.14.0" });
  expect((await admitJudgedLearnerMemory(cwd, [other], session([other]), { ...options(), calibration: calibration(other.backend!) })).skipped).toBe(1);
  const equal = decision("equal", 0.99);
  expect((await admitJudgedLearnerMemory(cwd, [equal], session([equal]), options())).skipped).toBe(1);
});

test("explicit duplicate cannot be overwritten and ordinary explicit corrections remove obsolete judgement metadata", async () => {
  const cwd = await workspace(); const row = decision("diagrams"); const source = session([row]);
  await rememberLearnerMemory(cwd, { category: "learning-preference", value: row.candidate.evidence, evidence: row.candidate.evidence, source: "explicit" }, source);
  expect((await admitJudgedLearnerMemory(cwd, [row], source, options())).skipped).toBe(1);
  expect((await loadLearnerMemory(cwd))[0]!.source).toBe("explicit");
  const other = decision("pictures"); await admitJudgedLearnerMemory(cwd, [other], session([other]), options());
  await rememberLearnerMemory(cwd, { category: "learning-preference", value: other.candidate.evidence, evidence: other.candidate.evidence, source: "explicit" }, session([other]));
  const upgraded = (await loadLearnerMemory(cwd)).find(fact => fact.value === other.candidate.evidence)!;
  expect(upgraded.source).toBe("explicit"); expect(upgraded.judgement).toBeUndefined();
});

test("wrong exact message, modified source, aliases and uncalibrated accepted flags fail without partial admission", async () => {
  for (const mode of ["message", "source", "alias", "uncalibrated"] as const) {
    const cwd = await workspace(); const one = decision("one"); const two = decision("two"); const source = session([one, structuredClone(two)]);
    if (mode === "message") two.candidate.messageId = "missing";
    if (mode === "source") two.candidate.message = `Changed ${two.candidate.message}`;
    if (mode === "alias") two.backend = { ...backend, model: "latest" };
    await expect(admitJudgedLearnerMemory(cwd, [one, two], source, { ...options(), ...(mode === "uncalibrated" ? { calibration: { entries: {} } } : {}) })).rejects.toThrow();
    expect(await loadLearnerMemory(cwd)).toEqual([]);
  }
});

test("snapshot mismatch and freshness loss immediately before rename leave original bytes intact", async () => {
  const cwd = await workspace(); const first = decision("first"); await admitJudgedLearnerMemory(cwd, [first], session([first]), options());
  const before = await readFile(learnerMemoryPath(cwd), "utf8"); const next = decision("next");
  await expect(admitJudgedLearnerMemory(cwd, [next], session([next]), { ...options(), expectedMemorySha256: learnerMemoryDigest([]) })).rejects.toThrow("source_changed");
  let checks = 0;
  await expect(admitJudgedLearnerMemory(cwd, [next], session([next]), { ...options(), isCurrent: () => ++checks < 6 })).rejects.toThrow("source_changed");
  expect(checks).toBe(6); expect(await readFile(learnerMemoryPath(cwd), "utf8")).toBe(before);
});

test("symlink source files and tampered judgement provenance are rejected", async () => {
  const cwd = await workspace(); const row = decision("one"); await admitJudgedLearnerMemory(cwd, [row], session([row]), options());
  const path = learnerMemoryPath(cwd); const original = await readFile(path, "utf8");
  const value = JSON.parse(original); value.facts[0].judgement.probability = 0.99; await writeFile(path, JSON.stringify(value));
  await expect(loadLearnerMemory(cwd)).rejects.toThrow("invalid_judgement");
  const target = join(cwd, "redirect.json"); await writeFile(target, original); await rm(path); await symlink(target, path);
  await expect(loadLearnerMemory(cwd)).rejects.toThrow();
  await expect(admitJudgedLearnerMemory(cwd, [decision("two")], session([decision("two")]), options())).rejects.toThrow();
});

test("older rubric receipts remain readable but cannot authorize current admission or comparable eviction", async () => {
  const cwd = await workspace(); const row = decision("old", 0.8);
  const saved = (await admitJudgedLearnerMemory(cwd, [row], session([row]), options())).saved[0]!;
  const historical = structuredClone(saved);
  (historical.judgement!.questions.worth as { instructions: string }).instructions = "An earlier independently fitted memory-worth rubric.";
  const facts = Array.from({ length: 128 }, (_, index) => ({ ...structuredClone(historical), id: `lm-${randomUUID()}`, value: historical.value }));
  await writeFile(learnerMemoryPath(cwd), JSON.stringify({ schemaVersion: 1, facts }));
  expect(await loadLearnerMemory(cwd)).toHaveLength(128);
  const next = decision("new", 1);
  expect((await admitJudgedLearnerMemory(cwd, [next], session([next]), options())).skipped).toBe(1);
  await expect(admitJudgedLearnerMemory(cwd, [historical.judgement!], session([historical.judgement!]), options())).rejects.toThrow("invalid_admission");
});
