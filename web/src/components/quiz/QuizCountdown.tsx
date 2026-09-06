import { AlertTriangle, Clock } from "lucide-react";
import { quizTimerState } from "./game";
import "./quiz-countdown.css";

/** A quiet clock until time gets short; warning shape and motion supplement color. */
export function QuizCountdown({ remaining, total }: { remaining: number; total: number }) {
	const timer = quizTimerState(remaining, total);
	const seconds = Math.max(0, Math.ceil(Number.isFinite(remaining) ? remaining : 0));
	const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
	const Icon = timer.urgency === "steady" ? Clock : AlertTriangle;
	return <div className="quiz-countdown" role="timer" aria-label="Time remaining on this question" aria-live="off" data-urgency={timer.urgency}>
		<strong className="quiz-countdown__digits"><Icon size={20} aria-hidden="true" />{clock}</strong>
		<div className="quiz-countdown__track" aria-hidden="true"><div style={{ transform: `scaleX(${timer.progress})` }} /></div>
		{timer.urgency === "critical" ? <span className="activity-sr-only" role="status" aria-live="polite">Five seconds or less remaining.</span> : null}
	</div>;
}
