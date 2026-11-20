import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import { IndexedDBStorageBackend } from "../lib/cloud-storage-backend";
import type { OpenUiPresentationRecord, QuestionCheckRecord } from "../keating/storage";
import { DAY_MS, HOUR_MS, calendarDay, habitDay } from "../keating/habits/calendar";
import type { HabitsGrade } from "../keating/habits/contracts";
import { privateQuestionEvidence } from "../keating/habits/evidence";
import { admitPrivateStudy, applyHabitsCommand, createHabitsState, habitsSnapshot, reconcileHabits } from "../keating/habits/engine";
import { HabitsRepository } from "../keating/habits/store";

const firstDay = Date.parse("2026-11-02T09:00:00Z");
const date = (offset: number) => firstDay + offset * DAY_MS;
const scope = "test-learner";

function evidence(id: string, checkedAt: number, family = id) {
  return { id, checkedAt, objective: "Test objective", family, mastery: 1 };
}

function grade(id = "practice-1", patch: Partial<HabitsGrade> = {}): HabitsGrade {
  return { type: "grade", scope, id, objective: "Loops", kind: "transfer", rubric: [2, 2, 2], ...patch };
}

function testStore() {
  let now = firstDay;
  let account = scope;
  const backend = new IndexedDBStorageBackend({ dbName: "habits-proof-" + crypto.randomUUID(), version: 1, stores: [{ name: "settings" }] });
  const options = { now: () => now, scope: () => account, seed: () => "unit seed", backend: () => backend, zone: () => "UTC", evidence: async () => [] };
  return { backend, options, clock: (next: number) => { now = next; }, signIn: (next: string) => { account = next; } };
}

test("learning days start at 04:00 on 23-hour and 25-hour IANA days", () => {
  const zone = "America/Toronto";
  const spring = habitDay(Date.parse("2026-03-08T06:59:59Z"), zone);
  const autumn = habitDay(Date.parse("2026-11-01T06:00:00Z"), zone);
  expect([spring.label, spring.end - spring.start]).toEqual(["2026-03-07", 23 * HOUR_MS]);
  expect([autumn.label, autumn.end - autumn.start]).toEqual(["2026-10-31", 25 * HOUR_MS]);
  expect(habitDay(Date.parse("2026-11-01T09:00:00Z"), zone).label).toBe("2026-11-01");
  expect(calendarDay("2026-02-30")).toBeNull();
});

test("a missed day resets the streak and a full synthesis rescues it without granting extra study or loot", () => {
  const state = createHabitsState(firstDay, "lively", "seed", "UTC");
  expect(admitPrivateStudy(state, evidence("first", firstDay))).toBe(true);
  const deadline = Date.parse("2026-11-04T22:00:00Z");
  reconcileHabits(state, date(2), "lively");
  expect(habitsSnapshot(state, scope)).toMatchObject({ streak: 0, bestStreak: 1, totalStudyDays: 1, rescueUntil: deadline });

  expect(applyHabitsCommand(state, grade("weak-answer", { kind: "rescue", rubric: [2, 1, 1] }))).toBe(false);
  expect(admitPrivateStudy(state, evidence("today", date(2)))).toBe(true);
  const before = habitsSnapshot(state, scope);
  expect(applyHabitsCommand(state, grade("strong-answer", { kind: "rescue" }))).toBe(true);
  expect(habitsSnapshot(state, scope)).toMatchObject({
    streak: 3, bestStreak: 3, totalStudyDays: 2, rescuedDays: ["2026-11-03"], rescueUntil: null,
    inventory: before.inventory, workshopLP: before.workshopLP, crates: before.crates,
  });
});

test("planned rest, holiday pauses and Companion Off bridge days without decay during pauses", () => {
  const state = createHabitsState(firstDay, "lively", "seed", "UTC");
  admitPrivateStudy(state, evidence("first", firstDay));
  expect(applyHabitsCommand(state, { type: "planRest", day: "2026-11-03" })).toBe(true);
  expect(applyHabitsCommand(state, { type: "planRest", day: "2026-11-02" })).toBe(false);
  reconcileHabits(state, date(1), "calm");
  expect(state.condition.charge).toBeCloseTo(0.5);
  expect(applyHabitsCommand(state, { type: "pause", days: 3 })).toBe(true);
  reconcileHabits(state, date(3), "off");
  expect(state.condition.charge).toBeCloseTo(0.5);
  reconcileHabits(state, date(9), "calm");
  expect(state.condition.charge).toBeCloseTo(0.5);
  expect(applyHabitsCommand(state, grade("studied-again"))).toBe(true);
  expect(habitsSnapshot(state, scope)).toMatchObject({ streak: 2, totalStudyDays: 2, studiedToday: true, pauseUntil: null });
});

