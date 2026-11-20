import { LessonHeader } from "../lesson/LessonFrame";
import { QuizCountdown } from "./QuizCountdown";
/**
 * Quiz head (board L1): topic, kind, and in the tools the per-question countdown
 * (or elapsed / final time), adapted and score readouts and the appearance picker.
 */
import { KeatingGlyph } from "../../design-system/glyphs";
import type { CSSProperties } from "react";
import { Select } from "../Select";
import { FlashcardShaderField } from "../flashcards/FlashcardShaderField";
import type { FlashcardShaderPreset } from "../flashcards/game";
import { RoundProgress } from "./ActivityGame";
import { QUIZ_SHADER_OPTIONS, formatQuizDuration, type QuizTimerState } from "./game";
import { formatDuration } from "./quiz-presentation";

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
		<>
			<LessonHeader glyph="quiz" title={topic} kind={revealed ? "Quiz result" : "Quiz"} tools={
				<div className="quiz-tools" style={headerStyle}>
					{timer ? (
						<QuizCountdown remaining={timer.remaining} total={timer.progress > 0 ? Math.round(timer.remaining / timer.progress) : Math.max(1,timer.remaining)} />
					) : <span><KeatingGlyph name="clock" size={13} /> {revealed && finalTotalMs !== undefined ? formatQuizDuration(finalTotalMs) : formatDuration(elapsed)}</span>}
					{skippedCount > 0 ? <span>+{skippedCount} adapted</span> : null}
					{revealed ? <strong>{totalScored > 0 ? `${rawScore}/${totalScored}` : "review"}</strong> : null}
					<details className="quiz-effects activity-quiz-effects"><summary aria-label="Quiz appearance"><KeatingGlyph name="spark" size={13} /></summary><label>Appearance<Select aria-label="Quiz visual effect" value={shaderPreset} onValueChange={(value) => onChangeShaderPreset(value as FlashcardShaderPreset)}>{QUIZ_SHADER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</Select></label></details>
				</div>
			}/>
			<div className="quiz-shader" aria-hidden="true">
				<FlashcardShaderField key={shaderKey} preset={shaderPreset} energy={shaderEnergy} seed={shaderSeed} />
			</div>
		</>
	);
}

/** Round position under the head: the L1 solid bar and the mono "Question 1 of N". */
export function QuizProgress({ current, totalVisible, answeredCount, revealed }: { current: number; totalVisible: number; answeredCount: number; revealed: boolean }) {
	return <RoundProgress current={current} total={totalVisible} resolved={answeredCount} label="Quiz progress" complete={revealed} />;
}
