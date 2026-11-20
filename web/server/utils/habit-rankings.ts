import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRankedItem, RANKED_SUBJECTS, type RankedItem, type RankedSubject } from "./habit-rankings-items";
import type { HabitRankingsStore, RankEdit, SubjectScore } from "./habit-rankings-store";

export const RANK_DIVISIONS = ["Paper", "Chalk", "Ink", "Brass", "Copper", "Phosphor", "Emerald", "Laureate"] as const;
const DAY = 86_400_000;
const ATTEMPT_TTL = 10 * 60_000;
const BOARD_TTL = 28 * 86_400;
const COHORT_SIZE = 30;
const DAILY_LP_CAP = 80;
const DAILY_ATTEMPT_CAP = 16;
const LP_FACTOR = 1_000_000_000;
const TRANSFER_FACTOR = 1_000_000;
const DAYS_FACTOR = 100_000;
const REPEAT_WEIGHTS = [1, 0.5, 0.2] as const;
const ALIAS_WORDS = ["Cedar Quill", "Quiet Prism", "Moss Circuit", "Aster Lantern", "River Atlas", "Amber Margin", "Linen Comet", "Indigo Dial"];

export type RankCommand =
  | { type: "enroll"; adultAttested: true }
  | { type: "withdraw" }
  | { type: "start"; subject: RankedSubject }
  | { type: "answer"; attemptId: string; choice: number }
  | { type: "accept-demotion" };
export type RankScope = { division: number; cohort: number } | { subject: RankedSubject };

type Score = { lp: number; transfers: number; days: number[] };
type CohortRow = { alias: string; order: number };
type Cohort = { rows: CohortRow[] };
type Weekly = {
  startsDay: number;
  cohort: number;
  total: Score;
  subjects: Partial<Record<RankedSubject, Score>>;
};
type Attempt = { id: string; subject: RankedSubject; item: RankedItem; expiresAt: number };
type RankReceipt = { id: string; subject: RankedSubject; family: string; checkedAt: number; points: number };
type CheckedAnswer = { correct: boolean; explanation: string; receipt: RankReceipt | null };
type Account = {
  alias: string;
  consentAt: number | null;
  division: number;
  week?: Weekly;
  attempt?: Attempt;
  attemptBudget?: { day: number; count: number };
  lastAnswer?: { id: string; choice: number; result: CheckedAnswer };
  rewarded: { day: number; at: number; family: string; points: number }[];
  lastObjective: Record<string, number>;
  previous?: { rank: number | null; lp: number; result: "promoted" | "held" | "demoted" };
  appeal?: { endsAt: number; passed: string[] };
};

export class RankRequestError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

function dayFor(now: number): number { return Math.floor(now / DAY); }
function weekFor(now: number): number { return Math.floor((dayFor(now) + 3) / 7) * 7 - 3; }
function weekClose(week: number): number { return (week + 7) * DAY; }
function cohortKey(week: number, division: number, cohort: number): string { return `week:${week}:cohort:${division}:${cohort}`; }
function subjectKey(week: number, subject: RankedSubject): string { return `week:${week}:subject:${subject}`; }
function emptyScore(): Score { return { lp: 0, transfers: 0, days: [] }; }
function seed(alias: string, week: number): number {
  return createHash("sha256").update(`${week}:${alias}`).digest().readUInt32BE() % DAYS_FACTOR;
}

function order(score: Score, alias: string, week: number): number {
  return score.lp * LP_FACTOR + score.transfers * TRANSFER_FACTOR + score.days.length * DAYS_FACTOR + seed(alias, week);
}

function compareRows(a: CohortRow, b: CohortRow): number {
  return b.order - a.order || b.alias.localeCompare(a.alias, "en");
}

function row(alias: string, division: number, rank: number | null, lp: number) {
  return { alias, division: RANK_DIVISIONS[division]!, rank, lp };
}

