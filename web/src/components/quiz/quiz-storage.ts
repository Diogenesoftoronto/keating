/** Local persistence for quiz bookmarks and the chosen shader atmosphere. */
import type { FlashcardShaderPreset } from "../flashcards/game";
import { QUIZ_SHADER_STORAGE_KEY, resolveQuizShaderPreset } from "./game";

const BOOKMARK_KEY = "keating:quiz-bookmarks";

export function loadBookmarkIds(): string[] {
	try {
		const raw = localStorage.getItem(BOOKMARK_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
	} catch {
		return [];
	}
}

export function saveBookmarkIds(ids: string[]) {
	try {
		localStorage.setItem(BOOKMARK_KEY, JSON.stringify(ids));
	} catch {
		/* ignore */
	}
}

export function loadQuizShaderPreset(
	seed: string,
	fallback?: FlashcardShaderPreset,
): FlashcardShaderPreset {
	if (fallback) return resolveQuizShaderPreset(fallback, seed);
	try {
		return resolveQuizShaderPreset(localStorage.getItem(QUIZ_SHADER_STORAGE_KEY), seed);
	} catch {
		return resolveQuizShaderPreset(undefined, seed);
	}
}

export function saveQuizShaderPreset(preset: FlashcardShaderPreset) {
	try {
		localStorage.setItem(QUIZ_SHADER_STORAGE_KEY, preset);
	} catch {
		/* visual preference only */
	}
}
