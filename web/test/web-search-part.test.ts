import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	formatSites,
	isWebSearchToolName,
	parseWebSearchResult,
	WebSearchPart,
	type ParsedWebSearch,
} from "../src/components/WebSearchPart";

describe("web search part — tool name detection", () => {
	test("renders an incomplete result as a failure instead of a spinner", () => {
		const html = renderToStaticMarkup(
			createElement(WebSearchPart, {
				toolName: "web_search",
				result: undefined,
				status: { type: "incomplete" },
			}),
		);

		expect(html).toContain("failed");
		expect(html).not.toContain("searching");
	});

	test("recognizes hosted and client search tool names", () => {
		for (const name of [
			"web_search",
			"web_search_preview",
			"web_search_20250305",
			"google_grounding",
			"browser_search",
			"client-web-search",
		]) {
			expect(isWebSearchToolName(name)).toBe(true);
		}
	});

	test("rejects unrelated tool names", () => {
		expect(isWebSearchToolName("web_scrape")).toBe(false);
		expect(isWebSearchToolName("generate_image")).toBe(false);
		expect(isWebSearchToolName("")).toBe(false);
	});
});

describe("web search part — result parsing", () => {
	test("extracts query from tool arguments", () => {
		const parsed: ParsedWebSearch = parseWebSearchResult(
			{ text: "results" },
			{ query: "Keating tutorial" },
		);
		expect(parsed.query).toBe("Keating tutorial");
	});

	test("parses details.citations (TUI shape)", () => {
		const parsed = parseWebSearchResult(
			{
				text: "Here are the results",
				details: {
					citations: [
						{ title: "Keating Docs", url: "https://keating.dev/docs" },
						{ title: "Pi Runtime", url: "https://pi.dev/runtime" },
					],
				},
			},
			{ query: "keating" },
		);
		expect(parsed.sites).toHaveLength(2);
		expect(parsed.sites[0]).toMatchObject({ title: "Keating Docs", url: "https://keating.dev/docs" });
		expect(parsed.sites[1].title).toBe("Pi Runtime");
	});

	test("ignores unrelated arrays before citation collections", () => {
		const parsed = parseWebSearchResult(
			{
				content: [{ type: "resource", url: "https://not-a-citation.example" }],
				steps: ["searching", "ranking"],
				details: {
					citations: [{ title: "Actual result", url: "https://result.example" }],
				},
			},
			{},
		);
		expect(parsed.sites).toEqual([
			{ title: "Actual result", url: "https://result.example", snippet: undefined },
		]);
	});

	test("skips empty or invalid citation arrays in favor of later valid results", () => {
		const parsed = parseWebSearchResult(
			{
				citations: [{ title: "Missing URL" }],
				results: [{ title: "Valid result", link: "https://valid.example" }],
			},
			{},
		);
		expect(parsed.sites).toHaveLength(1);
		expect(parsed.sites[0].url).toBe("https://valid.example");
	});

	test("parses nested sources/results arrays", () => {
		const parsed = parseWebSearchResult(
			{
				output: JSON.stringify({
					webResults: [
						{ title: "Result A", url: "https://a.example", snippet: "desc a" },
						{ title: "Result B", url: "https://b.example" },
					],
				}),
			},
			{ q: "fallback" },
		);
		expect(parsed.query).toBe("fallback");
		expect(parsed.sites).toHaveLength(2);
		expect(parsed.sites[0].snippet).toBe("desc a");
	});

	test("falls back to markdown links in plain text results", () => {
		const parsed = parseWebSearchResult(
			"Found [Keating repo](https://github.com/example/keating) and [docs](https://keating.dev/).",
			{},
		);
		expect(parsed.sites).toHaveLength(2);
		expect(parsed.sites[0].url).toBe("https://github.com/example/keating");
	});

	test("falls back to bare URLs when no markdown links exist", () => {
		const parsed = parseWebSearchResult(
			"See https://keating.dev/start and https://pi.dev for details.",
			{},
		);
		expect(parsed.sites).toHaveLength(2);
		expect(parsed.sites[0].url).toBe("https://keating.dev/start");
	});

	test("returns empty sites for results without any URLs", () => {
		const parsed = parseWebSearchResult({ text: "no citations at all" }, {});
		expect(parsed.sites).toHaveLength(0);
		expect(parsed.text).toBe("no citations at all");
	});

	test("extracts provider failure text from content blocks", () => {
		const parsed = parseWebSearchResult(
			{ content: [{ type: "text", text: "Search quota exceeded; retry in 30 seconds." }] },
			{},
		);
		expect(parsed.text).toBe("Search quota exceeded; retry in 30 seconds.");
	});

	test("extracts provider failure messages and nested errors", () => {
		expect(parseWebSearchResult({ message: "Provider unavailable" }, {}).text).toBe(
			"Provider unavailable",
		);
		expect(
			parseWebSearchResult({ error: { message: "Invalid search credentials" } }, {}).text,
		).toBe("Invalid search credentials");
	});

	test("preserves unknown structured payloads as JSON text", () => {
		const parsed = parseWebSearchResult({ code: "UPSTREAM_FAILURE", retryable: true }, {});
		expect(parsed.text).toContain('"code": "UPSTREAM_FAILURE"');
		expect(parsed.text).toContain('"retryable": true');
	});

	test("rejects non-web citation URLs", () => {
		const parsed = parseWebSearchResult(
			{
				citations: [
					{ title: "Unsafe", url: "javascript:alert(1)" },
					{ title: "Web", url: "https://safe.example" },
				],
			},
			{},
		);
		expect(parsed.sites).toEqual([
			{ title: "Web", url: "https://safe.example", snippet: undefined },
		]);
	});
});

describe("web search part — site formatting", () => {
	test("formatSites renders numbered list", () => {
		const formatted = formatSites([
			{ title: "One", url: "https://one.example" },
			{ url: "https://two.example" },
		]);
		expect(formatted).toBe("1. One\n2. https://two.example");
	});
});
