import "../lesson/lesson.css";
import type { ReactNode } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import "./activity-game.css";

/** A tactile choice shared by embedded learning activities. */
export function AnswerTile({ label, index, selected, disabled, status, multiple, onClick }: {
	label: string;
	index?: number;
	selected: boolean;
	disabled?: boolean;
	status?: "correct" | "wrong" | "neutral";
	multiple?: boolean;
	onClick: () => void;
}) {
	return (
		<button type="button" className="activity-answer" data-state={status && status !== "neutral" ? status : selected ? "selected" : "idle"}
			disabled={disabled} aria-pressed={selected} onClick={onClick}>
			<span className="activity-answer-key" aria-hidden="true" data-multiple={multiple || undefined}>
				{index === undefined ? <KeatingGlyph name="ring" size={14}/> : String.fromCharCode(65 + index)}
			</span>
			<span className="activity-answer-copy">{label}</span>
			{status === "correct" || status === "wrong" ? <span className="lesson-verdict"><KeatingGlyph name={status === "correct" ? "check" : "x"} size={13}/>{status === "correct" ? "Correct" : "Your answer"}</span> : null}
		</button>
	);
}

/** A solid fill on a soft track (board L1), with the mono position beside it. Never an invented game score. */
export function RoundProgress({ current, total, resolved, label = "Round progress", complete = false }: {
	current: number; total: number; resolved?: number; label?: string; complete?: boolean;
}) {
	const count = Math.max(0, Math.floor(total));
	const position = Math.min(count, Math.max(0, current));
	const done = complete ? count : position;
	// The fill reaches the question being answered, so "Question 1 of 1" reads as a full bar.
	const reach = complete ? count : Math.min(count, position + 1);
	return <div className="lesson-round">
		<span className="lesson-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={count} aria-valuenow={done} aria-valuetext={`${done} of ${count}`}>
			<i style={{ width: `${count > 0 ? reach / count * 100 : 0}%` }}/>
		</span>
		{resolved !== undefined && <span className="lesson-sr">{resolved} answered or skipped</span>}
		<small>{complete ? `${count} of ${count} complete` : `Question ${Math.min(position + 1, count)} of ${count}`}</small>
	</div>;
}

export function CompletionMark({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
	return (
		<div className="activity-completion" role="status" data-glyph-host>
			<span className="activity-completion-symbol" aria-hidden="true"><KeatingGlyph name="check" size={27} /></span>
			<div><strong>{children}</strong>{detail ? <p>{detail}</p> : null}</div>
		</div>
	);
}
