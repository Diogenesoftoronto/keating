import { expect, test } from "bun:test";
import { CodingTimingTracker, formatCodingTime } from "../components/labs/coding-timing";

test("work time excludes idle, paused, hidden and runner intervals across attempts", () => {
	const timer = new CodingTimingTracker();
	expect(timer.snapshot(10_000)).toBe(0);
	timer.setActive(true, 10_000);
	expect(timer.snapshot(11_500)).toBe(1500);
	expect(timer.snapshot(11_500)).toBe(1500);
	// A pause or hidden tab uses the same inactive clock boundary.
	timer.setActive(false, 12_000);
	expect(timer.snapshot(50_000)).toBe(2000);
	timer.setActive(true, 50_000);
	timer.setActive(false, 53_000);
	// Test execution does not add to the learner's work time.
	expect(timer.recordRun(56_000)).toEqual({ workingMs: 5000, sinceLastRunMs: 5000, runNumber: 1 });
	timer.setActive(true, 60_000);
	timer.setActive(false, 61_250);
	expect(timer.recordRun(70_000)).toEqual({ workingMs: 6250, sinceLastRunMs: 1250, runNumber: 2 });
	expect(timer.snapshot(90_000)).toBe(6250);
});

test("repeated visibility transitions do not restart active time", () => {
	const timer = new CodingTimingTracker();
	timer.setActive(true, 100);
	timer.setActive(true, 800);
	timer.setActive(false, 1600);
	timer.setActive(false, 20_000);
	expect(timer.snapshot(30_000)).toBe(1500);
	timer.setActive(true, 40_000);
	expect(timer.snapshot(40_500)).toBe(2000);
});

test("elapsed display keeps stable minutes and seconds", () => {
	expect(formatCodingTime(999)).toBe("00:00");
	expect(formatCodingTime(65_432)).toBe("01:05");
	expect(formatCodingTime(3_600_000)).toBe("60:00");
});
