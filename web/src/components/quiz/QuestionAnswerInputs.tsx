/**
 * Answer inputs for each quiz question type (choice, multi-select, true/false,
 * free text, slider, dropdown) and the revealed-answer note. Each is a small
 * stateless component driven by QuestionCard.
 */
import { KeatingGlyph } from "../../design-system/glyphs";
import type { ReactNode } from "react";
import type { QuizQuestion } from "../../keating/core";
import { AnswerTile } from "./ActivityGame";
import { Select } from "../Select";
import { isOpenEnded } from "./quiz-scoring";

type OptionStatus = "correct" | "wrong" | "neutral" | undefined;

function QuizOption({ label, index, selected, onClick, disabled, status, checkbox }: {
	label: string;
	index?: number;
	selected: boolean;
	onClick: () => void;
	disabled?: boolean;
	status?: OptionStatus;
	checkbox?: boolean;
}) {
	return <AnswerTile label={label} index={index} selected={selected} onClick={onClick} disabled={disabled} status={status} multiple={checkbox} />;
}

/** Tile status once answers are revealed: the key is correct, a wrong pick is wrong. */
function revealedStatus(revealed: boolean, isKey: boolean, chosen: boolean): OptionStatus {
	if (!revealed) return undefined;
	if (isKey) return "correct";
	return chosen ? "wrong" : undefined;
}

export function ChoiceOptions({ q, answer, revealed, onChange, options, layout }: {
	q: QuizQuestion;
	answer: string;
	revealed: boolean;
	onChange: (val: string) => void;
	options: string[];
	layout: "grid" | "row";
}) {
	const tiles = options.map((opt, optionIndex) => {
		const chosen = answer === opt;
		return (
			<QuizOption
				key={opt}
				label={opt}
				index={optionIndex}
				selected={chosen}
				onClick={() => onChange(opt)}
				disabled={revealed}
				status={revealedStatus(revealed, opt === q.correctAnswer, chosen)}
			/>
		);
	});
	return layout === "grid"
		? <div className="activity-answer-grid">{tiles}</div>
		: <div className="quiz-tf">{tiles}</div>;
}

export function MultiSelectOptions({ q, selected, revealed, onToggle }: {
	q: QuizQuestion;
	selected: string[];
	revealed: boolean;
	onToggle: (opt: string) => void;
}) {
	return (
		<div className="activity-answer-grid">
			{(q.options ?? []).map((opt, optionIndex) => {
				const chosen = selected.includes(opt);
				return (
					<QuizOption
						key={opt}
						label={opt}
						index={optionIndex}
						selected={chosen}
						onClick={() => onToggle(opt)}
						disabled={revealed}
						status={revealedStatus(revealed, q.correctAnswers?.includes(opt) ?? false, chosen)}
						checkbox
					/>
				);
			})}
		</div>
	);
}

/** The correct answer, plus optional extra lines, shown under a revealed question. */
export function RevealedAnswerNote({ q, afterAnswer, afterExplanation }: {
	q: QuizQuestion;
	afterAnswer?: ReactNode;
	afterExplanation?: ReactNode;
}) {
	return (
		<div className="quiz-reveal">
			<KeatingGlyph name="bulb" size={13} />
			<div>
				<p>
					<b>{q.correctAnswer}</b>
				</p>
				{afterAnswer}
				{q.explanation && <p>{q.explanation}</p>}
				{afterExplanation}
			</div>
		</div>
	);
}

export function TextAnswer({ q, answer, revealed, correct, wrong, credit, onChange }: {
	q: QuizQuestion;
	answer: string;
	revealed: boolean;
	correct: boolean;
	wrong: boolean;
	credit: number;
	onChange: (val: string) => void;
}) {
	const result = revealed && q.type === "fill_in" ? wrong ? "wrong" : correct ? "correct" : undefined : undefined;
	return (
		<div className="lesson-section">
			<textarea
				className="quiz-field"
				data-result={result}
				aria-label="Your answer"
				placeholder={q.type === "fill_in" ? "Fill in the blank..." : "Type your answer..."}
				value={answer}
				onChange={(e) => onChange(e.target.value)}
				disabled={revealed}
			/>
			{revealed && !(q.type === "fill_in" && q.blanks && q.blanks.length > 0) && (
				<RevealedAnswerNote
					q={q}
					afterAnswer={isOpenEnded(q) && (
						<small>
							Teacher review pending{credit > 0 ? ` · ${credit >= 0.6 ? "close match" : "partial match"}` : ""}.
						</small>
					)}
					afterExplanation={q.rubric && <small>{q.rubric}</small>}
				/>
			)}
		</div>
	);
}

export function SliderAnswer({ q, answer, revealed, label, onChange }: {
	q: QuizQuestion;
	answer: string;
	revealed: boolean;
	label: string;
	onChange: (val: string) => void;
}) {
	return (
		<div className="quiz-slider">
			<div>
				<span className="quiz-meta">{q.min ?? 0}</span>
				<input
					type="range"
					aria-label={label}
					min={q.min ?? 0}
					max={q.max ?? 100}
					step={q.step ?? 1}
					value={answer ? parseFloat(answer) : (q.min ?? 0)}
					onChange={(e) => onChange(e.target.value)}
					disabled={revealed}
					className="lesson-range"
				/>
				<span className="quiz-meta">{q.max ?? 100}</span>
			</div>
			<output>
				{answer || (q.min ?? 0).toString()}
			</output>
			{revealed && <RevealedAnswerNote q={q} />}
		</div>
	);
}

export function DropdownAnswer({ q, answer, revealed, correct, label, onChange }: {
	q: QuizQuestion;
	answer: string;
	revealed: boolean;
	correct: boolean;
	label: string;
	onChange: (val: string) => void;
}) {
	return (
		<div className="lesson-section">
			<Select
				aria-label={label}
				value={answer}
				onValueChange={(value) => onChange(value)}
				disabled={revealed}
				className="quiz-field"
				data-result={revealed ? (correct ? "correct" : "wrong") : undefined}
			>
				<option value="" disabled>
					Select an answer...
				</option>
				{(q.options ?? []).map((opt) => (
					<option key={opt} value={opt}>
						{opt}
					</option>
				))}
			</Select>
			{revealed && <RevealedAnswerNote q={q} />}
		</div>
	);
}
