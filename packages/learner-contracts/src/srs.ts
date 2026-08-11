import { isContractTimestamp } from "./validation.js";

/** Ratings deliberately match Keating's web SM-2 variant. */
export type SrsRating = 0 | 1 | 2 | 3;

/** Canonical, portable state for one flashcard's next-review schedule. */
export interface CardSrsState {
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: string;
  /** Null is the portable equivalent of the web runtime's initial `0`. */
  lastReviewedAt: string | null;
  lastRating: SrsRating | null;
}

export interface SrsReviewOutcome {
  next: CardSrsState;
  appliedIntervalDays: number;
  isLapse: boolean;
}

export interface SrsReplayEvent {
  rating: SrsRating;
  createdAt: string;
}

const MS_PER_DAY = 86_400_000;
export const AGAIN_INTERVAL_MS = 10 * 60 * 1000;
export const MIN_EASE = 1.3;

function timestampMillis(value: string): number {
  if (!isContractTimestamp(value)) throw new Error("SRS timestamps must be canonical UTC timestamps.");
  return Date.parse(value);
}

function timestampAfter(value: string, milliseconds: number): string {
  return new Date(timestampMillis(value) + milliseconds).toISOString();
}

function isRating(value: unknown): value is SrsRating {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function validateCardSrsState(value: unknown): value is CardSrsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<CardSrsState>;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 7 || !keys.every((key) => typeof key === "string" && [
    "ease", "intervalDays", "repetitions", "lapses", "dueAt", "lastReviewedAt", "lastRating",
  ].includes(key))) return false;
  const reviewPairIsConsistent = state.lastReviewedAt === null
    ? state.lastRating === null && state.repetitions === 0 && state.intervalDays === 0
    : isRating(state.lastRating);
  return typeof state.ease === "number" && Number.isFinite(state.ease) && state.ease >= MIN_EASE
    && typeof state.intervalDays === "number" && Number.isFinite(state.intervalDays) && state.intervalDays >= 0
    && typeof state.repetitions === "number" && Number.isSafeInteger(state.repetitions) && state.repetitions >= 0
    && typeof state.lapses === "number" && Number.isSafeInteger(state.lapses) && state.lapses >= 0
    && typeof state.dueAt === "string" && isContractTimestamp(state.dueAt)
    && (state.lastReviewedAt === null || (typeof state.lastReviewedAt === "string" && isContractTimestamp(state.lastReviewedAt)))
    && reviewPairIsConsistent;
}

/** Fresh cards are due immediately, just as on the web surface. */
export function initialSrsState(now: string): CardSrsState {
  timestampMillis(now);
  return {
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    dueAt: now,
    lastReviewedAt: null,
    lastRating: null,
  };
}

/**
 * Keating's SM-2-compatible scheduler. Its intervals and ease adjustments
 * intentionally match `web/src/keating/srs.ts`; only timestamps are ISO here
 * so they can cross persistence boundaries without locale ambiguity.
 */
export function applyReview(state: CardSrsState, rating: SrsRating, now: string): SrsReviewOutcome {
  if (!validateCardSrsState(state)) throw new Error("Cannot schedule an invalid card SRS state.");
  if (!isRating(rating)) throw new Error("SRS rating must be 0, 1, 2, or 3.");
  timestampMillis(now);
  const next: CardSrsState = { ...state, lastReviewedAt: now, lastRating: rating };

  if (rating === 0) {
    next.lapses = state.lapses + 1;
    next.repetitions = 0;
    next.intervalDays = 0;
    next.ease = Math.max(MIN_EASE, state.ease - 0.2);
    next.dueAt = timestampAfter(now, AGAIN_INTERVAL_MS);
    return { next, appliedIntervalDays: 0, isLapse: true };
  }

  let easeDelta = 0;
  if (rating === 1) easeDelta = -0.15;
  else if (rating === 3) easeDelta = 0.15;
  const newEase = Math.max(MIN_EASE, state.ease + easeDelta);
  next.ease = newEase;
  next.repetitions = state.repetitions + 1;

  let interval: number;
  if (next.repetitions === 1) interval = 1;
  else if (next.repetitions === 2) interval = 6;
  else interval = Math.max(1, Math.round(state.intervalDays * newEase));
  if (rating === 1 && next.repetitions > 2) interval = Math.max(1, Math.round(interval * 0.8));
  if (rating === 3 && next.repetitions > 2) interval = Math.max(1, Math.round(interval * 1.3));

  next.intervalDays = interval;
  next.dueAt = timestampAfter(now, interval * MS_PER_DAY);
  return { next, appliedIntervalDays: interval, isLapse: false };
}

