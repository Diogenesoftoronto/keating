import { describe, expect, it } from "bun:test";

import {
	applyReview,
	formatDueIn,
	formatInterval,
	getDeckStats,
	getDueCards,
	initialSrsState,
	isDue,
	MIN_EASE,
	scheduleDueCards,
	validateDeckDraft,
	type Flashcard,
	type FlashcardDeck,
} from "../keating/srs";

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
	const now = overrides.createdAt ?? Date.now();
	return {
		id: overrides.id ?? `card-${Math.random().toString(36).slice(2)}`,
		front: overrides.front ?? "Front",
		back: overrides.back ?? "Back",
		srs: overrides.srs ?? initialSrsState(now),
		createdAt: now,
		updatedAt: now,
		...(overrides.tags ? { tags: overrides.tags } : {}),
	};
}

function makeDeck(cards: Flashcard[]): FlashcardDeck {
	const now = Date.now();
	return {
		id: "deck-1",
		topic: "Test topic",
		slug: "test-topic",
		title: "Test deck",
		cards,
		createdAt: now,
		updatedAt: now,
	};
}

describe("SM-2 flashcard SRS", () => {
	it("applies the first successful review as a 1-day interval", () => {
		const now = 1_000_000;
		const srs = initialSrsState(now);
		const outcome = applyReview(srs, 2, now + 60_000);
		expect(outcome.appliedIntervalDays).toBe(1);
		expect(outcome.isLapse).toBe(false);
		expect(outcome.next.reps).toBe(1);
		expect(outcome.next.ease).toBe(2.5);
		expect(outcome.next.dueAt).toBe(now + 60_000 + 86_400_000);
	});

	it("applies the second successful review as a 6-day interval", () => {
		const now = 0;
		let srs = initialSrsState(now);
		srs = applyReview(srs, 2, now).next;
		const second = applyReview(srs, 2, now + 86_400_000);
		expect(second.appliedIntervalDays).toBe(6);
		expect(second.next.reps).toBe(2);
	});

	it("scales intervals past the second review by the ease factor", () => {
		const now = 0;
		let srs = initialSrsState(now);
		srs = applyReview(srs, 2, now).next; // 1d
		srs = applyReview(srs, 2, now).next; // 6d
		const third = applyReview(srs, 2, now);
		// 6 * 2.5 = 15
		expect(third.appliedIntervalDays).toBe(15);
		expect(third.next.reps).toBe(3);
	});

	it("shortens interval on Hard and lengthens on Easy", () => {
		const now = 0;
		let srs = initialSrsState(now);
		srs = applyReview(srs, 2, now).next; // 1d
		srs = applyReview(srs, 2, now).next; // 6d
		const good = applyReview(srs, 2, now).appliedIntervalDays; // 15
		const hard = applyReview(srs, 1, now).appliedIntervalDays;
		const easy = applyReview(srs, 3, now).appliedIntervalDays;
		expect(hard).toBeLessThan(good);
		expect(easy).toBeGreaterThan(good);
	});

	it("lapses on Again: schedules 10 min later, drops ease, resets reps", () => {
		const now = 0;
		let srs = initialSrsState(now);
		srs = applyReview(srs, 2, now).next;
		srs = applyReview(srs, 2, now).next;
		srs = applyReview(srs, 2, now).next;
		const beforeEase = srs.ease;
		const beforeReps = srs.reps;
		const lapse = applyReview(srs, 0, now);
		expect(lapse.isLapse).toBe(true);
		expect(lapse.appliedIntervalDays).toBe(0);
		expect(lapse.next.reps).toBe(0);
		expect(lapse.next.lapses).toBe(1);
		expect(lapse.next.ease).toBeLessThan(beforeEase);
		expect(lapse.next.dueAt).toBe(now + 10 * 60 * 1000);
		expect(beforeReps).toBe(3);
	});

	it("clamps ease to the SM-2 minimum", () => {
		let srs = initialSrsState(0);
		for (let i = 0; i < 10; i++) {
			srs = applyReview(srs, 1, 0).next;
		}
		expect(srs.ease).toBeGreaterThanOrEqual(MIN_EASE);
	});
});

