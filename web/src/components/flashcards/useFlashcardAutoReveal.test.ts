import { describe, expect, it } from "bun:test";
import { createFlashcardCountdown, sampleFlashcardCountdown } from "./useFlashcardAutoReveal";

describe("flashcard auto-reveal clock", () => {
	it("stays off until the learner chooses a duration", () => {
		const result = sampleFlashcardCountdown(createFlashcardCountdown(0, 0), 60_000, true);
		expect(result.reveal).toBe(false);
		expect(result.clock.done).toBe(true);
	});

	it("reveals once at the deadline, including after a delayed frame", () => {
		const started = sampleFlashcardCountdown(createFlashcardCountdown(5, 0), 100, true);
		const before = sampleFlashcardCountdown(started.clock, 5_099, true);
		expect(before.clock.remainingMs).toBe(1);
		expect(before.reveal).toBe(false);
		const elapsed = sampleFlashcardCountdown(before.clock, 6_000, true);
		expect(elapsed.clock.remainingMs).toBe(0);
		expect(elapsed.reveal).toBe(true);
		expect(sampleFlashcardCountdown(elapsed.clock, 9_000, true).reveal).toBe(false);
	});

	it("excludes paused or hidden time while retaining the visible fraction", () => {
		const started = sampleFlashcardCountdown(createFlashcardCountdown(10, 0), 0, true);
		const paused = sampleFlashcardCountdown(started.clock, 2_125, false);
		expect(paused.clock.remainingMs).toBe(7_875);
		const resumed = sampleFlashcardCountdown(paused.clock, 60_000, true);
		expect(resumed.clock.remainingMs).toBe(7_875);
		expect(resumed.reveal).toBe(false);
		const due = sampleFlashcardCountdown(resumed.clock, 67_875, true);
		expect(due.reveal).toBe(true);
	});

	it("does not reveal in a hidden tab even if its last active interval elapsed", () => {
		const started = sampleFlashcardCountdown(createFlashcardCountdown(5, 0), 0, true);
		const hidden = sampleFlashcardCountdown(started.clock, 5_000, false);
		expect(hidden.reveal).toBe(false);
		expect(hidden.clock.done).toBe(false);
		expect(sampleFlashcardCountdown(hidden.clock, 9_000, false).reveal).toBe(false);
		expect(sampleFlashcardCountdown(hidden.clock, 10_000, true).reveal).toBe(true);
	});

	it("a manually revealed card stays stopped when flipped back", () => {
		const started = sampleFlashcardCountdown(createFlashcardCountdown(5, 0), 0, true);
		const revealed = { ...started.clock, done: true, running: false };
		expect(sampleFlashcardCountdown(revealed, 10_000, true).reveal).toBe(false);
	});

	it("resets a new card or changed duration without carrying elapsed time", () => {
		const previous = sampleFlashcardCountdown(createFlashcardCountdown(5, 0), 0, true);
		expect(sampleFlashcardCountdown(previous.clock, 4_000, true).clock.remainingMs).toBe(1_000);
		const nextCard = sampleFlashcardCountdown(createFlashcardCountdown(5, 4_000), 4_000, true);
		expect(nextCard.clock.remainingMs).toBe(5_000);
		const changed = sampleFlashcardCountdown(createFlashcardCountdown(15, 4_000), 4_000, true);
		expect(changed.clock.remainingMs).toBe(15_000);
	});

	it("ignores a backwards clock sample instead of adding time", () => {
		const started = sampleFlashcardCountdown(createFlashcardCountdown(5, 1_000), 1_000, true);
		expect(sampleFlashcardCountdown(started.clock, 500, true).clock.remainingMs).toBe(5_000);
	});
});