function newAccount(): Account {
  const bytes = randomBytes(7);
  const word = ALIAS_WORDS[bytes[0]! % ALIAS_WORDS.length]!;
  return {
    alias: `${word} · ${bytes.subarray(1).toString("hex").toUpperCase()}`,
    consentAt: null, division: 0, rewarded: [], lastObjective: {},
  };
}

class RankTransaction {
  private readonly reads = new Map<string, RankEdit>();
  private readonly scores: SubjectScore[] = [];
  constructor(private readonly store: HabitRankingsStore) {}

  async get<T>(key: string): Promise<T | null> {
    let edit = this.reads.get(key);
    if (!edit) {
      edit = { key, before: await this.store.get(key) };
      this.reads.set(key, edit);
    }
    const raw = edit.value ?? edit.before;
    return raw === null ? null : JSON.parse(raw) as T;
  }

  set(key: string, value: unknown, ttl?: number): void {
    const edit = this.reads.get(key);
    if (!edit) throw new Error("Read the ranking record before changing it.");
    const serialized = JSON.stringify(value);
    edit.value = serialized === edit.before ? undefined : serialized;
    edit.ttl = ttl;
  }

  project(score: SubjectScore): void { this.scores.push(score); }

  commit(): Promise<boolean> {
    const edits = [...this.reads.values()];
    return edits.some(edit => edit.value !== undefined) || this.scores.length
      ? this.store.compareAndSet(edits, this.scores)
      : Promise.resolve(true);
  }
}

export class HabitRankings {
  constructor(
    private readonly store: HabitRankingsStore,
    private readonly clock: () => number = Date.now,
    private readonly itemFor: typeof createRankedItem = createRankedItem,
  ) {}

  async board(scope: RankScope) {
    const now = this.clock(), startsDay = weekFor(now);
    const subjects = Object.entries(RANKED_SUBJECTS).map(([id, label]) => ({ id, label }));
    let rows;
    if ("subject" in scope) {
      const leaders = await this.store.leaders(subjectKey(startsDay, scope.subject));
      rows = leaders.map(({ member, score }, index) => {
        const split = member.indexOf("|");
        return row(member.slice(split + 1), Number(member.slice(0, split)), index + 1, Math.floor(score / LP_FACTOR));
      });
    } else {
      const raw = await this.store.get(cohortKey(startsDay, scope.division, scope.cohort));
      const board = raw ? JSON.parse(raw) as Cohort : { rows: [] };
      rows = board.rows.sort(compareRows)
        .map((entry, index) => row(entry.alias, scope.division, index + 1, Math.floor(entry.order / LP_FACTOR)));
    }
    return { rows, closesAt: weekClose(startsDay), divisions: RANK_DIVISIONS, subjects };
  }

  async account(did: string, command?: RankCommand) {
    const key = "account:" + createHash("sha256").update(did).digest("hex");
    for (let retry = 0; retry < 6; retry++) {
      const now = this.clock();
      const transaction = new RankTransaction(this.store);
      const profile = await transaction.get<Account>(key) ?? newAccount();
      await this.reconcile(transaction, profile, now);
      const result = command ? await this.apply(transaction, profile, command, now) : null;
      const view = await this.view(transaction, profile, now);
      transaction.set(key, profile);
      if (await transaction.commit()) return { ...view, result };
    }
    throw new RankRequestError(409, "Your standings changed. Please try again.");
  }