test("pity is deterministic, daily draws are capped and expiry preserves claimed items", () => {
  const state = createHabitsState(firstDay, "lively", "seed", "UTC");
  state.pity = { misses: 5, belowRare: 7, belowMasterwork: 29 };
  admitPrivateStudy(state, evidence("fresh", firstDay));
  expect(state.crates[0]?.rarity).toBe("masterwork");
  admitPrivateStudy(state, evidence("same-family", firstDay, "fresh"));
  admitPrivateStudy(state, evidence("second-family", firstDay));
  admitPrivateStudy(state, evidence("third-family", firstDay));
  admitPrivateStudy(state, evidence("fourth-family", firstDay));
  expect(state.draws?.families).toEqual(["fresh", "second-family", "third-family"]);
  expect(applyHabitsCommand(state, { type: "claim", crateId: "fresh" })).toBe(false);
  reconcileHabits(state, firstDay + 3 * HOUR_MS, "lively");
  expect(applyHabitsCommand(state, { type: "claim", crateId: "fresh" })).toBe(true);
  reconcileHabits(state, date(5), "lively");
  const snapshot = habitsSnapshot(state, scope);
  expect(snapshot.crates).toEqual([]);
  expect(snapshot.collectedFinishes).toContain("Gilded cloth");
  expect(snapshot.collectedRelics).toContain("Gold-leaf bookmark");
});

test("practice run scores and rewards never create learning receipts", () => {
  const state = createHabitsState(firstDay, "lively", "seed", "UTC");
  const runEnd = { type: "runEnd", runId: "one", result: { quit: false, score: 432, care: { used: 0.1, cogs: 2, sparks: 1 } } } as const;
  expect(applyHabitsCommand(state, runEnd)).toBe(true);
  expect(habitsSnapshot(state, scope)).toMatchObject({
    streak: 0, totalStudyDays: 0, recessBest: 432, inventory: { cogs: 2, sparks: 1 }, crates: [],
  });
  reconcileHabits(state, date(1), "off");
  expect(applyHabitsCommand(state, { ...runEnd, runId: "two", result: { ...runEnd.result, score: 500 } })).toBe(true);
  expect(habitsSnapshot(state, scope)).toMatchObject({
    recessBest: 500, condition: { charge: 0.75, tune: 0.75, shine: 0.75 }, inventory: { cogs: 2, sparks: 1 }, crates: [],
  });
});

test("quest rewards require accepted work, follow expedition order and can be equipped after crafting", () => {
  const state = createHabitsState(firstDay, "lively", "seed", "UTC");
  const completion = grade("quest-grade", { kind: "assignment", target: { kind: "quest", id: "receipt" } });
  expect(applyHabitsCommand(state, completion)).toBe(false);
  expect(state.inventory.parts).toBe(0);
  expect(applyHabitsCommand(state, { type: "acceptQuest", questId: "x-rust" })).toBe(false);
  expect(applyHabitsCommand(state, { type: "acceptQuest", questId: "receipt" })).toBe(true);
  const sparksBeforeCompletion = state.inventory.sparks;
  expect(applyHabitsCommand(state, { ...completion, id: "accepted-quest-grade" })).toBe(true);
  expect(state.inventory.parts).toBe(7);
  expect(state.inventory.sparks).toBe(sparksBeforeCompletion + 1);
  expect(applyHabitsCommand(state, { ...completion, id: "repeat-quest-grade" })).toBe(false);
  expect(state.inventory.sparks).toBe(sparksBeforeCompletion + 1);
  expect(applyHabitsCommand(state, { type: "craft", kitId: "protractor" })).toBe(true);
  expect(applyHabitsCommand(state, { type: "equip", kitId: "protractor" })).toBe(true);
  expect(habitsSnapshot(state, scope)).toMatchObject({
    equippedKit: { topper: "protractor" }, ownedKit: expect.arrayContaining(["star", "protractor"]),
    quests: { receipt: { acceptedAt: firstDay, completedAt: firstDay } },
  });
});

