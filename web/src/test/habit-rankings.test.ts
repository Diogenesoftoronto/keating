import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { H3Event } from "h3";
import { createRankedItem, type RankedSubject } from "../../server/utils/habit-rankings-items";
import { changeHabitRankings, parseRankCommand, parseRankScope } from "../../server/utils/habit-rankings-http";
import { HabitRankings } from "../../server/utils/habit-rankings";
import { RedisHabitRankingsStore, type HabitRankingsStore, type RankEdit, type SubjectScore } from "../../server/utils/habit-rankings-store";

class TestStore implements HabitRankingsStore {
  private values = new Map<string, string>();
  private rows = new Map<string, Map<string, number>>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async compareAndSet(edits: readonly RankEdit[], scores: readonly SubjectScore[]) {
    if (edits.some(edit => (this.values.get(edit.key) ?? null) !== edit.before)) return false;
    for (const edit of edits) if (edit.value !== undefined) this.values.set(edit.key, edit.value);
    for (const score of scores) {
      const board = this.rows.get(score.key) ?? new Map<string, number>();
      if (score.score === undefined) board.delete(score.member);
      else board.set(score.member, score.score);
      this.rows.set(score.key, board);
    }
    return true;
  }
  async leaders(key: string) {
    return [...(this.rows.get(key) ?? [])].sort((a, b) => b[1] - a[1]).map(([member, score]) => ({ member, score }));
  }
}

const ADA = "did:plc:ada";
const GRACE = "did:plc:grace";
const monday = Date.UTC(2026, 10, 23);
const DAY = 86_400_000;
const enroll = { type: "enroll", adultAttested: true } as const;
const paper = { division: 0, cohort: 1 };
const fixedItem: typeof createRankedItem = () => ({
  family: "repair", objective: "subject-context", route: "transfer", prompt: "What is 2 + 2?",
  choices: ["4", "5", "3"], correct: 0, explanation: "Add the two equal groups.",
});

function fixture(now = monday) {
  const rankings = new HabitRankings(new TestStore(), () => now, fixedItem);
  return { rankings, advance: (ms: number) => { now += ms; } };
}

async function correct(rankings: HabitRankings, subject: RankedSubject, account = ADA) {
  const started = await rankings.account(account, { type: "start", subject });
  return rankings.account(account, { type: "answer", attemptId: started.attempt!.id, choice: 0 });
}

