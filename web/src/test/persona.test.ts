import { beforeEach, describe, expect, it } from "bun:test";
import {
	DEFAULT_TEACHER_PERSONA,
	isDefaultPersona,
	loadPersona,
	resetPersona,
	savePersona,
} from "../keating/persona";
import { composeKeatingSystemPrompt, KEATING_SYSTEM_PROMPT } from "../keating/browser-tools";

function createMockStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => store.set(k, v),
		removeItem: (k: string) => store.delete(k),
		clear: () => store.clear(),
		key: () => null,
		length: 0,
	} as unknown as Storage;
}

beforeEach(() => {
	(globalThis as unknown as { localStorage: Storage }).localStorage = createMockStorage();
});

describe("persona storage", () => {
	it("defaults to the John Keating persona", () => {
		expect(loadPersona()).toBe(DEFAULT_TEACHER_PERSONA);
		expect(isDefaultPersona()).toBe(true);
		expect(DEFAULT_TEACHER_PERSONA).toContain("John Keating");
		expect(DEFAULT_TEACHER_PERSONA).toContain("Carpe diem");
	});

	it("persists and reloads a custom persona", () => {
		savePersona("You are Socrates. Ask only questions.");
		expect(loadPersona()).toBe("You are Socrates. Ask only questions.");
		expect(isDefaultPersona()).toBe(false);
	});

	it("falls back to the default for blank input", () => {
		savePersona("   ");
		expect(loadPersona()).toBe(DEFAULT_TEACHER_PERSONA);
	});

	it("resets back to the default", () => {
		savePersona("Custom");
		resetPersona();
		expect(loadPersona()).toBe(DEFAULT_TEACHER_PERSONA);
		expect(isDefaultPersona()).toBe(true);
	});
});

describe("composeKeatingSystemPrompt", () => {
	it("the default compose equals KEATING_SYSTEM_PROMPT", () => {
		expect(composeKeatingSystemPrompt(DEFAULT_TEACHER_PERSONA)).toBe(KEATING_SYSTEM_PROMPT);
	});

	it("includes the operational protocol with a custom persona", () => {
		const composed = composeKeatingSystemPrompt("You are Socrates.");
		expect(composed).toContain("You are Socrates.");
		expect(composed).toContain("## Self-Evolution Protocol");
		expect(composed).toContain("ask_user_question");
	});

	it("uses the default persona when given blank text", () => {
		expect(composeKeatingSystemPrompt("   ")).toBe(KEATING_SYSTEM_PROMPT);
	});
});
