import { IconButton } from "../design-system/kit";
import { LessonFrame } from "./lesson/LessonFrame";
import { useEffect, useMemo, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";

import type { Quiz } from "../keating/core";
import type { FlashcardShaderPreset } from "./flashcards/game";
import {
	QUIZ_SHADER_STORAGE_KEY,
	resolveQuizShaderPreset,
	uniqueQuizQuestions,
} from "./quiz/game";
import { QuizRenderer, type QuizResult } from "./QuizRenderer";

export interface QuizSessionProps {
	quiz: Quiz;
	onSubmit: (result: QuizResult) => void;
	onDismiss?: () => void;
}

function formatCountdown(totalSeconds: number): string {
	const seconds = Math.max(0, Math.ceil(totalSeconds));
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function loadSessionPreset(identity: string): FlashcardShaderPreset {
	try {
		return resolveQuizShaderPreset(localStorage.getItem(QUIZ_SHADER_STORAGE_KEY), identity);
	} catch {
		return resolveQuizShaderPreset(undefined, identity);
	}
}

export function QuizSessionPanel({ quiz, onSubmit, onDismiss }: QuizSessionProps) {
	const [started, setStarted] = useState(false);
	const questions = useMemo(() => uniqueQuizQuestions(quiz.questions), [quiz.questions]);
	const identity = `${quiz.slug ?? quiz.topic}:${questions.map((question) => question.id).join("|")}`;
	const [preset, setPreset] = useState<FlashcardShaderPreset>(() => loadSessionPreset(identity));
	const timedQuestions = useMemo(
		() => questions.filter((question) => typeof question.timeLimit === "number"),
		[questions],
	);
	const totalTimeLimit = useMemo(
		() => timedQuestions.reduce((total, question) => total + (question.timeLimit ?? 0), 0),
		[timedQuestions],
	);

	useEffect(() => {
		setStarted(false);
		setPreset(loadSessionPreset(identity));
	}, [identity]);

	if (started) {
		return (
			<QuizRenderer
				quiz={{ ...quiz, questions }}
				onSubmit={onSubmit}
				defaultShaderPreset={preset}
			/>
		);
	}

	return (
		<LessonFrame glyph="quiz" kind="Quiz" title={quiz.topic} aria-label={`Quiz ready: ${quiz.topic}`} tools={totalTimeLimit > 0 && <span className="lesson-foot-meta" aria-label={`${formatCountdown(totalTimeLimit)} total timed allowance`}><KeatingGlyph name="clock" size={13}/> {formatCountdown(totalTimeLimit)}</span>} footer={<>
			{onDismiss && <IconButton size="sm" glyph="x" label="Dismiss quiz" onClick={onDismiss} />}
			<button type="button" className="lesson-primary" data-glyph-surface="inverse" onClick={()=>setStarted(true)} disabled={!questions.length}>{questions.length ? "Start Quiz" : "No questions"}<KeatingGlyph name="right" size={13}/></button>
		</>}>
			<div className="lesson-readouts" data-glyph-host>
				<div className="lesson-readout"><small><KeatingGlyph name="quiz" size={13}/> Questions</small><b>{questions.length}</b></div>
				{timedQuestions.length ? <div className="lesson-readout"><small><KeatingGlyph name="clock" size={13}/> Timed</small><b>{timedQuestions.length}</b></div> : null}
			</div>
			<p>{timedQuestions.length ? "Timed questions move on when their clock runs out; your answer is kept." : "Answer at your own pace; you can go back before you finish."}</p>
		</LessonFrame>
	);
}

QuizSessionPanel.displayName = "QuizSessionPanel";
