import type { CaptureResult, Properties } from "posthog-js";

/**
 * Custom properties that can contain learner-authored or model-authored data.
 * Keating analytics are deliberately behavioral: content stays on the user's
 * device and with the model provider they selected.
 */
const PRIVATE_CONTENT_PROPERTIES = new Set([
	"args",
	"content",
	"error",
	"error_message",
	"input",
	"message",
	"messages",
	"output",
	"prompt_text",
	"response",
	"result",
	"sample_text",
	"tool_args",
	"tool_result",
	"topic",
	"$ai_input",
	"$ai_output_choices",
	"$el_text",
	"$exception_message",
]);

const PRIVATE_ROUTE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
	[/^\/s\/[^/]+/, "/s/:shareId"],
	[/^\/courses\/join\/[^/]+/, "/courses/join/:token"],
	[/^\/courses\/[^/]+/, "/courses/:courseId"],
	[/^\/usage\/evolution\/[^/]+/, "/usage/evolution/:evolutionId"],
];

export function analyticsPath(pathname: string): string {
	for (const [pattern, replacement] of PRIVATE_ROUTE_PATTERNS) {
		if (pattern.test(pathname)) return pathname.replace(pattern, replacement);
	}
	return pathname;
}

/** Remove query strings, hashes, share IDs, invite tokens, and course IDs. */
export function analyticsUrl(value: unknown): unknown {
	if (typeof value !== "string" || !value) return value;
	try {
		const url = new URL(value, "https://keating.invalid");
		url.pathname = analyticsPath(url.pathname);
		url.search = "";
		url.hash = "";
		return url.origin === "https://keating.invalid" ? url.pathname : url.toString();
	} catch {
		return value.split(/[?#]/, 1)[0];
	}
}

export function sanitizeAnalyticsProperties(properties: Properties): Properties {
	const sanitized: Properties = { ...properties };
	for (const key of PRIVATE_CONTENT_PROPERTIES) delete sanitized[key];
	if (Array.isArray(sanitized.$exception_list)) {
		sanitized.$exception_list = sanitized.$exception_list.map((exception: unknown) => {
			if (!exception || typeof exception !== "object") return exception;
			const item = exception as Record<string, unknown>;
			return {
				...item,
				value: typeof item.type === "string" ? `[${item.type}]` : "[redacted]",
			};
		});
	}

	for (const key of ["$current_url", "$referrer", "$pathname", "$prev_pageview_pathname"]) {
		if (key in sanitized) sanitized[key] = analyticsUrl(sanitized[key]);
	}

	return sanitized;
}

export function sanitizePostHogEvent(event: CaptureResult | null): CaptureResult | null {
	if (!event) return null;
	return {
		...event,
		properties: sanitizeAnalyticsProperties(event.properties ?? {}),
	};
}

export function sanitizeReplayRequest<T extends { name?: string }>(request: T): T {
	const sanitized = {
		...request,
		...(request.name ? { name: String(analyticsUrl(request.name)) } : {}),
	} as T & Record<string, unknown>;
	delete sanitized.requestHeaders;
	delete sanitized.responseHeaders;
	delete sanitized.requestBody;
	delete sanitized.responseBody;
	return sanitized;
}
