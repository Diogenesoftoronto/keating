import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
	accrueQuestionTime,
	adaptiveSkipIds,
	clampQuestionIndex,
	deadlineFor,
	finishButtonLabel,
	isDeadlineExpired,
	isValidQuestionIndex,
	remainingSeconds,
	resolvedTimeAt,
	timeoutAdvance,
	toggleBookmarkId,
} from "../components/quiz/quiz-session";
import { formatCountdown, formatDuration, quizQuestionEntryClass, showsBinaryResult, stableQuizSeed } from "../components/quiz/quiz-presentation";
import type { QuizQuestion } from "../keating/core";

const question = (id: string, extra: Partial<QuizQuestion> = {}): QuizQuestion =>
	({ id, question: id, type: "multiple_choice", level: "recall", correctAnswer: "A", options: ["A"], explanation: "", ...extra }) as QuizQuestion;

describe("deadlines", () => {
	test("only finite authored limits create a deadline", () => {
		expect(deadlineFor(question("a"), 30, 1000)).toEqual({ questionId: "a", at: 31000 });
		expect(deadlineFor(question("a"), undefined, 1000)).toBeUndefined();
		expect(deadlineFor(question("a"), Number.NaN, 1000)).toBeUndefined();
		expect(deadlineFor(undefined, 30, 1000)).toBeUndefined();
		expect(deadlineFor(question("a"), -5, 1000)).toEqual({ questionId: "a", at: 1000 });
	});

	test("expiry applies only to the deadline's own question", () => {
		const d = { questionId: "a", at: 5000 };
		expect(isDeadlineExpired(d, "a", 4999)).toBe(false);
		expect(isDeadlineExpired(d, "a", 5000)).toBe(true);
		expect(isDeadlineExpired(d, "b", 9999)).toBe(false);
		expect(isDeadlineExpired(undefined, "a", 9999)).toBe(false);
	});

	test("time is capped at the deadline only for the matching question", () => {
		const d = { questionId: "a", at: 5000 };
		expect(resolvedTimeAt(d, "a", 9000)).toBe(5000);
		expect(resolvedTimeAt(d, "b", 9000)).toBe(9000);
		expect(resolvedTimeAt(d, "a", 3000)).toBe(3000);
	});

	test("accrual adds to a copy and never goes negative", () => {
		const before = { a: 100 };
		const after = accrueQuestionTime(before, "a", 1000, 1500, undefined);
		expect(after).toEqual({ a: 600 });
		expect(before).toEqual({ a: 100 });
		expect(accrueQuestionTime({}, "b", 2000, 1000, undefined)).toEqual({ b: 0 });
		expect(accrueQuestionTime({}, "a", 1000, 9000, { questionId: "a", at: 4000 })).toEqual({ a: 3000 });
	});

	test("remaining seconds round up and floor at zero", () => {
		expect(remainingSeconds(10_000, 9_001)).toBe(1);
		expect(remainingSeconds(10_000, 20_000)).toBe(0);
	});

	test("property: one accrual never exceeds the deadline window and is monotone in `now`", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 10_000 }),
				fc.integer({ min: 0, max: 60 }),
				fc.array(fc.integer({ min: 0, max: 200_000 }), { minLength: 1, maxLength: 8 }),
				(entered, limit, nows) => {
					const deadline = deadlineFor(question("a"), limit, entered)!;
					let previous = 0;
					for (const now of [...nows].sort((x, y) => x - y)) {
						const spent = accrueQuestionTime({}, "a", entered, now, deadline).a;
						expect(spent).toBeGreaterThanOrEqual(previous);
						expect(spent).toBeLessThanOrEqual(limit * 1000);
						previous = spent;
					}
				},
			),
		);
	});
});

describe("navigation", () => {
	test("validity and clamping bounds", () => {
		expect(isValidQuestionIndex(-1, 3)).toBe(false);
		expect(isValidQuestionIndex(3, 3)).toBe(false);
		expect(isValidQuestionIndex(2, 3)).toBe(true);
		expect(clampQuestionIndex(5, 3)).toBe(2);
		expect(clampQuestionIndex(-2, 3)).toBe(0);
		expect(clampQuestionIndex(4, 0)).toBe(0);
	});

	test("timeout on the last question submits, otherwise advances", () => {
		expect(timeoutAdvance(0, 3)).toBe("next");
		expect(timeoutAdvance(2, 3)).toBe("submit");
	});

	test("property: navigation never leaves the question range", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 9 }), fc.array(fc.integer({ min: -3, max: 12 }), { maxLength: 30 }), (total, targets) => {
				let index = 0;
				for (const target of targets) {
					if (isValidQuestionIndex(target, total)) index = target;
					expect(index).toBeGreaterThanOrEqual(0);
					expect(index).toBeLessThan(total);
					expect(clampQuestionIndex(index, total)).toBe(index);
				}
			}),
		);
	});

	test("property: clamp always lands in range", () => {
		fc.assert(
			fc.property(fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 20 }), (current, total) => {
				const clamped = clampQuestionIndex(current, total);
				expect(clamped).toBeGreaterThanOrEqual(0);
				expect(clamped).toBeLessThanOrEqual(Math.max(0, total - 1));
			}),
		);
	});
});

