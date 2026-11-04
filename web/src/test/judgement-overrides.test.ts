import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { memoryAdmissionQuestions, questionDigest, thresholdKey, type JudgementCaller, type MemoryAdmissionCandidate, type MemoryAdmissionDecision } from "@keating/learner-contracts";
import { applyWebMemoryOverride, createIndexedDbWebMemoryStore, createWebMemoryAdmission, type MemoryOverride } from "../keating/judgement/memory-admission";
import { retryPendingMemoryLabels, saveCheckLabel, saveMemoryLabel, type JudgementLabelDeps } from "../keating/judgement/judgement-labels";
import type { JudgementLabelRecord, TurnMemoryDecision } from "../keating/judgement/turn-records";
import type { NeedleSessionStore } from "../keating/needle-retrieval";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

const backend = { backend: "system-one" as const, model: "jev-1.13.0", calibrationSha256: "a".repeat(64) };
const calibration = { entries: Object.fromEntries(Object.values(memoryAdmissionQuestions()).map(question => [thresholdKey(backend, questionDigest(question)), { deferBelow: 0.7, actAtOrAbove: 0.9 }])) };
const answer: JudgementCaller = async () => ({ ok: true, response: { backend, answers: {
  worth: { type: "noul", noul: 0.96 }, category: { type: "choice", choice: "interest", confidence: 0.95,
    probabilities: Object.fromEntries(Object.keys(memoryAdmissionQuestions().category.criteria).map(key => [key, key === "interest" ? 1 : 0])) },
} } });
const learner = { id: "learner", role: "user", content: "I enjoy astronomy. I study at night.", timestamp: 1 };
const candidate = (evidence: string): MemoryAdmissionCandidate => {
  const start = learner.content.indexOf(evidence);
  return { id: `id:${evidence}`, evidence, sessionId: "past", messageId: "learner", message: learner.content, start, end: start + evidence.length };
};

function fixture() {
  const sessions: NeedleSessionStore = { async getAllMetadata() { return [{ id: "past" }]; }, async loadSession(id) { return id === "past" ? { id, messages: [structuredClone(learner)] } : null; } };
  const store = createIndexedDbWebMemoryStore(new IDBFactory());
  const decisions: { decisions: readonly MemoryAdmissionDecision[]; committed: boolean }[] = [];
  const runtime = (): WebJudgementRuntime => ({ settings: { backend: "hosted", localModelId: "local-model", gatewayPath: "/api/judgement" },
    policy: { calibration, tiers: [{ key: backend, call: answer }] } });
  const memory = createWebMemoryAdmission({ sessions, store, timeoutMs: 1000, enabled: () => true, current: () => true, requestIdentity: () => "turn",
    account: { current: () => "account-a", refresh: async () => {} }, runtime: async () => ({ runtime: runtime(), current: () => true }),
    subscribe: () => () => {}, onDecisions: (rows, _scope, committed) => decisions.push({ decisions: rows, committed }) });
  const admit = async (evidence: string) => { memory.reviewExtracted([candidate(evidence)], "extractor", () => true); await memory.settled(); };
  return { memory, store, admit, decisions };
}

test("a reviewer rejection removes the memory from later prompts and blocks its re-admission", async () => {
  const f = fixture();
  await f.admit("I enjoy astronomy.");
  expect(f.decisions[0]).toMatchObject({ committed: true });
  expect(await f.memory.prompt()).toContain("I enjoy astronomy.");
  await applyWebMemoryOverride("account-a", { kind: "reject", candidateId: "id:I enjoy astronomy." }, f.store);
  expect(await f.memory.prompt()).toBe("");
  await f.admit("I enjoy astronomy.");
  expect((await f.store.read("account-a")).bank).toEqual([]);
  expect(await f.memory.prompt()).toBe("");
  f.memory.dispose();
});

test("a reviewer admission appears as a reviewer row and disappears when its source changes", async () => {
  const f = fixture();
  await applyWebMemoryOverride("account-a", { kind: "admit", candidate: candidate("I study at night."), category: "study-context" }, f.store);
  const prompt = await f.memory.prompt();
  expect(prompt).toContain('"source":"reviewer"');
  expect(prompt).toContain("I study at night.");
  expect(prompt).toContain("confirmed by a human reviewer");
  await applyWebMemoryOverride("account-a", { kind: "clear", candidateId: "id:I study at night." }, f.store);
  expect(await f.memory.prompt()).toBe("");
  // Another account's bank is untouched.
  expect((await f.store.read("account-b")).overrides).toEqual({ rejected: [], admitted: [] });
  f.memory.dispose();
});

function labelDeps(scope: string | null) {
  const labels = new Map<string, JudgementLabelRecord>();
  const applied: { scope: string; change: MemoryOverride }[] = [];
  const deps: JudgementLabelDeps = {
    storage: { putJudgementLabel: async record => { labels.set(record.id, record); }, deleteJudgementLabel: async id => { labels.delete(id); } },
    memoryScope: async () => scope, applyMemory: async (target, change) => { applied.push({ scope: target, change }); }, now: () => 5,
  };
  return { deps, labels, applied, setScope: (next: string | null) => { scope = next; } };
}
const decision: TurnMemoryDecision = { candidate: candidate("I enjoy astronomy."), accepted: true, reason: "accepted", category: "interest",
  probability: 0.96, threshold: 0.9, backend: "system-one/jev", scope: "account-a", committed: true };
const turn = { sessionId: "s", assistantTimestamp: 20 };

test("memory labels apply only for the account that holds the memory, and apply later when it returns", async () => {
  const l = labelDeps("account-b");
  const pending = await saveMemoryLabel(l.deps, turn, { decision, verdict: "reject" });
  expect(pending?.effect).toBe("pending-account");
  expect(l.applied).toEqual([]);
  l.setScope("account-a");
  const [retried] = await retryPendingMemoryLabels(l.deps, [pending!]);
  expect(retried?.effect).toBe("applied");
  expect(l.applied).toEqual([{ scope: "account-a", change: { kind: "reject", candidateId: decision.candidate.id } }]);
  await saveMemoryLabel(l.deps, turn, { decision, verdict: null, existing: retried });
  expect(l.applied.at(-1)?.change).toEqual({ kind: "clear", candidateId: decision.candidate.id });
  expect(l.labels.size).toBe(0);
});

test("check labels keep the model's verdict beside the reviewer's and change nothing else", async () => {
  const l = labelDeps("account-a");
  const check = { id: "mastery_overclaimed", status: "fail" as const, source: "jev" as const, severity: "critical" as const, probability: 0.41 };
  const label = await saveCheckLabel(l.deps, turn, { attempt: 1, check, judge: "jev", verdict: "no-violation", note: "  Learner showed independent work. " });
  expect(label).toMatchObject({ verdict: "no-violation", note: "Learner showed independent work.", effect: "none", model: { status: "fail", probability: 0.41, judge: "jev" } });
  expect(l.applied).toEqual([]);
  expect(await saveCheckLabel(l.deps, turn, { attempt: 1, check, judge: "jev", verdict: null })).toBeNull();
  expect(l.labels.size).toBe(0);
});