describe("flashcard scheduling helpers", () => {
	it("isDue respects the card's dueAt", () => {
		const now = 1000;
		const fresh = initialSrsState(now);
		expect(isDue(fresh, now)).toBe(true);
		expect(isDue({ ...fresh, dueAt: now + 10_000 }, now)).toBe(false);
	});

	it("getDueCards returns only cards whose SRS is due", () => {
		const now = 100_000;
		const deck = makeDeck([
			makeCard({ id: "due", srs: { ...initialSrsState(now), dueAt: now - 1 } }),
			makeCard({ id: "fresh", srs: { ...initialSrsState(now), dueAt: now + 100_000 } }),
		]);
		const due = getDueCards(deck, now);
		expect(due.map((c) => c.id)).toEqual(["due"]);
	});

	it("scheduleDueCards surfaces lapses first, then oldest-due", () => {
		const now = 1000;
		const deck = makeDeck([
			makeCard({ id: "old", srs: { ...initialSrsState(now), dueAt: now - 100, lapses: 0, reps: 2 } }),
			makeCard({ id: "lapse", srs: { ...initialSrsState(now), dueAt: now - 50, lapses: 2, reps: 4 } }),
			makeCard({ id: "newest", srs: { ...initialSrsState(now), dueAt: now - 10, lapses: 0, reps: 1 } }),
		]);
		const ordered = scheduleDueCards(getDueCards(deck, now), now).map((c) => c.id);
		expect(ordered[0]).toBe("lapse");
		// The non-lapsing cards are ordered by dueAt ascending.
		expect(ordered.slice(1)).toEqual(["old", "newest"]);
	});

	it("getDeckStats classifies cards into fresh/learning/review/mature", () => {
		const now = 0;
		const deck = makeDeck([
			makeCard({ id: "fresh", srs: { ...initialSrsState(now), reps: 0 } }),
			makeCard({ id: "learning", srs: { ...initialSrsState(now), reps: 3, intervalDays: 10 } }),
			makeCard({ id: "review", srs: { ...initialSrsState(now), reps: 5, intervalDays: 45 } }),
			makeCard({ id: "mature", srs: { ...initialSrsState(now), reps: 8, intervalDays: 120 } }),
		]);
		const stats = getDeckStats(deck, now);
		expect(stats).toEqual({ total: 4, dueNow: 4, fresh: 1, learning: 1, review: 1, mature: 1 });
	});
});

describe("format helpers", () => {
	it("formatInterval produces human-readable labels", () => {
		expect(formatInterval(0)).toBe("10m");
		expect(formatInterval(0.01)).toMatch(/m/);
		expect(formatInterval(1)).toBe("1d");
		expect(formatInterval(3)).toBe("3d");
		expect(formatInterval(30)).toBe("1mo");
		expect(formatInterval(365)).toBe("1.0y");
	});

	it("formatDueIn handles future, now, and overdue", () => {
		const now = 1_000_000;
		expect(formatDueIn(now, now)).toBe("now");
		expect(formatDueIn(now + 3 * 86_400_000, now)).toBe("in 3d");
		expect(formatDueIn(now - 2 * 86_400_000, now)).toBe("2d overdue");
	});
});

describe("validateDeckDraft", () => {
	it("rejects non-array input", () => {
		const result = validateDeckDraft(null);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/array/);
	});

	it("rejects too few cards", () => {
		const result = validateDeckDraft([{ front: "Q?", back: "A." }]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/at least 2/);
	});

	it("rejects too many cards", () => {
		const tooMany = Array.from({ length: 250 }, (_, i) => ({ front: `Q${i}?`, back: `A${i}.` }));
		const result = validateDeckDraft(tooMany);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/Too many/);
	});

	it("rejects short fronts or backs", () => {
		const result = validateDeckDraft([
			{ front: "ab", back: "answer here" },
			{ front: "Valid question?", back: "Valid answer." },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/front is too short/);
	});

	it("rejects duplicate fronts", () => {
		const result = validateDeckDraft([
			{ front: "Same question?", back: "First answer." },
			{ front: "same question?", back: "Second answer." },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/Duplicate/);
	});

	it("accepts well-formed cards and preserves tags", () => {
		const result = validateDeckDraft([
			{ front: "What is recursion?", back: "A function that calls itself." },
			{ front: "What is a closure?", back: "A function with its lexical environment.", tags: ["js", "fundamentals"] },
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.cards).toHaveLength(2);
			expect(result.cards?.[1].tags).toEqual(["js", "fundamentals"]);
		}
	});

	it("filters out non-string tags silently", () => {
		const result = validateDeckDraft([
			{ front: "Q1?", back: "A1." },
			{ front: "Q2?", back: "A2.", tags: ["valid", 42, null, "also-valid"] },
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.cards?.[1].tags).toEqual(["valid", "also-valid"]);
		}
	});
});
