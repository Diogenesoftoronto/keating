import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { thresholdKey, type JudgementRequest, type UiDocument } from "@keating/learner-contracts";
import { IDBFactory } from "fake-indexeddb";
import { loadComingUpReadiness, reviewComingUpReadiness, createComingUpReadinessSession,
  type ComingUpReadinessSource, type ComingUpReadinessView as View } from "../keating/judgement/coming-up-readiness";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";
import { KeatingStorage, type FlashcardDeck, type LearnerState, type LessonPlan, type QuestionCheckRecord } from "../keating/storage";
import { dispatchSharedUiAction, sharedUiActionStateKey } from "../keating/openui/shared-actions";
import { initialSrsState } from "../keating/srs";
import { ComingUpReadiness, ComingUpReadinessView } from "../components/ComingUpReadiness";

const key = { backend: "system-one" as const, model: "jev-readiness-fixture", calibrationSha256: null as string | null };
function fixture() {
  const now = Date.now();
  const state: LearnerState = { schemaVersion: 3, topicsExplored: [], feedbackHistory: [], strengths: [], weaknesses: [], topicProfiles: [], sessionsCount: 1,
    sessions: [{ startedAt: now - 10_000, endedAt: now - 5_000, topicsCovered: ["Derivative", "functions", "limits", "slope"] }], profileBeliefs: [], studyPriorities: [] };
  const decks: FlashcardDeck[] = [{ id: "d1", topic: "Derivative", slug: "derivative", title: "Derivative review", createdAt: now - 10_000, updatedAt: now - 10_000,
    cards: [{ id: "card", front: "What does the derivative measure?", back: "Instantaneous rate of change", createdAt: now - 10_000, updatedAt: now - 10_000,
      srs: { ...initialSrsState(now - 1_000), intervalDays: 1, reps: 1 } }] }];
  const checks: QuestionCheckRecord[] = [{ id: "answer", topic: "Derivative", question: "Explain an instantaneous rate.", answer: "The limiting rate at a point.", grading: "auto", score: 1, createdAt: now - 4_000 }];
  const source: ComingUpReadinessSource = { getDecks: async () => structuredClone(decks), getVerifications: async () => [],
    getLearnerState: async () => structuredClone(state), getQuestionChecks: async () => structuredClone(checks), getCardReviews: async () => [], getLessonPlans: async () => [] };
  const requests: JudgementRequest[] = [];
  let hook: (() => void) | undefined;
  const runtime: WebJudgementRuntime = { settings: { backend: "hosted", localModelId: "local-fixture", gatewayPath: "/api/judgement" },
    policy: { calibration: { entries: {} }, tiers: [{ key, call: async request => {
      requests.push(structuredClone(request)); hook?.();
      return { ok: true, response: { backend: key, answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id,
        question.type === "noul" ? { type: "noul", noul: .95 } : { type: "choice", choice: "candidate_0", confidence: .95, probabilities: { candidate_0: .95, none: .05 } }])) } };
    } }] } };
  return { source, state, decks, checks, requests, runtime, hook: (next: () => void) => { hook = next; } };
}

test("actual due deck mapping uses authored graph, recorded exposure and exact answers, never derived mastery", async () => {
  const f = fixture();
  f.checks.push({ ...f.checks[0]!, id: "proposal", grading: "model", score: 1, answer: "MODEL GRADED", createdAt: Date.now() - 1 });
  const input = await loadComingUpReadiness(f.source);
  expect(input.candidates[0]).toMatchObject({ id: "deck:d1", due: true, covered: true, prerequisiteGraphKnown: true,
    prerequisites: [{ id: "functions", covered: true }, { id: "limits", covered: true }, { id: "slope", covered: true }] });
  expect(input.candidates[0]!.requirements).toContain(f.decks[0]!.cards[0]!.front);
  expect(input.candidates[0]!.work[0]).toEqual({ question: f.checks[1]!.question, answer: "MODEL GRADED", result: "pending" });
  expect(input.candidates[0]!.work[1]!.answer).toBe(f.checks[0]!.answer);
  f.state.sessions = []; f.state.topicsExplored = ["functions", "limits", "slope", "Derivative"];
  const noExposure = await loadComingUpReadiness(f.source);
  expect(noExposure.candidates[0]!.prerequisites.every(row => !row.covered)).toBe(true);
  const blocked = await reviewComingUpReadiness(noExposure, f.runtime, { current: async () => true });
  expect(blocked.review?.blocked[0]?.reason).toBe("unmet-prerequisite"); expect(f.requests).toHaveLength(0);
});

