import { describe, expect, test } from "bun:test";
import { isOpenEnded, questionCredit } from "../components/QuizRenderer";
import type { QuizQuestion } from "../keating/core";
import { quizEvidenceScore } from "../keating/storage";

function q(overrides: Partial<QuizQuestion>): QuizQuestion {
	return {
		id: "q1",
		question: "Why does velocity decrease near the wall?",
		type: "short_answer",
		level: "comprehension",
		correctAnswer: "Friction from the wall slows the fluid",
		explanation: "",
		...overrides,
	} as QuizQuestion;
}

describe("isOpenEnded", () => {
	test("short_answer and transfer are open-ended", () => {
		expect(isOpenEnded(q({ type: "short_answer" }))).toBe(true);
		expect(isOpenEnded(q({ type: "transfer" }))).toBe(true);
	});

	test("single-blank fill_in is open-ended, multi-blank is not", () => {
		expect(isOpenEnded(q({ type: "fill_in" }))).toBe(true);
		expect(
			isOpenEnded(q({ type: "fill_in", blanks: [{ placeholder: "a" }, { placeholder: "b" }] })),
		).toBe(false);
	});

	test("objective types are not open-ended", () => {
		expect(isOpenEnded(q({ type: "multiple_choice", options: ["a", "b"] }))).toBe(false);
		expect(isOpenEnded(q({ type: "true_false" }))).toBe(false);
		expect(isOpenEnded(q({ type: "multi_select", correctAnswers: ["a"] }))).toBe(false);
	});
});

describe("questionCredit (open-ended heuristic)", () => {
	test("exact match scores full credit", () => {
		const question = q({});
		expect(questionCredit(question, question.correctAnswer)).toBe(1);
	});

	test("blank answer scores zero", () => {
		expect(questionCredit(q({}), "   ")).toBe(0);
	});

	test("phrase overlap (bigrams) earns more than unrelated text", () => {
		const question = q({ correctAnswer: "friction from the wall slows the fluid" });
		const close = questionCredit(question, "the wall slows the fluid through friction");
		const unrelated = questionCredit(question, "bananas are yellow");
		expect(close).toBeGreaterThan(unrelated);
		expect(close).toBeGreaterThan(0.4);
	});
});

describe("quizEvidenceScore", () => {
	test("uses answer-derived partial-credit points and saved model grades", () => {
		expect(quizEvidenceScore({
			id: "quiz-1",
			topic: "fluid mechanics",
			createdAt: 1,
			score: 1,
			partialCreditPoints: 1.5,
			totalQuestions: 2,
			openEndedGrades: [
				{ questionId: "open-1", verdict: "correct" },
				{ questionId: "open-2", verdict: "partial" },
			],
		})).toBe(0.75);
	});

	test("falls back to the objective score when partial-credit evidence is absent", () => {
		expect(quizEvidenceScore({
			id: "legacy-quiz",
			topic: "fluid mechanics",
			createdAt: 1,
			score: 1,
			totalQuestions: 2,
		})).toBe(0.5);
	});
});
