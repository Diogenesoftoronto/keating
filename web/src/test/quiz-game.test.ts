import { describe, expect, it } from "bun:test";

import type { QuizQuestion } from "../keating/core";
import {
	defaultQuizShaderPreset,
	formatQuizDuration,
	isQuickQuizAnswer,
	quizRunSignal,
	quizTimerState,
	resolveQuizShaderPreset,
	uniqueQuizQuestions,
} from "../components/quiz/game";

function question(id: string, prompt = id): QuizQuestion {
	return {
		id,
		type: "multiple_choice",
		level: "recall",
		question: prompt,
		options: ["A", "B"],
		correctAnswer: "A",
		explanation: "A is correct.",
	};
}

describe("quiz minigame helpers", () => {
	it("preserves exact saved milliseconds at second and minute boundaries", () => {
		expect(formatQuizDuration(0)).toBe("0.000s");
		expect(formatQuizDuration(4_238)).toBe("4.238s");
		expect(formatQuizDuration(59_999)).toBe("59.999s");
		expect(formatQuizDuration(60_000)).toBe("1:00.000");
		expect(formatQuizDuration(64_238)).toBe("1:04.238");
		expect(formatQuizDuration(3_604_238)).toBe("60:04.238");
		expect(formatQuizDuration(Number.NaN)).toBe("—");
	});

	it("marks only answered questions within a quarter of their authored budget", () => {
		const answer = { timeMs: 5_000, timeLimitSeconds: 20, answered: true };
		expect(isQuickQuizAnswer(answer)).toBe(true);
		expect(isQuickQuizAnswer({ ...answer, timeMs: 5_001 })).toBe(false);
		expect(isQuickQuizAnswer({ ...answer, answered: false })).toBe(false);
		expect(isQuickQuizAnswer({ ...answer, timedOut: true })).toBe(false);
		expect(isQuickQuizAnswer({ ...answer, timeLimitSeconds: undefined })).toBe(false);
		expect(isQuickQuizAnswer({ ...answer, timeLimitSeconds: 0 })).toBe(false);
		expect(isQuickQuizAnswer({ ...answer, timeMs: undefined })).toBe(false);
		expect(isQuickQuizAnswer({ ...answer, timeMs: -1 })).toBe(false);
		expect(isQuickQuizAnswer({ ...answer, timeMs: Number.NaN })).toBe(false);
		expect(isQuickQuizAnswer({ ...answer, timeMs: 0 })).toBe(true);
	});

	it("picks a stable animated default and preserves an explicit preset", () => {
		const first = defaultQuizShaderPreset("quiz-a");
		expect(defaultQuizShaderPreset("quiz-a")).toBe(first);
		expect(first).not.toBe("still");
		expect(resolveQuizShaderPreset("current", "quiz-a")).toBe("current");
		expect(resolveQuizShaderPreset("retired", "quiz-a")).toBe(first);
	});

	it("keeps source order while dropping duplicate question ids", () => {
		const questions = [
			question("one", "First"),
			question("two", "Second"),
			question("one", "Duplicate"),
		];
		expect(uniqueQuizQuestions(questions).map((entry) => entry.question)).toEqual([
			"First",
			"Second",
		]);
	});

	it("clamps timer progress and escalates warning states", () => {
		expect(quizTimerState(45, 45)).toEqual({ urgency: "steady", progress: 1 });
		expect(quizTimerState(10, 45).urgency).toBe("warning");
		expect(quizTimerState(5, 45).urgency).toBe("critical");
		expect(quizTimerState(-5, 45)).toEqual({ urgency: "critical", progress: 0 });
		expect(quizTimerState(90, 45).progress).toBe(1);
		expect(quizTimerState(Number.NaN, Number.NaN)).toEqual({ urgency: "critical", progress: 0 });
	});

	it("summarizes perfect, mixed, weak, and teacher-reviewed runs", () => {
		expect(quizRunSignal({ score: 4, totalScored: 4, pendingReviewCount: 0 }).label).toBe("Perfect signal");
		expect(quizRunSignal({ score: 3, totalScored: 4, pendingReviewCount: 0 }).label).toBe("Strong run");
		expect(quizRunSignal({ score: 2, totalScored: 4, pendingReviewCount: 0 }).label).toBe("Useful map");
		expect(quizRunSignal({ score: 1, totalScored: 4, pendingReviewCount: 0 }).label).toBe("Calibration run");
		expect(quizRunSignal({ score: 0, totalScored: 0, pendingReviewCount: 2 }).label).toBe("Review queued");
	});
});
