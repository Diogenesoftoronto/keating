import posthog from "posthog-js";
import { sanitizePostHogEvent, sanitizeReplayRequest } from "./analytics-privacy";
import {
	readAnalyticsPreferences,
	type AnalyticsPreferences,
	writeAnalyticsPreferences,
} from "./analytics-preferences";

export const ANALYTICS_SCHEMA_VERSION = 2;

export function postHogGlobalProperties() {
	return {
		analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
		app_version: String(import.meta.env.APP_VERSION ?? "dev"),
		app_surface: "web",
		build_environment: import.meta.env.MODE,
	};
}

export function isSessionReplayAvailable(): boolean {
	return import.meta.env.VITE_POSTHOG_SESSION_REPLAY === "true";
}

export function isPostHogEnabled() {
	return Boolean(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN) && import.meta.env.VITE_POSTHOG_DISABLED !== "true";
}

export function initPostHog() {
	if (!isPostHogEnabled()) return null;
	const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
	if (!token) return null;
	const preferences = readAnalyticsPreferences(isSessionReplayAvailable());
	const sessionReplayEnabled = preferences.captureEnabled && preferences.replayEnabled;
	posthog.init(token, {
		api_host: '/ingest',
		ui_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.posthog.com',
		defaults: "2026-05-30",
		capture_pageview: "history_change",
		capture_pageleave: true,
		respect_dnt: true,
		opt_out_capturing_by_default: !preferences.captureEnabled,
		opt_out_capturing_persistence_type: "localStorage",
		autocapture: true,
		capture_heatmaps: true,
		capture_dead_clicks: true,
		capture_performance: {
			network_timing: sessionReplayEnabled,
			web_vitals: true,
		},
		disable_session_recording: !sessionReplayEnabled,
		session_recording: {
			maskAllInputs: true,
			maskTextSelector: "*",
			maskCapturedNetworkRequestFn: sanitizeReplayRequest,
			recordBody: false,
			recordHeaders: false,
		},
		mask_all_text: true,
		mask_all_element_attributes: true,
		mask_personal_data_properties: true,
		capture_exceptions: true,
		enable_recording_console_log: false,
		before_send: sanitizePostHogEvent,
		loaded: (client) => {
			client.register(postHogGlobalProperties());
			client.register_once({ first_seen_app_version: postHogGlobalProperties().app_version });
		},
		debug: import.meta.env.DEV,
	});
	return posthog;
}

export function updateAnalyticsPreferences(preferences: AnalyticsPreferences): void {
	const replayEnabled = isSessionReplayAvailable() && preferences.replayEnabled;
	const normalized = { ...preferences, replayEnabled };
	writeAnalyticsPreferences(normalized);

	if (!isPostHogEnabled()) return;
	if (!normalized.captureEnabled) {
		posthog.stopSessionRecording();
		posthog.opt_out_capturing();
		return;
	}

	posthog.opt_in_capturing();
	if (replayEnabled) posthog.startSessionRecording();
	else posthog.stopSessionRecording();
	posthog.capture("analytics_preferences_updated", {
		capture_enabled: true,
		replay_enabled: replayEnabled,
	});
}

export { posthog };
