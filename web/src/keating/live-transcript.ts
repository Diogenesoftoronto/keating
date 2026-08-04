export interface LiveTranscriptTurn {
	user: string;
	assistant: string;
}

export interface LiveTranscriptState {
	turns: LiveTranscriptTurn[];
	draft: LiveTranscriptTurn;
}

export type LiveTranscriptRole = keyof LiveTranscriptTurn;

export function emptyLiveTranscript(): LiveTranscriptState {
	return {
		turns: [],
		draft: { user: "", assistant: "" },
	};
}

function mergeTranscript(current: string, text: string, final: boolean): string {
	if (final) return text || current;
	return current + text;
}

function completedDraft(state: LiveTranscriptState): LiveTranscriptState {
	const user = state.draft.user.trim();
	const assistant = state.draft.assistant.trim();
	if (!user && !assistant) return state;
	return {
		turns: [...state.turns, { user, assistant }],
		draft: { user: "", assistant: "" },
	};
}

/**
 * Fold provider transcript callbacks into conversational turns.
 *
 * OpenAI completes a turn with the full assistant transcript while Gemini
 * completes it with an empty final marker. In both cases, an assistant final
 * closes the user/assistant pair. User finals only settle their side of the
 * draft because the answer is still on its way.
 */
export function appendLiveTranscript(
	state: LiveTranscriptState,
	role: LiveTranscriptRole,
	text: string,
	final: boolean,
): LiveTranscriptState {
	const next = {
		...state,
		draft: {
			...state.draft,
			[role]: mergeTranscript(state.draft[role], text, final),
		},
	};
	return role === "assistant" && final ? completedDraft(next) : next;
}

/** Preserve a partially transcribed turn when the learner ends the session. */
export function flushLiveTranscript(state: LiveTranscriptState): LiveTranscriptState {
	return completedDraft(state);
}
