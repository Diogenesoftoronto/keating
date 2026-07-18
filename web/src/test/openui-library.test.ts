import { describe, expect, it } from "bun:test";
import { createParser } from "@openuidev/react-lang";

import {
	keatingOpenUILibrary,
	keatingOpenUIPrompt,
} from "../keating/openui/library";
import {
	loadOpenUIState,
	openUIStateKey,
	saveOpenUIState,
} from "../keating/openui/renderer";

class MemoryStorage {
	private readonly values = new Map<string, string>();
	getItem(key: string) { return this.values.get(key) ?? null; }
	setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("Keating OpenUI library", () => {
	it("parses a streamed learning surface with forward references", () => {
		const parser = createParser(keatingOpenUILibrary.toJSONSchema());
		const result = parser.parse([
			'root = LearningSurface([explanation, check], "Fractions", "Build a visual model", "resumable")',
			'explanation = Explanation("A fraction names equal parts of a whole.")',
			'check = Question([{question: "Which is one half?", choices: ["1/2", "1/3"], type: "choice"}], "ephemeral", "fractions", "Try one")',
		].join("\n"));

		expect(result.root?.typeName).toBe("LearningSurface");
		expect(result.meta.errors).toEqual([]);
		expect(result.meta.unresolved).toEqual([]);
	});

	it("generates prompt instructions for the curated grammar", () => {
		expect(keatingOpenUIPrompt).toContain("LearningSurface");
		expect(keatingOpenUIPrompt).toContain("Question(");
		expect(keatingOpenUIPrompt).toContain("lifecycle=ephemeral|resumable|workspace");
	});

	it("persists resumable state and skips ephemeral state", () => {
		const storage = new MemoryStorage();
		const resumable = { id: "quiz-1", lifecycle: "resumable" as const, revision: 0 };
		const ephemeral = { id: "question-1", lifecycle: "ephemeral" as const, revision: 0 };

		expect(saveOpenUIState(storage, resumable, { answer: "1/2" })).toBe(true);
		expect(loadOpenUIState(storage, resumable)).toEqual({ answer: "1/2" });
		expect(storage.getItem(openUIStateKey(resumable.id))).not.toBeNull();
		expect(saveOpenUIState(storage, ephemeral, { answer: "temporary" })).toBe(false);
		expect(loadOpenUIState(storage, ephemeral)).toEqual({});
	});
});
