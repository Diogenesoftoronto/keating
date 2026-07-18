import { describe, expect, it } from "bun:test";

import { normalizeProviderSearchResult, setSearchProvenanceSignalSink } from "../../keating/search";

describe("search result provenance", () => {
	it("normalizes citation URL variants and marks external content untrusted", () => {
		const signals: unknown[] = [];
		const cleanup = setSearchProvenanceSignalSink((signal) => signals.push(signal));
		const result = normalizeProviderSearchResult({
			model: { provider: "google", id: "gemini-3.5-flash" },
			route: {
				provider: "google",
				modelId: "gemini-3.5-flash",
				kind: "native",
				tool: "google-search-grounding",
				citationKind: "grounding-metadata",
				providerNative: true,
			},
			query: "Keating",
			citations: [
				{ uri: "https://example.com/a", title: "A" },
				{ url: "https://example.com/b", text: "B excerpt" },
				{ title: "Missing URL" },
			],
			retrievedAt: "2026-07-18T12:00:00.000Z",
		});

		expect(result.citations).toHaveLength(2);
		expect(result.citations[0]?.url).toBe("https://example.com/a");
		expect(result.citations[1]?.snippet).toBe("B excerpt");
		expect(result.provenance.untrusted).toBe(true);
		expect(result.citations[0]?.provenance.citationKind).toBe("grounding-metadata");
		expect(signals).toEqual([{
			untrusted: true,
			provider: "google",
			modelId: "gemini-3.5-flash",
			sourceIds: ["citation-1", "citation-2"],
			retrievedAt: "2026-07-18T12:00:00.000Z",
		}]);
		cleanup();
	});

	it("signals MiniMax client-adapter results when normalization receives them", () => {
		const signals: unknown[] = [];
		const cleanup = setSearchProvenanceSignalSink((signal) => signals.push(signal));
		normalizeProviderSearchResult({
			model: { provider: "minimax", id: "minimax-m2.7-highspeed" },
			route: {
				provider: "minimax",
				modelId: "minimax-m2.7-highspeed",
				kind: "client-adapter",
				tool: "client-web-search",
				citationKind: "tool-results",
				providerNative: false,
			},
			citations: [{ url: "https://example.com/minimax-result" }],
			retrievedAt: "2026-07-18T12:30:00.000Z",
		});

		expect(signals).toEqual([{
			untrusted: true,
			provider: "minimax",
			modelId: "minimax-m2.7-highspeed",
			sourceIds: ["citation-1"],
			retrievedAt: "2026-07-18T12:30:00.000Z",
		}]);
		cleanup();
	});
});
