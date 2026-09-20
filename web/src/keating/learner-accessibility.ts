import type { DeclaredLearnerProfile } from "@keating/learner-contracts";
import { loadDeclaredProfile, subscribeDeclaredProfile } from "./learner-profile-store";

/**
 * Declared accessibility preferences are requirements, not hints. The profile
 * form promises reduced motion, larger text, stronger contrast and friendlier
 * typography, so the interface has to honour them rather than only telling the
 * tutor about them.
 *
 * Preferences travel as attributes on <html> and are styled in
 * `learner-accessibility.css`; the operating system's own reduced-motion
 * setting is honoured there independently of anything declared here.
 */
export const LEARNER_ACCESSIBILITY_ATTRIBUTES = [
	"data-reduce-motion",
	"data-high-contrast",
	"data-dyslexia-font",
	"data-text-scale",
] as const;

export type LearnerAccessibilityAttribute = (typeof LEARNER_ACCESSIBILITY_ATTRIBUTES)[number];

/** `null` means "remove the attribute", so switching a preference off cannot leave a stale one behind. */
export type LearnerAccessibilityAttributes = Record<LearnerAccessibilityAttribute, string | null>;

export function learnerAccessibilityAttributes(profile: DeclaredLearnerProfile): LearnerAccessibilityAttributes {
	return {
		"data-reduce-motion": profile.reduceMotion ? "true" : null,
		"data-high-contrast": profile.highContrast ? "true" : null,
		"data-dyslexia-font": profile.dyslexiaFriendlyFont ? "true" : null,
		// "default" is the absence of a scale, not a third scale to style.
		"data-text-scale": profile.textScale && profile.textScale !== "default" ? profile.textScale : null,
	};
}

export function applyLearnerAccessibility(
	profile: DeclaredLearnerProfile,
	root: Pick<HTMLElement, "setAttribute" | "removeAttribute"> | undefined =
		typeof document === "undefined" ? undefined : document.documentElement,
): void {
	if (!root) return;
	for (const [attribute, value] of Object.entries(learnerAccessibilityAttributes(profile))) {
		if (value === null) root.removeAttribute(attribute);
		else root.setAttribute(attribute, value);
	}
}

/** Applies the stored preferences now and keeps them applied as the profile changes. */
export function initLearnerAccessibility(): () => void {
	try {
		applyLearnerAccessibility(loadDeclaredProfile());
	} catch {
		// A blocked or corrupt profile store must never stop the app from booting.
	}
	return subscribeDeclaredProfile((profile) => applyLearnerAccessibility(profile));
}
