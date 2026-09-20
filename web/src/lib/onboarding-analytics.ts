import { useCallback } from "react";
import { usePostHog } from "@posthog/react";
import {
	type DeclaredLearnerProfile,
	answeredDeclaredProfileFields,
} from "@keating/learner-contracts";

/**
 * Onboarding and tour instrumentation, closing the "onboarding
 * viewed/completed/skipped" coverage the 4.0 plan asks for.
 *
 * The learner profile itself never leaves the device. These events carry only
 * step identifiers, positions, booleans and aggregate counts — never a field
 * value, and deliberately no per-group breakdown either, because "filled in the
 * accessibility section" is itself sensitive information about a person.
 */
export type OnboardingAnalyticsEvent =
	| "onboarding_viewed"
	| "onboarding_step_completed"
	| "onboarding_completed"
	| "onboarding_skipped"
	| "interface_tour_started"
	| "interface_tour_completed"
	| "interface_tour_skipped";

export interface OnboardingProfileProperties {
	profile_fields_filled: number;
	profile_groups_skipped: number;
	profile_has_goal: boolean;
}

export function onboardingProfileProperties(profile: DeclaredLearnerProfile): OnboardingProfileProperties {
	return {
		profile_fields_filled: answeredDeclaredProfileFields(profile).length,
		profile_groups_skipped: profile.skippedGroups.length,
		profile_has_goal: profile.goalText.trim().length > 0,
	};
}

/** Numbers, booleans and short enum ids only; anything else is a value leak. */
export type OnboardingAnalyticsProperties = Record<string, string | number | boolean>;

/**
 * The complete set of properties these events may carry. An allowlist of keys
 * rather than a guess at which values look safe: a lowercase first name is
 * indistinguishable from a step id by shape, but `name` is simply not a key
 * anything is allowed to send.
 */
export const ALLOWED_ONBOARDING_PROPERTY_KEYS = [
	"step_id",
	"step_index",
	"step_count",
	"skipped",
	"steps_visible",
	"profile_fields_filled",
	"profile_groups_skipped",
	"profile_has_goal",
] as const;

const ALLOWED_KEYS = new Set<string>(ALLOWED_ONBOARDING_PROPERTY_KEYS);

/**
 * Last line of defence: drops any key that is not on the allowlist, then any
 * value that is not a finite number, a boolean or a short lowercase identifier.
 */
export function safeOnboardingProperties(properties: OnboardingAnalyticsProperties): OnboardingAnalyticsProperties {
	const safe: OnboardingAnalyticsProperties = {};
	for (const [key, value] of Object.entries(properties)) {
		if (!ALLOWED_KEYS.has(key)) continue;
		if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
		else if (typeof value === "boolean") safe[key] = value;
		// Identifiers are lowercase slugs; free text never matches.
		else if (typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)) safe[key] = value;
	}
	return safe;
}

/** No-ops when analytics are disabled, opted out, or no provider is mounted. */
export function useOnboardingAnalytics() {
	const posthog = usePostHog();
	return useCallback((event: OnboardingAnalyticsEvent, properties: OnboardingAnalyticsProperties = {}) => {
		if (!posthog) return;
		try {
			posthog.capture(event, safeOnboardingProperties(properties));
		} catch {
			// Instrumentation must never interrupt onboarding.
		}
	}, [posthog]);
}
