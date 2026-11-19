import { Countdown } from "../../design-system/charts";
import { KeatingGlyph } from "../../design-system/glyphs";
import { quizTimerState } from "./game";
import "./quiz-countdown.css";

/** A quiet clock until time gets short; warning shape and motion supplement color. */
export function QuizCountdown({ remaining, total }: { remaining: number; total: number }) {
	const timer = quizTimerState(remaining, total);
	const seconds = Math.max(0, Math.ceil(Number.isFinite(remaining) ? remaining : 0));
	const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
	const glyph = timer.urgency === "steady" ? "clock" : "alert";
	return <div className="quiz-countdown" role="timer" aria-label="Time remaining on this question" aria-live="off" data-urgency={timer.urgency}>
		<strong className="quiz-countdown__digits"><KeatingGlyph name={glyph} size={14} />{clock}</strong>
		{total > 0 && seconds / total < 0.25 && <small>{seconds / total < 0.1 ? "Critical" : "Hurry"}</small>}
		<Countdown remaining={seconds} total={total} label="Question time left"/>
		{timer.urgency === "critical" ? <span className="activity-sr-only" role="status" aria-live="polite">Five seconds or less remaining.</span> : null}
	</div>;
}