test("custom graph and no-work cases block before inference; stored profile labels never manufacture coverage", async () => {
  const f = fixture(); f.decks[0]!.topic = "Custom lunar topic"; f.checks[0]!.topic = "Custom lunar topic";
  const input = await loadComingUpReadiness(f.source);
  expect(input.candidates[0]!.prerequisiteGraphKnown).toBe(false);
  const result = await reviewComingUpReadiness(input, f.runtime, { current: async () => true });
  expect(result.review?.blocked[0]?.reason).toBe("unknown-prerequisites"); expect(f.requests).toHaveLength(0);
  const html = renderToStaticMarkup(<ComingUpReadinessView view={{ pending: false, result, stale: false }} hasDueDecks onReview={() => {}} onStart={() => {}} />);
  expect(html).toContain("Prerequisite graph unavailable"); expect(html).not.toContain("Suggested next review");
});

test("ordinary production-time loads stay fresh and an explicit uncalibrated review never forces selection", async () => {
  const f = fixture(), before = JSON.stringify({ state: f.state, decks: f.decks, checks: f.checks });
  const first = await loadComingUpReadiness(f.source), later = await loadComingUpReadiness(f.source, Date.now() + 500);
  expect(first.key).toBe(later.key);
  const result = await reviewComingUpReadiness(first, f.runtime, { current: async () => (await loadComingUpReadiness(f.source)).key === first.key });
  expect(result.review?.status).toBe("uncalibrated"); expect(result.review?.selectedId).toBeNull(); expect(f.requests).toHaveLength(1);
  expect(JSON.stringify(f.requests)).not.toContain("topicsExplored");
  expect(JSON.stringify({ state: f.state, decks: f.decks, checks: f.checks })).toBe(before);
  const html = renderToStaticMarkup(<ComingUpReadinessView view={{ pending: false, result, stale: false }} hasDueDecks onReview={() => {}} onStart={() => {}} />);
  expect(html).toContain("Uncalibrated readiness estimates"); expect(html).toContain("95% model readiness probability");
  expect(html).not.toContain("Suggested next review"); expect(html).toContain("jev-readiness-fixture");
});

test("off/local settings never call the hosted fixture and input budget never silently clips answer text", async () => {
  const f = fixture(); const input = await loadComingUpReadiness(f.source);
  for (const backend of ["off", "local"] as const) {
    const runtime = { ...f.runtime, settings: { ...f.runtime.settings, backend } };
    expect((await reviewComingUpReadiness(input, runtime, { current: async () => true })).review?.status).toBe("unavailable");
  }
  expect(f.requests).toHaveLength(0);
  f.checks[0]!.answer = "A".repeat(60_000);
  const large = await loadComingUpReadiness(f.source);
  expect(large.candidates[0]!.work[0]!.answer).toHaveLength(60_000);
  expect((await reviewComingUpReadiness(large, f.runtime, { current: async () => true })).reason).toBe("input-budget");
  expect(f.requests).toHaveLength(0);
});

