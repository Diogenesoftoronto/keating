import type { QuizQuestion } from "../../keating/core";
import {
	FLASHCARD_SHADER_OPTIONS,
	normalizeFlashcardShaderPreset,
	type FlashcardShaderPreset,
} from "../flashcards/game";

export const QUIZ_SHADER_OPTIONS = FLASHCARD_SHADER_OPTIONS;
export const QUIZ_SHADER_STORAGE_KEY = "keating:quiz-shader-preset";

/** Preserve saved millisecond precision; never round a result to whole seconds. */
export function formatQuizDuration(ms: number): string {
	if (!Number.isFinite(ms)) return "—";
	const value = Math.max(0, Math.round(ms));
	const seconds = Math.floor(value / 1000);
	const fraction = (value % 1000).toString().padStart(3, "0");
	if (seconds < 60) return `${seconds}.${fraction}s`;
	return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}.${fraction}`;
}

/** A neutral timing note relative to the author's budget, never a quality score. */
export function isQuickQuizAnswer({ timeMs, timeLimitSeconds, answered, timedOut = false }: {
	timeMs?: number;
	timeLimitSeconds?: number;
	answered: boolean;
	timedOut?: boolean;
}): boolean {
	return answered && !timedOut
		&& typeof timeMs === "number" && Number.isFinite(timeMs) && timeMs >= 0
		&& typeof timeLimitSeconds === "number" && Number.isFinite(timeLimitSeconds) && timeLimitSeconds > 0
		&& timeMs <= timeLimitSeconds * 1000 * 0.25;
}

const ANIMATED_QUIZ_SHADER_PRESETS = QUIZ_SHADER_OPTIONS
	.filter((option) => option.id !== "still")
	.map((option) => option.id);

/**
 * Pick a stable animated scene for a quiz that has no saved learner choice.
 * The same quiz keeps its identity, while different quizzes avoid all opening
 * on the same visual.
 */
export function defaultQuizShaderPreset(seed: string): FlashcardShaderPreset {
	let hash = 2166136261;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	const preset = ANIMATED_QUIZ_SHADER_PRESETS[(hash >>> 0) % ANIMATED_QUIZ_SHADER_PRESETS.length];
	return preset ?? "phosphor";
}

export function resolveQuizShaderPreset(
	value: unknown,
	seed: string,
): FlashcardShaderPreset {
	if (QUIZ_SHADER_OPTIONS.some((option) => option.id === value)) {
		return normalizeFlashcardShaderPreset(value);
	}
	return defaultQuizShaderPreset(seed);
}

/**
 * Question ids key answers, timing, bookmarks, and grading. Keep the first
 * occurrence of a repeated id so those maps cannot silently overwrite an
 * earlier question. Input order otherwise remains unchanged.
 */
export function uniqueQuizQuestions(
	questions: readonly QuizQuestion[],
): QuizQuestion[] {
	const seen = new Set<string>();
	const unique: QuizQuestion[] = [];
	for (const question of questions) {
		if (seen.has(question.id)) continue;
		seen.add(question.id);
		unique.push(question);
	}
	return unique;
}

export interface QuizRunSignal {
	label: string;
	detail: string;
}

export type QuizTimerUrgency = "steady" | "warning" | "critical";

export interface QuizTimerState {
	urgency: QuizTimerUrgency;
	progress: number;
}

/**
 * A timed question gets a visible warning for roughly its final quarter, capped
 * at twenty seconds, and a distinct critical state for the final five seconds.
 * Invalid values fail closed to an expired timer instead of producing NaN CSS.
 */
export function quizTimerState(
	remainingSeconds: number,
	totalSeconds: number,
): QuizTimerState {
	const total = Number.isFinite(totalSeconds) ? Math.max(1, totalSeconds) : 1;
	const remaining = Number.isFinite(remainingSeconds)
		? Math.max(0, Math.min(total, remainingSeconds))
		: 0;
	const warningAt = Math.min(20, Math.max(10, Math.ceil(total * 0.25)));
	return {
		urgency: remaining <= 5 ? "critical" : remaining <= warningAt ? "warning" : "steady",
		progress: remaining / total,
	};
}

export function quizRunSignal(input: {
	score: number;
	totalScored: number;
	pendingReviewCount: number;
}): QuizRunSignal {
	const total = Math.max(0, Math.floor(input.totalScored));
	const score = Math.min(total, Math.max(0, Math.floor(input.score)));
	const pending = Math.max(0, Math.floor(input.pendingReviewCount));
	if (total === 0) {
		return {
			label: pending > 0 ? "Review queued" : "Run recorded",
			detail: pending > 0 ? `${pending} response${pending === 1 ? "" : "s"} ready for teacher review.` : "No objective questions were scored.",
		};
	}
	const ratio = score / total;
	if (ratio === 1) {
		return {
			label: "Perfect signal",
			detail: "Every objective answer landed.",
		};
	}
	if (ratio >= 0.7) {
		return {
			label: "Strong run",
			detail: "Most of the knowledge held under retrieval.",
		};
	}
	if (ratio >= 0.4) {
		return {
			label: "Useful map",
			detail: "The misses point to a focused next review.",
		};
	}
	return {
		label: "Calibration run",
		detail: "The result found what should come back next.",
	};
}
