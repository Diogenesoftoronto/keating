import { describe, expect, test } from "bun:test";
import { searchFullText } from "../lib/full-text-search";

const models = [
	{ id: "claude-opus-5", name: "Claude Opus 5", provider: "anthropic" },
	{ id: "gpt-5.6-sol", name: "GPT 5.6 Sol", provider: "openai-codex" },
	{ id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", provider: "google" },
];

const search = (query: string) => searchFullText(models, query, (model) => [model.name, model.id, model.provider]);

describe("searchFullText", () => {
	test("matches terms across fields regardless of query order", () => {
		expect(search("anthropic opus").map((model) => model.id)).toEqual(["claude-opus-5"]);
		expect(search("opus anthropic").map((model) => model.id)).toEqual(["claude-opus-5"]);
	});

	test("allows fuzzy matches for misspelled model names", () => {
		expect(search("antropic opuss").map((model) => model.id)).toEqual(["claude-opus-5"]);
	});

	test("requires every query term to match somewhere in the document", () => {
		expect(search("claude openai")).toEqual([]);
	});

	test("preserves source order for an empty query", () => {
		expect(search("  ")).toEqual(models);
	});
});
