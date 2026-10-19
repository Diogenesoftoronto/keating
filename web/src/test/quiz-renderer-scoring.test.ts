import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { questionCredit } from "../components/QuizRenderer";
import { completionSummary, countAnswered, summarizeQuizScores } from "../components/quiz/quiz-scoring";
import type { QuizQuestion } from "../keating/core";

function q(overrides: Partial<QuizQuestion>): QuizQuestion {
	return {
		id: "q1",
		question: "Q?",
		type: "multiple_choice",
		level: "recall",
		correctAnswer: "B",
		options: ["A", "B", "C"],
		explanation: "",
		...overrides,
	} as QuizQuestion;
}

describe("questionCredit characterization", () => {
	test("blank answers earn nothing", () => {
		expect(questionCredit(q({}), "   ")).toBe(0);
	});
	test("choice-like types are all or nothing, case/space-insensitive", () => {
		expect(questionCredit(q({}), " b ")).toBe(1);
		expect(questionCredit(q({}), "A")).toBe(0);
		expect(questionCredit(q({ type: "true_false", correctAnswer: "True" }), "true")).toBe(1);
		expect(questionCredit(q({ type: "dropdown" }), "B")).toBe(1);
	});
	test("multi_select rewards correct picks and penalizes wrong ones", () => {
		const m = q({ type: "multi_select", correctAnswers: ["A", "B"], options: ["A", "B", "C", "D"] });
		expect(questionCredit(m, "A,B")).toBe(1);
		expect(questionCredit(m, "A")).toBe(0.5);
		expect(questionCredit(m, "A,C")).toBe(0.25);
		expect(questionCredit(m, "C,D")).toBe(0);
	});
	test("slider is full credit within tolerance and decays linearly beyond it", () => {
		const s = q({ type: "slider", correctAnswer: "50", min: 0, max: 100, step: 1 });
		expect(questionCredit(s, "54")).toBe(1);
		expect(questionCredit(s, "80")).toBeCloseTo(0.7);
		expect(questionCredit(s, "abc")).toBe(0);
	});
	test("multi-blank fill_in scores per blank", () => {
		const f = q({ type: "fill_in", blanks: [{}, {}], correctAnswers: ["x", "y"], correctAnswer: "x" });
		expect(questionCredit(f, "x | y")).toBe(1);
		expect(questionCredit(f, "X|nope")).toBe(0.5);
	});
	test("open-ended uses the most generous overlap signal", () => {
		const o = q({ type: "short_answer", correctAnswer: "friction slows the fluid" });
		expect(questionCredit(o, "Friction slows the fluid")).toBe(1);
		expect(questionCredit(o, "friction")).toBeCloseTo(1 / 3);
		expect(questionCredit(o, "totally unrelated words")).toBeLessThan(0.5);
	});
	test("property: credit is always within [0, 1]", () => {
		const types: QuizQuestion["type"][] = ["multiple_choice", "multi_select", "short_answer", "slider", "true_false", "dropdown", "fill_in", "transfer"];
		fc.assert(
			fc.property(fc.constantFrom(...types), fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), (type, correct, answer) => {
				const question = q({ type, correctAnswer: correct, correctAnswers: [correct, "z"], options: [correct, "z"] });
				const credit = questionCredit(question, answer);
				expect(credit).toBeGreaterThanOrEqual(0);
				expect(credit).toBeLessThanOrEqual(1);
			}),
		);
	});
});

describe("quiz score summary", () => {
	const mc = (id: string, correct = "B") => q({ id, correctAnswer: correct });

	test("counts correct answers and sums partial credit over scorable questions", () => {
		const scorable = [mc("a"), mc("b"), q({ id: "c", type: "multi_select", correctAnswers: ["A", "B"], options: ["A", "B", "C", "D"] })];
		const summary = summarizeQuizScores(scorable, { a: "B", b: "A", c: "A" });
		expect(summary.rawScore).toBe(1);
		expect(summary.partialCredits).toEqual({ a: 1, b: 0, c: 0.5 });
		expect(summary.partialCreditPoints).toBe(1.5);
		expect(summary.percent).toBe(33);
	});

	test("nothing scorable yields zeros", () => {
		expect(summarizeQuizScores([], {})).toEqual({ partialCredits: {}, rawScore: 0, partialCreditPoints: 0, percent: 0 });
	});

	test("countAnswered ignores blank answers", () => {
		expect(countAnswered([mc("a"), mc("b"), mc("c")], { a: "B", b: "  " })).toBe(1);
	});

	test("completion summary headline and detail", () => {
		expect(completionSummary({ totalScored: 0, rawScore: 0, pendingReviewCount: 2 })).toEqual({
			title: "Ready for review",
			detail: "Your teacher will review your answers.",
		});
		expect(completionSummary({ totalScored: 3, rawScore: 3, pendingReviewCount: 0 }).title).toBe("Clean sweep");
		expect(completionSummary({ totalScored: 3, rawScore: 1, pendingReviewCount: 2 })).toEqual({
			title: "Round complete",
			detail: "1 of 3 correct · 2 awaiting review",
		});
	});

	test("property: partial-credit totals stay within [0, scorable count] and raw score within [0, count]", () => {
		const types: QuizQuestion["type"][] = ["multiple_choice", "multi_select", "true_false", "dropdown", "slider"];
		const questionArb = fc.record({
			type: fc.constantFrom(...types),
			correct: fc.string({ maxLength: 6 }),
			answer: fc.string({ maxLength: 6 }),
		});
		fc.assert(
			fc.property(fc.array(questionArb, { maxLength: 10 }), (specs) => {
				const scorable = specs.map((spec, i) =>
					q({ id: `q${i}`, type: spec.type, correctAnswer: spec.correct, correctAnswers: [spec.correct, "z"], options: [spec.correct, "z"] }),
				);
				const answers = Object.fromEntries(specs.map((spec, i) => [`q${i}`, spec.answer]));
				const summary = summarizeQuizScores(scorable, answers);
				expect(summary.partialCreditPoints).toBeGreaterThanOrEqual(0);
				expect(summary.partialCreditPoints).toBeLessThanOrEqual(scorable.length);
				expect(summary.rawScore).toBeGreaterThanOrEqual(0);
				expect(summary.rawScore).toBeLessThanOrEqual(scorable.length);
				expect(summary.percent).toBeGreaterThanOrEqual(0);
				expect(summary.percent).toBeLessThanOrEqual(100);
			}),
		);
	});
});
