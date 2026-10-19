/** Pure presentation helpers for the quiz: duration/countdown formatting, shader accent and entry class, stable seed. */
import type { QuizQuestion } from "../../keating/core";
import type { FlashcardShaderPreset } from "../flashcards/game";

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatCountdown(totalSeconds: number): string {
	const s = Math.max(0, Math.ceil(totalSeconds));
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function quizShaderAccent(preset: FlashcardShaderPreset): string {
	if (preset === "solar" || preset === "contour") return "var(--amber, #e8a33d)";
	if (preset === "prism") return "var(--red, #d95f4f)";
	if (preset === "current" || preset === "orbit") return "#67d7e8";
	if (preset === "still") return "var(--phosphor-dim, #9bd8ad)";
	return "var(--phosphor, #4be388)";
}

export function quizQuestionEntryClass(preset: FlashcardShaderPreset): string {
	return preset === "still" ? "quiz-question-enter" : `quiz-question-enter-${preset}`;
}

export function stableQuizSeed(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 0xffffffff * 131;
}

export function showsBinaryResult(q: QuizQuestion): boolean {
	return q.type !== "short_answer" && q.type !== "transfer" && q.type !== "fill_in";
}
