import { describe, expect, it } from "bun:test";

import { buildLiveHistory } from "../keating/live-history";

const message = (role: string, content: unknown) => ({ role, content });

describe("live voice history seed", () => {
	it("replays plain user and assistant turns in order", () => {
		expect(buildLiveHistory([
			message("user", "what is a monoid?"),
			message("assistant", "a set with an associative operation"),
		])).toEqual([
			{ role: "user", text: "what is a monoid?" },
			{ role: "assistant", text: "a set with an associative operation" },
		]);
	});

	it("flattens structured text parts", () => {
		expect(buildLiveHistory([
			message("assistant", [
				{ type: "text", text: "first" },
				{ type: "text", text: "second" },
			]),
		])).toEqual([{ role: "assistant", text: "first second" }]);
	});

	it("drops tool traffic and non-text parts", () => {
		// A speech model cannot use these, and they would burn the audio context
		// window, which is far smaller than the text one.
		expect(buildLiveHistory([
			message("tool", "tool output"),
			message("system", "system prompt"),
			message("assistant", [{ type: "tool-call", id: "call-1" }]),
			message("user", "still here"),
		])).toEqual([{ role: "user", text: "still here" }]);
	});

	it("treats an attachment turn as an ordinary learner turn", () => {
		expect(buildLiveHistory([
			message("user-with-attachments", [{ type: "text", text: "look at this diagram" }]),
		])).toEqual([{ role: "user", text: "look at this diagram" }]);
	});

	it("skips empty turns rather than seeding blank messages", () => {
		expect(buildLiveHistory([
			message("user", "   "),
			message("assistant", []),
			message("user", "real"),
		])).toEqual([{ role: "user", text: "real" }]);
	});

	it("keeps the most recent turns when over the turn budget", () => {
		const messages = Array.from({ length: 10 }, (_, i) => message("user", `turn ${i}`));
		const history = buildLiveHistory(messages, { maxTurns: 3 });
		expect(history).toEqual([
			{ role: "user", text: "turn 7" },
			{ role: "user", text: "turn 8" },
			{ role: "user", text: "turn 9" },
		]);
	});

	it("keeps the most recent turns when over the character budget", () => {
		const history = buildLiveHistory([
			message("user", "a".repeat(100)),
			message("user", "b".repeat(100)),
			message("user", "c".repeat(100)),
		], { maxChars: 250 });
		expect(history.map((turn) => turn.text[0])).toEqual(["b", "c"]);
	});

	it("returns nothing when the budget is zero", () => {
		const messages = [message("user", "hello")];
		expect(buildLiveHistory(messages, { maxTurns: 0 })).toEqual([]);
		expect(buildLiveHistory(messages, { maxChars: 0 })).toEqual([]);
	});

	it("handles an empty conversation", () => {
		expect(buildLiveHistory([])).toEqual([]);
	});
});
