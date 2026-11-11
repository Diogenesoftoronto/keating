import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { H3, type EventHandler } from "h3";

/**
 * End to end through the real route table: the declarations in nitro.config
 * are what production serves, so a route that is implemented but not
 * registered fails here instead of returning "endpoint unavailable" live.
 */
const stored = new Map<string, unknown>();
mock.module("nitro/storage", () => ({
	useStorage: () => ({
		getItem: async (key: string) => stored.has(key) ? structuredClone(stored.get(key)) : null,
		setItem: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
		removeItem: async (key: string) => { stored.delete(key); },
	}),
}));

const { default: config } = await import("../../nitro.config");
const { default: notFound } = await import("../../server/api-not-found");
const { default: readProfile } = await import("../../server/api/profiles/[did].get");
const { default: reportProfile } = await import("../../server/api/profiles/report.post");
const { default: moderation } = await import("../../server/api/profiles/moderation");
const { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } = await import("../../server/utils/public-abuse");
const { clearPublicProfileCache } = await import("../../server/utils/public-profile");
const { LEARNING_PROFILE_COLLECTION, publicProfileRecord } = await import("../keating/public-profile-contract");

const handlers = new Map<string, EventHandler>([
	["server/api-not-found.ts", notFound],
	["server/api/profiles/[did].get.ts", readProfile],
	["server/api/profiles/report.post.ts", reportProfile],
	["server/api/profiles/moderation.ts", moderation],
]);
const app = new H3();
for (const route of config.handlers ?? []) {
	const handler = typeof route.handler === "string" ? handlers.get(route.handler) : undefined;
	if (!handler || !route.route) continue;
	if (route.method) app.on(route.method, route.route, handler);
	else app.all(route.route, handler);
}

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const PDS = "https://pds.example.com";
const TOKEN = "moderation-token-0123456789abcdef";
const record = publicProfileRecord({ displayName: "Ada", topics: ["Attention"], work: [{ kind: "notes", title: "Notes", url: "https://example.com/notes" }] });
const originalFetch = globalThis.fetch;
const originalToken = process.env.KEATING_MODERATION_TOKEN;
let upstream: string[] = [];

beforeEach(() => {
	stored.clear();
	upstream = [];
	clearPublicProfileCache();
	setPublicAbuseStoreForTests(new MemoryPublicAbuseStore(() => 1_000));
	process.env.KEATING_MODERATION_TOKEN = TOKEN;
	globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
		const url = String(input);
		upstream.push(url);
		if (url.startsWith("https://plc.directory/")) return Response.json({ id: DID, alsoKnownAs: ["at://ada.example.com"], service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }] });
		if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord`)) return Response.json({ uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, cid: "c", value: record });
		return new Response("unexpected", { status: 500 });
	}, { preconnect: originalFetch.preconnect }) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	setPublicAbuseStoreForTests();
	if (originalToken === undefined) delete process.env.KEATING_MODERATION_TOKEN; else process.env.KEATING_MODERATION_TOKEN = originalToken;
});

const get = (path: string, headers: Record<string, string> = {}) => app.request(`http://keating.test${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(`http://keating.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const operator = { authorization: `Bearer ${TOKEN}` };

