/**
 * Quiz renderer: public types and the QuizRenderer shell. The run state machine
 * lives in ./quiz/useQuizRun, scoring in ./quiz/quiz-scoring, timing and
 * navigation decisions in ./quiz/quiz-session, and the header, question card,
 * navigation and results are components under ./quiz/.
 */
import { useCallback } from "react";
import type { Quiz } from "../keating/core";
import { cx } from "../../styled-system/css";
import type { FlashcardShaderPreset } from "./flashcards/game";
import { quizTimerState } from "./quiz/game";
import { QuestionCard } from "./quiz/QuestionCard";
import { QuizHeader } from "./quiz/QuizHeader";
import { QuizNavigation } from "./quiz/QuizNavigation";
import { QuizResultsView } from "./quiz/QuizResultsView";
import { createQuizResultId } from "./quiz/quiz-result-id";
import { quizQuestionEntryClass, quizShaderAccent, stableQuizSeed } from "./quiz/quiz-presentation";
import { isOpenEnded, questionCredit } from "./quiz/quiz-scoring";
import { quizStyles } from "./quiz/quiz-styles";
import { useQuizRun } from "./quiz/useQuizRun";

export { createQuizResultId, isOpenEnded, questionCredit };

export interface QuizTiming {
	/** Total wall-clock time the learner spent on the quiz, in ms. */
	totalMs: number;
	/** Time spent per question id, in ms. */
	perQuestionMs: Record<string, number>;
}

export interface QuizResult {
	resultId: string;
	answers: Record<string, string>;
	score: number;
	partialCreditPoints: number;
	timing: QuizTiming;
	partialCredits: Record<string, number>;
	flagged: string[];
	/** Authored countdowns that expired during this run. */
	timedOutQuestionIds?: string[];
	examTimedOut?: boolean;
}

export interface TopicStats {
	count: number;
	avgScore: number;
	avgPartialCreditPoints: number;
	topQuartile: number;
}

export interface QuizRendererProps {
	quiz: Quiz;
	onSubmit?: (result: QuizResult) => void;
	topicStats?: TopicStats | null;
	/** Initial visual atmosphere. A saved learner choice takes precedence. */
	defaultShaderPreset?: FlashcardShaderPreset;
}

export interface QuizRendererProps {
	quiz: Quiz;
	onSubmit?: (result: QuizResult) => void;
	topicStats?: TopicStats | null;
	/** Initial visual atmosphere. A saved learner choice takes precedence. */
	defaultShaderPreset?: FlashcardShaderPreset;
}

function speakQuestion(text: string) {
	if (typeof window === "undefined" || !window.speechSynthesis) return;
	window.speechSynthesis.cancel();
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.rate = 0.95;
	window.speechSynthesis.speak(utterance);
}

