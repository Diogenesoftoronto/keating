/**
 * Quiz header: shader backdrop, topic, the per-question countdown, elapsed or
 * final time, adapted/score chips, the appearance picker and round progress.
 */
import { AlertTriangle, Clock, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "../../../styled-system/css";
import { Select } from "../Select";
import { FlashcardShaderField } from "../flashcards/FlashcardShaderField";
import type { FlashcardShaderPreset } from "../flashcards/game";
import { RoundProgress } from "./ActivityGame";
import { QUIZ_SHADER_OPTIONS, formatQuizDuration, type QuizTimerState } from "./game";
import { formatCountdown, formatDuration } from "./quiz-presentation";
import { quizStyles } from "./quiz-styles";

export interface QuizHeaderTimer extends QuizTimerState {
	remaining: number;
}

export function QuizHeader({
	topic,
	shaderPreset,
	shaderEnergy,
	shaderSeed,
	shaderKey,
	headerStyle,
	timer,
	revealed,
	finalTotalMs,
	elapsed,
	skippedCount,
	rawScore,
	totalScored,
	current,
	totalVisible,
	answeredCount,
	onChangeShaderPreset,
}: {
	topic: string;
	shaderPreset: FlashcardShaderPreset;
	shaderEnergy: number;
	shaderSeed: number;
	shaderKey: string;
	headerStyle: CSSProperties;
	timer: QuizHeaderTimer | null;
	revealed: boolean;
	/** Frozen total time after submit, when known. */
	finalTotalMs: number | undefined;
	elapsed: number;
	skippedCount: number;
	rawScore: number;
	totalScored: number;
	current: number;
	totalVisible: number;
	answeredCount: number;
	onChangeShaderPreset: (preset: FlashcardShaderPreset) => void;
}) {
	return (
		<header className={cx(quizStyles.effectHeader, "activity-quiz-header")} style={headerStyle}>
			<FlashcardShaderField
				key={shaderKey}
				preset={shaderPreset}
				energy={shaderEnergy}
				seed={shaderSeed}
			/>
			<div className={quizStyles.effectHeaderContent}>
				<div className={quizStyles.resultIntro}>
					<h3 className={cx(quizStyles.topic, "activity-quiz-topic")}>{topic}</h3>

				</div>
				<div className={quizStyles.headerInstruments}>
					{timer ? (
						<div
							role="timer"
							aria-label={`${timer.urgency === "critical" ? "Critical, " : timer.urgency === "warning" ? "Warning, " : ""}${formatCountdown(timer.remaining)} remaining`}
							aria-live="off"
							data-urgency={timer.urgency}
							className={cx(quizStyles.timer, timer.urgency === "critical" ? "quiz-timer-critical" : "")}
						>
							<strong className={quizStyles.timerDigits}>
								{timer.urgency === "steady" ? <Clock size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
								{formatCountdown(timer.remaining)}
							</strong>
							<div className={quizStyles.timerTrack} aria-hidden="true">
								<div className={quizStyles.timerFill} style={{ transform: `scaleX(${timer.progress})` }} />
							</div>
							{timer.urgency === "critical" ? <span role="status" className={quizStyles.visuallyHidden}>Five seconds or less remaining.</span> : null}
						</div>
					) : null}
					<div className={quizStyles.headerMeta}>
						<span><Clock size={12} aria-hidden="true" /> {revealed && finalTotalMs !== undefined ? formatQuizDuration(finalTotalMs) : formatDuration(elapsed)}</span>
						{skippedCount > 0 ? <span>+{skippedCount} adapted</span> : null}
						{revealed ? <strong>{totalScored > 0 ? `${rawScore}/${totalScored}` : "review"}</strong> : null}
						<details className="activity-quiz-effects"><summary aria-label="Quiz appearance"><Sparkles size={16} /></summary><label>Appearance<Select className={quizStyles.effectSelect} aria-label="Quiz visual effect" value={shaderPreset} onValueChange={(value) => onChangeShaderPreset(value as FlashcardShaderPreset)}>{QUIZ_SHADER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</Select></label></details>
					</div>
				</div>
			</div>
			<RoundProgress current={current} total={totalVisible} resolved={answeredCount} label="Quiz progress" complete={revealed} />
		</header>
	);
}
