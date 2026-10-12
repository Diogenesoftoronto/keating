import { describe, expect, it } from "bun:test";
import { projectActiveWork, type ActivitySelectionInput, type ReleasedActivitySelection, type TeachingPolicyTurn } from "@keating/learner-contracts";
import { ACTIVITY_QUESTION_FINGERPRINT, ACTIVITY_SIGNALS, activityObservationFeatures, type ActivityObservations } from "../../../packages/learner-contracts/src/judgement/activity-observations";
import { buildActivityLearningBatch, describeActivityCandidate, type ActivityExposure } from "../../../packages/learner-contracts/src/judgement/activity-learning";
import { buildBackgroundActivityBatch, validateBackgroundActivityPolicy, type BackgroundActivityPolicy } from "../../../packages/learner-contracts/src/judgement/background-activity-policy";
import { activityOutcomesFromChecks, clearWebActivityLearningHistory, createWebActivityLearning, recordWebActivityPresentation } from "../keating/judgement/activity-learning";
import { presentationsFromAssistantText } from "../keating/judgement/active-work-host";
import { KeatingStorage, type OpenUiPresentationRecord, type QuestionCheckRecord } from "../keating/storage";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const question = ["Try this.", "```openui id=check",
  'root = LearningSurface([check], "DNS", "A quick check.", "ephemeral")',
  'check = Question([{ question: "What makes a repeated lookup faster?", type: "text" }], "ephemeral", "DNS")', "```"].join("\n");
const observations: ActivityObservations = { version: 1, questionFingerprint: ACTIVITY_QUESTION_FINGERPRINT, judgeModel: "jev-test", inferred: Object.fromEntries(ACTIVITY_SIGNALS.map(id => [id, .5])) as ActivityObservations["inferred"],
  observed: { focusPresented: null, focusAttempted: null, focusCorrect: null, focusIncorrect: null, pendingGrades: 0, priorLearnerTurns: 1 } };
const turn: TeachingPolicyTurn = { learnerMessage: "Help me practise DNS", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "practice", improvementRuns: null, domain: "general" };
const input = (reply = question): ActivitySelectionInput => ({ turn, observations, baselineAttempt: 1, signal: new AbortController().signal,
  candidates: [{ attempt: 1, variant: "default", reply: { text: reply, toolCalls: [] } }] });
