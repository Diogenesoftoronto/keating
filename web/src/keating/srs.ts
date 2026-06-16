/**
 * SM-2 spaced repetition algorithm — Anki-compatible variant.
 *
 * Each card carries the SM-2 state vector: `ease`, `interval` (days), `reps`,
 * `lapses`. After every review the learner grades themselves 0..3:
 *   0 — Again  (failed recall; reset reps, schedule ~10 min later)
 *   1 — Hard   (recalled with serious difficulty; grow interval, ease -= 0.15)
 *   2 — Good   (recalled with some effort; grow interval, ease unchanged)
 *   3 — Easy   (recalled instantly; grow interval, ease += 0.15)
 *
 * The ease factor is clamped to [1.3, ∞) per SM-2. Intervals are clamped to
 * whole days with a 1-day minimum on success. The "Again" path uses a 10-minute
 * intra-day re-show window (`intervalDays < 1`).
 *
 * This is pure logic, easily testable, no LLM, no IO.
 */

export type SrsRating = 0 | 1 | 2 | 3;

export const SRS_RATING_LABELS: Record<SrsRating, string> = {
	0: "Again",
	1: "Hard",
	2: "Good",
	3: "Easy",
};

/** Initial SM-2 state for a freshly authored card. */
export function initialSrsState(now: number = Date.now()): CardSrsState {
	return {
		ease: 2.5,
		intervalDays: 0,
		reps: 0,
		lapses: 0,
		dueAt: now, // due immediately on creation
		lastReviewedAt: 0,
		lastRating: null,
	};
}

export interface CardSrsState {
	/** SM-2 ease factor (E-Factor). Clamped to >= 1.3. */
	ease: number;
	/** Current interval in days. < 1 means "due later today" (intra-day re-show). */
	intervalDays: number;
	/** Number of successful consecutive reviews (resets to 0 on Again). */
	reps: number;
	/** Total times this card was rated Again. */
	lapses: number;
	/** Timestamp at which the card becomes due. */
	dueAt: number;
	/** Timestamp of the most recent review (0 if never reviewed). */
	lastReviewedAt: number;
	/** Most recent rating, or null if never reviewed. */
	lastRating: SrsRating | null;
}

export const MS_PER_DAY = 86_400_000;
/** Intra-day re-show window when the learner rates Again. */
export const AGAIN_INTERVAL_MS = 10 * 60 * 1000;
/** Minimum ease factor (SM-2 floors at 1.3). */
export const MIN_EASE = 1.3;

export interface ReviewOutcome {
	/** The new SRS state. */
	next: CardSrsState;
	/** The interval, in days, applied after this review (for display). */
	appliedIntervalDays: number;
	/** True if the rating was a lapse (Again). */
	isLapse: boolean;
}

export function applyReview(
	state: CardSrsState,
	rating: SrsRating,
	now: number = Date.now(),
): ReviewOutcome {
	const next: CardSrsState = { ...state };

	if (rating === 0) {
		// Lapse: reset reps, schedule again in 10 minutes, ease drops.
		next.lapses = state.lapses + 1;
		next.reps = 0;
		next.intervalDays = 0;
		next.ease = Math.max(MIN_EASE, state.ease - 0.2);
		next.dueAt = now + AGAIN_INTERVAL_MS;
		next.lastReviewedAt = now;
		next.lastRating = rating;
		return { next, appliedIntervalDays: 0, isLapse: true };
	}

	// Successful recall
	const prevEase = state.ease;
	let easeDelta = 0;
	if (rating === 1) easeDelta = -0.15;
	else if (rating === 2) easeDelta = 0;
	else if (rating === 3) easeDelta = 0.15;
	const newEase = Math.max(MIN_EASE, prevEase + easeDelta);
	next.ease = newEase;
	next.reps = state.reps + 1;

	let interval: number;
	if (next.reps === 1) {
		interval = 1;
	} else if (next.reps === 2) {
		interval = 6;
	} else {
		// SM-2: I(n) = I(n-1) * EF
		interval = Math.max(1, Math.round(state.intervalDays * newEase));
	}

	// Hard shortens the interval a touch compared to Good.
	if (rating === 1 && next.reps > 2) {
		interval = Math.max(1, Math.round(interval * 0.8));
	}
	// Easy stretches it a bit.
	if (rating === 3 && next.reps > 2) {
		interval = Math.max(1, Math.round(interval * 1.3));
	}

	next.intervalDays = interval;
	next.dueAt = now + interval * MS_PER_DAY;
	next.lastReviewedAt = now;
	next.lastRating = rating;
	return { next, appliedIntervalDays: interval, isLapse: false };
}

export function isDue(state: CardSrsState, now: number = Date.now()): boolean {
	return state.dueAt <= now;
}

/** Format an interval in days as a human-readable string ("10m", "3d", "2w", "5mo"). */
export function formatInterval(intervalDays: number): string {
	if (intervalDays < 1 / 24 / 6) return "10m";
	if (intervalDays < 1) return `${Math.round(intervalDays * 24 * 60)}m`;
	if (intervalDays < 30) return `${Math.round(intervalDays)}d`;
	if (intervalDays < 365) return `${Math.round(intervalDays / 30)}mo`;
	return `${(intervalDays / 365).toFixed(1)}y`;
}

