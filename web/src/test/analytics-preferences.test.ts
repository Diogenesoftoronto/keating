import { describe, expect, test } from "bun:test";
import {
	defaultAnalyticsPreferences,
	parseAnalyticsPreferences,
} from "../lib/analytics-preferences";

describe("analytics preferences", () => {
	test("enables only replay that the deployment made available", () => {
		expect(defaultAnalyticsPreferences(true)).toEqual({
			captureEnabled: true,
			replayEnabled: true,
			arizeEvaluationEnabled: false,
		});
		expect(defaultAnalyticsPreferences(false)).toEqual({
			captureEnabled: true,
			replayEnabled: false,
			arizeEvaluationEnabled: false,
		});
	});

	test("preserves an explicit analytics opt-out", () => {
		expect(
			parseAnalyticsPreferences(
				JSON.stringify({ captureEnabled: false, replayEnabled: false }),
				true,
			),
		).toEqual({ captureEnabled: false, replayEnabled: false, arizeEvaluationEnabled: false });
	});

	test("cannot enable replay when the build disabled it", () => {
		expect(
			parseAnalyticsPreferences(
				JSON.stringify({ captureEnabled: true, replayEnabled: true }),
				false,
			),
		).toEqual({ captureEnabled: true, replayEnabled: false, arizeEvaluationEnabled: false });
	});

	test("falls back safely for malformed storage", () => {
		expect(parseAnalyticsPreferences("not json", true)).toEqual({
			captureEnabled: true,
			replayEnabled: true,
			arizeEvaluationEnabled: false,
		});
	});

	test("preserves an explicit Arize preference without coupling it to PostHog", () => {
		expect(parseAnalyticsPreferences(
			JSON.stringify({ captureEnabled: false, replayEnabled: false, arizeEvaluationEnabled: true }),
			true,
		)).toEqual({ captureEnabled: false, replayEnabled: false, arizeEvaluationEnabled: true });
	});
});