test("injected calibration enables actual two-stage selection; source changes before stage two discard it", async () => {
  const f = fixture(); const calibratedKey = { ...key, calibrationSha256: "a".repeat(64) };
  const runtime: WebJudgementRuntime = { ...f.runtime, policy: { ...f.runtime.policy, calibration: { entries: {} }, tiers: f.runtime.policy.tiers.map(tier => ({ ...tier, key: calibratedKey,
    call: async (request, signal) => { const result = await tier.call(request, signal); return result.ok ? { ...result, response: { ...result.response, backend: calibratedKey } } : result; } })) } };
  const input = await loadComingUpReadiness(f.source);
  const entries: Record<string, { deferBelow: number; actAtOrAbove: number }> = {};
  const probe = await reviewComingUpReadiness(input, runtime, { current: async () => true });
  for (const hash of Object.values(probe.review!.questionDigests)) entries[thresholdKey(calibratedKey, hash)] = { deferBelow: .5, actAtOrAbove: .8 };
  const calibrated = { ...runtime, policy: { ...runtime.policy, calibration: { entries } } };
  const selectionProbe = await reviewComingUpReadiness(input, calibrated, { current: async () => true });
  entries[thresholdKey(calibratedKey, selectionProbe.review!.questionDigests.selection!)] = { deferBelow: .5, actAtOrAbove: .8 };
  f.requests.length = 0;
  const result = await reviewComingUpReadiness(input, calibrated, { current: async () => true });
  expect(result.review).toMatchObject({ status: "selected", selectedId: "deck:d1" }); expect(f.requests).toHaveLength(2);
  const html = renderToStaticMarkup(<ComingUpReadinessView view={{ pending: false, result, stale: false }} hasDueDecks onReview={() => {}} onStart={() => {}} />);
  expect(html).toContain("Suggested next review: Derivative review"); expect(html).toContain("Review Derivative review");
  f.requests.length = 0; let checks = 0;
  const stale = await reviewComingUpReadiness(input, calibrated, { current: async () => ++checks < 3 });
  expect(stale.reason).toBe("stale"); expect(stale.review).toBeNull(); expect(f.requests).toHaveLength(1);
  const opened: string[] = [];
  const session = createComingUpReadinessSession({ load: () => loadComingUpReadiness(f.source), contextKey: () => "queue", settings: () => calibrated.settings,
    runtime: () => calibrated, publish: () => {} });
  await session.review(); await session.openSelected("d1", id => opened.push(id)); expect(opened).toEqual(["d1"]);
  f.checks[0]!.answer = "Evidence changed before opening";
  await session.openSelected("d1", id => opened.push(id)); expect(opened).toEqual(["d1"]); session.dispose();
});

test("actual action session is passive, invalidates source/profile/settings and suppresses late results after disposal", async () => {
  const f = fixture(); const views: View[] = []; let context = "learner-A"; let settings = f.runtime.settings;
  const session = createComingUpReadinessSession({ load: () => loadComingUpReadiness(f.source), contextKey: () => context,
    settings: () => settings, runtime: () => f.runtime, publish: value => views.push(value) });
  await session.refresh(); expect(f.requests).toHaveLength(0);
  await session.review(); expect(views.at(-1)?.result?.review?.status).toBe("uncalibrated");
  f.checks[0]!.answer = "Changed answer"; await session.refresh(); expect(views.at(-1)).toEqual({ pending: false, result: null, stale: true });
  await session.review(); context = "learner-B"; await session.refresh(); expect(views.at(-1)?.result).toBeNull();
  await session.review(); settings = { ...settings, backend: "off" }; await session.refresh(); expect(views.at(-1)?.result).toBeNull();
  settings = f.runtime.settings; f.hook(() => session.dispose()); const run = session.review(); await run;
  expect(views.at(-1)?.pending).toBe(true); // disposed components receive no late result publication
  const calls = f.requests.length; await session.review(); expect(f.requests).toHaveLength(calls);
});

test("mounted panel renders an explicit passive action without fetching or executing a model", () => {
  const f = fixture(); let reads = 0;
  const html = renderToStaticMarkup(<ComingUpReadiness source={{ ...f.source, getDecks: async () => { reads++; return f.decks; } }} contextVersion="queue-one" hasDueDecks onStart={() => {}} />);
  expect(html).toContain("Check study readiness"); expect(html).toContain("Hosted review sends"); expect(reads).toBe(0); expect(f.requests).toHaveLength(0);
});

test("effect cleanup and replay reactivates the session without reviving disposed work", async () => {
  const f = fixture(); const views: View[] = [];
  const session = createComingUpReadinessSession({ load: () => loadComingUpReadiness(f.source), contextKey: () => "same-queue", settings: () => f.runtime.settings,
    runtime: () => f.runtime, publish: view => views.push(view) });
  session.activate(); const old = session.review(); session.dispose(); session.activate();
  await old; expect(f.requests).toHaveLength(0);
  await session.review(); expect(f.requests).toHaveLength(1); expect(views.at(-1)?.result?.review?.status).toBe("uncalibrated");
  session.dispose();
});

test("a hung local source or freshness check exits on deadline or abort", async () => {
  const f = fixture(); const views: View[] = [];
  const session = createComingUpReadinessSession({ load: () => new Promise(() => {}), contextKey: () => "queue", settings: () => f.runtime.settings,
    runtime: () => f.runtime, publish: view => views.push(view), timeoutMs: 5 });
  await session.review(); expect(views.at(-1)?.pending).toBe(false); expect(views.at(-1)?.result?.reason).toBe("cancelled"); expect(f.requests).toHaveLength(0);
  const input = await loadComingUpReadiness(f.source), controller = new AbortController();
  const pending = reviewComingUpReadiness(input, f.runtime, { signal: controller.signal, current: () => new Promise(() => {}) });
  controller.abort(); expect((await pending).reason).toBe("cancelled"); expect(f.requests).toHaveLength(0);
});