  private async reconcile(transaction: RankTransaction, profile: Account, now: number) {
    const previous = profile.week;
    const current = weekFor(now);
    if (previous && previous.startsDay !== current) {
      if (profile.consentAt !== null) {
        const cohort = await transaction.get<Cohort>(cohortKey(previous.startsDay, profile.division, previous.cohort));
        const position = cohort?.rows.sort(compareRows).findIndex(entry => entry.alias === profile.alias) ?? -1;
        const rank = position < 0 ? null : position + 1;
        profile.previous = { rank, lp: previous.total.lp, result: "held" };
        // A learner must earn points in a cohort with enough places to compete for promotion.
        if (rank !== null && rank <= 6 && (cohort?.rows.length ?? 0) >= 7 && previous.total.lp > 0 && profile.division < RANK_DIVISIONS.length - 1) {
          profile.division++;
          profile.previous.result = "promoted";
        } else if (rank !== null && rank >= 25 && profile.division > 0) {
          profile.appeal = { endsAt: weekClose(previous.startsDay) + DAY, passed: [] };
        }
      }
      delete profile.week;
      delete profile.attempt;
    }
    if (profile.appeal && now >= profile.appeal.endsAt) this.finishAppeal(profile, false);
    profile.rewarded = profile.rewarded.filter(receipt => now - receipt.at < 7 * DAY);
    if (profile.attempt && now >= profile.attempt.expiresAt) delete profile.attempt;
    if (profile.consentAt !== null && !profile.appeal && !profile.week) await this.joinWeek(transaction, profile, current);
  }

  private async joinWeek(transaction: RankTransaction, profile: Account, week: number) {
    const counterKey = `week:${week}:count:${profile.division}`;
    const seats = (await transaction.get<number>(counterKey) ?? 0) + 1;
    transaction.set(counterKey, seats, BOARD_TTL);
    profile.week = { startsDay: week, cohort: Math.ceil(seats / COHORT_SIZE), total: emptyScore(), subjects: {} };
    await this.publish(transaction, profile, true);
  }

  private async publish(transaction: RankTransaction, profile: Account, active: boolean) {
    const week = profile.week;
    if (!week) return;
    const key = cohortKey(week.startsDay, profile.division, week.cohort);
    const cohort = await transaction.get<Cohort>(key) ?? { rows: [] };
    cohort.rows = cohort.rows.filter(entry => entry.alias !== profile.alias);
    if (active) cohort.rows.push({ alias: profile.alias, order: order(week.total, profile.alias, week.startsDay) });
    transaction.set(key, cohort, BOARD_TTL);
    for (const [subject, score] of Object.entries(week.subjects) as [RankedSubject, Score][]) {
      transaction.project({
        key: subjectKey(week.startsDay, subject),
        member: `${profile.division}|${profile.alias}`,
        ...(active ? { score: order(score, profile.alias, week.startsDay) } : {}),
        ttl: BOARD_TTL,
      });
    }
  }

  private finishAppeal(profile: Account, success: boolean): void {
    delete profile.appeal;
    delete profile.attempt;
    if (!success) {
      profile.division--;
      if (profile.previous) profile.previous.result = "demoted";
    }
  }