export function QuizRenderer(props: QuizRendererProps) {
	const { quiz } = props;
	const run = useQuizRun(props);
	const {
		questions,
		quizIdentity,
		answers,
		revealed,
		current,
		currentQuestion,
		totalVisible,
		totalScored,
		rawScore,
		answeredCount,
		shaderPreset,
		timeRemaining,
		timeLimit,
	} = run;

	const handleRequestRemediation = useCallback((level: string) => {
		window.dispatchEvent(new CustomEvent("keating:quiz-remediation-requested", {
			detail: { level, topic: quiz.topic, slug: quiz.slug },
		}));
	}, [quiz.slug, quiz.topic]);

	const shaderSeed = stableQuizSeed(`${quizIdentity}:${currentQuestion?.id ?? "result"}`);
	const shaderEnergy = revealed
		? Math.min(1, totalScored > 0 ? rawScore / totalScored + 0.16 : 0.35)
		: Math.min(1, answeredCount / Math.max(1, totalVisible) * 0.65 + current / Math.max(1, totalVisible) * 0.25);
	const headerStyle = { "--arena-accent": quizShaderAccent(shaderPreset) } as React.CSSProperties;
	const timer = !revealed && typeof timeRemaining === "number" && typeof timeLimit === "number"
		? { ...quizTimerState(timeRemaining, timeLimit), remaining: timeRemaining }
		: null;

	const header = (
		<QuizHeader
			topic={quiz.topic}
			shaderPreset={shaderPreset}
			shaderEnergy={shaderEnergy}
			shaderSeed={shaderSeed}
			shaderKey={`${shaderPreset}:${currentQuestion?.id ?? "result"}`}
			headerStyle={headerStyle}
			timer={timer}
			revealed={revealed}
			finalTotalMs={run.finalTiming?.totalMs}
			elapsed={run.elapsed}
			skippedCount={run.skippedIds.size}
			rawScore={rawScore}
			totalScored={totalScored}
			current={current}
			totalVisible={totalVisible}
			answeredCount={answeredCount}
			onChangeShaderPreset={run.changeShaderPreset}
		/>
	);

	if (questions.length === 0) {
		return (
			<section className={cx(quizStyles.shell, "activity-game activity-quiz")} aria-label={`Quiz: ${quiz.topic}`}>
				{header}
				<div className={quizStyles.empty} role="status">No quiz questions yet.</div>
			</section>
		);
	}

	return (
		<section className={cx(quizStyles.shell, "activity-game activity-quiz")} aria-label={`Quiz: ${quiz.topic}`}>
			{header}

			{!revealed ? (
				<>
					{currentQuestion ? (
						<div
							key={`${currentQuestion.id}:${shaderPreset}`}
							aria-busy={run.isQuestionPending}
							className={cx(quizStyles.questionStage, quizQuestionEntryClass(shaderPreset))}
							style={{ ...headerStyle, opacity: run.isQuestionPending ? 0.72 : 1 }}
						>
							<QuestionCard
								q={currentQuestion}
								index={current}
								answer={answers[currentQuestion.id] || ""}
								onChange={(value) => run.setAnswer(currentQuestion.id, value)}
								revealed={false}
								bookmarked={run.bookmarkIds.includes(currentQuestion.id)}
								onToggleBookmark={() => run.toggleBookmark(currentQuestion.id)}
								onSpeak={() => speakQuestion(currentQuestion.question)}
								reframeMode={run.reframeModes[currentQuestion.id] ?? null}
								onReframe={(mode) => run.setReframeMode(currentQuestion.id, mode)}
							/>
						</div>
					) : null}

					<QuizNavigation
						isFirst={current === 0}
						isLast={run.isLast}
						isPending={run.isQuestionPending}
						currentAnswered={Boolean(currentQuestion && answers[currentQuestion.id]?.trim())}
						allAnswered={run.allAnswered}
						submitted={run.submitted}
						unansweredCount={totalVisible - answeredCount}
						onPrev={() => run.goTo(current - 1)}
						onNext={() => run.goTo(current + 1)}
						onFinish={run.doSubmit}
					/>
				</>
			) : (
				<QuizResultsView
					normalizedQuiz={run.normalizedQuiz}
					visibleQuestions={run.visibleQuestions}
					answers={answers}
					totalScored={totalScored}
					rawScore={rawScore}
					percent={run.percent}
					partialCreditPoints={run.partialCreditPoints}
					pendingReviewCount={run.pendingReviewCount}
					finalTotalMs={run.finalTiming?.totalMs}
					finalPerQuestionMs={run.finalTiming?.perQuestionMs}
					timedOutIds={run.timedOutIds}
					bookmarkIds={run.bookmarkIds}
					reframeModes={run.reframeModes}
					fetchedStats={run.fetchedStats}
					onChangeAnswer={run.setAnswer}
					onToggleBookmark={run.toggleBookmark}
					onSpeak={speakQuestion}
					onRequestRemediation={handleRequestRemediation}
					onRetake={run.resetRun}
				/>
			)}
		</section>
	);
}

QuizRenderer.displayName = "QuizRenderer";
