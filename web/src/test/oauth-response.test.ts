import { describe, expect, it } from "bun:test";
import { readOAuthJson } from "../keating/oauth-response";

describe("safe OAuth response parsing", () => {
	it("reads valid JSON without changing credential fields", async () => {
		const credentials = { access_token: "access", refresh_token: "refresh", expires_in: 3600 };
		expect(await readOAuthJson(Response.json(credentials))).toEqual(credentials);
	});

	it.each([200, 404])("explains an HTML %s response without exposing its contents", async (status) => {
		try {
			await readOAuthJson(new Response("<!doctype html><title>private-upstream-trace</title>", { status, headers: { "Content-Type": "text/html; charset=utf-8" } }));
			throw new Error("Expected parser to reject HTML");
		} catch (error) {
			expect((error as Error).message).toContain("sign-in API returned a web page");
			expect((error as Error).message).toContain("Restart or update");
			expect((error as Error).message).not.toContain("private-upstream-trace");
			expect((error as Error).message).not.toContain("<!doctype");
			expect((error as Error).message).not.toContain("Unexpected token");
		}
	});

	it("detects HTML even when a proxy mislabels it as JSON", async () => {
		await expect(readOAuthJson(new Response(" \n<html>hidden-details</html>", { headers: { "Content-Type": "application/json" } }))).rejects.toThrow("sign-in API returned a web page");
	});

	it.each(["{\"secret\":\"private-value\"", "null", "[]", "42", "\"string\""])("rejects malformed or non-object JSON: %s", async (body) => {
		await expect(readOAuthJson(new Response(body))).rejects.toThrow("sign-in API returned an invalid response");
	});

	it("bounds streamed response size and cancels the upstream reader", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(128 * 1024 + 1))); },
			cancel() { cancelled = true; },
		});
		await expect(readOAuthJson(new Response(body))).rejects.toThrow("sign-in API returned an unexpected response");
		expect(cancelled).toBe(true);
	});

	it("handles an empty response with an actionable error", async () => {
		await expect(readOAuthJson(new Response(null, { status: 204 }))).rejects.toThrow("sign-in API returned an empty response");
	});
});