let sequence = 0;
function harness(overrides: Partial<Parameters<typeof createWebActivityLearning>[0]> = {}) {
  const sessionId = `activity-test-${++sequence}`, scope = `account-${sequence}`, storage = new MemoryStorage();
  const state = { scope: scope as string | null, authorized: true, enabled: true, current: true, now: 10_000, checks: [] as QuestionCheckRecord[], presentations: [] as OpenUiPresentationRecord[], selectedExposures: [] as ActivityExposure[], pause: null as ReturnType<typeof deferred> | null, started: null as ReturnType<typeof deferred> | null };
  const host = createWebActivityLearning({ sessionId, storage: () => storage, source: { getQuestionChecks: async () => state.checks,
    getOpenUiPresentations: async () => state.presentations }, current: () => state.current,
    account: () => ({ scope: state.scope, authorized: state.authorized }), enabled: () => state.enabled, now: () => state.now,
    mode: () => "live",
    select: async (value, options) => {
      state.selectedExposures = structuredClone([...options.exposures]);
      state.started?.resolve(); if (state.pause) await state.pause.promise;
      return { attempt: value.baselineAttempt, receipt: buildActivityLearningBatch(value, options.exposures, options.asOf!).receipt };
    }, ...overrides });
  const read = () => JSON.parse(storage.getItem(`keating.activity-learning.v1:${scope}`) ?? '{"exposures":[],"boundaries":[]}') as { exposures: ActivityExposure[]; boundaries: { sessionId: string; createdAt: number }[] };
  const release = async (value = input(), timestamp = 5_000, publishedAt = 6_000) => {
    const selected = await host.select(value);
    const selection: ReleasedActivitySelection = { observations: value.observations, candidate: value.candidates.find(candidate => candidate.attempt === selected.attempt)!, receipt: selected.receipt };
    host.published({ messageTimestamp: timestamp, publishedAt, activitySelection: selection });
    return { selection, text: value.candidates[0]!.reply.text, scope: { sessionId, messageId: `message-${timestamp}` }, timestamp };
  };
  const seed = () => {
    const candidate = describeActivityCandidate(input().candidates[0]!.reply)!;
    const records = presentationsFromAssistantText(question, { sessionId, messageId: "seed" }, null, 6_000);
    const exposure: ActivityExposure = { id: "seed", sessionId, createdAt: 6_000, observations, candidate,
      sources: records.map(record => ({ documentId: record.documentId, revision: record.revision, nodeId: record.nodeId })),
      receipt: buildActivityLearningBatch(input(), [], state.now).receipt };
    storage.setItem(`keating.activity-learning.v1:${scope}`, JSON.stringify({ version: 1, exposures: [exposure], boundaries: [{ sessionId, createdAt: 6_000 }] }));
  };
  return { host, state, scope, sessionId, storage, read, release, seed };
}
const check = (sessionId: string, source: QuestionCheckRecord["source"], createdAt = 7_000): QuestionCheckRecord => ({
  id: "answer-1", sessionId, source, createdAt, topic: "DNS", question: "What speeds up lookups?", answer: "PRIVATE_ANSWER", grading: "auto", score: 1,
});

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 40));
function testedPolicy(asOf: number): BackgroundActivityPolicy {
  const features = activityObservationFeatures(observations);
  return { version: 1, questionFingerprint: ACTIVITY_QUESTION_FINGERPRINT, featureVersion: "activity-observations-v1-kind-v1", model: "v3.5_default", judgeModel: observations.judgeModel!,
    createdAt: asOf, expiresAt: asOf + 86_400_000, kinds: ["prose", "question"], bounds: { min: features, max: features },
    prototypes: [{ features, scores: [.2, .8] }], trainRows: 20,
    validation: { kind: "squared-error", modelLoss: .05, localLoss: .06, baselineLoss: .2, rows: 5, coveredRows: 5, passed: true },
    target: "next-linked-objective-score", scope: "chronological-within-learner", causal: false };
}
describe("background chat learning", () => {
  it("records a published baseline without a selection call or synchronous storage and binds the captured open question", async () => {
    const h = harness({ mode: () => "background" });
    const [presentation] = presentationsFromAssistantText(question, { sessionId: h.sessionId, messageId: "prior-question" }, null, 1_000);
    h.state.presentations = [presentation!];
    const activeWork = projectActiveWork({ plan: null, attempts: [], presentations: [{ documentId: presentation!.documentId, nodeId: presentation!.nodeId,
      component: presentation!.component, presentedAt: 1_000, planDocumentId: null, planItemId: null }] });
    const value = input("A cache reuses a previous lookup. Try the open question.");
    const selection = { observations, candidate: value.candidates[0]!, receipt: buildActivityLearningBatch(value, [], h.state.now).receipt };
    const settings = h.host.turnSettings();
    h.host.published({ messageTimestamp: 5_000, publishedAt: 6_000, activitySelection: selection,
      publicationContext: settings.publicationContext, activeWork });
    expect(h.read().boundaries).toHaveLength(0);
    recordWebActivityPresentation(value.candidates[0]!.reply.text, { sessionId: h.sessionId, messageId: "reply" }, 5_000);
    expect(h.read().exposures).toHaveLength(0);
    await tick();
    expect(h.read().exposures).toHaveLength(1);
    expect(h.read().exposures[0]!.sources).toEqual([{ documentId: presentation!.documentId, revision: presentation!.revision, nodeId: presentation!.nodeId }]);
    clearWebActivityLearningHistory(h.scope, h.storage);
  });

  it("uses a completed policy only on the next snapshot and deduplicates identical evidence", async () => {
    let batches = 0;
    const started = deferred(), pending = deferred();
    const h = harness({ mode: () => "background", transport: async () => { batches++; started.resolve(); await pending.promise; return {}; },
      learn: async options => {
        await options.transport({ model: "v3.5_default", task: "regression", train: { columns: ["x"], rows: [[0]], targets: [0] }, test: { rows: [[1]] } } as never, options.signal);
        return { policy: testedPolicy(options.asOf), receipt: buildBackgroundActivityBatch([], observations.judgeModel!, options.asOf).receipt };
      } });
    h.seed();
    h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
    const previous = h.host.turnSettings();
    expect(previous.policy).toBeNull();
    await started.promise;
    expect(h.host.turnSettings().policy).toBeNull();
    pending.resolve(); await tick();
    expect(previous.policy).toBeNull();
    const next = h.host.turnSettings();
    expect(validateBackgroundActivityPolicy(next.policy)).toBe(true);
    expect(next.policy?.prototypes[0]!.scores).toEqual([.2, .8]);
    // Flush the coalesced request beyond its cooldown without changing evidence.
    h.state.now += 60_001;
    clearWebActivityLearningHistory(h.scope, new Proxy(h.storage, { get: (target, property) => property === "removeItem" ? () => {} : Reflect.get(target, property, target)?.bind?.(target) }));
    // A fresh coordinator reads the persisted dispatch fingerprint and avoids another paid call.
    h.host.turnSettings(); await tick();
    expect(batches).toBe(1);
    clearWebActivityLearningHistory(h.scope, h.storage);
  });


  it("finishes account-scoped research after the originating conversation is replaced", async () => {
    const started = deferred(), pending = deferred();
    const h = harness({ mode: () => "background", transport: async () => { started.resolve(); await pending.promise; return {}; },
      learn: async options => {
        await options.transport({} as never, options.signal);
        return { policy: testedPolicy(options.asOf), receipt: buildBackgroundActivityBatch([], observations.judgeModel!, options.asOf).receipt };
      } });
    h.seed(); h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
    h.host.schedule(); await started.promise;
    h.state.current = false;
    pending.resolve(); await tick();
    expect(validateBackgroundActivityPolicy(JSON.parse(h.storage.getItem(`keating.activity-policy.v1:${h.scope}`)!))).toBe(true);
    clearWebActivityLearningHistory(h.scope, h.storage);
  });

  it("retries failed evidence after reloading the persisted cooldown on a later trigger", async () => {
    let calls = 0;
    const h = harness({ mode: () => "background", transport: async () => { calls++; if (calls === 1) throw new Error("temporary outage"); return {}; },
      learn: async options => {
        await options.transport({} as never, options.signal);
        return { policy: testedPolicy(options.asOf), receipt: buildBackgroundActivityBatch([], observations.judgeModel!, options.asOf).receipt };
      } });
    h.seed(); h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
    h.host.schedule(); await tick();
    expect(calls).toBe(1);
    expect(JSON.parse(h.storage.getItem(`keating.activity-research.v1:${h.scope}`)!)).toEqual({ lastAttemptAt: 10_000, evidenceKey: null });
    // Reset the process-local coordinator while preserving disk, as a reload does.
    clearWebActivityLearningHistory(h.scope, { getItem: h.storage.getItem.bind(h.storage), setItem: h.storage.setItem.bind(h.storage), removeItem: () => {} });
    h.state.now += 60_001; h.host.schedule(); await tick();
    expect(calls).toBe(2);
    expect(validateBackgroundActivityPolicy(h.host.turnSettings().policy)).toBe(true);
    clearWebActivityLearningHistory(h.scope, h.storage);
  });

  it("coalesces new evidence arriving during a batch into one subsequent batch", async () => {
    let calls = 0;
    const started = deferred(), pending = deferred();
    const h = harness({ mode: () => "background", transport: async () => { if (++calls === 1) { started.resolve(); await pending.promise; } return {}; },
      learn: async options => {
        await options.transport({} as never, options.signal);
        return { policy: testedPolicy(options.asOf), receipt: buildBackgroundActivityBatch([], observations.judgeModel!, options.asOf).receipt };
      } });
    h.seed(); h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
    h.host.schedule(); await started.promise;
    h.state.checks[0] = { ...h.state.checks[0]!, score: .2 };
    h.state.now += 60_001;
    h.host.schedule(); h.host.schedule();
    pending.resolve(); await tick();
    expect(calls).toBe(2);
    expect(validateBackgroundActivityPolicy(h.host.turnSettings().policy)).toBe(true);
    clearWebActivityLearningHistory(h.scope, h.storage);
  });

  it("a mode change and change back cannot revive already dispatched work", async () => {
    let mode: "background" | "live" = "background";
    const started = deferred(), pending = deferred();
    let signal: AbortSignal | undefined;
    const h = harness({ mode: () => mode, transport: async (_request, _scope, value) => { signal = value; started.resolve(); await pending.promise; return {}; },
      learn: async options => {
        await options.transport({} as never, options.signal);
        return { policy: testedPolicy(options.asOf), receipt: buildBackgroundActivityBatch([], observations.judgeModel!, options.asOf).receipt };
      } });
    h.seed(); h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
    h.host.schedule(); await started.promise;
    mode = "live"; h.host.turnSettings();
    expect(signal?.aborted).toBe(true);
    mode = "background"; h.host.turnSettings();
    pending.resolve(); await tick();
    expect(h.storage.getItem(`keating.activity-policy.v1:${h.scope}`)).toBeNull();
    clearWebActivityLearningHistory(h.scope, h.storage);
  });

  it("publication and question attribution do not wait for an unavailable history source", async () => {
    const forever = new Promise<never>(() => {});
    const h = harness({ mode: () => "background", source: { getQuestionChecks: () => forever, getOpenUiPresentations: () => forever } });
    const settings = h.host.turnSettings(), value = input();
    expect(h.host.published({ messageTimestamp: 5_000, publishedAt: 6_000, publicationContext: settings.publicationContext,
      activitySelection: { observations, candidate: value.candidates[0]!, receipt: buildActivityLearningBatch(value, [], h.state.now).receipt } })).toBeUndefined();
    recordWebActivityPresentation(question, { sessionId: h.sessionId, messageId: "shown-question" }, 5_000);
    await tick();
    expect(h.read().exposures).toHaveLength(1);
    clearWebActivityLearningHistory(h.scope, h.storage);
  });

  it("portable history imports cancel old research before writes and suspend scheduling until completion", async () => {
    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
    const started = deferred(), pending = deferred(), imported = deferred();
    let calls = 0, signal: AbortSignal | undefined;
    const h = harness({ mode: () => "background", transport: async (_request, _scope, value) => { calls++; signal = value; started.resolve(); await pending.promise; return {}; },
      learn: async options => {
        await options.transport({} as never, options.signal);
        return { policy: testedPolicy(options.asOf), receipt: buildBackgroundActivityBatch([], observations.judgeModel!, options.asOf).receipt };
      } });
    try {
      h.seed(); h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
      h.host.schedule(); await started.promise;
      const source = new KeatingStorage();
      Object.defineProperty(source, "putMany", { value: async () => { await imported.promise; return 0; } });
      Object.defineProperty(source, "refreshDerivedLearnerProfile", { value: async () => {} });
      const importing = source.importPortableData({});
      expect(signal?.aborted).toBe(true);
      expect(h.read().exposures).toHaveLength(0);
      expect(h.host.turnSettings().recordActivity).toBe(false);
      h.host.schedule(); pending.resolve(); await tick();
      expect(calls).toBe(1);
      imported.resolve(); await importing; await tick();
      expect(h.host.turnSettings().recordActivity).toBe(true);
      expect(h.storage.getItem(`keating.activity-policy.v1:${h.scope}`)).toBeNull();
    } finally {
      imported.resolve(); pending.resolve(); clearWebActivityLearningHistory(h.scope, h.storage);
      if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow); else Reflect.deleteProperty(globalThis, "window");
    }
  });

  for (const change of ["account", "disable", "clear", "evidence"] as const) {
    it(`rejects a background result after ${change} and does not hold publication`, async () => {
      const started = deferred(), pending = deferred();
      let batchSignal: AbortSignal | undefined;
      const h = harness({ mode: () => "background", transport: async (_request, _scope, signal) => { batchSignal = signal; started.resolve(); await pending.promise; return {}; },
        learn: async options => {
          await options.transport({} as never, options.signal);
          return { policy: testedPolicy(options.asOf), receipt: buildBackgroundActivityBatch([], observations.judgeModel!, options.asOf).receipt };
        } });
      h.seed();
      h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
      h.host.schedule(); await started.promise;
      // A second publication is synchronous while the detached transport remains pending.
      const settings = h.host.turnSettings();
      h.host.published({ messageTimestamp: 12_000, publishedAt: 12_000, publicationContext: settings.publicationContext });
      if (change === "account") h.state.scope = "other-account";
      if (change === "disable") h.state.enabled = false;
      if (change === "clear") { clearWebActivityLearningHistory(h.scope, h.storage); expect(batchSignal?.aborted).toBe(true); }
      if (change === "evidence") h.state.checks = [];
      pending.resolve(); await tick();
      expect(h.storage.getItem(`keating.activity-policy.v1:${h.scope}`)).toBeNull();
      clearWebActivityLearningHistory(h.scope, h.storage);
    });
  }
});