function canonicalPlan() {
  const f = fixture();
  f.decks[0]!.topic = "Custom fractions"; f.checks[0]!.topic = "Custom fractions";
  const document: UiDocument = { schemaVersion: 1, id: "custom-fractions-plan", revision: 0, lifecycle: "ready", supportedSurfaces: ["web"],
    title: "Custom fractions", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    nodes: [{ type: "study-plan", id: "plan", title: "Fractions pathway", items: [
      { id: "parts", title: "Equal parts", status: "not_started" },
      { id: "fractions", title: "Custom fractions", detail: "Explain equal shares.", outcomes: ["Name the denominator"], dependsOn: ["parts"] },
      { id: "future", title: "Future algebra", dependsOn: ["fractions"], status: "not_started" },
    ] }] };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const completed = dispatchSharedUiAction(storage, document, { type: "complete-plan-item", nodeId: "plan", itemId: "parts", completed: true }, "2026-01-02T00:00:00.000Z");
  const plans: LessonPlan[] = [{ id: "saved-plan", topic: "Custom fractions", createdAt: 1, updatedAt: 2, content: "Saved readable projection", metadata: { source: "openui", documentId: document.id, documentRevision: 1 } }];
  const source: ComingUpReadinessSource = { ...f.source, getLessonPlans: async () => structuredClone(plans), readStudyPlanState: id => storage.getItem(sharedUiActionStateKey(id)) };
  return { ...f, source, document, completed, plans, values, storage };
}

test("topic-bound canonical graph uses exact candidate edges and completion receipts, never future lessons", async () => {
  const f = canonicalPlan(); const input = await loadComingUpReadiness(f.source);
  expect(input.graphBindings?.["deck:d1"]).toEqual({ artifactIds: ["saved-plan"], documentId: f.document.id, revision: 1, nodeId: "plan", itemId: "fractions" });
  expect(input.candidates[0]!.prerequisites).toEqual([{ id: `plan:${f.document.id}:plan:parts`, covered: true }]);
  expect(input.candidates[0]!.requirements).toContain("Explain equal shares."); expect(input.candidates[0]!.requirements).toContain("Name the denominator");
  expect(JSON.stringify(input.candidates)).not.toContain("Future algebra");
  const result = await reviewComingUpReadiness(input, f.runtime, { current: async () => (await loadComingUpReadiness(f.source)).key === input.key });
  expect(result.review?.status).toBe("uncalibrated"); expect(f.requests).toHaveLength(1);
  expect(JSON.stringify(f.requests[0])).toContain("recorded plan-item completion, not demonstrated mastery");
  const next = dispatchSharedUiAction(f.storage, f.completed.document, { type: "complete-plan-item", nodeId: "plan", itemId: "parts", completed: false }, "2026-01-03T00:00:00.000Z");
  const changed = await loadComingUpReadiness(f.source);
  expect(changed.key).not.toBe(input.key); expect(changed.graphBindings?.["deck:d1"]?.revision).toBe(next.document.revision);
  expect(changed.candidates[0]!.prerequisites[0]!.covered).toBe(false);
});

