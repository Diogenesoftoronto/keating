import { describe, expect, it } from "bun:test";
import { searchNotOrganicWeb } from "../notorganic-provider/web";
import { setSearchProvenanceSignalSink } from "../keating/search";

const session = { id: "account-one", scope: "web:search" } as any;
const source = { url: "https://example.com/source", title: "Source", snippet: "A finding" };
function client(body: unknown = { results: [source] }, status = 200) {
	const calls: { path: string; init?: RequestInit }[] = [];
	return { calls, getSession: () => session, request: async (path: string, init?: RequestInit) => {
		calls.push({ path, init }); return Response.json(body, { status });
	} };
}

describe("Not Organic hosted web search", () => {
	it("uses the authenticated transport with a cost cap and preserves source provenance", async () => {
		const transport = client(); const signals: any[] = [];
		const cleanup = setSearchProvenanceSignalSink(value => signals.push(value));
		try {
			const text = await searchNotOrganicWeb(transport, " current documentation ", undefined, 42_000);
			expect(transport.calls[0].path).toBe("/v1/web/search");
			expect(transport.calls[0].init?.method).toBe("POST");
			expect(new Headers(transport.calls[0].init?.headers).get("x-notorganic-max-cost-microusd")).toBe("42000");
			expect(JSON.parse(transport.calls[0].init?.body as string)).toEqual({ query: "current documentation", max_results: 8 });
			expect(text).toContain("UNTRUSTED WEB SEARCH RESULTS"); expect(text).toContain(source.url);
			expect(signals[0]).toMatchObject({ untrusted: true, provider: "notorganic", modelId: "keenable", sourceIds: ["citation-1"] });
		} finally { cleanup(); }
	});
	it("bounds content, deduplicates sources and discards unsafe URLs", async () => {
		const transport = client({ results: [source, source, { ...source, url: "javascript:alert(1)" }, { ...source, url: "https://example.com/other", snippet: "x".repeat(4_000) }, ...Array.from({ length: 10 }, (_, i) => ({ ...source, url: `https://example.com/${i}` }))] });
		const text = await searchNotOrganicWeb(transport, "query");
		const body = JSON.parse(text.split("\n")[1]);
		expect(body.results.length).toBeLessThanOrEqual(8);
		expect(body.results.filter((item: any) => item.url === source.url)).toHaveLength(1);
		expect(text).not.toContain("javascript:"); expect(body.results[1].snippet).toHaveLength(2_000);
	});
	it("requests reconnect for old grants and dispatches only after permission exists", async () => {
		const transport = client(); let current = { ...session, scope: "infer:balanced" };
		transport.getSession = () => current;
		const reconnect: boolean[] = [];
		await searchNotOrganicWeb(transport, "query", undefined, 100, async value => { reconnect.push(value); current = session; return true; });
		expect(reconnect).toEqual([true]); expect(transport.calls).toHaveLength(1);
	});
	it("opens sign-in for disconnected accounts and never dispatches after dismissal", async () => {
		const transport = client(); transport.getSession = () => null as any;
		const reconnect: boolean[] = [];
		await expect(searchNotOrganicWeb(transport, "query", undefined, 100, async value => { reconnect.push(value); return false; })).rejects.toThrow("Reconnect Not Organic");
		expect(reconnect).toEqual([false]); expect(transport.calls).toHaveLength(0);
	});
	it("honors cancellation before sign-in or network dispatch", async () => {
		const transport = client(); const abort = new AbortController(); abort.abort();
		await expect(searchNotOrganicWeb(transport, "query", abort.signal)).rejects.toThrow();
		expect(transport.calls).toHaveLength(0);
	});
	it("withholds results after account changes", async () => {
		const transport = client(); let reads = 0;
		transport.getSession = () => (++reads === 1 ? session : { ...session, id: "other-account" });
		await expect(searchNotOrganicWeb(transport, "query")).rejects.toThrow("account changed");
	});
	it.each([401, 403, 402, 500, 503])("returns safe actionable errors for HTTP %s without exposing upstream bodies", async status => {
		const transport = client({ secret: "private diagnostic" }, status);
		let error: unknown; try { await searchNotOrganicWeb(transport, "query"); } catch (caught) { error = caught; }
		expect(error).toBeInstanceOf(Error); expect((error as Error).message).not.toContain("private diagnostic"); expect(transport.calls).toHaveLength(1);
	});
	it("rejects malformed response shapes", async () => {
		await expect(searchNotOrganicWeb(client({ invalid: true }), "query")).rejects.toThrow("invalid search response");
	});
});
