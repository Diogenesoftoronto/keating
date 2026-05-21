import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { applyGoogleSearchGrounding } from "../src/hooks/keating-stream";

function model(id: string, provider = "google"): Model<Api> {
	return {
		id,
		name: id,
		api: "google-generative-ai",
		provider,
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 4096,
	};
}

describe("Google Search grounding payload hook", () => {
	test("adds googleSearch for keyed Gemini 3 requests with existing function tools", () => {
		const payload = {
			model: "gemini-3-flash-preview",
			contents: [{ role: "user", parts: [{ text: "latest news" }] }],
			config: {
				tools: [{ functionDeclarations: [{ name: "plan" }] }],
			},
		};

		const next = applyGoogleSearchGrounding(payload, model("gemini-3-flash-preview"), true) as any;

		expect(next.config.tools).toHaveLength(2);
		expect(next.config.tools[1]).toEqual({ googleSearch: {} });
	});

	test("does not enable grounding without a Google key", () => {
		const payload = { config: {} };

		expect(applyGoogleSearchGrounding(payload, model("gemini-3-flash-preview"), false)).toBeUndefined();
	});

	test("does not combine Google Search with function tools on older Gemini models", () => {
		const payload = { config: { tools: [{ functionDeclarations: [{ name: "plan" }] }] } };

		expect(applyGoogleSearchGrounding(payload, model("gemini-2.5-flash"), true)).toBeUndefined();
	});
});
