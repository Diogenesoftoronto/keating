/**
 * State machine for one quiz run: answers, current position, reveal/submit,
 * retake, and the effects that tie the run to quiz identity, analytics,
 * countdown timeouts and position clamping. Scoring, timing, adaptive skipping
 * and preferences come from sibling modules; this hook only sequences them.
 */
import { usePostHog } from "@posthog/react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { QuizResult, QuizRendererProps } from "../QuizRenderer";
import { uniqueQuizQuestions } from "./game";
import { isOpenEnded, countAnswered, summarizeQuizScores } from "./quiz-scoring";
import { clampQuestionIndex, isValidQuestionIndex, timeoutAdvance } from "./quiz-session";
import { createQuizResultId } from "./quiz-result-id";
import { quizStorage, useQuizBookmarks, useQuizShaderPreset, useTopicStats } from "./useQuizPreferences";
import { useAdaptiveSkipEffect, useSkippedQuestionIds } from "./useQuizAdaptiveSkips";
import { useQuizTimers, useQuizTimingState } from "./useQuizTiming";

export function useQuizRun({ quiz, onSubmit, topicStats, defaultShaderPreset }: QuizRendererProps) {
	const posthog = usePostHog();
	const questions = useMemo(() => uniqueQuizQuestions(quiz.questions), [quiz.questions]);
	const normalizedQuiz = useMemo(() => ({ ...quiz, questions }), [questions, quiz]);
	const quizIdentity = `${quiz.slug ?? quiz.topic}:${questions.map((question) => question.id).join("|")}`;
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [revealed, setRevealed] = useState(false);
	const [current, setCurrent] = useState(0);
	const [isQuestionPending, startQuestionTransition] = useTransition();
	const [reframeModes, setReframeModes] = useState<Record<string, string | null>>({});
	const resultIdRef = useRef(createQuizResultId(quiz.slug ?? quiz.topic));
	const submittedRef = useRef(false);
	const previousQuizIdentityRef = useRef(quizIdentity);

	const { bookmarkIds, toggleBookmark } = useQuizBookmarks();
	const { shaderPreset, changeShaderPreset, reloadShaderPreset } = useQuizShaderPreset(quizIdentity, defaultShaderPreset);
	const fetchedStats = useTopicStats(topicStats, quiz.slug);

	const [skippedIds, setSkippedIds] = useSkippedQuestionIds();
	const visibleQuestions = useMemo(
		() => questions.filter((question) => !skippedIds.has(question.id)),
		[questions, skippedIds],
	);
	const totalVisible = visibleQuestions.length;
	const scorableQuestions = useMemo(
		() => visibleQuestions.filter((question) => !isOpenEnded(question)),
		[visibleQuestions],
	);
	const pendingReviewCount = totalVisible - scorableQuestions.length;
	const totalScored = scorableQuestions.length;

	const timing = useQuizTimingState({ visibleQuestions, current, firstQuestion: questions[0] });
	const { currentQuestion, timeLimit, timeRemaining, questionTimer, accrueCurrent, recordTimeout, finishTiming, resetTiming, isQuestionLocked } = timing;

	const { partialCredits, rawScore, partialCreditPoints, percent } = useMemo(
		() => summarizeQuizScores(scorableQuestions, answers),
		[answers, scorableQuestions],
	);
	const answeredCount = countAnswered(visibleQuestions, answers);
	const allAnswered = totalVisible > 0 && answeredCount === totalVisible;

	const doSubmit = useCallback(() => {
		if (submittedRef.current || totalVisible === 0) return;
		submittedRef.current = true;
		const submittedTiming = finishTiming(Date.now());
		setRevealed(true);
		posthog.capture("quiz_completed", {
			question_count: questions.length,
			score: rawScore,
			partial_credit_points: partialCreditPoints,
			duration_ms: submittedTiming.totalMs,
		});
		const timedOutQuestionIds = [...timing.timedOutIdsRef.current];
		onSubmit?.({
			resultId: resultIdRef.current,
			answers,
			score: rawScore,
			partialCreditPoints,
			timing: submittedTiming,
			partialCredits,
			flagged: bookmarkIds,
			timedOutQuestionIds,
		} satisfies QuizResult);
		quizStorage.saveQuizResult(rawScore, partialCreditPoints, totalScored, quiz.slug, {
			resultId: resultIdRef.current,
			answers,
			partialCredits,
			timing: submittedTiming,
			flaggedQuestionIds: bookmarkIds,
			timedOutQuestionIds,
			pendingGradeQuestionIds: questions.filter(isOpenEnded).map((question) => question.id),
		}).catch(() => {});
		window.speechSynthesis?.cancel();
	}, [answers, bookmarkIds, finishTiming, onSubmit, partialCreditPoints, partialCredits, posthog, questions, quiz.slug, rawScore, timing.timedOutIdsRef, totalScored, totalVisible]);

	const resetRun = useCallback(() => {
		setAnswers({});
		resultIdRef.current = createQuizResultId(quiz.slug ?? quiz.topic);
		setRevealed(false);
		setCurrent(0);
		setSkippedIds(new Set());
		setReframeModes({});
		resetTiming();
		submittedRef.current = false;
		window.speechSynthesis?.cancel();
	}, [quiz.slug, quiz.topic, resetTiming]);

	// Reset state if a parent reuses this component instance for another quiz.
	useEffect(() => {
		if (previousQuizIdentityRef.current === quizIdentity) return;
		previousQuizIdentityRef.current = quizIdentity;
		resetRun();
		reloadShaderPreset();
	}, [quizIdentity, reloadShaderPreset, resetRun]);

	useEffect(() => {
		posthog.capture("quiz_started", {
			question_count: questions.length,
			has_stable_slug: Boolean(quiz.slug),
		});
	}, [posthog, questions.length, quiz.slug, quizIdentity]);

	useQuizTimers({ timing, revealed, totalVisible, submittedRef });

	const goTo = useCallback((nextIndex: number) => {
		if (!isValidQuestionIndex(nextIndex, totalVisible)) return;
		const now = Date.now();
		recordTimeout(now);
		accrueCurrent(now);
		startQuestionTransition(() => setCurrent(nextIndex));
	}, [accrueCurrent, recordTimeout, totalVisible]);

	// When the countdown hits zero, record the timeout and move on (or submit on the last question).
	useEffect(() => {
		if (revealed || questionTimer.questionId !== currentQuestion?.id || typeof timeRemaining !== "number" || timeRemaining > 0 || totalVisible === 0) return;
		recordTimeout(Date.now());
		const id = window.setTimeout(() => {
			if (timeoutAdvance(current, totalVisible) === "submit") doSubmit();
			else goTo(current + 1);
		}, 200);
		return () => window.clearTimeout(id);
	}, [current, currentQuestion, doSubmit, goTo, questionTimer.questionId, recordTimeout, revealed, timeRemaining, totalVisible]);

	useAdaptiveSkipEffect({ quiz, questions, currentQuestion, answers, revealed, setSkippedIds });

	useEffect(() => {
		const clamped = clampQuestionIndex(current, totalVisible);
		if (clamped !== current) setCurrent(clamped);
	}, [current, totalVisible]);

	useEffect(() => () => window.speechSynthesis?.cancel(), []);

	const setAnswer = useCallback((questionId: string, value: string) => {
		if (submittedRef.current || isQuestionLocked(questionId)) return;
		setAnswers((previous) => ({ ...previous, [questionId]: value }));
	}, [isQuestionLocked]);

	const setReframeMode = useCallback((questionId: string, mode: string | null) => {
		setReframeModes((previous) => ({ ...previous, [questionId]: mode }));
	}, []);

	return {
		questions,
		normalizedQuiz,
		quizIdentity,
		answers,
		revealed,
		current,
		isQuestionPending,
		reframeModes,
		setReframeMode,
		skippedIds,
		visibleQuestions,
		totalVisible,
		pendingReviewCount,
		totalScored,
		currentQuestion,
		timeLimit,
		timeRemaining,
		elapsed: timing.elapsed,
		finalTiming: timing.finalTimingRef.current,
		timedOutIds: timing.timedOutIds,
		rawScore,
		partialCreditPoints,
		percent,
		answeredCount,
		allAnswered,
		isLast: current === totalVisible - 1,
		submitted: submittedRef.current,
		bookmarkIds,
		toggleBookmark,
		shaderPreset,
		changeShaderPreset,
		fetchedStats,
		goTo,
		doSubmit,
		resetRun,
		setAnswer,
	};
}