/** The immutable due-time component of a persisted review outcome. */
export function dueAtAfterReview(createdAt: string, rating: SrsRating, appliedIntervalDays: number): string {
  timestampMillis(createdAt);
  if (!isRating(rating) || !Number.isSafeInteger(appliedIntervalDays) || appliedIntervalDays < 0) {
    throw new Error("Cannot calculate due time for an invalid SRS review outcome.");
  }
  if (rating === 0) {
    if (appliedIntervalDays !== 0) throw new Error("Again reviews must have a zero-day interval.");
    return timestampAfter(createdAt, AGAIN_INTERVAL_MS);
  }
  if (appliedIntervalDays < 1) throw new Error("Successful reviews must have a positive whole-day interval.");
  return timestampAfter(createdAt, appliedIntervalDays * MS_PER_DAY);
}

export function isDue(state: CardSrsState, now: string): boolean {
  if (!validateCardSrsState(state)) throw new Error("Cannot inspect an invalid card SRS state.");
  return timestampMillis(state.dueAt) <= timestampMillis(now);
}

/** Replay is useful for deterministic fixtures and for checking imported review histories. */
export function replaySrsEvents(initial: CardSrsState, events: readonly SrsReplayEvent[]): CardSrsState {
  let current = structuredClone(initial);
  let previous = current.lastReviewedAt;
  for (const event of events) {
    if (!isRating(event.rating) || !isContractTimestamp(event.createdAt)) {
      throw new Error("Cannot replay an invalid SRS event.");
    }
    if (previous && Date.parse(event.createdAt) < Date.parse(previous)) {
      throw new Error("SRS replay events must be chronological.");
    }
    current = applyReview(current, event.rating, event.createdAt).next;
    previous = event.createdAt;
  }
  return current;
}

export function formatInterval(intervalDays: number): string {
  if (!Number.isFinite(intervalDays) || intervalDays < 0) throw new Error("SRS interval must be a non-negative finite number.");
  if (intervalDays < 1 / 24 / 6) return "10m";
  if (intervalDays < 1) return `${Math.round(intervalDays * 24 * 60)}m`;
  if (intervalDays < 30) return `${Math.round(intervalDays)}d`;
  if (intervalDays < 365) return `${Math.round(intervalDays / 30)}mo`;
  return `${(intervalDays / 365).toFixed(1)}y`;
}

export function formatDueIn(dueAt: string, now: string): string {
  const diffMs = timestampMillis(dueAt) - timestampMillis(now);
  const days = diffMs / MS_PER_DAY;
  if (Math.abs(days) < 0.001) return "now";
  if (diffMs < 0) {
    const overdueDays = Math.abs(days);
    if (overdueDays < 1) {
      const overdueMinutes = Math.round(overdueDays * 24 * 60);
      return overdueMinutes <= 60 ? `${overdueMinutes}m overdue` : `${Math.round(overdueDays)}d overdue`;
    }
    return `${Math.round(days * -1)}d overdue`;
  }
  if (days < 1) {
    const minutes = Math.round(days * 24 * 60);
    return minutes <= 60 ? `in ${minutes}m` : "in <1d";
  }
  return `in ${Math.round(days)}d`;
}
