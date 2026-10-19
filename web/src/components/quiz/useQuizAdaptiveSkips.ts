/**
 * Adaptive branching: once the current question clears its rule's threshold,
 * consecutive fallback questions after it are removed from the run. Source
 * order is kept; decisions come from adaptiveSkipIds in ./quiz-session.
 *
 * Split in two hooks because the skipped set decides which questions are
 * visible, and the visible list decides the current question the effect needs.
 */
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import type { Quiz, QuizQuestion } from "../../keating/core";
import { adaptiveSkipIds } from "./quiz-session";
import { questionCredit } from "./quiz-scoring";

export function useSkippedQuestionIds() {
	return useState<Set<string>>(new Set());
}

export function useAdaptiveSkipEffect({
	quiz,
	questions,
	currentQuestion,
	answers,
	revealed,
	setSkippedIds,
}: {
	quiz: Quiz;
	questions: QuizQuestion[];
	currentQuestion: QuizQuestion | undefined;
	answers: Record<string, string>;
	revealed: boolean;
	setSkippedIds: Dispatch<SetStateAction<Set<string>>>;
}) {
	useEffect(() => {
		if (!quiz.adaptiveRules || !currentQuestion || revealed) return;
		const answer = answers[currentQuestion.id];
		if (!answer?.trim()) return;
		const toSkip = adaptiveSkipIds({
			questions,
			current: currentQuestion,
			answer,
			credit: questionCredit(currentQuestion, answer),
			adaptiveRules: quiz.adaptiveRules,
		});
		if (toSkip.size > 0) {
			setSkippedIds((previous) => {
				const next = new Set(previous);
				for (const id of toSkip) next.add(id);
				return next;
			});
		}
	}, [answers, currentQuestion, questions, quiz.adaptiveRules, revealed]);
}
