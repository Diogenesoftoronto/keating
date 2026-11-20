import type { RecessQuestionKind } from "../../components/recess/types";

/**
 * How a learner has done on each kind of Recess problem, so the next run can lean toward the kinds
 * they miss and away from the ones they have down. Per device and per account scope; recent runs
 * count more than old ones. A convenience, never a grade: losing it only makes the next mix generic.
 */
export interface KindRecord { right: number; missed: number; at: number }
export type RecessMastery = Partial<Record<RecessQuestionKind, KindRecord>>;

const KEY = "keating:recess-mastery";
/** Each new run counts fully; older runs fade by half every two weeks. */
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function decay(record: KindRecord, now: number): KindRecord {
  const k = Math.pow(0.5, Math.max(0, now - record.at) / HALF_LIFE_MS);
  return { right: record.right * k, missed: record.missed * k, at: now };
}

export function readRecessMastery(scope: string, now = Date.now()): RecessMastery {
  try {
    const all = JSON.parse(storage()?.getItem(KEY) ?? "{}") as Record<string, RecessMastery>;
    const mine = all?.[scope];
    if (!mine || typeof mine !== "object") return {};
    const out: RecessMastery = {};
    for (const [kind, record] of Object.entries(mine)) {
      if (record && Number.isFinite(record.right) && Number.isFinite(record.missed) && Number.isFinite(record.at)) out[kind as RecessQuestionKind] = decay(record, now);
    }
    return out;
  } catch { return {}; }
}

/** Record one run's answered gates (and the Second Wind question) by kind. Unanswered or kindless items are skipped. */
export function recordRecessKinds(scope: string, answered: readonly { kind?: string; ok: boolean; picked: string | null }[], now = Date.now()) {
  const store = storage();
  if (!store || !answered.length) return;
  try {
    const all = JSON.parse(store.getItem(KEY) ?? "{}") as Record<string, RecessMastery>;
    const mine = readRecessMastery(scope, now);
    for (const item of answered) {
      if (!item.kind) continue;
      const kind = item.kind as RecessQuestionKind;
      const record = mine[kind] ?? { right: 0, missed: 0, at: now };
      // A timed-out pick counts as a miss: the learner did not know it in time.
      if (item.ok) record.right += 1; else record.missed += 1;
      record.at = now;
      mine[kind] = record;
    }
    all[scope] = mine;
    store.setItem(KEY, JSON.stringify(all));
  } catch { /* per-device convenience only */ }
}

/**
 * How much the next run should want a kind: above 1 for kinds the learner misses, below 1 for kinds
 * they reliably get right, 1 for anything unseen. Bounded so no kind is ever ruled out or forced.
 */
export function kindWeight(mastery: RecessMastery, kind: RecessQuestionKind | undefined): number {
  const record = kind ? mastery[kind] : undefined;
  if (!record) return 1;
  const seen = record.right + record.missed;
  if (seen < 0.5) return 1;
  // Laplace-smoothed miss rate: one miss in one try is a hint, not a verdict.
  const missRate = (record.missed + 0.5) / (seen + 1);
  return Math.min(1.8, Math.max(0.55, 0.55 + missRate * 1.6));
}
