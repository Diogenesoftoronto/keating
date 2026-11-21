/**
 * Replies released as feedback only, after a feedback-plus-next-question reply
 * could not be verified. The chat offers "Next question" under the latest of
 * them as one tap. Kept in memory: a reload drops the offer, never a grade.
 */
import { useSyncExternalStore } from "react";

export const NEXT_QUESTION_PROMPT = "I'm ready for the next question.";

const suggested = new Map<string, Set<number>>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version += 1; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function rememberNextQuestionSuggestion(sessionId: string, messageTimestamp: number): void {
	const session = suggested.get(sessionId) ?? new Set<number>();
	session.add(messageTimestamp);
	suggested.delete(sessionId);
	suggested.set(sessionId, session);
	while (suggested.size > 20) suggested.delete(suggested.keys().next().value!);
	emit();
}

export function hasNextQuestionSuggestion(sessionId: string | null | undefined, timestamps: readonly number[]): boolean {
	const session = sessionId ? suggested.get(sessionId) : undefined;
	return Boolean(session && timestamps.some((timestamp) => session.has(timestamp)));
}

export function useNextQuestionSuggestion(sessionId: string | null | undefined, timestamps: readonly number[]): boolean {
	useSyncExternalStore(subscribe, () => version, () => version);
	return hasNextQuestionSuggestion(sessionId, timestamps);
}

/** Test seam. */
export function resetNextQuestionSuggestions(): void { suggested.clear(); emit(); }
