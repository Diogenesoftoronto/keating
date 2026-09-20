import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadLearnerContext } from "../src/core/learner-context.js";
import { createHash } from "node:crypto";
import { memoryAdmissionQuestions, type MemoryAdmissionDecision } from "../packages/learner-contracts/src/judgement/memory-admission.js";
import { learnerMemoryPath } from "../src/core/paths.js";
import type { LearnerMemoryFact, LearnerMemorySession } from "../src/core/learner-memory.js";
import type { NeedleMemoryOptions, NeedleMemoryResult } from "../src/retrieval/needle-memory.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function workspace() { const path = await mkdtemp(join(tmpdir(), "needle-admission-integration-")); directories.push(path); return path; }
function retrieval(count = 1, size = 40): NeedleMemoryOptions {
  const session: LearnerMemorySession = {
    getSessionId: () => "real-session",
    getBranch: () => Array.from({ length: count }, (_, index) => ({ type: "message", id: `learner-${index}`,
      message: { role: "user", content: `I enjoy baking ${index}. `.padEnd(size, "x") } })),
  };
  return { query: "baking", session, runtime: { model: "needle-fixture", call: async input => ({ model: "needle-fixture",
    vectors: input.texts.map(() => [1, 0]),
    selections: (input.sources ?? []).map(source => ({ sourceId: source.id, category: "interest", quote: source.text })),
  }) } };
}
function recall(context: string) {
  return JSON.parse(context.split("\n").at(-2)!).localRecall as { tentativeNotSaved: Array<{ evidence: string }> };
}

test("admission observer cannot hold baseline context open", async () => {
  let started = false;
  const context = await loadLearnerContext(await workspace(), { ...retrieval(), onRetrieved: async () => {
    started = true;
    await new Promise<void>(() => {});
  } });
  expect(started).toBe(true);
  expect(context).toContain("I enjoy baking 0.");
}, 1000);

test("observer receives complete proposal snapshot before context budget trimming", async () => {
  let captured: NeedleMemoryResult | undefined;
  const context = await loadLearnerContext(await workspace(), { ...retrieval(4, 500), onRetrieved: result => { captured = result; } });
  expect(captured?.proposals).toHaveLength(4);
  expect(captured?.proposals.every(proposal => proposal.evidence.length === 500)).toBe(true);
  expect(recall(context).tentativeNotSaved.length).toBeLessThan(4);
  expect(captured?.proposals).toHaveLength(4);
});

test("observer mutations cannot rewrite the learner context", async () => {
  const context = await loadLearnerContext(await workspace(), { ...retrieval(), onRetrieved: result => {
    result.proposals[0]!.evidence = "Forged fact";
    result.sourceSpans[0]!.quote = "Forged quote";
  } });
  expect(context).not.toContain("Forged");
  expect(recall(context).tentativeNotSaved[0]?.evidence).toContain("I enjoy baking 0.");
});

test("synchronous and asynchronous observer failures preserve baseline context", async () => {
  for (const onRetrieved of [() => { throw new Error("observer failed"); }, async () => { throw new Error("observer rejected"); }]) {
    const context = await loadLearnerContext(await workspace(), { ...retrieval(), onRetrieved });
    expect(context).toContain("I enjoy baking 0.");
    expect(context).not.toContain("observer failed");
  }
});

test("disabled retrieval never starts admission", async () => {
  let calls = 0;
  const context = await loadLearnerContext(await workspace(), { onRetrieved: () => { calls++; } });
  expect(calls).toBe(0);
  expect(context).toContain("<keating-learner-context>");
});


function memoryFact(index: number, patch: Partial<LearnerMemoryFact> = {}): LearnerMemoryFact {
  const evidence = `Exact learner statement ${index}: <baking> `.padEnd(450, "x");
  return { id: `lm-00000000-0000-0000-0000-${String(index).padStart(12, "0")}`, category: "interest", value: `Interest ${index}`,
    evidence, source: "observed", confidence: 0.45, createdAt: 1, updatedAt: index,
    provenance: { sessionId: "saved-session", messageId: `real-message-${index}`, quoteSha256: createHash("sha256").update(evidence).digest("hex") }, ...patch };
}
async function saveFacts(cwd: string, facts: LearnerMemoryFact[]) {
  const path = learnerMemoryPath(cwd); await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ schemaVersion: 1, facts }), { mode: 0o600 });
}
function contextData(context: string): { activeProfileFacts: LearnerMemoryFact[]; truncated: boolean } {
  return JSON.parse(context.split("\n").at(-2)!);
}

