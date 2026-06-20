import posthog from "posthog-js";

export function isPostHogEnabled() {
	return Boolean(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN) && import.meta.env.VITE_POSTHOG_DISABLED !== "true";
}

export function initPostHog() {
	if (!isPostHogEnabled()) return null;
	const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
	if (!token) return null;
	posthog.init(token, {
		api_host: '/ingest',
		ui_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.posthog.com',
		defaults: "2026-01-30",
		capture_pageview: true,
		autocapture: false,
		disable_session_recording: true,
		capture_exceptions: true,
		debug: import.meta.env.DEV,
	});
	return posthog;
}

export { posthog };
