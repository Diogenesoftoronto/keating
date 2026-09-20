import { beforeEach, describe, expect, it } from "bun:test";
import { defaultDeclaredProfile } from "@keating/learner-contracts";

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

const {
	DECLARED_PROFILE_STORAGE_KEY,
	LEGACY_LEARNER_CONTEXT_STORAGE_KEY,
	loadDeclaredProfile,
	markDeclaredProfileGroupSkipped,
	resetDeclaredProfile,
	saveDeclaredProfile,
	updateDeclaredProfile,
} = await import("../keating/learner-profile-store");
const { learnerContextPrompt, loadLearnerContext, saveLearnerContext } = await import("../keating/learner-context");

describe("declared learner profile store", () => {
	beforeEach(() => values.clear());

	it("returns an empty profile when nothing is stored", () => {
		expect(loadDeclaredProfile()).toEqual(defaultDeclaredProfile());
	});

	it("round-trips a saved profile", () => {
		saveDeclaredProfile({ ...defaultDeclaredProfile(), preferredName: "Sam", ageBand: "18-24", hintLevel: "minimal" });
		const loaded = loadDeclaredProfile();
		expect(loaded.preferredName).toBe("Sam");
		expect(loaded.ageBand).toBe("18-24");
		expect(loaded.hintLevel).toBe("minimal");
		expect(loaded.updatedAt).not.toBe("");
	});

	it("recovers defaults from a corrupted record instead of throwing", () => {
		values.set(DECLARED_PROFILE_STORAGE_KEY, "{{{ not json");
		expect(loadDeclaredProfile()).toEqual(defaultDeclaredProfile());
	});

	// The migration that must not lose anyone's hand-written profile.
	it("adopts a pre-v2 free-text profile as notes", () => {
		values.set(LEGACY_LEARNER_CONTEXT_STORAGE_KEY, "I know Python and prefer visual examples.");
		expect(loadDeclaredProfile().notes).toBe("I know Python and prefer visual examples.");
	});

	it("leaves the legacy blob in place after migrating", () => {
		values.set(LEGACY_LEARNER_CONTEXT_STORAGE_KEY, "Existing notes");
		updateDeclaredProfile({ preferredName: "Sam" });
		expect(values.get(LEGACY_LEARNER_CONTEXT_STORAGE_KEY)).toBe("Existing notes");
		expect(loadDeclaredProfile().notes).toBe("Existing notes");
		expect(loadDeclaredProfile().preferredName).toBe("Sam");
	});

	it("keeps the legacy reader working so untouched callers still see notes", () => {
		updateDeclaredProfile({ notes: "Teach me with diagrams." });
		expect(loadLearnerContext()).toBe("Teach me with diagrams.");
	});

	it("keeps the structured notes in step when a legacy writer saves", () => {
		saveLearnerContext("  Written through the old path.  ");
		expect(loadDeclaredProfile().notes).toBe("Written through the old path.");
		expect(loadLearnerContext()).toBe("Written through the old path.");
	});

	it("clears both records on reset", () => {
		updateDeclaredProfile({ preferredName: "Sam", notes: "Some notes" });
		resetDeclaredProfile();
		expect(values.get(DECLARED_PROFILE_STORAGE_KEY)).toBeUndefined();
		expect(values.get(LEGACY_LEARNER_CONTEXT_STORAGE_KEY)).toBeUndefined();
		expect(loadDeclaredProfile()).toEqual(defaultDeclaredProfile());
	});

	it("records a skipped group once", () => {
		markDeclaredProfileGroupSkipped("identity");
		markDeclaredProfileGroupSkipped("identity");
		markDeclaredProfileGroupSkipped("goals");
		expect(loadDeclaredProfile().skippedGroups).toEqual(["identity", "goals"]);
	});
});

describe("declared profile in the system prompt", () => {
	beforeEach(() => values.clear());

	it("adds nothing when there is neither a profile nor notes", () => {
		expect(learnerContextPrompt("", defaultDeclaredProfile())).toBe("");
	});

	it("carries the demographic guardrail whenever declared fields are present", () => {
		const prompt = learnerContextPrompt("", { ...defaultDeclaredProfile(), ageBand: "13-17" });
		expect(prompt).toContain("Age band: 13 to 17");
		expect(prompt).toContain("Do not infer ability, intelligence, personality or learning style from age");
		expect(prompt).toContain("Accessibility preferences are requirements");
	});

	it("includes both declared fields and free-text notes", () => {
		const prompt = learnerContextPrompt("I learn best in the morning.", {
			...defaultDeclaredProfile(),
			preferredName: "Sam",
		});
		expect(prompt).toContain("Preferred name: Sam");
		expect(prompt).toContain(JSON.stringify("I learn best in the morning."));
	});

	it("stays backwards compatible when no profile is passed", () => {
		expect(learnerContextPrompt("Just free text")).toContain(JSON.stringify("Just free text"));
		expect(learnerContextPrompt("Just free text")).not.toContain("### Declared profile");
	});
});
