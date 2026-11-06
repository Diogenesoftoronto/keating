import { expect, test } from "bun:test";
import { retryPendingMemoryLabels, saveMemoryLabel, type JudgementLabelDeps } from "../keating/judgement/judgement-labels";
import type { JudgementLabelRecord, TurnMemoryDecision } from "../keating/judgement/turn-records";

const turn = { sessionId: "s", assistantTimestamp: 20 };
const decision: TurnMemoryDecision = { candidate: { id: "c", evidence: "I like stars.", sessionId: "s", messageId: "m", message: "I like stars.", start: 0, end: 13 },
  accepted: false, reason: "below-threshold", category: "interest", probability: 0.8, threshold: 0.9, backend: "jev", scope: "a", committed: true };
function fixture() {
  const labels = new Map<string, JudgementLabelRecord>();
  const admitted = new Set<string>();
  let scope = "a", fail = false;
  const deps: JudgementLabelDeps = {
    storage: { async putJudgementLabel(row) { labels.set(row.id, structuredClone(row)); }, async deleteJudgementLabel(id) { labels.delete(id); } },
    memoryScope: async () => scope,
    async applyMemory(_scope, change) {
      if (fail) throw new Error("storage unavailable");
      if (change.kind === "admit") admitted.add(change.candidate.id);
      else admitted.delete(change.candidateId);
    },
    now: () => 5,
  };
  return { deps, labels, admitted, scope: (value: string) => { scope = value; }, fail: (value: boolean) => { fail = value; } };
}
for (const failure of ["account", "storage"]) test(`undo retains a durable clear after ${failure} failure`, async () => {
  const f = fixture();
  const applied = await saveMemoryLabel(f.deps, turn, { decision, verdict: "admit", category: "interest" });
  if (failure === "account") f.scope("b"); else f.fail(true);
  const pending = await saveMemoryLabel(f.deps, turn, { decision, verdict: null, existing: applied! });
  expect(pending?.effect).toBe(failure === "account" ? "pending-account" : "failed");
  expect(f.labels.size).toBe(1);
  expect([...f.admitted]).toEqual(["c"]);
  f.scope("a"); f.fail(false);
  // Retry a serialized row with a fresh dependency object, as after reopening review.
  await retryPendingMemoryLabels({ ...f.deps, storage: { ...f.deps.storage } }, [...f.labels.values()]);
  expect(f.labels.size).toBe(0);
  expect(f.admitted.size).toBe(0);
});

test("undo invalidates a retry paused on account resolution, including later stale retries", async () => {
  const f = fixture();
  f.scope("b");
  const pending = await saveMemoryLabel(f.deps, turn, { decision, verdict: "admit", category: "interest" });
  let release!: (scope: string) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.deps.memoryScope = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const retry = retryPendingMemoryLabels(f.deps, [pending!]);
  await started;
  const undo = saveMemoryLabel(f.deps, turn, { decision, verdict: null, existing: pending! });
  f.deps.memoryScope = async () => "a";
  release("a");
  await Promise.all([retry, undo]);
  await retryPendingMemoryLabels(f.deps, [pending!]);
  expect(f.labels.size).toBe(0);
  expect(f.admitted.size).toBe(0);
});

test("undo clears an admission whose retry is already writing memory", async () => {
  const f = fixture();
  f.scope("b");
  const pending = await saveMemoryLabel(f.deps, turn, { decision, verdict: "admit", category: "interest" });
  f.scope("a");
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const apply = f.deps.applyMemory;
  f.deps.applyMemory = async (scope, change) => {
    if (change.kind === "admit") { entered(); await new Promise<void>(resolve => { release = resolve; }); }
    await apply(scope, change);
  };
  const retry = retryPendingMemoryLabels(f.deps, [pending!]);
  await started;
  const undo = saveMemoryLabel(f.deps, turn, { decision, verdict: null, existing: pending! });
  release();
  await Promise.all([retry, undo]);
  expect(f.labels.size).toBe(0);
  expect(f.admitted.size).toBe(0);
});