describe("public habits rankings", () => {
  test("requires affirmative enrollment and closed, bound answer requests", async () => {
    expect(() => parseRankCommand({ type: "enroll", adultAttested: false })).toThrow("Invalid rankings request.");
    expect(() => parseRankCommand({ type: "enroll", adultAttested: true, email: "ada@invalid.test" })).toThrow();
    expect(() => parseRankCommand({ type: "answer", attemptId: randomUUID(), choice: 0, lp: 600 })).toThrow();
    expect(() => parseRankScope(new URLSearchParams("subject=toString"))).toThrow();
    expect(() => parseRankScope(new URLSearchParams("division=8"))).toThrow();
    expect(parseRankScope(new URLSearchParams("subject=maths"))).toEqual({ subject: "maths" });
    const crossOrigin = new H3Event(new Request("https://keating.example/api/habits/rankings/me", {
      method: "POST", body: JSON.stringify(enroll), headers: { origin: "https://other.example", "content-type": "application/json" },
    }));
    await expect(changeHabitRankings(crossOrigin)).rejects.toMatchObject({ statusCode: 403 });
  });

  test("keeps preview private and projects only alias, division, rank and LP", async () => {
    const { rankings } = fixture();
    const preview = await rankings.account(ADA);
    expect(preview.active).toBe(false);
    expect(preview.row.rank).toBeNull();
    expect((await rankings.board(paper)).rows).toEqual([]);
    await expect(rankings.account(ADA, { type: "start", subject: "maths" })).rejects.toMatchObject({ statusCode: 409 });
    const joined = await rankings.account(ADA, enroll);
    expect(joined.row.alias).toBe(preview.row.alias);
    expect(Object.keys((await rankings.board(paper)).rows[0]!).sort()).toEqual(["alias", "division", "lp", "rank"]);
    expect((await rankings.board({ subject: "maths" })).rows).toEqual([]);
  });

  test("attempts are single-use, account-bound and idempotent in concurrent submissions", async () => {
    const { rankings } = fixture();
    for (const did of [ADA, GRACE]) await rankings.account(did, enroll);
    const started = await rankings.account(ADA, { type: "start", subject: "coding" });
    expect(Object.keys(started.attempt!).sort()).toEqual(["choices", "expiresAt", "id", "prompt", "subject"]);
    const command = { type: "answer", attemptId: started.attempt!.id, choice: 0 } as const;
    await expect(rankings.account(GRACE, command)).rejects.toMatchObject({ statusCode: 409 });
    const [one, replay] = await Promise.all([rankings.account(ADA, command), rankings.account(ADA, command)]);
    expect(one.result?.receipt?.points).toBe(24);
    expect(replay.result?.receipt).toEqual(one.result?.receipt);
    await expect(rankings.account(ADA, { ...command, choice: 2 })).rejects.toMatchObject({ statusCode: 409 });
    expect((await rankings.board({ subject: "coding" })).rows[0]?.lp).toBe(24);
    const wrong = await rankings.account(ADA, { type: "start", subject: "coding" });
    const result = await rankings.account(ADA, { type: "answer", attemptId: wrong.attempt!.id, choice: 2 });
    expect(result.result).toMatchObject({ correct: false, receipt: null });
    expect(result.row.lp).toBe(24);
  });

  test("separates subjects, applies repeated practice decay and caps the day's LP", async () => {
    const first = fixture().rankings;
    await first.account(ADA, enroll);
    expect((await correct(first, "coding")).result?.receipt?.points).toBe(24);
    expect((await correct(first, "coding")).result?.receipt?.points).toBe(12);
    expect((await correct(first, "coding")).result?.receipt?.points).toBe(4);
    expect((await correct(first, "coding")).result?.receipt).toBeNull();
    expect((await correct(first, "maths")).result?.receipt?.points).toBe(24);
    expect((await correct(first, "history")).result?.receipt?.points).toBe(16);
    expect((await correct(first, "law")).result?.receipt).toBeNull();
    expect((await first.board({ subject: "maths" })).rows[0]?.lp).toBe(24);
    expect((await first.board(paper)).rows[0]?.lp).toBe(80);
  });

  test("withdrawal removes every projection without resetting repeat limits", async () => {
    const { rankings } = fixture();
    await rankings.account(ADA, enroll);
    await correct(rankings, "maths");
    await correct(rankings, "coding");
    await rankings.account(ADA, { type: "withdraw" });
    expect((await rankings.board(paper)).rows).toEqual([]);
    expect((await rankings.board({ subject: "maths" })).rows).toEqual([]);
    expect((await rankings.board({ subject: "coding" })).rows).toEqual([]);
    const rejoined = await rankings.account(ADA, enroll);
    expect(rejoined.row.lp).toBe(48);
    expect((await correct(rankings, "coding")).result?.receipt?.points).toBe(12);
  });

  test("rolls over at Monday UTC, moves eligible standings, and keeps expired answers closed", async () => {
    const { rankings, advance } = fixture(monday + 7 * DAY - 1000);
    for (const account of [ADA, ...Array.from({ length: 6 }, (_, index) => `did:plc:cohort-${index}`)]) await rankings.account(account, enroll);
    await correct(rankings, "maths");
    const started = await rankings.account(ADA, { type: "start", subject: "maths" });
    advance(1000);
    expect((await rankings.board(paper)).rows).toEqual([]);
    const next = await rankings.account(ADA);
    expect(next.row).toMatchObject({ division: "Chalk", lp: 0 });
    expect(next.previous).toEqual({ result: "promoted", rank: 1, lp: 24 });
    await expect(rankings.account(ADA, { type: "answer", attemptId: started.attempt!.id, choice: 0 })).rejects.toMatchObject({ statusCode: 409 });
  });

  test("allocates a new cohort on the 31st enrollment", async () => {
    const { rankings } = fixture();
    for (let index = 0; index < 30; index++) await rankings.account(`did:plc:cohort-${index}`, enroll);
    const next = await rankings.account(ADA, enroll);
    expect(next.scope.cohort).toBe(2);
    expect((await rankings.board(paper)).rows).toHaveLength(30);
    expect((await rankings.board({ division: 0, cohort: 2 })).rows.map(item => item.alias)).toEqual([next.row.alias]);
  });

  test("serves distinct answer options from each authored question family", () => {
    const subjects = ["maths", "coding", "chemistry", "biology", "music", "spanish", "history", "law"] as const;
    for (const subject of subjects) {
      const first = createRankedItem(subject, () => 0);
      const second = createRankedItem(subject, family => Number(family === first.family));
      expect(second.family).not.toBe(first.family);
      for (const item of [first, second]) {
        expect(new Set(item.choices).size).toBe(3);
        expect(item.choices[item.correct]).toBeTruthy();
      }
    }
  });
});

test.skipIf(!process.env.KEATING_TEST_RANKINGS_REDIS_URL)("Redis atomically scores and withdraws across two instances", async () => {
  const url = process.env.KEATING_TEST_RANKINGS_REDIS_URL!;
  const namespace = "test:" + randomUUID();
  const left = new RedisHabitRankingsStore(url, namespace);
  const right = new RedisHabitRankingsStore(url, namespace);
  try {
    const a = new HabitRankings(left, () => monday, fixedItem);
    const b = new HabitRankings(right, () => monday, fixedItem);
    const enrolled = await a.account(ADA, enroll);
    expect((await b.board(paper)).rows[0]?.alias).toBe(enrolled.row.alias);
    const started = await a.account(ADA, { type: "start", subject: "maths" });
    const answer = { type: "answer", attemptId: started.attempt!.id, choice: 0 } as const;
    const results = await Promise.all([a.account(ADA, answer), b.account(ADA, answer)]);
    expect(results[0].result).toEqual(results[1].result);
    expect((await a.board({ subject: "maths" })).rows[0]?.lp).toBe(24);
    await b.account(ADA, { type: "withdraw" });
    expect((await a.board(paper)).rows).toEqual([]);
    expect((await a.board({ subject: "maths" })).rows).toEqual([]);
  } finally { left.close(); right.close(); }
});