  private async apply(transaction: RankTransaction, profile: Account, command: RankCommand, now: number): Promise<CheckedAnswer | null> {
    if (command.type === "enroll") {
      if (profile.consentAt !== null) return null;
      profile.consentAt = now;
      if (profile.week) await this.publish(transaction, profile, true);
      else if (!profile.appeal) await this.joinWeek(transaction, profile, weekFor(now));
      return null;
    }
    if (command.type === "withdraw") {
      await this.publish(transaction, profile, false);
      profile.consentAt = null;
      delete profile.attempt;
      delete profile.lastAnswer;
      return null;
    }
    if (profile.consentAt === null) throw new RankRequestError(409, "Join public rankings to start ranked questions.");
    if (command.type === "accept-demotion") {
      if (!profile.appeal) throw new RankRequestError(409, "There is no active division appeal.");
      this.finishAppeal(profile, false);
      await this.joinWeek(transaction, profile, weekFor(now));
      return null;
    }
    if (command.type === "start") {
      if (profile.attempt) return null;
      const day = dayFor(now);
      const budget = profile.attemptBudget?.day === day ? profile.attemptBudget : { day, count: 0 };
      if (budget.count >= DAILY_ATTEMPT_CAP) throw new RankRequestError(429, "You have reached today's ranked question limit.");
      const item = this.itemFor(command.subject, family => {
        const id = `${command.subject}:${family}`;
        if (profile.appeal) return Number(profile.appeal.passed.includes(id));
        return profile.rewarded.filter(receipt => receipt.family === id).length;
      });
      profile.attemptBudget = { day, count: budget.count + 1 };
      profile.attempt = {
        id: randomUUID(), subject: command.subject, item,
        expiresAt: Math.min(now + ATTEMPT_TTL, profile.appeal?.endsAt ?? weekClose(weekFor(now))),
      };
      return null;
    }
    const previous = profile.lastAnswer;
    if (previous?.id === command.attemptId && previous.choice === command.choice) return previous.result;
    const attempt = profile.attempt;
    if (attempt?.id !== command.attemptId) throw new RankRequestError(409, "This question has ended. Start a new one.");
    delete profile.attempt;
    const correct = command.choice === attempt.item.correct;
    const result: CheckedAnswer = { correct, explanation: attempt.item.explanation, receipt: null };
    if (correct && profile.appeal) {
      const family = `${attempt.subject}:${attempt.item.family}`;
      if (!profile.appeal.passed.includes(family)) profile.appeal.passed.push(family);
      if (profile.appeal.passed.length >= 2) {
        this.finishAppeal(profile, true);
        await this.joinWeek(transaction, profile, weekFor(now));
      }
    } else if (correct && profile.week) {
      result.receipt = this.award(profile, profile.week, attempt, now);
      if (result.receipt) await this.publish(transaction, profile, true);
    }
    profile.lastAnswer = { id: attempt.id, choice: command.choice, result };
    return result;
  }

  private award(profile: Account, week: Weekly, attempt: Attempt, now: number): RankReceipt | null {
    const { item, subject } = attempt;
    const day = dayFor(now), family = `${subject}:${item.family}`, objective = `${subject}:${item.objective}`;
    const uses = profile.rewarded.filter(receipt => receipt.family === family).length;
    const earnedToday = profile.rewarded.filter(receipt => receipt.day === day).reduce((total, receipt) => total + receipt.points, 0);
    const last = profile.lastObjective[objective];
    const spacing = last !== undefined && now - last >= 3 * DAY ? 1.25 : 1;
    // Full credit corresponds to mastery m = 1 for these closed, authored questions.
    const base = item.route === "transfer" ? 24 : 8;
    const points = Math.min(DAILY_LP_CAP - earnedToday, Math.floor(base * spacing * (REPEAT_WEIGHTS[uses] ?? 0)));
    profile.lastObjective[objective] = now;
    if (points <= 0) return null;
    const topic = week.subjects[subject] ??= emptyScore();
    for (const score of [week.total, topic]) {
      score.lp += points;
      if (item.route === "transfer") score.transfers++;
      if (!score.days.includes(day)) score.days.push(day);
    }
    profile.rewarded.push({ day, at: now, family, points });
    return { id: attempt.id, subject, family, checkedAt: now, points };
  }

  private async view(transaction: RankTransaction, profile: Account, now: number) {
    const week = profile.week;
    const active = profile.consentAt !== null;
    const board = active && week ? await transaction.get<Cohort>(cohortKey(week.startsDay, profile.division, week.cohort)) : null;
    const index = board?.rows.sort(compareRows).findIndex(entry => entry.alias === profile.alias) ?? -1;
    const attempt = profile.attempt;
    return {
      active,
      row: row(profile.alias, profile.division, index < 0 ? null : index + 1, week?.total.lp ?? 0),
      scope: { division: profile.division, cohort: week?.cohort ?? 1 },
      closesAt: weekClose(weekFor(now)),
      previous: profile.previous ?? null,
      appeal: profile.appeal ? { endsAt: profile.appeal.endsAt, passed: profile.appeal.passed.length } : null,
      // The checked answer, explanation and challenge metadata never leave this endpoint before submission.
      attempt: attempt ? { id: attempt.id, subject: attempt.subject, prompt: attempt.item.prompt, choices: attempt.item.choices, expiresAt: attempt.expiresAt } : null,
    };
  }
}
