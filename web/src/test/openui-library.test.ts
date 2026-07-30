import { describe, expect, it } from "bun:test";
import { createParser } from "@openuidev/react-lang";

import {
	keatingOpenUILibrary,
	keatingOpenUIPrompt,
	keatingOpenUIQuestionExampleProgram,
	keatingOpenUIQuestionTypeGuide,
	keatingOpenUIQuestionVarietyExampleProgram,
	keatingOpenUIStudyPlanExampleProgram,
} from "../keating/openui/library";
import {
	loadOpenUIState,
	openUIStateKey,
	saveOpenUIState,
} from "../keating/openui/renderer";
import { normalizeQuestionForm } from "../components/QuestionRenderer";

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
		expect(keatingOpenUIPrompt).toContain("## Question type catalog");
		expect(keatingOpenUIPrompt).toContain("Choose the format from the learning operation");
		expect(keatingOpenUIPrompt).toContain("Question` and `Quiz` use different type names");
		expect(keatingOpenUIPrompt).toContain("## Canonical Question interaction");
		expect(keatingOpenUIPrompt).toContain("stop and wait for the learner's submitted answer");
		expect(keatingOpenUIPrompt).toContain("```openui lifecycle=ephemeral id=dns-caching-check");
		expect(keatingOpenUIPrompt).toContain("```openui lifecycle=ephemeral id=dns-question-variety");
		expect(keatingOpenUIPrompt).toContain("## Canonical detailed lesson plan");
		expect(keatingOpenUIPrompt).toContain("at least four meaningful top-level coverage areas");
		expect(keatingOpenUIPrompt).toContain("at least two nested levels");
		expect(keatingOpenUIPrompt).toContain("expandable dependency graph");
		expect(keatingOpenUIPrompt).toContain("relatedPlans");
	});

	it("keeps the canonical question example valid against the live component grammar", () => {
		const parser = createParser(keatingOpenUILibrary.toJSONSchema());
		const result = parser.parse(keatingOpenUIQuestionExampleProgram);

		expect(result.root?.typeName).toBe("LearningSurface");
		expect(result.meta.errors).toEqual([]);
		expect(result.meta.unresolved).toEqual([]);
	});

	it("documents every available Question and Quiz format for the model", () => {
		for (const type of ["choice", "text", "blanks", "classification", "matching"]) {
			expect(keatingOpenUIQuestionTypeGuide).toContain(`\`${type}\``);
		}
		for (const type of [
			"multiple_choice",
			"multi_select",
			"true_false",
			"fill_in",
			"short_answer",
			"transfer",
			"slider",
			"dropdown",
		]) {
			expect(keatingOpenUIQuestionTypeGuide).toContain(`\`${type}\``);
		}

		const generatedGrammar = keatingOpenUILibrary.prompt({
			inlineMode: true,
			toolCalls: false,
			bindings: true,
		});
		expect(generatedGrammar).toContain("itemLabel?: string");
		expect(generatedGrammar).toContain("choiceLabel?: string");
		expect(generatedGrammar).toContain("reasonLabel?: string");
		expect(generatedGrammar).toContain("uniqueMatches?: boolean");
	});

	it("keeps the all-types Question example valid against the live component grammar", () => {
		const parser = createParser(keatingOpenUILibrary.toJSONSchema());
		const result = parser.parse(keatingOpenUIQuestionVarietyExampleProgram);

		expect(result.root?.typeName).toBe("LearningSurface");
		expect(result.meta.errors).toEqual([]);
		expect(result.meta.unresolved).toEqual([]);
	});

	it("normalizes a text question to include an answer control", () => {
		const data = normalizeQuestionForm({
			questions: [{ question: "What changed?", type: "text" }],
		});
		expect(data?.questions[0]?.allowText).toBe(true);
	});

	it("keeps the nested lesson-plan example valid against the live component grammar", () => {
		const parser = createParser(keatingOpenUILibrary.toJSONSchema());
		const result = parser.parse(keatingOpenUIStudyPlanExampleProgram);

		expect(result.root?.typeName).toBe("LearningSurface");
		expect(result.meta.errors).toEqual([]);
		expect(result.meta.unresolved).toEqual([]);
		expect(keatingOpenUIStudyPlanExampleProgram).toContain('planId: "dns-observability-lab"');
		expect(keatingOpenUIStudyPlanExampleProgram).toContain('planId: "dns-resolution-core"');
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
