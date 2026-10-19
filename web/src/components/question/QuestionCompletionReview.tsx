/**
 * Post-submit review of a question round: a completion mark plus a collapsible
 * list of the learner's answers, with red/green rows for keyed matching questions.
 */
import { MessageSquare } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { CompletionMark } from "../quiz/ActivityGame";
import type { QuestionField } from "../QuestionRenderer";
import {
	type BlankState,
	isMatchingQuestion,
	matchingCorrectness,
	serializeQuestionAnswer,
} from "./question-answers";
import { questionStyles, sm } from "./question-styles";

interface QuestionCompletionReviewProps {
	questions: QuestionField[];
	answers: BlankState[];
}

export function QuestionCompletionReview({ questions, answers: states }: QuestionCompletionReviewProps) {
	return (
		<div className={cx(questionStyles.submittedShell, "activity-game")}>
			<CompletionMark detail="Your answers are ready for review.">Round complete</CompletionMark>
			<details className="activity-review">
				<summary>Review answers</summary>
				<div className={questionStyles.rowStart}>
				<div className={cx(questionStyles.minFlex, questionStyles.stack2)}>

					<div className={css({ display: "grid", gap: "0.5rem", fontSize: "0.875rem", color: "var(--primary)" })}>
						{questions.map((q, index) => {
							const state = states[index];
							if (isMatchingQuestion(q) && q.correctMatches && state) {
								return (
									<div key={index} className={questionStyles.stack2}>
										<div className={questionStyles.rowStart}>
											<MessageSquare size={14} className={css({ marginTop: "0.25rem", flexShrink: 0 })} />
											<span className={cx(questionStyles.minFlex, questionStyles.breakWords)}>
												{q.header ? `${q.header}: ` : ""}
												<strong>{q.question}</strong>
											</span>
										</div>
										<div className={questionStyles.stack15}>
											{state.classifications.map((row, rowIndex) => {
												const status = matchingCorrectness(q, rowIndex, row.choice);
												const correct = q.correctMatches?.[rowIndex];
												return (
													<div
														key={`${row.item}-${rowIndex}`}
														className={cx(
															css({
																display: "grid",
																gap: "0.5rem",
																borderRadius: "0.375rem",
																border: "1px solid",
																padding: "0.375rem 0.5rem",
																[sm]: { gridTemplateColumns: "minmax(0,1fr) minmax(11rem,0.42fr)" },
															}),
															status === "correct"
																? css({ borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)", color: "var(--primary)" })
																: status === "wrong"
																	? css({ borderColor: "color-mix(in srgb, var(--destructive) 50%, transparent)", background: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: "var(--destructive)" })
																	: css({ borderColor: "var(--border)", background: "var(--background)", color: "var(--foreground)" }),
														)}
													>
														<div className={cx(questionStyles.minFlex, questionStyles.breakWords)}>{row.item}</div>
														<div className={css({ minWidth: 0 })}>
															<strong className={questionStyles.breakWords}>{row.choice}</strong>
															{status === "wrong" && correct && (
																<div className={css({ marginTop: "0.125rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
																	Correct: {correct}
																</div>
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								);
							}
							return (
								<div key={index} className={questionStyles.rowStart}>
									<MessageSquare size={14} className={css({ marginTop: "0.25rem", flexShrink: 0 })} />
									<span className={css({ minWidth: 0, whiteSpace: "pre-line", overflowWrap: "break-word" })}>
										{q.header ? `${q.header}: ` : ""}
										<strong>{serializeQuestionAnswer(q, state)}</strong>
									</span>
								</div>
							);
						})}
					</div>
				</div>
			</div>
			</details>
		</div>
	);
}
