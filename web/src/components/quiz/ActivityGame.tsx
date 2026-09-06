import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
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
				{status === "correct" || selected && status !== "wrong" ? <Check className="activity-answer-check" size={18} strokeWidth={2.5} /> : status === "wrong" ? <X size={18} /> : index === undefined ? "·" : String.fromCharCode(65 + index)}
			</span>
			<span className="activity-answer-copy">{label}</span>
			{status === "correct" || status === "wrong" ? <span className="activity-sr-only">{status === "correct" ? "Correct answer" : "Incorrect answer"}</span> : null}
		</button>
	);
}

/** Segments represent actual activity progress, never an invented game score. */
export function RoundProgress({ current, total, resolved, label = "Round progress", complete = false }: {
	current: number; total: number; resolved?: number; label?: string; complete?: boolean;
}) {
	const count = Math.max(0, Math.floor(total));
	const position = Math.min(count, Math.max(0, current));
	const value = complete ? count : Math.min(count, Math.max(0, resolved ?? position));
	return (
		<div className="activity-progress-row">
			<div className="activity-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={count || 1} aria-valuenow={value}>
				{count <= 20 ? Array.from({ length: count }, (_, index) => <span key={index} data-filled={index < value}><i /></span>) : <span className="activity-progress-continuous" style={{ transform: `scaleX(${value / count})` }} />}
			</div>
			<span key={`${position}:${value}:${complete}`} className="activity-progress-count">{complete ? "Complete" : `${Math.min(position + 1, count)} / ${count}`}</span>
		</div>
	);
}

export function CompletionMark({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
	return (
		<div className="activity-completion" role="status">
			<span className="activity-completion-symbol" aria-hidden="true"><Check size={27} strokeWidth={2.5} /></span>
			<div><strong>{children}</strong>{detail ? <p>{detail}</p> : null}</div>
		</div>
	);
}
