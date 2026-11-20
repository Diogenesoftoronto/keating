import { LessonScore } from "../lesson/LessonFrame";
/**
 * Revealed quiz: completion summary and meta chips, collapsible review of every
 * question (remediation, benchmark, answers) and the retake button.
 */
import { KeatingGlyph } from "../../design-system/glyphs";
import type { Quiz, QuizQuestion } from "../../keating/core";
import type { TopicStats } from "../QuizRenderer";
import { CompletionMark } from "./ActivityGame";
import { formatQuizDuration } from "./game";
import { BenchmarkComparison, RemediationDashboard } from "./QuizFeedbackPanels";
import { QuestionCard } from "./QuestionCard";
import { completionSummary, isOpenEnded, isCorrect, questionCredit } from "./quiz-scoring";

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
	const partly = visibleQuestions.filter(q => !isOpenEnded(q) && !isCorrect(q, answers[q.id] ?? "") && questionCredit(q, answers[q.id] ?? "") > 0).length;
	const summary = completionSummary({ totalScored, rawScore, pendingReviewCount });
	return (
		<>
			<div className="lesson-body">
				<div className="lesson-section quiz-result-arrive">
					<CompletionMark detail={summary.detail}>{summary.title}</CompletionMark>
					<LessonScore score={totalScored ? `${rawScore} of ${totalScored}` : "Pending review"} percent={totalScored ? percent : undefined} time={finalTotalMs !== undefined ? formatQuizDuration(finalTotalMs) : undefined} correct={rawScore} partly={partly} missed={Math.max(0,totalScored-rawScore-partly)}/>
					<div className="quiz-result-meta">
						{finalTotalMs !== undefined ? <span aria-label={`Total quiz time: ${finalTotalMs} milliseconds`}>{formatQuizDuration(finalTotalMs)} total</span> : null}
						{timedOutIds.size ? <span>{timedOutIds.size} timed out</span> : null}
						{totalScored > 0 ? <span>{percent}% objective score</span> : null}
						{pendingReviewCount > 0 ? <span>{pendingReviewCount} pending review</span> : null}
						{bookmarkIds.length > 0 ? <span>{bookmarkIds.length} flagged</span> : null}
						{partialCreditPoints !== rawScore ? <span>{partialCreditPoints.toFixed(2)} partial points</span> : null}
					</div>
				</div>

				<details className="activity-review">
					<summary><KeatingGlyph name="checklist" size={13} />All answers<span className="lesson-meta">{visibleQuestions.length}</span><KeatingGlyph name="chev" size={13} /><KeatingGlyph name="chevu" size={13} /></summary>
					<RemediationDashboard quiz={normalizedQuiz} answers={answers} onRequestRemediation={onRequestRemediation} />
					<BenchmarkComparison score={rawScore} partialCreditPoints={partialCreditPoints} total={totalScored} stats={fetchedStats} />

					<div className="quiz-review-list">
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
			</div>
			<footer className="lesson-foot">
				<span className="lesson-foot-meta">{visibleQuestions.length} questions</span>
				<button type="button" onClick={onRetake} className="lesson-primary" data-glyph-surface="inverse">
					<KeatingGlyph name="refresh" size={13} /> Retake
				</button>
			</footer>
		</>
	);
}
