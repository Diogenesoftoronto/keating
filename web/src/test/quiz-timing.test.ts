import { describe, expect, test } from "bun:test";
import { QuizTimingTracker } from "../components/quiz/timing";

describe("quiz timing evidence", () => {
	test("records question visits separately from reviewing the whole attempt", () => {
		const clock = new QuizTimingTracker(100, "first");
		clock.visit("second", 1_338);
		clock.visit(undefined, 3_683);
		expect(clock.finish(8_901)).toEqual({ totalMs: 8_801, perQuestionMs: { first: 1_238, second: 2_345 } });
	});
	test("accumulates revisits without charging time spent in the review screen", () => {
		const clock = new QuizTimingTracker(0, "first");
		clock.visit(undefined, 1_000);
		clock.visit("first", 5_000);
		clock.visit("first", 5_500);
		expect(clock.snapshot(6_234).perQuestionMs).toEqual({ first: 2_234 });
	});
	test("freezes exact timings across save retries and later result renders", () => {
		const clock = new QuizTimingTracker(0, "first");
		const timing = clock.finish(4_238);
		clock.visit("second", 9_000);
		expect(clock.finish(15_000)).toEqual(timing);
		timing.perQuestionMs.first = 99;
		expect(clock.snapshot(90_000)).toEqual({ totalMs: 4_238, perQuestionMs: { first: 4_238 } });
	});
	test("keeps zero duration visits and omits unvisited questions", () => {
		const clock = new QuizTimingTracker(0, "first");
		clock.visit("second", 0);
		expect(clock.snapshot(0)).toEqual({ totalMs: 0, perQuestionMs: { first: 0, second: 0 } });
	});
	test("captures subsecond work as integer milliseconds without rounding to seconds", () => {
		const clock = new QuizTimingTracker(1.1, "first");
		expect(clock.snapshot(412.8)).toEqual({ totalMs: 412, perQuestionMs: { first: 412 } });
	});
});
