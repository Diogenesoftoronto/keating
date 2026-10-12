import { expect, test } from "bun:test";
import { ACTIVITY_KINDS, type ActivityExposure, type ActivityKind } from "../../packages/learner-contracts/src/judgement/activity-learning";
import { ACTIVITY_QUESTION_FINGERPRINT, ACTIVITY_SIGNALS, type ActivityObservations } from "../../packages/learner-contracts/src/judgement/activity-observations";
import { learnBackgroundActivityPolicy, type BackgroundActivityPolicy } from "../../packages/learner-contracts/src/judgement/background-activity-policy";
import { MobileBackgroundActivityLearning, type MobileBackgroundActivityJob } from "../src/lib/judgement/background-activity-learning";
import { MobileOnlineLearningPreferences } from "../src/lib/judgement/online-learning";

const start = Date.parse("2026-10-01T12:00:00Z"), asOf = start + 100_000;
function history(): ActivityExposure[] {
  return Array.from({ length: 40 }, (_, index) => {
    const kind: ActivityKind = index % 2 ? "question" : "prose", context = Math.floor(index / 2) % 2;
    const source = { documentId: `document-${index}`, revision: 1, nodeId: "node" };
    const observations: ActivityObservations = { version: 1, questionFingerprint: ACTIVITY_QUESTION_FINGERPRINT, judgeModel: "judge", inferred: Object.fromEntries(ACTIVITY_SIGNALS.map(signal =>
      [signal, signal === "learner_stuck" ? context : 0])) as ActivityObservations["inferred"],
      observed: { focusPresented: null, focusAttempted: null, focusCorrect: null, focusIncorrect: null, pendingGrades: 0, priorLearnerTurns: 1 } };
    return { id: `exposure-${index}`, sessionId: `session-${index}`, createdAt: start + index * 1000, observations,
      candidate: { kind, features: [...ACTIVITY_KINDS.map(value => Number(value === kind)), Math.log1p(100)] }, sources: [source],
      outcome: { id: `outcome-${index}`, sessionId: `session-${index}`, createdAt: start + index * 1000 + 100, grading: "auto",
        attemptStatus: "first-recorded", questionKey: `question-${index}`, source, score: Number(Number(kind === "question") === context) } };
  });
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
const drain = async () => { for (let index = 0; index < 60; index++) await Promise.resolve(); };
function fixture() {
  let current = true, generation = 0, clock = asOf, transportCalls = 0;
  const rows = history(), saved: BackgroundActivityPolicy[] = [];
  const response = deferred<unknown>();
  let started = deferred<void>();
  const coordinator = new MobileBackgroundActivityLearning(learnBackgroundActivityPolicy, () => clock);
  const job: MobileBackgroundActivityJob = { scope: "account", generation: 0, boundaries: () => [], current: () => current,
    store: { generation: async () => generation, history: async () => structuredClone(rows),
      savePolicy: async (_expected, policy, active) => { if (active()) saved.push(structuredClone(policy)); } },
    transport: async (request, _signal, fresh) => {
      expect(await fresh()).toBe(true); transportCalls++; started.resolve();
      await response.promise;
      return { model: "v3.5_default", predictions: request.testFeatures.map(row => Number(row[1] === row[23])) };
    } };
  return { coordinator, job, rows, saved, response, started, get calls() { return transportCalls; },
    current: (value: boolean) => { current = value; }, generation: (value: number) => { generation = value; },
    advance: () => { clock += 60_001; started = deferred<void>(); } };
}

test("background work returns immediately and publishes a tested policy after a later conversation turn", async () => {
  const f = fixture();
  expect(f.coordinator.schedule(f.job)).toBeUndefined();
  await f.started.promise;
  expect(f.saved).toEqual([]);
  // A further publication queues a refresh; it does not cancel a valid account-bound request.
  f.rows.push({ ...structuredClone(f.rows[0]!), id: "unlabelled-later-turn", createdAt: asOf - 1, outcome: undefined });
  f.coordinator.schedule(f.job);
  expect(f.calls).toBe(1);
  f.response.resolve(null); await drain();
  expect(f.saved).toHaveLength(1);
  expect(f.saved[0]!.validation.passed).toBe(true);
  f.advance(); f.coordinator.schedule(f.job); await drain();
  expect(f.calls).toBe(1); // New unlabelled prose never causes duplicate paid research.
  f.coordinator.cancel();
});

test("account disable, history reset, or cancellation rejects a noncooperative background result", async () => {
  for (const reason of ["account-or-disable", "reset", "cancel"] as const) {
    const f = fixture(); f.coordinator.schedule(f.job); await f.started.promise;
    if (reason === "account-or-disable") f.current(false);
    else if (reason === "reset") f.generation(1);
    else f.coordinator.cancel();
    f.response.resolve(null); await drain();
    expect(f.saved).toEqual([]); f.coordinator.cancel();
  }
});

test("changed evidence coalesces into one refresh after the minimum one minute spending cooldown", async () => {
  const f = fixture(); f.coordinator.schedule(f.job); await f.started.promise;
  f.response.resolve(null); await drain(); expect(f.calls).toBe(1);
  f.rows[0]!.outcome!.score = 1 - f.rows[0]!.outcome!.score!;
  f.coordinator.schedule(f.job); f.coordinator.schedule(f.job); await drain();
  expect(f.calls).toBe(1);
  f.advance(); f.coordinator.schedule(f.job); await drain();
  expect(f.calls).toBe(2); f.coordinator.cancel();
});

test("reset during the asynchronous history read prevents any hosted request", async () => {
  const f = fixture(), read = deferred<ActivityExposure[]>(), entered = deferred<void>();
  f.job.store.history = async () => { entered.resolve(); return read.promise; };
  f.coordinator.schedule(f.job); await entered.promise;
  f.generation(1); read.resolve(f.rows); await drain();
  expect(f.calls).toBe(0); expect(f.saved).toEqual([]); f.coordinator.cancel();
});

test("cancelled, failed, or malformed predictions can retry on a later event after the cooldown", async () => {
  for (const interruption of ["cancelled", "failed", "invalid-response"] as const) {
    const f = fixture();
    if (interruption === "failed") f.job.transport = async () => { f.started.resolve(); throw Error("temporary outage"); };
    if (interruption === "invalid-response") f.job.transport = async () => { f.started.resolve(); return { model: "v3.5_default", predictions: [Number.NaN] }; };
    f.coordinator.schedule(f.job); await f.started.promise;
    if (interruption === "cancelled") f.coordinator.cancel();
    await drain();
    let retried = 0;
    f.job.transport = async request => { retried++; return { model: "v3.5_default", predictions: request.testFeatures.map(row => Number(row[1] === row[23])) }; };
    f.coordinator.schedule(f.job); await drain(); expect(retried).toBe(0);
    f.advance(); f.coordinator.schedule(f.job); await drain();
    expect(retried).toBe(1); expect(f.saved).toHaveLength(1);
    f.response.resolve(null); await drain(); expect(f.saved).toHaveLength(1);
    f.coordinator.cancel();
  }
});

test("the transport receives a final asynchronous generation guard for refresh/signing delays", async () => {
  const f = fixture(), authentication = deferred<void>(), entered = deferred<void>(); let sent = 0;
  f.job.transport = async (_request, _signal, fresh) => {
    entered.resolve(); await authentication.promise;
    if (!await fresh()) throw Error("Evidence changed during account authorization.");
    sent++; return {};
  };
  f.coordinator.schedule(f.job); await entered.promise;
  f.generation(1); authentication.resolve(); await drain();
  expect(sent).toBe(0); expect(f.saved).toEqual([]); f.coordinator.cancel();
});

test("chat modes migrate to background, persist per account, and leaving live invalidates before storage finishes", async () => {
  const values = new Map<string, string>(); const wait = deferred<void>(); let block = false;
  const storage = { getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { if (block) await wait.promise; values.set(key, value); } };
  const preference = new MobileOnlineLearningPreferences(storage);
  await preference.load("account-a"); await preference.set("account-a", "v3.5_default");
  expect(preference.chatMode("account-a")).toBe("background");
  await preference.setChatMode("account-a", "live");
  const epoch = preference.epoch("account-a");
  expect(preference.chatMode("account-b")).toBe("background");
  block = true; const changed = preference.setChatMode("account-a", "background");
  expect(preference.chatMode("account-a")).toBe("background"); expect(preference.epoch("account-a")).not.toBe(epoch);
  wait.resolve(); await changed;
  const reloaded = new MobileOnlineLearningPreferences(storage); await reloaded.load("account-a");
  expect(reloaded.get("account-a")).toBe("v3.5_default"); expect(reloaded.chatMode("account-a")).toBe("background");
});
