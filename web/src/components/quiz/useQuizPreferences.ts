/**
 * Small persisted-preference hooks for the quiz: bookmarks, shader atmosphere,
 * and the topic benchmark stats fetch.
 */
import { useCallback, useEffect, useState } from "react";
import { KeatingStorage } from "../../keating/storage";
import type { TopicStats } from "../QuizRenderer";
import type { FlashcardShaderPreset } from "../flashcards/game";
import { resolveQuizShaderPreset } from "./game";
import { toggleBookmarkId } from "./quiz-session";
import {
	loadBookmarkIds,
	loadQuizShaderPreset,
	saveBookmarkIds,
	saveQuizShaderPreset,
} from "./quiz-storage";

export const quizStorage = new KeatingStorage();

export function useQuizBookmarks() {
	const [bookmarkIds, setBookmarkIds] = useState<string[]>(() => loadBookmarkIds());
	const toggleBookmark = useCallback((questionId: string) => {
		setBookmarkIds((previous) => {
			const next = toggleBookmarkId(previous, questionId);
			saveBookmarkIds(next);
			return next;
		});
	}, []);
	return { bookmarkIds, toggleBookmark };
}

export function useQuizShaderPreset(quizIdentity: string, defaultShaderPreset?: FlashcardShaderPreset) {
	const [shaderPreset, setShaderPreset] = useState<FlashcardShaderPreset>(() => (
		loadQuizShaderPreset(quizIdentity, defaultShaderPreset)
	));

	useEffect(() => {
		if (!defaultShaderPreset) return;
		setShaderPreset(resolveQuizShaderPreset(defaultShaderPreset, quizIdentity));
	}, [defaultShaderPreset, quizIdentity]);

	const changeShaderPreset = useCallback((preset: FlashcardShaderPreset) => {
		const normalized = resolveQuizShaderPreset(preset, quizIdentity);
		setShaderPreset(normalized);
		saveQuizShaderPreset(normalized);
	}, [quizIdentity]);

	/** Re-reads the saved preference for a new quiz identity. */
	const reloadShaderPreset = useCallback(() => {
		setShaderPreset(loadQuizShaderPreset(quizIdentity, defaultShaderPreset));
	}, [defaultShaderPreset, quizIdentity]);

	return { shaderPreset, changeShaderPreset, reloadShaderPreset };
}

/** Benchmark stats: the prop when supplied, otherwise fetched from storage by slug. */
export function useTopicStats(topicStats: TopicStats | null | undefined, slug: string) {
	const [fetchedStats, setFetchedStats] = useState<TopicStats | null | undefined>(topicStats);
	useEffect(() => {
		if (topicStats !== undefined) {
			setFetchedStats(topicStats);
			return;
		}
		let cancelled = false;
		quizStorage.getTopicQuizStats(slug)
			.then((stats: TopicStats | null) => {
				if (!cancelled) setFetchedStats(stats);
			})
			.catch(() => {
				if (!cancelled) setFetchedStats(null);
			});
		return () => { cancelled = true; };
	}, [slug, topicStats]);
	return fetchedStats;
}
