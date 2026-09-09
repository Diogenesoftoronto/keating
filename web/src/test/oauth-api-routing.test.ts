import { afterEach, describe, expect, test } from "bun:test";
import { H3, type EventHandler } from "h3";
import config from "../../nitro.config";
import notFound from "../../server/api-not-found";
import device from "../../server/api/oauth/openai-codex-device";
import poll from "../../server/api/oauth/openai-codex-poll";

const handlers = new Map<string, EventHandler>([
	["server/api-not-found.ts", notFound],
	["server/api/oauth/openai-codex-device.ts", device],
	["server/api/oauth/openai-codex-poll.ts", poll],
	["server/api/share/[id].ts", () => ({ endpoint: "share" })],
	["server/api/notorganic/openai/[...path].ts", () => ({ endpoint: "notorganic" })],
]);
const app = new H3();
// Use the actual production route declarations so a misspelled mapping fails.
for (const route of config.handlers ?? []) {
	const handler = typeof route.handler === "string" ? handlers.get(route.handler) : undefined;
	if (handler && route.route) app.all(route.route, handler);
}
app.all("/**", () => new Response("<!DOCTYPE html><title>Keating</title>", {
	headers: { "Content-Type": "text/html" },
}));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("OAuth API routing", () => {
	test("unknown API paths return JSON instead of the SPA, even when HTML is accepted", async () => {
		const response = await app.request("http://keating.test/api/oauth/missing", { headers: { Accept: "text/html" } });
		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toMatchObject({ error: expect.stringContaining("endpoint is unavailable") });
	});

	test("device route resolves to OpenAI handler, ahead of API fallback", async () => {
		globalThis.fetch = Object.assign(async () => Response.json({ device_auth_id: "device", user_code: "ABCD", interval: 5 }), { preconnect: originalFetch.preconnect });
		const response = await app.request("http://keating.test/api/oauth/openai-codex/device", { method: "POST" });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ device_code: "device", user_code: "ABCD" });
	});

	test("device readiness probe rejects GET without contacting OpenAI", async () => {
		globalThis.fetch = Object.assign(async () => { throw new Error("must not reach OpenAI"); }, { preconnect: originalFetch.preconnect });
		const response = await app.request("http://keating.test/api/oauth/openai-codex/device");
		expect(response.status).toBe(405);
		expect(response.headers.get("content-type")).toContain("application/json");
	});

	test("poll readiness probe reaches validation without contacting OpenAI", async () => {
		globalThis.fetch = Object.assign(async () => { throw new Error("must not reach OpenAI"); }, { preconnect: originalFetch.preconnect });
		const response = await app.request("http://keating.test/api/oauth/openai-codex/poll", {
			method: "POST", headers: { "content-type": "application/json" }, body: "{}",
		});
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/json");
	});

	test("normal pages retain the SPA response", async () => {
		const response = await app.request("http://keating.test/chat");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
	});

	test.each([
		["/api/share/example", "share"],
		["/api/notorganic/openai/v1/chat/completions", "notorganic"],
	])("specific wildcard API %s takes precedence over API fallback", async (path, endpoint) => {
		const response = await app.request(`http://keating.test${path}`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ endpoint });
	});
});
