import type { LiveHistoryTurn } from "./speech";

/**
 * Build the conversation seed for a live voice session.
 *
 * A voice session opens a separate model connection, so without a seed the
 * model has no idea what was just discussed in text and reintroduces itself
 * mid-lesson. Only plain user/assistant text is replayed: tool traffic and
 * generative-UI payloads mean nothing to a speech model and would waste the
 * audio context window, which is far smaller than the text one.
 */
export const DEFAULT_LIVE_HISTORY_TURNS = 12;
export const DEFAULT_LIVE_HISTORY_CHARS = 6000;

function turnText(message: unknown): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content.trim();
	if (Array.isArray(content)) {
		return content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => (part.text as string).trim())
			.filter(Boolean)
			.join(" ")
			.trim();
	}
	return "";
}

function turnRole(message: unknown): LiveHistoryTurn["role"] | null {
	const role = (message as { role?: unknown }).role;
	if (role === "assistant") return "assistant";
	// "user-with-attachments" carries the same learner intent as a plain turn;
	// the attachments themselves are dropped along with the other non-text parts.
	if (role === "user" || role === "user-with-attachments") return "user";
	return null;
}

export function buildLiveHistory(
	messages: readonly unknown[],
	options: { maxTurns?: number; maxChars?: number } = {},
): LiveHistoryTurn[] {
	const maxTurns = Math.max(0, options.maxTurns ?? DEFAULT_LIVE_HISTORY_TURNS);
	const maxChars = Math.max(0, options.maxChars ?? DEFAULT_LIVE_HISTORY_CHARS);
	if (maxTurns === 0 || maxChars === 0) return [];

	const turns: LiveHistoryTurn[] = [];
	// Walk backwards so that when the budget runs out it is the oldest turns
	// that are dropped, not the ones the learner just spoke about.
	for (let i = messages.length - 1; i >= 0 && turns.length < maxTurns; i -= 1) {
		const role = turnRole(messages[i]);
		if (!role) continue;
		const text = turnText(messages[i]);
		if (!text) continue;
		turns.push({ role, text });
	}
	turns.reverse();

	let total = 0;
	const budgeted: LiveHistoryTurn[] = [];
	for (let i = turns.length - 1; i >= 0; i -= 1) {
		total += turns[i].text.length;
		if (total > maxChars) break;
		budgeted.push(turns[i]);
	}
	return budgeted.reverse();
}