describe("web chat outcome learning", () => {
  it("records only the exact newly published message with renderer-scoped sources and no prose", async () => {
    const h = harness(), released = await h.release();
    expect(h.read().exposures).toHaveLength(0);
    recordWebActivityPresentation(released.text, released.scope, released.timestamp + 1);
    expect(h.read().exposures).toHaveLength(0);
    recordWebActivityPresentation(released.text, released.scope, released.timestamp);
    const [exposure] = h.read().exposures;
    expect(exposure!.createdAt).toBe(6_000);
    const [presented] = presentationsFromAssistantText(released.text, released.scope, null, 6_000);
    expect(exposure!.sources).toEqual([{ documentId: presented!.documentId, revision: presented!.revision, nodeId: presented!.nodeId }]);
    const saved = JSON.stringify(h.read());
    expect(saved).not.toContain("lookup"); expect(saved).not.toContain("learnerMessage");
    recordWebActivityPresentation(released.text, released.scope, released.timestamp);
    expect(h.read().exposures).toHaveLength(1);
  });
  it("does not log mismatched text, reopened history, or an unshown private selection", async () => {
    const h = harness(), released = await h.release();
    recordWebActivityPresentation("Different reply", released.scope, released.timestamp);
    recordWebActivityPresentation(released.text, released.scope, released.timestamp);
    expect(h.read().exposures).toHaveLength(0);
    await h.host.select(input());
    recordWebActivityPresentation(question, { sessionId: h.sessionId, messageId: "old-history" }, 1);
    expect(h.read().exposures).toHaveLength(0);
  });
  it("uses the renderer's transformed text for source ids and tolerates a full history store", async () => {
    const h = harness(), released = await h.release();
    const renderedText = `An introductory paragraph.\n\n${released.text}`;
    recordWebActivityPresentation(released.text, released.scope, released.timestamp, renderedText);
    const [presented] = presentationsFromAssistantText(renderedText, released.scope, null, 6_000);
    expect(h.read().exposures[0]!.sources[0]!.documentId).toBe(presented!.documentId);
    const next = await h.release(input(), 8_000, 9_000);
    h.storage.setItem = () => { throw new Error("Quota exceeded"); };
    expect(() => recordWebActivityPresentation(next.text, next.scope, next.timestamp)).not.toThrow();
    expect(h.read().exposures).toHaveLength(0);
  });
  it("links an exact first-recorded auto answer and removes its label if learner records are cleared", async () => {
    const h = harness(), released = await h.release();
    recordWebActivityPresentation(released.text, released.scope, released.timestamp);
    h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
    await h.host.select(input());
    expect(h.state.selectedExposures[0]!.outcome?.score).toBe(1);
    expect(JSON.stringify(h.read())).not.toContain("PRIVATE_ANSWER");
    h.state.checks = [];
    await h.host.select(input());
    expect(h.state.selectedExposures[0]!.outcome).toBeUndefined();
    expect(h.read().exposures[0]!.outcome).toBeUndefined();
  });
  it("an empty semantic answer stored as auto zero cannot label a reply or make a later retry first", async () => {
    const h = harness(), released = await h.release();
    recordWebActivityPresentation(released.text, released.scope, released.timestamp);
    const source = h.read().exposures[0]!.sources[0];
    const empty = { ...check(h.sessionId, source), answer: "  ", score: 0 };
    h.state.checks = [empty];
    await h.host.select(input());
    expect(h.state.selectedExposures[0]!.outcome).toBeUndefined();
    const retry = { ...check(h.sessionId, source, 8_000), id: "retry" };
    h.state.checks.push(retry);
    expect(activityOutcomesFromChecks(h.state.checks)[0]!.attemptStatus).toBe("repeat");
    await h.host.select(input());
    expect(h.state.selectedExposures[0]!.outcome).toBeUndefined();
  });
  it("quarantines an old ledger when writing and removing a publication boundary both fail", async () => {
    const h = harness(), released = await h.release();
    recordWebActivityPresentation(released.text, released.scope, released.timestamp);
    const source = h.read().exposures[0]!.sources[0];
    const setItem = h.storage.setItem.bind(h.storage), removeItem = h.storage.removeItem.bind(h.storage);
    h.storage.setItem = () => { throw new Error("Storage blocked"); };
    h.storage.removeItem = () => { throw new Error("Storage blocked"); };
    expect(() => h.host.published({ messageTimestamp: 6_400, publishedAt: 6_500 })).toThrow();
    expect(h.read().exposures).toHaveLength(1);
    h.storage.setItem = setItem; h.storage.removeItem = removeItem;
    h.state.checks = [check(h.sessionId, source)];
    await expect(h.host.select(input())).rejects.toThrow("activity-history-unavailable");
    expect(h.read().exposures[0]!.outcome).toBeUndefined();
    clearWebActivityLearningHistory(h.scope, h.storage);
    await h.host.select(input());
    expect(h.state.selectedExposures).toHaveLength(0);
  });
  it("a later published reply censors a prior exposure even when predictions were turned off", async () => {
    const h = harness(), released = await h.release();
    recordWebActivityPresentation(released.text, released.scope, released.timestamp);
    h.state.enabled = false;
    h.host.published({ messageTimestamp: 6_400, publishedAt: 6_500 });
    h.state.enabled = true;
    h.state.checks = [check(h.sessionId, h.read().exposures[0]!.sources[0])];
    await h.host.select(input());
    expect(h.state.selectedExposures[0]!.outcome).toBeUndefined();
    expect(h.read().boundaries).toHaveLength(2);
  });
  it("prose binds only the one existing awaiting question; unmatched prose remains unlabelled", async () => {
    const h = harness();
    const [presentation] = presentationsFromAssistantText(question, { sessionId: h.sessionId, messageId: "previous-question" }, null, 1_000);
    h.state.presentations = [presentation!];
    const value = input("A cache reuses an earlier lookup. Try the open question.");
    const activeWork = projectActiveWork({ plan: null, attempts: [], presentations: [{ documentId: presentation!.documentId, nodeId: presentation!.nodeId, component: presentation!.component, presentedAt: 1_000, planDocumentId: null, planItemId: null }] });
    const released = await h.release({ ...value, turn: { ...turn, activeWork } });
    recordWebActivityPresentation(released.text, released.scope, released.timestamp);
    expect(h.read().exposures[0]!.sources).toEqual([{ documentId: presentation!.documentId, revision: presentation!.revision, nodeId: presentation!.nodeId }]);
    const second = await h.release(input("Another explanation."), 8_000, 9_000);
    recordWebActivityPresentation(second.text, second.scope, second.timestamp);
    expect(h.read().exposures[1]!.sources).toEqual([]);
  });
  for (const change of ["account", "preference", "cancel", "evidence", "clear"] as const) {
    it(`discards selection when ${change} changes while the predictor is pending`, async () => {
      const h = harness(), value = input(), controller = new AbortController();
      h.state.pause = deferred(); h.state.started = deferred();
      const pending = h.host.select({ ...value, signal: controller.signal }).then(() => false, () => true);
      await h.state.started.promise;
      if (change === "account") h.state.scope = "different-account";
      if (change === "preference") h.state.enabled = false;
      if (change === "cancel") controller.abort();
      if (change === "evidence") h.state.checks.push(check(h.sessionId, { documentId: "new", revision: 0, nodeId: "check" }));
      if (change === "clear") clearWebActivityLearningHistory(h.scope, h.storage);
      h.state.pause.resolve();
      expect(await pending).toBe(true);
      expect(h.read().exposures).toHaveLength(0);
    });
  }
  it("account or preference changes after release cannot persist a pending presentation", async () => {
    for (const change of ["account", "preference", "clear"] as const) {
      const h = harness(), released = await h.release();
      if (change === "account") h.state.scope = "different-account";
      if (change === "preference") h.state.enabled = false;
      if (change === "clear") clearWebActivityLearningHistory(h.scope, h.storage);
      recordWebActivityPresentation(released.text, released.scope, released.timestamp);
      expect(h.read().exposures).toHaveLength(0);
    }
  });
  it("deduplicates against pending/model/legacy earlier attempts and keeps simultaneous first attempts unknown", () => {
    const source = { documentId: "doc", revision: 0, nodeId: "question" };
    const first = { ...check("s", source, 1_000), id: "first", grading: "pending" as const, source: undefined };
    const later = { ...check("s", source, 2_000), id: "later" };
    expect(activityOutcomesFromChecks([first, later])[0]!.attemptStatus).toBe("repeat");
    expect(activityOutcomesFromChecks([{ ...later, id: "same-time" }, later]).map(row => row.attemptStatus)).toEqual(["unknown", "unknown"]);
  });
});