/** Format a timestamp as a relative due label ("now", "in 3d", "5d overdue"). */
export function formatDueIn(dueAt: number, now: number = Date.now()): string {
	const diffMs = dueAt - now;
	const days = diffMs / MS_PER_DAY;
	if (Math.abs(days) < 0.001) return "now";
	if (diffMs < 0) {
		const overdueDays = Math.abs(days);
		if (overdueDays < 1) {
			const overdueMin = Math.round(overdueDays * 24 * 60);
			return overdueMin <= 60 ? `${overdueMin}m overdue` : `${Math.round(overdueDays)}d overdue`;
		}
		return `${Math.round(overdueDays)}d overdue`;
	}
	if (days < 1) {
		const minutes = Math.round(days * 24 * 60);
		return minutes <= 60 ? `in ${minutes}m` : "in <1d";
	}
	return `in ${Math.round(days)}d`;
}

// ---------------------------------------------------------------------------
// Deck-level operations
// ---------------------------------------------------------------------------

export interface Flashcard {
	id: string;
	front: string;
	back: string;
	tags?: string[];
	srs: CardSrsState;
	createdAt: number;
	updatedAt: number;
}

export interface FlashcardDeck {
	id: string;
	topic: string;
	slug: string;
	title: string;
	description?: string;
	cards: Flashcard[];
	createdAt: number;
	updatedAt: number;
}

export function getDueCards(deck: FlashcardDeck, now: number = Date.now()): Flashcard[] {
	return deck.cards.filter((c) => isDue(c.srs, now));
}

export function getDeckStats(deck: FlashcardDeck, now: number = Date.now()): {
	total: number;
	dueNow: number;
	fresh: number;
	learning: number;
	review: number;
	mature: number;
} {
	let dueNow = 0;
	let fresh = 0;
	let learning = 0;
	let review = 0;
	let mature = 0;
	for (const card of deck.cards) {
		if (isDue(card.srs, now)) dueNow += 1;
		if (card.srs.reps === 0) fresh += 1;
		else if (card.srs.intervalDays < 21) learning += 1;
		else if (card.srs.intervalDays < 90) review += 1;
		else mature += 1;
	}
	return { total: deck.cards.length, dueNow, fresh, learning, review, mature };
}

/** Order the given due cards using a simple scheduler: lapses first, then oldest-due. */
export function scheduleDueCards(cards: Flashcard[], now: number = Date.now()): Flashcard[] {
	return [...cards].sort((a, b) => {
		// Lapses float to the top of the queue.
		if ((a.srs.lapses > 0) !== (b.srs.lapses > 0)) return a.srs.lapses > 0 ? -1 : 1;
		return a.srs.dueAt - b.srs.dueAt;
	});
}

// ---------------------------------------------------------------------------
// Validation (used by browser-tools to reject templated / empty decks)
// ---------------------------------------------------------------------------

export interface CardDraft {
	front?: unknown;
	back?: unknown;
	tags?: unknown;
}

export interface DeckValidationResult {
	ok: boolean;
	error?: string;
	cards?: Array<{ front: string; back: string; tags?: string[] }>;
}

const MIN_FRONT_CHARS = 3;
const MIN_BACK_CHARS = 3;
const MAX_CARDS = 200;

export function validateDeckDraft(rawCards: unknown): DeckValidationResult {
	if (!Array.isArray(rawCards)) {
		return { ok: false, error: "Pass `cards` as an array of {front, back} objects you author yourself." };
	}
	if (rawCards.length < 2) {
		return { ok: false, error: "Author at least 2 cards. Reuse specific facts/concepts from the lesson." };
	}
	if (rawCards.length > MAX_CARDS) {
		return { ok: false, error: `Too many cards (${rawCards.length}). Cap is ${MAX_CARDS} per deck.` };
	}
	const seenFronts = new Set<string>();
	const validated: Array<{ front: string; back: string; tags?: string[] }> = [];
	for (let i = 0; i < rawCards.length; i++) {
		const draft = rawCards[i] as CardDraft;
		if (!draft || typeof draft !== "object") {
			return { ok: false, error: `Card #${i + 1} is not an object.` };
		}
		const front = typeof draft.front === "string" ? draft.front.trim() : "";
		const back = typeof draft.back === "string" ? draft.back.trim() : "";
		if (front.length < MIN_FRONT_CHARS) {
			return { ok: false, error: `Card #${i + 1} front is too short (min ${MIN_FRONT_CHARS} chars).` };
		}
		if (back.length < MIN_BACK_CHARS) {
			return { ok: false, error: `Card #${i + 1} back is too short (min ${MIN_BACK_CHARS} chars).` };
		}
		const key = front.toLowerCase();
		if (seenFronts.has(key)) {
			return { ok: false, error: `Duplicate front text on card #${i + 1}. Author distinct cards.` };
		}
		seenFronts.add(key);
		const tags = Array.isArray(draft.tags)
			? draft.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
			: undefined;
		validated.push({ front, back, ...(tags && tags.length > 0 ? { tags } : {}) });
	}
	return { ok: true, cards: validated };
}
