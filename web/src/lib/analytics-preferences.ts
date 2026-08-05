export const ANALYTICS_PREFERENCES_KEY = "keating.analytics.preferences.v1";

export interface AnalyticsPreferences {
	captureEnabled: boolean;
	replayEnabled: boolean;
	arizeEvaluationEnabled: boolean;
}

export function defaultAnalyticsPreferences(replayAvailable: boolean): AnalyticsPreferences {
	return {
		captureEnabled: true,
		replayEnabled: replayAvailable,
		arizeEvaluationEnabled: false,
	};
}

export function parseAnalyticsPreferences(
	value: string | null,
	replayAvailable: boolean,
): AnalyticsPreferences {
	const fallback = defaultAnalyticsPreferences(replayAvailable);
	if (!value) return fallback;

	try {
		const parsed = JSON.parse(value) as Partial<AnalyticsPreferences>;
		return {
			captureEnabled:
				typeof parsed.captureEnabled === "boolean"
					? parsed.captureEnabled
					: fallback.captureEnabled,
			replayEnabled:
				replayAvailable &&
				(typeof parsed.replayEnabled === "boolean"
					? parsed.replayEnabled
					: fallback.replayEnabled),
			arizeEvaluationEnabled:
				typeof parsed.arizeEvaluationEnabled === "boolean"
					? parsed.arizeEvaluationEnabled
					: false,
		};
	} catch {
		return fallback;
	}
}

export function readAnalyticsPreferences(replayAvailable: boolean): AnalyticsPreferences {
	if (typeof window === "undefined") return defaultAnalyticsPreferences(replayAvailable);
	return parseAnalyticsPreferences(
		window.localStorage.getItem(ANALYTICS_PREFERENCES_KEY),
		replayAvailable,
	);
}

export function writeAnalyticsPreferences(preferences: AnalyticsPreferences): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(ANALYTICS_PREFERENCES_KEY, JSON.stringify(preferences));
}
