import { describe, expect, it } from "bun:test";
import { parseDeclaredProfile } from "@keating/learner-contracts";
import {
	ALLOWED_ONBOARDING_PROPERTY_KEYS,
	onboardingProfileProperties,
	safeOnboardingProperties,
} from "../lib/onboarding-analytics";

describe("onboarding telemetry keeps the profile on the device", () => {
	const filled = parseDeclaredProfile({
		preferredName: "Sam Fitzgerald",
		pronouns: "they/them",
		ageBand: "13-17",
		explainInLanguage: "Tagalog",
		interests: ["skateboarding", "synthesizers"],
		goalText: "I want to understand recursion.",
		screenReader: true,
		skippedGroups: ["pedagogy", "accessibility"],
	});

	it("reports counts rather than anything the learner wrote", () => {
		const properties = onboardingProfileProperties(filled);
		expect(properties).toEqual({
			profile_fields_filled: 7,
			profile_groups_skipped: 2,
			profile_has_goal: true,
		});
	});

	it("carries no field value anywhere in the payload", () => {
		const serialized = JSON.stringify(onboardingProfileProperties(filled));
		for (const value of ["Sam", "they/them", "13-17", "Tagalog", "skateboarding", "recursion"]) {
			expect(serialized).not.toContain(value);
		}
	});

	it("does not break the profile down by group, because the groups are themselves revealing", () => {
		const keys = Object.keys(onboardingProfileProperties(filled));
		expect(keys.some((key) => key.includes("accessibility"))).toBe(false);
		expect(keys.some((key) => key.includes("identity"))).toBe(false);
	});

	it("distinguishes an empty goal from a filled one without sending it", () => {
		expect(onboardingProfileProperties(parseDeclaredProfile({ goalText: "   " })).profile_has_goal).toBe(false);
		expect(onboardingProfileProperties(parseDeclaredProfile({})).profile_fields_filled).toBe(0);
	});
});

describe("the property allowlist", () => {
	it("keeps identifiers, counts and flags", () => {
		expect(safeOnboardingProperties({ step_id: "accessibility", step_index: 6, skipped: true }))
			.toEqual({ step_id: "accessibility", step_index: 6, skipped: true });
	});

	it("drops free text that a future caller might attach by mistake", () => {
		expect(safeOnboardingProperties({
			step_id: "identity",
			goal: "I want to understand recursion.",
			name: "Sam Fitzgerald",
			pronouns: "they/them",
		})).toEqual({ step_id: "identity" });
	});

	// A lowercase first name is shaped exactly like a step id, so the key
	// allowlist — not the value shape — is what actually holds the line.
	it("drops a value that would have passed a shape check, because its key is not allowed", () => {
		expect(safeOnboardingProperties({ name: "sam", pronouns: "they", explain_in_language: "tagalog" })).toEqual({});
	});

	it("allows only the documented keys", () => {
		const everything = Object.fromEntries(ALLOWED_ONBOARDING_PROPERTY_KEYS.map((key) => [key, 1]));
		expect(Object.keys(safeOnboardingProperties(everything)).sort())
			.toEqual([...ALLOWED_ONBOARDING_PROPERTY_KEYS].sort());
	});

	it("drops non-finite numbers", () => {
		expect(safeOnboardingProperties({ step_index: Number.NaN, steps_visible: Number.POSITIVE_INFINITY, ok: 3 }))
			.toEqual({});
	});
});
