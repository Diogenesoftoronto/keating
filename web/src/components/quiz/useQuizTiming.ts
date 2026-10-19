/**
 * Timing for a running quiz, split in two hooks so the host can keep its
 * identity-reset effect between them (effect order matters: a reset must run
 * before the timers re-arm the deadline).
 *
 * - useQuizTimingState: refs/state for total time, per-question time, timeouts
 *   and the current countdown, plus accrue/record/reset/finish actions.
 * - useQuizTimers: the effects that arm the deadline and tick the clocks.
 *
 * Decisions (deadline capping, remaining seconds) live in ./quiz-session.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { QuizQuestion } from "../../keating/core";
import type { QuizTiming } from "../QuizRenderer";
import {
	type QuizDeadline,
	accrueQuestionTime,
	deadlineFor,
	isDeadlineExpired,
	remainingSeconds,
	resolvedTimeAt,
} from "./quiz-session";

export interface QuizCountdown {
	questionId?: string;
	remaining?: number;
}

export function useQuizTimingState({
	visibleQuestions,
	current,
	firstQuestion,
}: {
	visibleQuestions: QuizQuestion[];
	current: number;
	firstQuestion: QuizQuestion | undefined;
}) {
	const currentQuestion = visibleQuestions[current];
	const timeLimit = currentQuestion?.timeLimit;

	// Total wall-clock plus accrued time per question while stepping.
	const startRef = useRef<number>(Date.now());
	const questionEnteredRef = useRef<number>(startRef.current);
	const perQuestionRef = useRef<Record<string, number>>({});
	const finalTimingRef = useRef<QuizTiming | null>(null);
	const timedOutIdsRef = useRef(new Set<string>());
	const [timedOutIds, setTimedOutIds] = useState<Set<string>>(new Set());
	const deadlineRef = useRef<QuizDeadline | undefined>(undefined);
	const [elapsed, setElapsed] = useState(0);
	const [questionTimer, setQuestionTimer] = useState<QuizCountdown>({ questionId: currentQuestion?.id, remaining: timeLimit });
	const timeRemaining = questionTimer.questionId === currentQuestion?.id ? questionTimer.remaining : timeLimit;

	const accrueCurrent = useCallback((now = Date.now()) => {
		const questionId = visibleQuestions[current]?.id;
		if (!questionId) return;
		perQuestionRef.current = accrueQuestionTime(
			perQuestionRef.current,
			questionId,
			questionEnteredRef.current,
			now,
			deadlineRef.current,
		);
		questionEnteredRef.current = now;
	}, [current, visibleQuestions]);

	const recordTimeout = useCallback((now: number) => {
		const deadline = deadlineRef.current;
		if (!deadline || deadline.questionId !== currentQuestion?.id || now < deadline.at) return;
		if (!timedOutIdsRef.current.has(deadline.questionId)) {
			timedOutIdsRef.current.add(deadline.questionId);
			setTimedOutIds(new Set(timedOutIdsRef.current));
		}
	}, [currentQuestion?.id]);

	/** Closes out timing at submit: records a timeout, accrues the last question, freezes totals. */
	const finishTiming = useCallback((now: number): QuizTiming => {
		recordTimeout(now);
		const completedAt = resolvedTimeAt(deadlineRef.current, currentQuestion?.id, now);
		accrueCurrent(completedAt);
		const timing: QuizTiming = {
			totalMs: Math.max(0, completedAt - startRef.current),
			perQuestionMs: { ...perQuestionRef.current },
		};
		finalTimingRef.current = timing;
		setElapsed(timing.totalMs);
		return timing;
	}, [accrueCurrent, currentQuestion?.id, recordTimeout]);

	/** Restarts all clocks for a fresh run. */
	const resetTiming = useCallback(() => {
		setElapsed(0);
		setQuestionTimer({ questionId: firstQuestion?.id, remaining: firstQuestion?.timeLimit });
		startRef.current = Date.now();
		questionEnteredRef.current = startRef.current;
		timedOutIdsRef.current = new Set();
		deadlineRef.current = undefined;
		setTimedOutIds(new Set());
		perQuestionRef.current = {};
		finalTimingRef.current = null;
	}, [firstQuestion?.id, firstQuestion?.timeLimit]);

	/** True once the question's countdown has expired, so answers are no longer accepted. */
	const isQuestionLocked = useCallback(
		(questionId: string) => isDeadlineExpired(deadlineRef.current, questionId, Date.now()),
		[],
	);

	return {
		currentQuestion,
		timeLimit,
		timeRemaining,
		questionTimer,
		setQuestionTimer,
		elapsed,
		setElapsed,
		startRef,
		questionEnteredRef,
		deadlineRef,
		finalTimingRef,
		timedOutIds,
		timedOutIdsRef,
		accrueCurrent,
		recordTimeout,
		finishTiming,
		resetTiming,
		isQuestionLocked,
	};
}

export type QuizTimingState = ReturnType<typeof useQuizTimingState>;

export function useQuizTimers({
	timing,
	revealed,
	totalVisible,
	submittedRef,
}: {
	timing: QuizTimingState;
	revealed: boolean;
	totalVisible: number;
	submittedRef: { current: boolean };
}) {
	const {
		currentQuestion,
		timeLimit,
		deadlineRef,
		questionEnteredRef,
		setQuestionTimer,
		setElapsed,
		startRef,
	} = timing;

	// Arm the deadline whenever the question (or its limit) changes.
	useEffect(() => {
		if (revealed) return;
		deadlineRef.current = deadlineFor(currentQuestion, timeLimit, questionEnteredRef.current);
		setQuestionTimer({ questionId: currentQuestion?.id, remaining: timeLimit });
	}, [currentQuestion?.id, revealed, timeLimit]);

	// Tick the visible countdown.
	useEffect(() => {
		if (revealed || typeof timeLimit !== "number" || !currentQuestion) return;
		const questionId = currentQuestion.id;
		const id = window.setInterval(() => {
			if (submittedRef.current || deadlineRef.current?.questionId !== questionId) return;
			const remaining = remainingSeconds(deadlineRef.current.at, Date.now());
			setQuestionTimer((previous) => previous.questionId === questionId && previous.remaining === remaining ? previous : { questionId, remaining });
			if (remaining === 0) window.clearInterval(id);
		}, 100);
		return () => window.clearInterval(id);
	}, [currentQuestion?.id, revealed, timeLimit]);

	// Tick the total elapsed clock.
	useEffect(() => {
		if (revealed || totalVisible === 0) return;
		const id = window.setInterval(() => { if (!submittedRef.current) setElapsed(Math.max(0, Date.now() - startRef.current)); }, 250);
		return () => window.clearInterval(id);
	}, [revealed, totalVisible]);
}
