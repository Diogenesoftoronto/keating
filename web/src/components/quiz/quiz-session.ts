/**
 * Pure decision helpers for a running quiz: per-question deadlines and time
 * accrual, navigation bounds, adaptive skipping, and bookmark persistence
 * shape. The React hooks in ./useQuiz* own the refs/state and call these.
 */
import type { QuizQuestion } from "../../keating/core";

export interface QuizDeadline {
	questionId: string;
	/** Epoch ms at which the question's countdown expires. */
	at: number;
}

/** Deadline for a question with an authored finite time limit, else undefined. */
export function deadlineFor(
	question: Pick<QuizQuestion, "id"> | undefined,
	timeLimitSeconds: unknown,
	enteredAt: number,
): QuizDeadline | undefined {
	return question && typeof timeLimitSeconds === "number" && Number.isFinite(timeLimitSeconds)
		? { questionId: question.id, at: enteredAt + Math.max(0, timeLimitSeconds) * 1000 }
		: undefined;
}

/** Whether `questionId`'s countdown has expired at `now`. */
export function isDeadlineExpired(deadline: QuizDeadline | undefined, questionId: string, now: number): boolean {
	return !!deadline && deadline.questionId === questionId && now >= deadline.at;
}

/** Time is capped at the deadline of the question being left. */
export function resolvedTimeAt(deadline: QuizDeadline | undefined, questionId: string | undefined, now: number): number {
	return deadline && deadline.questionId === questionId ? Math.min(now, deadline.at) : now;
}

/** Adds the time spent on `questionId` since `enteredAt` to a copy of `perQuestionMs`. */
export function accrueQuestionTime(
	perQuestionMs: Record<string, number>,
	questionId: string,
	enteredAt: number,
	now: number,
	deadline: QuizDeadline | undefined,
): Record<string, number> {
	const resolvedAt = resolvedTimeAt(deadline, questionId, now);
	return {
		...perQuestionMs,
		[questionId]: (perQuestionMs[questionId] ?? 0) + Math.max(0, resolvedAt - enteredAt),
	};
}

/** Whole seconds left before a deadline, never negative. */
export function remainingSeconds(deadlineAt: number, now: number): number {
	return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

/** Whether `nextIndex` is a reachable question position. */
export function isValidQuestionIndex(nextIndex: number, total: number): boolean {
	return nextIndex >= 0 && nextIndex < total;
}

/** Clamps a position into [0, total - 1]; 0 when there are no questions. */
export function clampQuestionIndex(current: number, total: number): number {
	if (total <= 0) return 0;
	return Math.min(Math.max(current, 0), total - 1);
}

/** What to do when the current question's countdown reaches zero. */
export function timeoutAdvance(current: number, total: number): "submit" | "next" {
	return current >= total - 1 ? "submit" : "next";
}

/**
 * Ids of fallback questions to skip once `current` clears its adaptive-rule
 * threshold. Only consecutive fallback questions directly after the source are
 * skipped, and the source itself and unanswered questions never are.
 */
export function adaptiveSkipIds(input: {
	questions: QuizQuestion[];
	current: QuizQuestion;
	answer: string | undefined;
	credit: number;
	adaptiveRules: { level: string; threshold?: number }[];
}): Set<string> {
	const { questions, current, answer, credit, adaptiveRules } = input;
	const skip = new Set<string>();
	if (!answer?.trim()) return skip;
	const rule = adaptiveRules.find((candidate) => candidate.level === current.level);
	if (credit < (rule?.threshold ?? 0.5)) return skip;
	const sourceIndex = questions.findIndex((question) => question.id === current.id);
	for (let index = sourceIndex + 1; index < questions.length; index += 1) {
		const candidate = questions[index];
		if (candidate.fallbackFor === current.level) skip.add(candidate.id);
		else if (!candidate.fallbackFor) break;
	}
	return skip;
}

/** Toggles an id in the bookmark list, preserving order of existing entries. */
export function toggleBookmarkId(ids: string[], questionId: string): string[] {
	return ids.includes(questionId) ? ids.filter((id) => id !== questionId) : [...ids, questionId];
}

/** Label on the final-question button. */
export function finishButtonLabel(allAnswered: boolean, unanswered: number): string {
	return allAnswered ? "Finish round" : `${unanswered} left`;
}
