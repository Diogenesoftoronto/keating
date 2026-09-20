import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needleLearnerSpans, needleRelativeScores, retrieveNeedleMemory } from "../src/retrieval/needle-memory.js";
import { needleTextHash, type NeedleRuntimeInput } from "../src/retrieval/needle-runtime.js";
import { rememberLearnerMemory, type LearnerMemoryFact, type LearnerMemorySession } from "../src/core/learner-memory.js";
import { loadLearnerContext } from "../src/core/learner-context.js";
import { ensureProjectScaffold } from "../src/core/project.js";
import { learnerMemoryPath } from "../src/core/paths.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const cwd = await mkdtemp(join(tmpdir(), "needle-memory-test-")); directories.push(cwd); return cwd; }
const USER_TEXT = "I prefer diagrams. I enjoy baking bread.";
function session(text = USER_TEXT): LearnerMemorySession {
  return { getSessionId: () => "learner-session", getBranch: () => [
    { type: "message", id: "assistant-id", message: { role: "assistant", content: "Invented learner fact: rocket scientist." } },
    { type: "message", id: "tool-id", message: { role: "toolResult", content: "Private tool output" } },
    { type: "message", id: "user-id", message: { role: "user", content: text } },
  ] };
}
const vector = (text: string) => text.toLowerCase().includes("bread") ? [1, 0, 0] : [0, 1, 0];
function runtime(calls: NeedleRuntimeInput[] = [], extra?: { category: string; quote: string }) {
  return { model: "needle-test-v1", call: async (input: NeedleRuntimeInput) => {
    calls.push(input);
    return { model: "needle-test-v1", vectors: input.texts.map(vector), selections: input.sources?.map(source => ({
      sourceId: source.id, category: extra?.category ?? "interest", quote: extra?.quote ?? "baking bread",
    })) ?? [] };
  } };
}
function fact(id: string, evidence: string): LearnerMemoryFact {
  return { id, category: "interest", value: evidence, evidence, source: "explicit", confidence: 1, createdAt: 0, updatedAt: 0,
    provenance: { sessionId: "saved-session", messageId: id, quoteSha256: needleTextHash(evidence) } };
}

test("only exact user spans are eligible; assistant and tool content never enter Needle", async () => {
  const cwd = await directory(); const calls: NeedleRuntimeInput[] = [];
  const result = await retrieveNeedleMemory(cwd, [], { query: "bread", session: session(), runtime: runtime(calls) });
  expect(JSON.stringify(calls)).not.toContain("rocket scientist");
  expect(JSON.stringify(calls)).not.toContain("Private tool output");
  expect(result?.sourceSpans[0].quote).toBe(USER_TEXT);
  expect(result?.proposals[0]).toMatchObject({ evidence: "baking bread", status: "tentative-not-saved", source: "observed" });
  const proposal = result!.proposals[0];
  expect(proposal.quoteSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(USER_TEXT.slice(proposal.provenance.start, proposal.provenance.end)).toBe(proposal.evidence);
  expect(await stat(join(cwd, ".keating/state/needle-index.json")).then(info => info.mode & 0o777)).toBe(0o600);
});

test("hallucinated paraphrases and unknown categories cannot become memory proposals", async () => {
  const cwd = await directory();
  expect((await retrieveNeedleMemory(cwd, [], { query: "bread", session: session(), runtime: runtime([], { category: "interest", quote: "I am a talented baker" }) }))?.proposals).toEqual([]);
  expect((await retrieveNeedleMemory(cwd, [], { query: "bread", session: session(), runtime: runtime([], { category: "ability", quote: "baking bread" }) }))?.proposals).toEqual([]);
});

test("persistent index reuses only exact source and model identity; deleted facts disappear", async () => {
  const cwd = await directory(); const calls: NeedleRuntimeInput[] = [];
  const saved = [fact("bread-id", "baking bread"), fact("music-id", "piano")];
  const options = { query: "bread", runtime: runtime(calls) };
  expect((await retrieveNeedleMemory(cwd, saved, options))?.facts[0].id).toBe("bread-id");
  await retrieveNeedleMemory(cwd, saved, options);
  expect(calls[1].texts).toEqual(["bread"]);
  await retrieveNeedleMemory(cwd, [fact("music-id", "violin")], options);
  expect(calls[2].texts).toEqual(["bread", "violin"]);
  const index = JSON.parse(await readFile(join(cwd, ".keating/state/needle-index.json"), "utf8"));
  expect(index.entries.map((entry: any) => entry.id)).toEqual(["music-id"]);
  const changedModel = { model: "needle-test-v2", call: async (input: NeedleRuntimeInput) => { calls.push(input); return { model: "needle-test-v2", vectors: input.texts.map(vector), selections: [] }; } };
  await retrieveNeedleMemory(cwd, [fact("music-id", "violin")], { query: "bread", runtime: changedModel });
  expect(calls[3].texts).toEqual(["bread", "violin"]);
});

test("cosine rankings are corpus-relative, not raw-cosine confidence thresholds", () => {
  const scores = needleRelativeScores([[1, 0], [0.99, 0.01], [0.8, 0.2]], [1, 0]);
  expect(scores[0]).toBeGreaterThan(scores[1]);
  expect(scores[1]).toBeGreaterThan(scores[2]);
  expect(scores.reduce((sum, score) => sum + score, 0)).toBeCloseTo(0, 8);
  expect(needleRelativeScores([[0, 0]], [1, 0])).toEqual([0]);
});

test("runtime unavailable or malformed vectors preserve the existing durable context", async () => {
  const cwd = await directory(); await ensureProjectScaffold(cwd);
  await rememberLearnerMemory(cwd, { category: "interest", source: "explicit", value: "Enjoys baking", evidence: "baking bread" }, session());
  const baseline = await loadLearnerContext(cwd);
  for (const call of [async () => null, async () => { throw Error("private model output"); }, async () => ({ model: "wrong-model", vectors: [[1]], selections: [] })]) {
    expect(await loadLearnerContext(cwd, { query: "bread", session: session(), runtime: { model: "needle-test-v1", call } })).toBe(baseline);
  }
});

test("production context contains bounded exact recall and never writes model proposals to durable memory", async () => {
  const cwd = await directory(); await ensureProjectScaffold(cwd);
  await rememberLearnerMemory(cwd, { category: "interest", source: "explicit", value: "Enjoys baking", evidence: "baking bread" }, session());
  const before = await readFile(learnerMemoryPath(cwd), "utf8");
  const text = await loadLearnerContext(cwd, { query: "bread", session: session(), runtime: runtime() });
  expect(text).toContain('"tentative-not-saved"');
  expect(text).toContain('"quote":"I prefer diagrams. I enjoy baking bread."');
  expect(text).toContain("Relative scores are rankings, not confidence");
  expect(await readFile(learnerMemoryPath(cwd), "utf8")).toBe(before);
  expect(text.length).toBeLessThan(16_000);
  const encoded = JSON.parse(text.slice(text.indexOf('\n{"schemaVersion"') + 1, text.lastIndexOf("\n</keating-learner-context>")));
  expect(JSON.stringify(encoded.localRecall).length).toBeLessThanOrEqual(4000);
});

test("source windows preserve exact offsets even for long Unicode learner text", () => {
  const text = "🍞 Bread and diagrams. ".repeat(140);
  for (const span of needleLearnerSpans(session(text))) {
    expect(text.slice(span.provenance.start, span.provenance.end)).toBe(span.text);
    expect(needleTextHash(span.text)).toBe(span.quoteSha256);
  }
});
