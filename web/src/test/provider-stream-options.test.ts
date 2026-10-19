import { expect, test } from "bun:test";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import { normalizeProviderStreamOptions, notOrganicInferenceRequestUrl } from "../hooks/keating-stream";

test("Not Organic signs the endpoint selected by the model API", () => {
	const baseUrl = "https://api.notorganic.test/v1///";
	expect(notOrganicInferenceRequestUrl({ api: "openai-responses", baseUrl })).toBe("https://api.notorganic.test/v1/responses");
	expect(notOrganicInferenceRequestUrl({ api: "openai-completions", baseUrl })).toBe("https://api.notorganic.test/v1/chat/completions");
});

test("Codex omits temperature and preserves the caller's remaining options", () => {
	const onPayload = (payload: unknown) => payload;
	const options: SimpleStreamOptions = {
		temperature: 0.2,
		apiKey: "test-key",
		reasoning: "medium",
		maxTokens: 800,
		headers: { "x-test-header": "preserved" },
		signal: new AbortController().signal,
		onPayload,
	};
	const result = normalizeProviderStreamOptions({ api: "openai-codex-responses" }, options);
	expect(result).not.toHaveProperty("temperature");
	const { temperature: _, ...rest } = options;
	expect(result).toEqual(rest);
	expect(result.onPayload).toBe(onPayload);
	expect(options.temperature).toBe(0.2);
});

test("other APIs preserve temperature and options unchanged", () => {
	const options: SimpleStreamOptions = { temperature: 0.85 };
	for (const api of ["openai-completions", "openai-responses", "anthropic-messages"] as const) {
		expect(normalizeProviderStreamOptions({ api }, options)).toBe(options);
	}
});
