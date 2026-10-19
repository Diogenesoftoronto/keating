/**
 * Revealed quiz: completion summary and meta chips, collapsible review of every
 * question (remediation, benchmark, answers) and the retake button.
 */
import { RotateCcw } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import type { Quiz, QuizQuestion } from "../../keating/core";
import type { TopicStats } from "../QuizRenderer";
import { CompletionMark } from "./ActivityGame";
import { formatQuizDuration } from "./game";
import { BenchmarkComparison, RemediationDashboard } from "./QuizFeedbackPanels";
import { QuestionCard } from "./QuestionCard";
import { completionSummary } from "./quiz-scoring";
import { quizStyles } from "./quiz-styles";

export function QuizResultsView({
	normalizedQuiz,
	visibleQuestions,
	answers,
	totalScored,
	rawScore,
	percent,
	partialCreditPoints,
	pendingReviewCount,
	finalTotalMs,
	finalPerQuestionMs,
	timedOutIds,
	bookmarkIds,
	reframeModes,
	fetchedStats,
	onChangeAnswer,
	onToggleBookmark,
	onSpeak,
	onRequestRemediation,
	onRetake,
}: {
	normalizedQuiz: Quiz;
	visibleQuestions: QuizQuestion[];
	answers: Record<string, string>;
	totalScored: number;
	rawScore: number;
	percent: number;
	partialCreditPoints: number;
	pendingReviewCount: number;
	finalTotalMs: number | undefined;
	finalPerQuestionMs: Record<string, number> | undefined;
	timedOutIds: Set<string>;
	bookmarkIds: string[];
	reframeModes: Record<string, string | null>;
	fetchedStats: TopicStats | null | undefined;
	onChangeAnswer: (questionId: string, value: string) => void;
	onToggleBookmark: (questionId: string) => void;
	onSpeak: (text: string) => void;
	onRequestRemediation: (level: string) => void;
	onRetake: () => void;
}) {
	const summary = completionSummary({ totalScored, rawScore, pendingReviewCount });
	return (
		<>
			<div className={cx(quizStyles.resultIntro, "quiz-result-arrive")}>
				<CompletionMark detail={summary.detail}>{summary.title}</CompletionMark>
				<div className={quizStyles.resultMeta}>
					{finalTotalMs !== undefined ? <span aria-label={`Total quiz time: ${finalTotalMs} milliseconds`}>{formatQuizDuration(finalTotalMs)} total</span> : null}
					{timedOutIds.size ? <span>{timedOutIds.size} timed out</span> : null}
					{totalScored > 0 ? <span>{percent}% objective score</span> : null}
					{pendingReviewCount > 0 ? <span>{pendingReviewCount} pending review</span> : null}
					{bookmarkIds.length > 0 ? <span>{bookmarkIds.length} flagged</span> : null}
					{partialCreditPoints !== rawScore ? <span>{partialCreditPoints.toFixed(2)} partial points</span> : null}
				</div>
			</div>

			<details className="activity-review"><summary>Review answers & next steps</summary>
			<RemediationDashboard quiz={normalizedQuiz} answers={answers} onRequestRemediation={onRequestRemediation} />
			<BenchmarkComparison score={rawScore} partialCreditPoints={partialCreditPoints} total={totalScored} stats={fetchedStats} />

			<div className={css({ display: "grid", gap: "1.5rem", "& > * + *": { borderTop: "1px solid var(--border)", paddingTop: "1.5rem" } })}>
				{visibleQuestions.map((question, index) => (
					<QuestionCard
						key={question.id}
						q={question}
						index={index}
						answer={answers[question.id] || ""}
						onChange={(value) => onChangeAnswer(question.id, value)}
						revealed
						timeMs={finalPerQuestionMs?.[question.id]}
						timedOut={timedOutIds.has(question.id)}
						bookmarked={bookmarkIds.includes(question.id)}
						onToggleBookmark={() => onToggleBookmark(question.id)}
						onSpeak={() => onSpeak(question.question)}
						reframeMode={reframeModes[question.id] ?? null}
					/>
				))}
			</div>
			</details>
			<button type="button" onClick={onRetake} className={cx(quizStyles.buttonSecondary, "activity-back-action", css({ width: "100%", justifyContent: "center", gap: "0.5rem" }))}>
				<RotateCcw size={14} /> Retake
			</button>
		</>
	);
}