describe("adaptive skipping", () => {
	const questions = [
		question("a", { level: "application" }),
		question("a-fb1", { level: "recall", fallbackFor: "application" }),
		question("a-fb2", { level: "recall", fallbackFor: "application" }),
		question("b", { level: "analysis" }),
		question("b-fb", { level: "recall", fallbackFor: "analysis" }),
	];
	const rules = [{ level: "application", threshold: 0.8 }];

	test("skips consecutive fallbacks once the threshold is met", () => {
		const skip = adaptiveSkipIds({ questions, current: questions[0], answer: "A", credit: 1, adaptiveRules: rules });
		expect([...skip]).toEqual(["a-fb1", "a-fb2"]);
	});

	test("does nothing below the threshold, with blank answers, or without a matching rule at default 0.5", () => {
		expect(adaptiveSkipIds({ questions, current: questions[0], answer: "A", credit: 0.7, adaptiveRules: rules }).size).toBe(0);
		expect(adaptiveSkipIds({ questions, current: questions[0], answer: "  ", credit: 1, adaptiveRules: rules }).size).toBe(0);
		expect([...adaptiveSkipIds({ questions, current: questions[3], answer: "A", credit: 0.5, adaptiveRules: rules })]).toEqual(["b-fb"]);
	});

	test("property: the current question is never skipped, so it can still time out (timed out ⇒ not skipped)", () => {
		fc.assert(
			fc.property(
				fc.array(fc.record({ fallback: fc.boolean(), level: fc.constantFrom("recall", "application") }), { minLength: 1, maxLength: 10 }),
				fc.nat(9),
				fc.double({ min: 0, max: 1, noNaN: true }),
				(specs, pick, credit) => {
					const list = specs.map((spec, i) =>
						question(`q${i}`, { level: spec.level as QuizQuestion["level"], fallbackFor: spec.fallback ? "application" : undefined }),
					);
					const current = list[pick % list.length];
					const skip = adaptiveSkipIds({ questions: list, current, answer: "A", credit, adaptiveRules: [{ level: "application", threshold: 0 }] });
					expect(skip.has(current.id)).toBe(false);
					const currentIndex = list.indexOf(current);
					for (const id of skip) expect(list.findIndex((item) => item.id === id)).toBeGreaterThan(currentIndex);
				},
			),
		);
	});
});

describe("bookmarks and labels", () => {
	test("toggle adds then removes", () => {
		expect(toggleBookmarkId(["a"], "b")).toEqual(["a", "b"]);
		expect(toggleBookmarkId(["a", "b"], "a")).toEqual(["b"]);
	});
	test("finish button label", () => {
		expect(finishButtonLabel(true, 0)).toBe("Finish round");
		expect(finishButtonLabel(false, 2)).toBe("2 left");
	});
});

describe("presentation", () => {
	test("duration and countdown formats", () => {
		expect(formatDuration(65_400)).toBe("1:05");
		expect(formatDuration(-5)).toBe("0:00");
		expect(formatCountdown(61.2)).toBe("1:02");
		expect(formatCountdown(-3)).toBe("0:00");
	});
	test("entry class and binary-result rule", () => {
		expect(quizQuestionEntryClass("still")).toBe("quiz-question-enter");
		expect(quizQuestionEntryClass("solar")).toBe("quiz-question-enter-solar");
		expect(showsBinaryResult(question("a"))).toBe(true);
		expect(showsBinaryResult(question("a", { type: "short_answer" }))).toBe(false);
	});
	test("seed is deterministic and bounded", () => {
		fc.assert(
			fc.property(fc.string(), (value) => {
				const seed = stableQuizSeed(value);
				expect(stableQuizSeed(value)).toBe(seed);
				expect(seed).toBeGreaterThanOrEqual(0);
				expect(seed).toBeLessThanOrEqual(131);
			}),
		);
	});
});