test("flight charge settles once, and quitting or Companion Off cannot grant recharge rewards", async () => {
  const { options, signIn } = testStore();
  const store = new HabitsRepository(options);
  const care = { used: 0.1, cogs: 2, sparks: 1 };
  const stopped = {
    type: "runEnd", runId: "stopped", scope,
    result: { quit: true, score: 100, care: { ...care, chargeDelta: -0.45 } },
  } as const;
  const [landed, replayed] = await Promise.all([store.dispatch("calm", stopped), store.dispatch("calm", stopped)]);
  expect([landed.outcome, replayed.outcome].sort()).toEqual(["accepted", "replayed"]);
  expect(replayed.condition.charge).toBeCloseTo(0.3);
  expect(replayed).toMatchObject({ recessBest: 0, inventory: { sparks: 0, cogs: 0 } });

  const recovered = { quit: false, score: 200, care: { ...care, chargeDelta: 0.35 } };
  const quitWhileAhead = await store.dispatch("calm", { ...stopped, runId: "quit-ahead", result: { ...recovered, quit: true } });
  expect(quitWhileAhead.condition.charge).toBeCloseTo(0.3);
  const finished = await store.dispatch("calm", { ...stopped, runId: "finished", result: recovered });
  expect(finished.condition.charge).toBeCloseTo(0.65);
  expect(finished).toMatchObject({ recessBest: 200, inventory: { sparks: 1, cogs: 2 } });

  await store.dispatch("off", { ...stopped, runId: "off" });
  expect((await store.read("calm")).condition.charge).toBeCloseTo(0.65);
  signIn("another-account");
  await expect(store.dispatch("calm", stopped)).rejects.toThrow("The learner account changed");
});

test("transactional concurrent retries grant a single receipt and rejected replays remain rejected", async () => {
  const { options } = testStore();
  const first = new HabitsRepository(options);
  const second = new HabitsRepository(options);
  const outcomes = await Promise.all([first.dispatch("calm", grade()), second.dispatch("calm", grade())]);
  expect(outcomes.map(result => result.outcome).sort()).toEqual(["accepted", "replayed"]);
  expect(outcomes[1].inventory).toMatchObject({ cogs: 1, sparks: 1 });
  expect((await second.dispatch("calm", grade("practice-1", { objective: "Changed payload" }))).outcome).toBe("rejected");
  const failed = grade("incomplete", { rubric: [1, 0, 0] });
  expect(await first.dispatch("lively", failed)).toMatchObject({ outcome: "rejected", accepted: false });
  expect(await first.dispatch("lively", failed)).toMatchObject({ outcome: "replayed", accepted: false });
});

test("switching accounts during evidence capture never mixes histories", async () => {
  const { options, signIn } = testStore();
  let finish!: (rows: ReturnType<typeof evidence>[]) => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const repository = new HabitsRepository({
    ...options, evidence: async () => new Promise(resolve => { finish = resolve; started(); }),
  });
  const collecting = repository.read("lively", "session-a");
  await waiting;
  signIn("another-account");
  finish([evidence("previous-account", firstDay)]);
  await expect(collecting).rejects.toThrow("account changed");
  expect(await repository.read("lively")).toMatchObject({ scope: "another-account", totalStudyDays: 0 });
  signIn(scope);
  expect(await repository.read("lively")).toMatchObject({ scope, totalStudyDays: 0 });
});

test("ranked receipts on the prior learning day preserve the real day and settle once", async () => {
  const { options, clock } = testStore();
  const store = new HabitsRepository(options);
  await store.read("lively");
  clock(date(1));
  const command = { type: "rankedStudy", scope, receipt: { id: "verified", subject: "maths", family: "fractions", checkedAt: firstDay, points: 8 } } as const;
  expect(await store.dispatch("lively", command)).toMatchObject({ accepted: true, day: "2026-11-03", actualStudyDays: ["2026-11-02"], studiedToday: false });
  expect(await store.dispatch("calm", command)).toMatchObject({ outcome: "replayed", totalStudyDays: 1 });
});

test("private evidence requires a released question and a deterministic or calibrated pass from the active lesson", async () => {
  const source = { documentId: "doc", revision: 1, nodeId: "node" };
  const presentation = { ...source, id: "doc:node", component: "question", sessionId: "active", planRef: null, createdAt: firstDay - 12 } satisfies OpenUiPresentationRecord;
  const check = { id: "first", topic: "Maths", question: "What is 3×2?", answer: "6", score: 1, grading: "auto", createdAt: firstDay, sessionId: "active", source } satisfies QuestionCheckRecord;
  const result = await privateQuestionEvidence([
    check,
    { ...check, id: "different-account", sessionId: "older" },
    { ...check, id: "self-grade", grading: "model", question: "How is this possible?" },
    { ...check, id: "zero", score: 0 },
    { ...check, id: "no-source", source: undefined },
  ], [presentation], "active", firstDay, firstDay);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ checkedAt: firstDay, mastery: 1, objective: "Maths" });
});
