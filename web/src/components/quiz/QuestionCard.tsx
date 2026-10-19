/**
 * One quiz question: prompt row (with reframe, read-aloud, bookmark and timing
 * chips), the answer input for its type, and the partial-credit badge. Used both
 * for the live question and for each revealed question in the review list.
 */
import { AlertTriangle, Bookmark, Clock, Volume2 } from "lucide-react";
import { useMemo } from "react";
import { css, cx } from "../../../styled-system/css";
import type { QuizQuestion } from "../../keating/core";
import { formatQuizDuration, isQuickQuizAnswer } from "./game";
import {
	ChoiceOptions,
	DropdownAnswer,
	MultiSelectOptions,
	SliderAnswer,
	TextAnswer,
} from "./QuestionAnswerInputs";
import { MultiBlankFillIn } from "./MultiBlankFillIn";
import { QuizResultBadge } from "./QuizResultBadge";
import { ReframeToggle } from "./ReframeToggle";
import { showsBinaryResult } from "./quiz-presentation";
import { isCorrect, questionCredit } from "./quiz-scoring";
import { dark, quizStyles, shared, sm } from "./quiz-styles";

export interface QuestionCardProps {
	q: QuizQuestion;
	index: number;
	answer: string;
	onChange: (val: string) => void;
	revealed: boolean;
	timeMs?: number;
	timedOut?: boolean;
	bookmarked: boolean;
	onToggleBookmark: () => void;
	onSpeak: () => void;
	reframeMode?: string | null;
	onReframe?: (mode: string | null) => void;
}