test("canonical binding rejects missing sources, competing plans, dangling edges, cycles and invented title-only links", async () => {
  for (const change of [
    (f: ReturnType<typeof canonicalPlan>) => { f.values.clear(); },
    (f: ReturnType<typeof canonicalPlan>) => { f.plans.push({ ...f.plans[0]!, id: "competing", metadata: { source: "openui", documentId: "another-plan", documentRevision: 1 } }); },
    (f: ReturnType<typeof canonicalPlan>) => { f.plans[0]!.metadata!.documentRevision = 50; },
    (f: ReturnType<typeof canonicalPlan>) => { f.plans[0]!.topic = "Some other topic"; },
    (f: ReturnType<typeof canonicalPlan>) => {
      const saved = JSON.parse(f.values.get(sharedUiActionStateKey(f.document.id))!);
      saved.document.revision = 2; saved.document.nodes[0].items[1].dependsOn = ["missing"];
      f.values.set(sharedUiActionStateKey(f.document.id), JSON.stringify(saved));
    },
    (f: ReturnType<typeof canonicalPlan>) => {
      const saved = JSON.parse(f.values.get(sharedUiActionStateKey(f.document.id))!);
      saved.document.revision = 2; saved.document.nodes[0].items[0].dependsOn = ["fractions"];
      f.values.set(sharedUiActionStateKey(f.document.id), JSON.stringify(saved));
    },
    (f: ReturnType<typeof canonicalPlan>) => {
      const saved = JSON.parse(f.values.get(sharedUiActionStateKey(f.document.id))!);
      saved.document.nodes[0].items[1].detail = "Conflicting same revision";
      f.values.set(sharedUiActionStateKey(f.document.id), JSON.stringify(saved));
    },
  ]) {
    const f = canonicalPlan(); change(f); const input = await loadComingUpReadiness(f.source);
    expect(input.candidates[0]!.prerequisiteGraphKnown).toBe(false);
    const result = await reviewComingUpReadiness(input, f.runtime, { current: async () => true });
    expect(result.review?.blocked[0]?.reason).toBe("unknown-prerequisites"); expect(f.requests).toHaveLength(0);
  }
});

test("authored done labels without a matching completed action cannot pass prerequisites", async () => {
  const f = canonicalPlan();
  const saved = JSON.parse(f.values.get(sharedUiActionStateKey(f.document.id))!); saved.journal.receipts = [];
  f.values.set(sharedUiActionStateKey(f.document.id), JSON.stringify(saved));
  const input = await loadComingUpReadiness(f.source); expect(input.candidates[0]!.prerequisiteGraphKnown).toBe(true);
  expect(input.candidates[0]!.prerequisites[0]!.covered).toBe(false);
  const result = await reviewComingUpReadiness(input, f.runtime, { current: async () => true });
  expect(result.review?.blocked[0]?.reason).toBe("unmet-prerequisite"); expect(f.requests).toHaveLength(0);
});

test("completion of an earlier prerequisite version does not cover changed authored requirements", async () => {
  const f = canonicalPlan();
  const saved = JSON.parse(f.values.get(sharedUiActionStateKey(f.document.id))!);
  saved.document.revision = 2; saved.document.nodes[0].items[0].detail = "New prerequisite material not completed yet";
  f.values.set(sharedUiActionStateKey(f.document.id), JSON.stringify(saved));
  const input = await loadComingUpReadiness(f.source);
  expect(input.candidates[0]!.prerequisiteGraphKnown).toBe(true); expect(input.candidates[0]!.prerequisites[0]!.covered).toBe(false);
  const result = await reviewComingUpReadiness(input, f.runtime, { current: async () => true });
  expect(result.review?.blocked[0]?.reason).toBe("unmet-prerequisite"); expect(f.requests).toHaveLength(0);
});

test("real KeatingStorage projection and durable canonical journal feed the readiness action", async () => {
  const previous = globalThis.indexedDB; globalThis.indexedDB = new IDBFactory();
  try {
    const f = canonicalPlan(); const storage = new KeatingStorage();
    await storage.materializeCanonicalOpenUiAction(f.completed.action, f.document, "2026-01-02T00:00:00.000Z");
    const [plan] = await storage.getLessonPlans();
    expect(plan?.metadata).toMatchObject({ source: "openui", documentId: f.document.id, documentRevision: 1 });
    const source = { ...f.source, getLessonPlans: () => storage.getLessonPlans() };
    const input = await loadComingUpReadiness(source); expect(input.candidates[0]!.prerequisiteGraphKnown).toBe(true);
    const views: View[] = [];
    const session = createComingUpReadinessSession({ load: () => loadComingUpReadiness(source), contextKey: () => "queue", settings: () => f.runtime.settings,
      runtime: () => f.runtime, publish: view => views.push(view) });
    await session.review(); expect(views.at(-1)?.result?.review?.status).toBe("uncalibrated");
    dispatchSharedUiAction(f.storage, f.completed.document, { type: "complete-plan-item", nodeId: "plan", itemId: "parts", completed: false }, "2026-01-03T00:00:00.000Z");
    await session.refresh(); expect(views.at(-1)).toEqual({ pending: false, result: null, stale: true }); session.dispose();
  } finally { globalThis.indexedDB = previous; }
});
