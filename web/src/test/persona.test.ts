import { beforeEach, describe, expect, it } from "bun:test";
import {
	DEFAULT_TEACHER_PERSONA,
	LEGACY_DEFAULT_TEACHER_PERSONA,
	isDefaultPersona,
	loadPersona,
	resetPersona,
	savePersona,
} from "../keating/persona";
import {
	composeKeatingSystemPrompt,
	getActiveKeatingPrompt,
	KEATING_SYSTEM_PROMPT,
	refreshKeatingOperationalProtocol,
} from "../keating/browser-tools";

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
	it("defaults to Keating Bot with John Keating as inspiration", () => {
		expect(loadPersona()).toBe(DEFAULT_TEACHER_PERSONA);
		expect(isDefaultPersona()).toBe(true);
		expect(DEFAULT_TEACHER_PERSONA).toContain("John Keating");
		expect(DEFAULT_TEACHER_PERSONA).toContain("Carpe diem");
	});

	it("upgrades the exact saved former default while preserving edited versions", () => {
		localStorage.setItem("keating:teacher-persona", LEGACY_DEFAULT_TEACHER_PERSONA);
		expect(loadPersona()).toBe(DEFAULT_TEACHER_PERSONA);
		expect(isDefaultPersona()).toBe(true);
		const custom = `${LEGACY_DEFAULT_TEACHER_PERSONA}\nUse examples from music.`;
		localStorage.setItem("keating:teacher-persona", custom);
		expect(loadPersona()).toBe(custom);
		expect(isDefaultPersona()).toBe(false);
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
		expect(composed).toContain("OpenUI `Question`");
		expect(composed).toContain("Use an OpenUI `Question`");
		expect(composed).toContain("stop and wait for its submitted answer");
		expect(composed).toContain("`client-web-search`");
		expect(composed).toContain("inline math like `$g \\approx 1$`");
		expect(composed).toContain("h^{(r)} = g^{(r)} \\odot h^{(r-1)}");
	});

	it("uses the default persona when given blank text", () => {
		expect(composeKeatingSystemPrompt("   ")).toBe(KEATING_SYSTEM_PROMPT);
	});

	it("replaces a stale evolved operational section with the current OpenUI protocol", async () => {
		const stale = [
			"You are an evolved Socratic tutor.",
			"",
			"## Self-Evolution Protocol",
			"Use ask_user_question whenever you need learner input.",
		].join("\n");
		const refreshed = refreshKeatingOperationalProtocol(stale);
		expect(refreshed).toContain("You are an evolved Socratic tutor.");
		expect(refreshed).toContain("Use an OpenUI `Question`");
		expect(refreshed).not.toContain("ask_user_question");

		const active = await getActiveKeatingPrompt({
			getPromptEvolutions: async () => [{ createdAt: 1, bestPrompt: stale }],
		} as any);
		// A stored prompt proposal is not evidence that it should become active.
		expect(active).toBe(KEATING_SYSTEM_PROMPT);
	});
});
