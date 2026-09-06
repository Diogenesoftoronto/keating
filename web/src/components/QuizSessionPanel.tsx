import { useEffect, useMemo, useState } from "react";
import { Clock, Play, X } from "lucide-react";

import { css } from "../../styled-system/css";
import type { Quiz } from "../keating/core";
import { FlashcardShaderField } from "./flashcards/FlashcardShaderField";
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

const startStyles = {
	shell: css({
		position: "relative",
		isolation: "isolate",
		display: "grid",
		minHeight: "8.5rem",
		alignContent: "space-between",
		gap: "1rem",
		overflow: "hidden",
		marginBlock: "0.25rem",
		borderRadius: "0.625rem",
		background: "var(--crt)",
		padding: { base: "0.875rem", sm: "1rem 1.125rem" },
		color: "var(--phosphor)",
	}),
	content: css({
		position: "relative",
		zIndex: 1,
		display: "flex",
		flexDirection: "column",
		gap: "0.875rem",
		sm: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
		},
	}),
	copy: css({ minWidth: 0 }),
	title: css({
		overflowWrap: "anywhere",
		fontFamily: "var(--mono-display, var(--font-mono))",
		fontSize: "1rem",
		fontWeight: 700,
		lineHeight: 1.4,
	}),
	meta: css({
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: "0.5rem",
		marginTop: "0.25rem",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.6875rem",
		color: "var(--phosphor-dim)",
	}),
	controls: css({
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: { base: "stretch", sm: "flex-end" },
		gap: "0.5rem",
	}),
	time: css({
		display: "inline-flex",
		minWidth: "6.75rem",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.375rem",
		fontFamily: "var(--mono-display, var(--font-mono))",
		fontSize: "1.5rem",
		fontWeight: 700,
		fontVariantNumeric: "tabular-nums",
		lineHeight: 1,
		textShadow: "0 0 14px color-mix(in srgb, var(--phosphor) 48%, transparent)",
	}),
	startButton: css({
		display: "inline-flex",
		minHeight: "2.75rem",
		flex: "1 1 8rem",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.4rem",
		border: "2px solid var(--phosphor)",
		borderRadius: "0.375rem",
		background: "var(--phosphor)",
		paddingInline: "0.875rem",
		fontSize: "0.8125rem",
		fontWeight: 700,
		color: "var(--crt)",
		transition: "filter 150ms, transform 120ms",
		_hover: { filter: "brightness(1.08)" },
		_active: { transform: "translateY(1px)" },
		_focusVisible: { outline: "3px solid white", outlineOffset: "2px" },
		_disabled: { cursor: "not-allowed", opacity: 0.5 },
		sm: { flex: "0 0 auto" },
	}),
	dismissButton: css({
		display: "inline-flex",
		width: "2.75rem",
		height: "2.75rem",
		alignItems: "center",
		justifyContent: "center",
		border: "1px solid color-mix(in srgb, var(--phosphor) 48%, transparent)",
		borderRadius: "0.375rem",
		background: "transparent",
		color: "var(--phosphor-dim)",
		transition: "background-color 150ms, color 150ms",
		_hover: { background: "color-mix(in srgb, var(--phosphor) 10%, transparent)", color: "var(--phosphor)" },
		_focusVisible: { outline: "3px solid white", outlineOffset: "2px" },
	}),
} as const;

/**
 * The persistent chat quiz uses the canonical QuizRenderer after one explicit
 * start gesture. One implementation now owns timing, grading, storage, adaptive
 * skips, effects, and result delivery across inline and focused quiz surfaces.
 */
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
		<section className={startStyles.shell} aria-label={`Quiz ready: ${quiz.topic}`}>
			<FlashcardShaderField preset={preset} energy={0.22} seed={identity.length * 1.731} />
			<div className={startStyles.content}>
				<div className={startStyles.copy}>
					<h3 className={startStyles.title}>{quiz.topic}</h3>
					<div className={startStyles.meta}>
						<span>{questions.length} question{questions.length === 1 ? "" : "s"}</span>
						{timedQuestions.length > 0 ? <span>{timedQuestions.length} timed</span> : null}
					</div>
				</div>
				<div className={startStyles.controls}>
					{totalTimeLimit > 0 ? (
						<span className={startStyles.time} aria-label={`${formatCountdown(totalTimeLimit)} total timed allowance`}>
							<Clock size={18} aria-hidden="true" />
							{formatCountdown(totalTimeLimit)}
						</span>
					) : null}
					<button
						type="button"
						onClick={() => setStarted(true)}
						disabled={questions.length === 0}
						className={startStyles.startButton}
					>
						<Play size={14} aria-hidden="true" />
						{questions.length === 0 ? "No questions" : "Start Quiz"}
					</button>
					{onDismiss ? (
						<button type="button" onClick={onDismiss} className={startStyles.dismissButton} aria-label="Dismiss quiz">
							<X size={16} />
						</button>
					) : null}
				</div>
			</div>
		</section>
	);
}

QuizSessionPanel.displayName = "QuizSessionPanel";
