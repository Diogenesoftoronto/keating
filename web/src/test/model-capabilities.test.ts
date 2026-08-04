import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import {
	modelCapabilityBadges,
	modelHasCapability,
	modelHasCapabilities,
} from "../keating/model-capabilities";

function model(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "test-model",
		name: "Test model",
		api: "openai-completions" as Api,
		provider: "test",
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 4_096,
		...overrides,
	};
}

describe("model capability filters", () => {
	test("uses declared model metadata for each filter", () => {
		const capable = model({
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 256_000,
			maxTokens: 16_000,
		});

		expect(modelHasCapability(capable, "thinking")).toBe(true);
			expect(modelHasCapability(capable, "vision")).toBe(true);
			expect(modelHasCapability(capable, "long-context")).toBe(true);
	});

	test("combines selected capabilities with AND semantics", () => {
		const visionOnly = model({ input: ["text", "image"], contextWindow: 128_000 });
		expect(modelHasCapabilities(visionOnly, ["vision"])).toBe(true);
		expect(modelHasCapabilities(visionOnly, ["vision", "long-context"])).toBe(false);
		expect(modelHasCapabilities(visionOnly, [])).toBe(true);
	});

	test("does not infer unsupported capabilities from a model name", () => {
		const plain = model({ id: "vision-thinking-1m", name: "Vision Thinking 1M" });

		expect(modelHasCapability(plain, "thinking")).toBe(false);
		expect(modelHasCapability(plain, "vision")).toBe(false);
		expect(modelHasCapability(plain, "long-context")).toBe(false);
	});

	test("shows badges for the same capabilities used by filters", () => {
		expect(modelCapabilityBadges(model({ contextWindow: 256_000 }))).toEqual(["Long context"]);
		expect(modelHasCapability(model({ contextWindow: 255_999 }), "long-context")).toBe(false);
	});
});
