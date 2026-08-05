import { describe, expect, test } from "bun:test";
import {
	analyticsPath,
	analyticsUrl,
	sanitizeAnalyticsProperties,
	sanitizePostHogEvent,
	sanitizeReplayRequest,
} from "../lib/analytics-privacy";

describe("PostHog analytics privacy", () => {
	test("redacts identifiers from private routes", () => {
		expect(analyticsPath("/s/private-share-id")).toBe("/s/:shareId");
		expect(analyticsPath("/courses/join/private-token")).toBe("/courses/join/:token");
		expect(analyticsPath("/courses/course-123/settings")).toBe("/courses/:courseId/settings");
	});

	test("removes query strings and fragments from captured URLs", () => {
		expect(analyticsUrl("https://keating.help/chat?session=secret#turn-2")).toBe(
			"https://keating.help/chat",
		);
		expect(analyticsUrl("/s/private-share-id?from=email")).toBe("/s/:shareId");
	});

	test("drops learning content while retaining behavioral and AI metrics", () => {
		const sanitized = sanitizeAnalyticsProperties({
			prompt_text: "Teach me topology",
			topic: "topology",
			$ai_input: [{ role: "user", content: "private" }],
			$ai_output_choices: [{ role: "assistant", content: "private" }],
			$ai_input_tokens: 42,
			$ai_output_tokens: 17,
			model: "openai/gpt-5",
			duration_ms: 810,
		});

		expect(sanitized.prompt_text).toBeUndefined();
		expect(sanitized.topic).toBeUndefined();
		expect(sanitized.$ai_input).toBeUndefined();
		expect(sanitized.$ai_output_choices).toBeUndefined();
		expect(sanitized.$ai_input_tokens).toBe(42);
		expect(sanitized.$ai_output_tokens).toBe(17);
		expect(sanitized.model).toBe("openai/gpt-5");
	});

	test("redacts raw error messages while retaining exception types and stack structure", () => {
		const result = sanitizeAnalyticsProperties({
			error: "Request failed for secret prompt",
			$exception_message: "Request failed for secret prompt",
			$exception_list: [{
				type: "ProviderError",
				value: "Request failed for secret prompt",
				stacktrace: { frames: [{ filename: "app.js", lineno: 4 }] },
			}],
		});

		expect(result.error).toBeUndefined();
		expect(result.$exception_message).toBeUndefined();
		expect(result.$exception_list).toEqual([{
			type: "ProviderError",
			value: "[ProviderError]",
			stacktrace: { frames: [{ filename: "app.js", lineno: 4 }] },
		}]);
	});

	test("sanitizes complete capture payloads without mutating the source", () => {
		const source = {
			uuid: "event-id",
			event: "message_sent",
			properties: {
				prompt_text: "private",
				$current_url: "https://keating.help/chat?session=private",
			},
		} as any;
		const sanitized = sanitizePostHogEvent(source)!;

		expect(sanitized.properties.prompt_text).toBeUndefined();
		expect(sanitized.properties.$current_url).toBe("https://keating.help/chat");
		expect(source.properties.prompt_text).toBe("private");
	});

	test("removes replay request bodies and headers", () => {
		const request = {
			name: "https://keating.help/api/chat?session=secret",
			requestHeaders: { authorization: "secret" },
			responseHeaders: { "set-cookie": "secret" },
			requestBody: "private prompt",
			responseBody: "private response",
			status: 200,
		};
		const result = sanitizeReplayRequest(request);

		expect(result.name).toBe("https://keating.help/api/chat");
		expect(result.status).toBe(200);
		expect(result.requestHeaders).toBeUndefined();
		expect(result.responseHeaders).toBeUndefined();
		expect(result.requestBody).toBeUndefined();
		expect(result.responseBody).toBeUndefined();
		expect(request.requestBody).toBe("private prompt");
	});
});
