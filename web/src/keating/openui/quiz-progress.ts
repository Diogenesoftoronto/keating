import type { UiQuestion } from "@keating/learner-contracts";
import { objectiveCredit } from "@keating/learner-contracts";
export { objectiveCredit, isOpenEndedQuestion } from "@keating/learner-contracts";

/** The teacher's judgement on an open-ended answer, delivered by `grade_quiz`. */
export type QuizVerdict = "correct" | "partial" | "incorrect";

export interface QuizGrade {
	questionId: string;
	verdict: QuizVerdict;
	note?: string;
}

/**
 * What is known about one question after submission.
 *
 * Open-ended answers are judged by the teacher, not by string match, so they
 * sit at `pending` until a verdict arrives and are excluded from the score
 * rather than counted as wrong.
 */
export type QuizOutcome =
	| { kind: "unanswered" }
	| { kind: "skipped" }
	| { kind: "objective"; correct: boolean }
	| { kind: "pending" }
	| { kind: "graded"; verdict: QuizVerdict; note?: string };


export function quizOutcome(
	question: UiQuestion,
	answer: string | undefined,
	options: { skipped?: boolean; grades?: readonly QuizGrade[] } = {},
): QuizOutcome {
	if (options.skipped) return { kind: "skipped" };
	if (answer === undefined || !answer.trim()) return { kind: "unanswered" };
	if (question.mathProblem) {
		const credit = objectiveCredit(question, answer);
		if (credit !== undefined) return { kind: "objective", correct: credit === 1 };
	}
	const grade = options.grades?.find((candidate) => candidate.questionId === question.id);
	if (grade) return { kind: "graded", verdict: grade.verdict, ...(grade.note ? { note: grade.note } : {}) };
	const credit = objectiveCredit(question, answer);
	if (credit === undefined) return { kind: "pending" };
	return { kind: "objective", correct: credit === 1 };
}

/** Points earned, or undefined while the outcome is still undecided. */
export function creditForOutcome(outcome: QuizOutcome): number | undefined {
	switch (outcome.kind) {
		case "objective": return outcome.correct ? 1 : 0;
		case "graded": return outcome.verdict === "correct" ? 1 : outcome.verdict === "partial" ? 0.5 : 0;
		case "skipped": return 0;
		default: return undefined;
	}
}

export interface QuizSummary {
	total: number;
	answered: number;
	skipped: number;
	/** Questions whose outcome is settled, and so form the score's denominator. */
	decided: number;
	pending: number;
	earned: number;
	correct: number;
	/** Percentage over decided questions only; 0 while everything is pending. */
	percentage: number;
}

export function summarizeQuiz(
	questions: readonly UiQuestion[],
	answers: Readonly<Record<string, string>>,
	skipped: readonly string[] = [],
	grades: readonly QuizGrade[] = [],
): QuizSummary {
	const skippedSet = new Set(skipped);
	let answered = 0;
	let decided = 0;
	let pending = 0;
	let earned = 0;
	let correct = 0;
	for (const question of questions) {
		const outcome = quizOutcome(question, answers[question.id], { skipped: skippedSet.has(question.id), grades });
		if (outcome.kind !== "unanswered" && outcome.kind !== "skipped") answered += 1;
		if (outcome.kind === "pending") pending += 1;
		const credit = creditForOutcome(outcome);
		if (credit === undefined) continue;
		decided += 1;
		earned += credit;
		if (credit === 1) correct += 1;
	}
	return {
		total: questions.length,
		answered,
		skipped: skippedSet.size,
		decided,
		pending,
		earned,
		correct,
		percentage: decided > 0 ? Math.round((earned / decided) * 100) : 0,
	};
}
