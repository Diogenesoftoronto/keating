import { describe, expect, it } from "bun:test";

import {
	appendLiveTranscript,
	emptyLiveTranscript,
	flushLiveTranscript,
} from "../keating/live-transcript";

describe("live transcript turn accumulation", () => {
	it("groups streaming user and assistant deltas into a chat turn", () => {
		let state = emptyLiveTranscript();
		state = appendLiveTranscript(state, "user", "explain ", false);
		state = appendLiveTranscript(state, "user", "monads", false);
		state = appendLiveTranscript(state, "assistant", "A monad ", false);
		state = appendLiveTranscript(state, "assistant", "sequences effects.", false);
		state = appendLiveTranscript(state, "assistant", "", true);

		expect(state).toEqual({
			turns: [{ user: "explain monads", assistant: "A monad sequences effects." }],
			draft: { user: "", assistant: "" },
		});
	});

	it("uses a provider final transcript without duplicating earlier deltas", () => {
		let state = emptyLiveTranscript();
		state = appendLiveTranscript(state, "user", "What is a closure?", true);
		state = appendLiveTranscript(state, "assistant", "A function ", false);
		state = appendLiveTranscript(state, "assistant", "with captured state.", false);
		state = appendLiveTranscript(state, "assistant", "A function with captured state.", true);

		expect(state.turns).toEqual([{
			user: "What is a closure?",
			assistant: "A function with captured state.",
		}]);
	});

	it("keeps successive live turns separate", () => {
		let state = emptyLiveTranscript();
		state = appendLiveTranscript(state, "user", "first", false);
		state = appendLiveTranscript(state, "assistant", "one", true);
		state = appendLiveTranscript(state, "user", "second", false);
		state = appendLiveTranscript(state, "assistant", "two", true);

		expect(state.turns).toEqual([
			{ user: "first", assistant: "one" },
			{ user: "second", assistant: "two" },
		]);
	});

	it("flushes a partial turn when a session ends", () => {
		let state = emptyLiveTranscript();
		state = appendLiveTranscript(state, "user", "unfinished question", false);

		expect(flushLiveTranscript(state).turns).toEqual([
			{ user: "unfinished question", assistant: "" },
		]);
	});

	it("does not create blank turns", () => {
		const state = appendLiveTranscript(emptyLiveTranscript(), "assistant", "", true);
		expect(flushLiveTranscript(state)).toEqual(emptyLiveTranscript());
	});
});
