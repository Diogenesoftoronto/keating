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
		<LessonFrame glyph="quiz" kind="Quiz" title={quiz.topic} aria-label={`Quiz ready: ${quiz.topic}`} tools={totalTimeLimit > 0 && <span aria-label={`${formatCountdown(totalTimeLimit)} total timed allowance`}><KeatingGlyph name="clock" size={14}/> {formatCountdown(totalTimeLimit)}</span>} footer={<>
			{onDismiss && <IconButton size="sm" glyph="x" label="Dismiss quiz" onClick={onDismiss} />}
			<button type="button" className="lesson-primary k-lift" onClick={()=>setStarted(true)} disabled={!questions.length}>{questions.length ? "Start Quiz" : "No questions"}</button>
		</>}>
			<p>{questions.length} question{questions.length === 1 ? "" : "s"}{timedQuestions.length ? ` · ${timedQuestions.length} timed` : ""}</p>
		</LessonFrame>
	);
}

QuizSessionPanel.displayName = "QuizSessionPanel";