describe("public profile API through the production route table", () => {
	test("every profile route is registered", () => {
		const routes = (config.handlers ?? []).map((route) => `${route.method ?? "ALL"} ${route.route} -> ${route.handler}`);
		expect(routes).toContain("GET /api/profiles/:did -> server/api/profiles/[did].get.ts");
		expect(routes).toContain("POST /api/profiles/report -> server/api/profiles/report.post.ts");
		expect(routes).toContain("ALL /api/profiles/moderation -> server/api/profiles/moderation.ts");
	});

	test("a published profile is served and never cached downstream", async () => {
		const response = await get(`/api/profiles/${encodeURIComponent(DID)}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = await response.json() as { status: string; handle?: string; profile: { displayName: string } };
		expect(body).toMatchObject({ status: "public", handle: "ada.example.com", profile: { displayName: "Ada" } });
		expect(upstream).toHaveLength(2);
	});

	test("an invalid identity is refused without contacting anything", async () => {
		const response = await get("/api/profiles/not-a-did");
		expect(response.status).toBe(400);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toMatchObject({ code: "invalid_did" });
		expect(upstream).toHaveLength(0);
	});

	test("an upstream failure is a 502, never 'no profile'", async () => {
		globalThis.fetch = Object.assign(async () => new Response("down", { status: 503 }), { preconnect: originalFetch.preconnect }) as typeof fetch;
		const response = await get(`/api/profiles/${encodeURIComponent(DID)}`);
		expect(response.status).toBe(502);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	test("report, review and hide: the minimum moderation loop", async () => {
		const reported = await post("/api/profiles/report", { did: DID, reason: "impersonation", detail: "Pretends to be me", publicationId: record.publicationId });
		expect(reported.status).toBe(200);
		expect(await reported.json()).toMatchObject({ received: true });

		const queue = await get("/api/profiles/moderation", operator);
		expect(queue.status).toBe(200);
		const listed = await queue.json() as { profiles: Array<{ did: string; hidden: boolean; reports: Array<{ reason: string; detail?: string; reporter: string }> }> };
		expect(listed.profiles).toHaveLength(1);
		expect(listed.profiles[0]).toMatchObject({ did: DID, hidden: false });
		expect(listed.profiles[0]!.reports[0]).toMatchObject({ reason: "impersonation", detail: "Pretends to be me" });
		// The reporter is kept only as a short hash.
		expect(listed.profiles[0]!.reports[0]!.reporter).toMatch(/^[0-9a-f]{16}$/);

		expect((await post("/api/profiles/moderation", { did: DID, hidden: true, note: "impersonation confirmed" }, operator)).status).toBe(200);
		const hidden = await get(`/api/profiles/${encodeURIComponent(DID)}`);
		expect(await hidden.json()).toEqual({ status: "hidden", did: DID });
		expect(hidden.headers.get("cache-control")).toBe("no-store");

		expect((await post("/api/profiles/moderation", { did: DID, hidden: false }, operator)).status).toBe(200);
		expect((await (await get(`/api/profiles/${encodeURIComponent(DID)}`)).json() as { status: string }).status).toBe("public");
	});

	test("hiding takes effect at once even when the profile was just served", async () => {
		expect((await (await get(`/api/profiles/${encodeURIComponent(DID)}`)).json() as { status: string }).status).toBe("public");
		await post("/api/profiles/moderation", { did: DID, hidden: true }, operator);
		expect((await (await get(`/api/profiles/${encodeURIComponent(DID)}`)).json() as { status: string }).status).toBe("hidden");
	});

	test("malformed reports are rejected and nothing is stored", async () => {
		for (const body of [{}, { did: DID }, { did: "nope", reason: "spam" }, { did: DID, reason: "other" }]) {
			expect((await post("/api/profiles/report", body)).status).toBe(400);
		}
		expect(stored.size).toBe(0);
		// Reading the report address is not a thing: "report" is not a learner identity.
		expect((await get("/api/profiles/report")).status).toBe(400);
		expect(upstream).toHaveLength(0);
	});

	test("one visitor cannot flood reports", async () => {
		const statuses: number[] = [];
		for (let index = 0; index < 8; index += 1) statuses.push((await post("/api/profiles/report", { did: DID, reason: "spam" })).status);
		expect(statuses.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
		expect(statuses.slice(6)).toEqual([429, 429]);
	});

	test("operator routes look like they do not exist without the right token", async () => {
		const attempts: Array<Record<string, string>> = [{}, { authorization: "Bearer wrong" }, { authorization: TOKEN }];
		for (const headers of attempts) {
			expect((await get("/api/profiles/moderation", headers)).status).toBe(404);
			expect((await post("/api/profiles/moderation", { did: DID, hidden: true }, headers)).status).toBe(404);
		}
		delete process.env.KEATING_MODERATION_TOKEN;
		expect((await get("/api/profiles/moderation", operator)).status).toBe(404);
		expect((await (await get(`/api/profiles/${encodeURIComponent(DID)}`)).json() as { status: string }).status).toBe("public");
	});

	test("an operator request must name a valid profile", async () => {
		expect((await post("/api/profiles/moderation", { did: "nope", hidden: true }, operator)).status).toBe(400);
		expect((await post("/api/profiles/moderation", { did: DID, hidden: "yes" }, operator)).status).toBe(400);
	});
});