/** Comma-separated multi-select answer to its selected options. */
function parseMultiSelected(answer: string): string[] {
	return answer.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Toggles `opt` in a comma-separated multi-select answer. */
function toggleMultiAnswer(selected: string[], opt: string): string {
	const set = new Set(selected);
	if (set.has(opt)) set.delete(opt);
	else set.add(opt);
	return Array.from(set).join(",");
}

function requestReframe(q: QuizQuestion, mode: string | null) {
	// If the selected mode has no pre-generated reframe, request one from the agent
	if (mode && !q.reframes?.[mode]) {
		window.dispatchEvent(
			new CustomEvent("keating:quiz-reframe-requested", {
				detail: { questionId: q.id, mode, topic: q.question },
			})
		);
	}
}

function QuestionActions({ q, revealed, timeMs, timedOut, answer, bookmarked, onToggleBookmark, onSpeak }: {
	q: QuizQuestion;
	revealed: boolean;
	timeMs?: number;
	timedOut: boolean;
	answer: string;
	bookmarked: boolean;
	onToggleBookmark: () => void;
	onSpeak: () => void;
}) {
	return (
		<div className={css({ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "flex-end", gap: "0.25rem" })}>
			<button
				type="button"
				onClick={onSpeak}
				className={quizStyles.iconButton}
				aria-label="Read question aloud"
				title="Read aloud"
			>
				<Volume2 size={14} />
			</button>
			<button
				type="button"
				onClick={onToggleBookmark}
				className={cx(
					quizStyles.iconButton,
					bookmarked && css({ color: "#f59e0b", _hover: { color: "#f59e0b" } }),
				)}
				aria-label={bookmarked ? "Remove bookmark" : "Bookmark question"}
				title={bookmarked ? "Bookmarked" : "Bookmark for review"}
			>
				<Bookmark size={14} fill={bookmarked ? "currentColor" : "none"} />
			</button>
			{revealed && timedOut ? <span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Timed out</span> : null}
			{revealed && isQuickQuizAnswer({ timeMs, timeLimitSeconds: q.timeLimit, answered: Boolean(answer.trim()), timedOut }) ? <span title="Answered within the first quarter of the time budget. Timing does not indicate correctness." className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Quick answer</span> : null}
			{revealed && typeof timeMs === "number" && (
				<span className={cx("font-terminal", css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.625rem", color: "var(--muted-foreground)" }))}>
					<Clock size={11} aria-hidden="true" />
					<span aria-label={`Time on question: ${timeMs} milliseconds`}>{formatQuizDuration(timeMs)}</span>
				</span>
			)}
		</div>
	);
}

export function QuestionCard({
	q,
	index,
	answer,
	onChange,
	revealed,
	timeMs,
	timedOut = false,
	bookmarked,
	onToggleBookmark,
	onSpeak,
	reframeMode,
	onReframe,
}: QuestionCardProps) {
	const credit = questionCredit(q, answer);
	const correct = isCorrect(q, answer);
	const wrong = Boolean(revealed && answer.trim() && !correct);
	const binaryCorrect = credit >= 1;
	const isMultiBlankFillIn = q.type === "fill_in" && !!q.blanks?.length;

	const displayQuestion = useMemo(() => {
		if (reframeMode && q.reframes?.[reframeMode]) {
			return q.reframes[reframeMode];
		}
		return q.question;
	}, [q, reframeMode]);

	const reframeModes = useMemo(() => {
		if (!q.reframes) return [];
		return Object.keys(q.reframes);
	}, [q.reframes]);

	const selectedMulti = useMemo(() => {
		if (q.type !== "multi_select") return [];
		return parseMultiSelected(answer);
	}, [answer, q.type]);

	return (
		<div className={quizStyles.card}>
			<div className={css({ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "0.5rem", [sm]: { flexDirection: "row", alignItems: "flex-start" } })}>
				<div className={cx(shared.minFlex, shared.stack2)}>
					{revealed ? (
						<span className={cx("font-terminal", css({ fontSize: "0.6875rem", color: "var(--muted-foreground)" }))}>
							{index + 1} · {q.level}
						</span>
					) : null}
					<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "0.5rem" })}>
						{isMultiBlankFillIn ? (
							<div className={shared.minFlex}>
								<MultiBlankFillIn
									question={displayQuestion}
									blanks={q.blanks ?? []}
									answer={answer}
									onChange={onChange}
									revealed={revealed}
									correctAnswers={q.correctAnswers ?? [q.correctAnswer]}
								/>
							</div>
						) : (
							<p className="activity-prompt">{displayQuestion}</p>
						)}
						{revealed && showsBinaryResult(q) && <QuizResultBadge correct={binaryCorrect} />}
					</div>
					{reframeModes.length > 0 && !revealed && onReframe && (
						<ReframeToggle
							modes={reframeModes}
							active={reframeMode ?? null}
							onChange={(mode) => {
								onReframe(mode);
								requestReframe(q, mode);
							}}
						/>
					)}
				</div>
				<QuestionActions
					q={q}
					revealed={revealed}
					timeMs={timeMs}
					timedOut={timedOut}
					answer={answer}
					bookmarked={bookmarked}
					onToggleBookmark={onToggleBookmark}
					onSpeak={onSpeak}
				/>
			</div>

			{q.type === "multiple_choice" && q.options && (
				<ChoiceOptions q={q} answer={answer} revealed={revealed} onChange={onChange} options={q.options} layout="grid" />
			)}

			{q.type === "multi_select" && q.options && (
				<MultiSelectOptions
					q={q}
					selected={selectedMulti}
					revealed={revealed}
					onToggle={(opt) => onChange(toggleMultiAnswer(selectedMulti, opt))}
				/>
			)}

			{(q.type === "short_answer" || q.type === "fill_in" || q.type === "transfer") && !isMultiBlankFillIn && (
				<TextAnswer q={q} answer={answer} revealed={revealed} correct={correct} wrong={wrong} credit={credit} onChange={onChange} />
			)}

			{q.type === "true_false" && (
				<ChoiceOptions q={q} answer={answer} revealed={revealed} onChange={onChange} options={["True", "False"]} layout="row" />
			)}

			{q.type === "slider" && (
				<SliderAnswer q={q} answer={answer} revealed={revealed} label={displayQuestion} onChange={onChange} />
			)}

			{q.type === "dropdown" && q.options && (
				<DropdownAnswer q={q} answer={answer} revealed={revealed} correct={correct} label={displayQuestion} onChange={onChange} />
			)}

			{/* Partial credit badge */}
			{revealed && credit < 1 && credit > 0 && (
				<div className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "9999px", background: "rgba(245, 158, 11, 0.1)", padding: "0.25rem 0.625rem", fontSize: "0.6875rem", fontWeight: 500, color: "#d97706", [dark]: { color: "#f59e0b" } })}>
					<AlertTriangle size={12} />
					Partial credit: {Math.round(credit * 100)}%
				</div>
			)}
		</div>
	);
}
