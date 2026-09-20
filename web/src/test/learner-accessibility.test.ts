import { describe, expect, it } from "bun:test";
import { defaultDeclaredProfile, parseDeclaredProfile } from "@keating/learner-contracts";
import {
	LEARNER_ACCESSIBILITY_ATTRIBUTES,
	applyLearnerAccessibility,
	learnerAccessibilityAttributes,
} from "../keating/learner-accessibility";

/** Stands in for <html>, recording what the real element would end up with. */
function fakeRoot() {
	const attributes = new Map<string, string>();
	return {
		attributes,
		setAttribute: (name: string, value: string) => { attributes.set(name, value); },
		removeAttribute: (name: string) => { attributes.delete(name); },
	};
}

describe("declared accessibility preferences reach the interface", () => {
	it("sets nothing for a learner who declared nothing", () => {
		const attributes = learnerAccessibilityAttributes(defaultDeclaredProfile());
		expect(Object.values(attributes).every((value) => value === null)).toBe(true);
	});

	it("maps each preference to the attribute the stylesheet keys on", () => {
		const profile = parseDeclaredProfile({
			reduceMotion: true,
			highContrast: true,
			dyslexiaFriendlyFont: true,
			textScale: "larger",
		});
		expect(learnerAccessibilityAttributes(profile)).toEqual({
			"data-reduce-motion": "true",
			"data-high-contrast": "true",
			"data-dyslexia-font": "true",
			"data-text-scale": "larger",
		});
	});

	it("treats an explicit default text size as no scaling at all", () => {
		expect(learnerAccessibilityAttributes(parseDeclaredProfile({ textScale: "default" }))["data-text-scale"]).toBeNull();
		expect(learnerAccessibilityAttributes(parseDeclaredProfile({ textScale: "" }))["data-text-scale"]).toBeNull();
		expect(learnerAccessibilityAttributes(parseDeclaredProfile({ textScale: "large" }))["data-text-scale"]).toBe("large");
	});

	it("applies preferences to the document root", () => {
		const root = fakeRoot();
		applyLearnerAccessibility(parseDeclaredProfile({ reduceMotion: true, textScale: "large" }), root);
		expect(root.attributes.get("data-reduce-motion")).toBe("true");
		expect(root.attributes.get("data-text-scale")).toBe("large");
		expect(root.attributes.has("data-high-contrast")).toBe(false);
	});

	// Switching a preference off has to undo it, not just stop setting it.
	it("removes an attribute when the learner turns the preference back off", () => {
		const root = fakeRoot();
		applyLearnerAccessibility(parseDeclaredProfile({ reduceMotion: true, highContrast: true, textScale: "larger" }), root);
		applyLearnerAccessibility(defaultDeclaredProfile(), root);
		expect(root.attributes.size).toBe(0);
	});

	it("covers every attribute the stylesheet looks for", () => {
		const attributes = learnerAccessibilityAttributes(defaultDeclaredProfile());
		expect(Object.keys(attributes).sort()).toEqual([...LEARNER_ACCESSIBILITY_ATTRIBUTES].sort());
	});

	it("does nothing when there is no document, as during server rendering", () => {
		expect(() => applyLearnerAccessibility(defaultDeclaredProfile(), undefined)).not.toThrow();
	});
});
