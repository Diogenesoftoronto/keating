import { beforeEach, describe, expect, it } from "bun:test";
import {
	MAX_LEARNER_CONTEXT_LENGTH,
	learnerContextPrompt,
	loadLearnerContext,
	saveLearnerContext,
} from "../keating/learner-context";

const values = new Map<string, string>();
(globalThis as any).localStorage = {
	getItem: (key: string) => values.get(key) ?? null,
	setItem: (key: string, value: string) => values.set(key, value),
	removeItem: (key: string) => values.delete(key),
};
(globalThis as any).window = {
	dispatchEvent: () => true,
	addEventListener: () => {},
	removeEventListener: () => {},
};

describe("learner-authored context", () => {
	beforeEach(() => values.clear());

	it("stores normalized learner context locally", () => {
		saveLearnerContext("  I know Python and prefer visual examples.  ");
		expect(loadLearnerContext()).toBe("I know Python and prefer visual examples.");
	});

	it("bounds the context before adding it to the model prompt", () => {
		const context = "x".repeat(MAX_LEARNER_CONTEXT_LENGTH + 20);
		const prompt = learnerContextPrompt(context);
		expect(prompt).toContain(JSON.stringify("x".repeat(MAX_LEARNER_CONTEXT_LENGTH)));
		expect(prompt).not.toContain("x".repeat(MAX_LEARNER_CONTEXT_LENGTH + 1));
	});

	it("adds no system-prompt text for empty context", () => {
		expect(learnerContextPrompt("   ")).toBe("");
	});
});
