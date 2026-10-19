import { beforeEach, describe, expect, it } from "bun:test";
import { defaultDeclaredProfile } from "@keating/learner-contracts";
import { Children, isValidElement } from "react";
import { AccessibilityFields } from "../components/profile/ProfileFieldGroups";
import { DEFAULT_WEB_SPEECH_SETTINGS, loadWebSpeechSettings, saveWebSpeechSettings } from "../keating/speech";

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

describe("saved dyslexia preferences enable spoken replies", () => {
	beforeEach(() => values.clear());

	it("leaves global speech untouched while the profile is only a draft", () => {
		let draft = defaultDeclaredProfile();
		const view = AccessibilityFields({ profile: draft, onChange: (patch) => { draft = { ...draft, ...patch }; } });
		const toggle = Children.toArray(view.props.children).find((child) =>
			isValidElement<{ title?: string }>(child) && child.props.title === "Dyslexia-friendly reading and speech");
		if (!isValidElement<{ onChange: (checked: boolean) => void }>(toggle)) throw new Error("Missing accessibility toggle");
		toggle.props.onChange(true);
		expect(draft.dyslexiaFriendlyFont).toBe(true);
		expect(loadDeclaredProfile().dyslexiaFriendlyFont).toBe(false);
		expect(loadWebSpeechSettings().enabled).toBe(false);
		toggle.props.onChange(false);
		expect(loadWebSpeechSettings()).toEqual(DEFAULT_WEB_SPEECH_SETTINGS);
	});

	for (const providerId of ["tavus", "gpt-live"]) {
		it(`enables device replies when a ${providerId} profile opt-in is saved`, () => {
			saveWebSpeechSettings({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId, microphoneEnabled: true });
			saveDeclaredProfile({ ...defaultDeclaredProfile(), dyslexiaFriendlyFont: true });
			expect(loadWebSpeechSettings()).toMatchObject({ enabled: true, replyMode: "device", microphoneEnabled: false, providerId });
		});
	}

	it("keeps a configured synthesis provider and explicitly disables its microphone", () => {
		saveWebSpeechSettings({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "openai-realtime", model: "gpt-realtime-2.1", microphoneEnabled: true });
		saveDeclaredProfile({ ...defaultDeclaredProfile(), dyslexiaFriendlyFont: true });
		expect(loadWebSpeechSettings()).toMatchObject({ enabled: true, replyMode: "provider", microphoneEnabled: false, providerId: "openai-realtime", model: "gpt-realtime-2.1" });
	});

	it("preserves later explicit speech choices across unrelated profile saves", () => {
		updateDeclaredProfile({ dyslexiaFriendlyFont: true });
		saveWebSpeechSettings({ ...loadWebSpeechSettings(), enabled: false, microphoneEnabled: true });
		updateDeclaredProfile({ preferredName: "Sam" });
		expect(loadWebSpeechSettings()).toMatchObject({ enabled: false, microphoneEnabled: true });
	});

	it("repairs the earlier enabled default once, without reenabling a later opt-out", () => {
		values.set(DECLARED_PROFILE_STORAGE_KEY, JSON.stringify({ ...defaultDeclaredProfile(), dyslexiaFriendlyFont: true }));
		saveWebSpeechSettings({ ...DEFAULT_WEB_SPEECH_SETTINGS, enabled: true, microphoneEnabled: true });
		updateDeclaredProfile({ preferredName: "Sam" });
		expect(loadWebSpeechSettings()).toMatchObject({ replyMode: "device", microphoneEnabled: false });
		saveWebSpeechSettings({ ...loadWebSpeechSettings(), enabled: false });
		updateDeclaredProfile({ notes: "Use short explanations." });
		expect(loadWebSpeechSettings().enabled).toBe(false);
	});

	it("does not activate speech when the profile write fails", () => {
		const setItem = localStorage.setItem;
		localStorage.setItem = (key, value) => {
			if (key === DECLARED_PROFILE_STORAGE_KEY) throw new Error("Blocked profile storage");
			setItem(key, value);
		};
		try {
			updateDeclaredProfile({ dyslexiaFriendlyFont: true });
			expect(loadDeclaredProfile().dyslexiaFriendlyFont).toBe(false);
			expect(loadWebSpeechSettings().enabled).toBe(false);
		} finally { localStorage.setItem = setItem; }
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
