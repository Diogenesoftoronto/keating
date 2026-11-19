import { LessonHeader } from "../lesson/LessonFrame";
import { QuizCountdown } from "./QuizCountdown";
/**
 * Quiz header: shader backdrop, topic, the per-question countdown, elapsed or
 * final time, adapted/score chips, the appearance picker and round progress.
 */
import { KeatingGlyph } from "../../design-system/glyphs";
import type { CSSProperties } from "react";
import { cx } from "../../../styled-system/css";
import { Select } from "../Select";
import { FlashcardShaderField } from "../flashcards/FlashcardShaderField";
import type { FlashcardShaderPreset } from "../flashcards/game";
import { RoundProgress } from "./ActivityGame";
import { QUIZ_SHADER_OPTIONS, formatQuizDuration, type QuizTimerState } from "./game";
import { formatDuration } from "./quiz-presentation";
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
		<div className={cx(quizStyles.effectHeader, "activity-quiz-header")} style={headerStyle}>
			<FlashcardShaderField
				key={shaderKey}
				preset={shaderPreset}
				energy={shaderEnergy}
				seed={shaderSeed}
			/>
			<div className={quizStyles.effectHeaderContent}>
				<div className={quizStyles.resultIntro}>
					<LessonHeader glyph="quiz" title={topic} kind={revealed ? "Quiz result" : "Quiz"}/>

				</div>
				<div className={quizStyles.headerInstruments}>
					{timer ? (
						<QuizCountdown remaining={timer.remaining} total={timer.progress > 0 ? Math.round(timer.remaining / timer.progress) : Math.max(1,timer.remaining)} />
					) : null}
					<div className={quizStyles.headerMeta}>
						<span><KeatingGlyph name="clock" size={14} /> {revealed && finalTotalMs !== undefined ? formatQuizDuration(finalTotalMs) : formatDuration(elapsed)}</span>
						{skippedCount > 0 ? <span>+{skippedCount} adapted</span> : null}
						{revealed ? <strong>{totalScored > 0 ? `${rawScore}/${totalScored}` : "review"}</strong> : null}
						<details className="activity-quiz-effects"><summary aria-label="Quiz appearance"><KeatingGlyph name="spark" size={14} /></summary><label>Appearance<Select className={quizStyles.effectSelect} aria-label="Quiz visual effect" value={shaderPreset} onValueChange={(value) => onChangeShaderPreset(value as FlashcardShaderPreset)}>{QUIZ_SHADER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</Select></label></details>
					</div>
				</div>
			</div>
			<RoundProgress current={current} total={totalVisible} resolved={answeredCount} label="Quiz progress" complete={revealed} />
		</div>
	);
}