test("saved memory budget retains whole quotes and provenance, with explicit facts first", async () => {
  const cwd = await workspace();
  const explicit = memoryFact(1, { source: "explicit", confidence: 1, updatedAt: 1 });
  const bestObserved = memoryFact(2, { confidence: 0.65, updatedAt: 2 });
  const facts = [explicit, bestObserved, ...Array.from({ length: 38 }, (_, index) => memoryFact(index + 3))];
  await saveFacts(cwd, facts);
  const data = contextData(await loadLearnerContext(cwd));
  expect(JSON.stringify(data.activeProfileFacts).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").length).toBeLessThanOrEqual(4000);
  expect(data.truncated).toBe(true);
  expect(data.activeProfileFacts.map(fact => fact.id).slice(0, 2)).toEqual([explicit.id, bestObserved.id]);
  expect(data.activeProfileFacts.length).toBeLessThan(facts.length);
  for (const fact of data.activeProfileFacts) {
    const original = facts.find(row => row.id === fact.id)!;
    expect(fact.evidence).toBe(original.evidence);
    expect(fact.provenance).toEqual(original.provenance);
  }
});

test("no-recall priority has stable confidence, recency and ID ties", async () => {
  const cwd = await workspace();
  const facts = [memoryFact(3, { confidence: 0.6, updatedAt: 10 }), memoryFact(2, { confidence: 0.6, updatedAt: 10 }),
    memoryFact(1, { source: "explicit", confidence: 1, updatedAt: 0 }), memoryFact(4, { confidence: 0.65, updatedAt: 1 })];
  await saveFacts(cwd, facts);
  const first = contextData(await loadLearnerContext(cwd));
  await saveFacts(cwd, [...facts].reverse());
  const second = contextData(await loadLearnerContext(cwd));
  expect(first.activeProfileFacts.map(fact => fact.id)).toEqual([facts[2]!.id, facts[3]!.id, facts[1]!.id, facts[0]!.id]);
  expect(second.activeProfileFacts).toEqual(first.activeProfileFacts);
  expect(first.truncated).toBe(false);
});

test("Needle relevance order is preserved when the memory budget trims its tail", async () => {
  const cwd = await workspace();
  const facts = Array.from({ length: 12 }, (_, index) => memoryFact(index + 1));
  await saveFacts(cwd, facts);
  const context = await loadLearnerContext(cwd, { query: "rank", runtime: { model: "deterministic-embedding-fixture",
    call: async input => ({ model: "deterministic-embedding-fixture", selections: [], vectors: input.texts.map((text, index) => {
      if (index === 0) return [1, 0];
      const position = facts.findIndex(fact => fact.evidence === text) + 1;
      return [position, 1];
    }) }),
  } });
  const data = contextData(context);
  expect(data.activeProfileFacts.length).toBeLessThan(facts.length);
  expect(data.activeProfileFacts.map(fact => fact.id)).toEqual([...facts].reverse().slice(0, data.activeProfileFacts.length).map(fact => fact.id));
  expect(data.truncated).toBe(true);
});


function judgedMemory(index: number, probability: number, updatedAt: number, options: { model?: string; calibration?: string; rubric?: string; size?: number } = {}): LearnerMemoryFact {
  const evidence = `I prefer example ${index}.`.padEnd(options.size ?? 240, "x");
  const questions = structuredClone(memoryAdmissionQuestions());
  if (options.rubric) questions.worth = { ...questions.worth, instructions: options.rubric };
  const judgement: MemoryAdmissionDecision = {
    candidate: { id: `candidate-${index}`, evidence, message: evidence, sessionId: "saved-session", messageId: `real-message-${index}`, start: 0, end: evidence.length },
    source: "proxy", accepted: true, reason: "accepted", category: "interest", probability,
    backend: { backend: "system-one", model: options.model ?? "jev-1.13.0", calibrationSha256: (options.calibration ?? "a").repeat(64) }, questions,
    answers: { worth: { type: "noul", noul: probability }, category: { type: "choice", choice: "interest", confidence: 1,
      probabilities: Object.fromEntries(Object.keys(questions.category.criteria).map(key => [key, key === "interest" ? 1 : 0])) } },
    thresholds: { worth: { deferBelow: 0.5, actAtOrAbove: 0.8 }, category: { deferBelow: 0.5, actAtOrAbove: 0.8 } },
  };
  return memoryFact(index, { value: evidence, evidence, confidence: 0.65, updatedAt, judgement,
    provenance: { sessionId: "saved-session", messageId: `real-message-${index}`, quoteSha256: createHash("sha256").update(evidence).digest("hex") } });
}

test("memory cut ranks full worth only inside comparable slots, protecting other sources", async () => {
  const cwd = await workspace();
  const explicit = memoryFact(1, { source: "explicit", confidence: 1, updatedAt: 0 });
  const unknown = memoryFact(2, { confidence: 0.65, updatedAt: 1000 });
  const otherModel = judgedMemory(3, 0.81, 900, { model: "other-model", size: 30 });
  const otherFit = judgedMemory(4, 0.82, 800, { calibration: "b", size: 30 });
  const otherRubric = judgedMemory(5, 0.83, 700, { rubric: "Earlier worth rubric", size: 30 });
  const low = judgedMemory(6, 0.81, 600);
  const high = judgedMemory(7, 0.99, 1);
  const fillers = Array.from({ length: 8 }, (_, index) => judgedMemory(index + 8, 0.85, 500 - index));
  const facts = [high, ...fillers, low, otherRubric, otherFit, otherModel, unknown, explicit];
  await saveFacts(cwd, facts);
  const data = contextData(await loadLearnerContext(cwd));
  expect(data.activeProfileFacts.map(fact => fact.id).slice(0, 5)).toEqual([explicit.id, unknown.id, otherModel.id, otherFit.id, otherRubric.id]);
  expect(data.activeProfileFacts.map(fact => fact.id)).toContain(high.id);
  expect(data.activeProfileFacts.map(fact => fact.id)).not.toContain(low.id);
  expect(data.truncated).toBe(true);
  expect(JSON.stringify(data.activeProfileFacts).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").length).toBeLessThanOrEqual(4000);
  await saveFacts(cwd, [...facts].reverse());
  expect(contextData(await loadLearnerContext(cwd)).activeProfileFacts).toEqual(data.activeProfileFacts);
});
