import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { H3 } from "h3";
import { SHARE_MAX_BYTES } from "../keating/share-contract";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";

// Run this server-boundary test independently: Nitro storage is a virtual module.
const stored = new Map<string, unknown>();
let failWrite = false;
const bytes = new Map<string, number>();
let quotaLimit = Number.POSITIVE_INFINITY;
let globalQuotaLimit = Number.POSITIVE_INFINITY;
mock.module("nitro/storage", () => ({ useStorage: () => ({
	hasItem: async (id: string) => stored.has(id),
	setItem: async (id: string, value: unknown) => {
		if (failWrite) throw new Error("Storage unavailable");
		stored.set(id, value);
	},
}) }));
const { default: handler } = await import("../../server/api/share/index");
const app = new H3().all("/api/share", handler);
const payload = { schemaVersion: 3, title: "Lesson", messages: [{ role: "user", content: [{ type: "text", text: "Explain fractions" }] }] };
const send = (body: string = JSON.stringify(payload)) => app.request("http://keating.test/api/share", {
	method: "POST", headers: { "content-type": "application/json" }, body,
});
beforeEach(() => {
 stored.clear(); bytes.clear(); failWrite = false; quotaLimit = Number.POSITIVE_INFINITY; globalQuotaLimit = Number.POSITIVE_INFINITY;
 const store = new MemoryPublicAbuseStore(() => 1000);
 setPublicAbuseStoreForTests({
  acquire: (...args) => store.acquire(...args),
  reserve: async (key, amount, limit, windowSeconds) => {
   const bucket = limit === 8 * 1024 * 1024 ? "share-bytes-client" : limit === 64 * 1024 * 1024 ? "share-bytes-global" : undefined;
   const effectiveLimit = bucket ? Math.min(limit, quotaLimit, bucket === "share-bytes-global" ? globalQuotaLimit : Number.POSITIVE_INFINITY) : limit;
   const reservation = await store.reserve(key, amount, effectiveLimit, windowSeconds);
   if (bucket && reservation.allowed) bytes.set(bucket, (bytes.get(bucket) ?? 0) + amount);
   return { ...reservation, release: async () => {
    await reservation.release();
    if (bucket && reservation.allowed) bytes.set(bucket, (bytes.get(bucket) ?? 0) - amount);
   } };
  },
 });
});
afterEach(() => setPublicAbuseStoreForTests());

describe("share creation abuse controls", () => {
	test("normal anonymous share preserves the public payload and compact ID", async () => {
		const response = await send();
		expect(response.status).toBe(200);
		const { id } = await response.json() as { id: string };
		expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
		expect(stored.get(id)).toMatchObject({ ...payload, id, messageCount: 1 });
	});
	test("rejects an oversized chunked request without content-length", async () => {
		const stream = new ReadableStream<Uint8Array>({ start(controller) {
			controller.enqueue(new Uint8Array(SHARE_MAX_BYTES));
			controller.enqueue(new Uint8Array(1));
			controller.close();
		} });
		const request = new Request("http://keating.test/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: stream });
		expect(request.headers.has("content-length")).toBe(false);
		const response = await app.request(request);
		expect(response.status).toBe(413);
		expect(stored.size).toBe(0);
	});
	test("eleventh request from a client is limited with a retry time", async () => {
		for (let index = 0; index < 10; index++) expect((await send()).status).toBe(200);
		const response = await send();
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("3600");
		expect(stored.size).toBe(10);
	});
	test("daily byte quota prevents writes", async () => {
		quotaLimit = 1;
		expect((await send()).status).toBe(429);
		expect(stored.size).toBe(0);
	});
	test("write failure rolls back both byte reservations", async () => {
		failWrite = true;
		expect((await send()).status).toBe(500);
		expect(bytes.get("share-bytes-client")).toBe(0);
		expect(bytes.get("share-bytes-global")).toBe(0);
		expect(stored.size).toBe(0);
	});
	test("global quota rejection rolls back the client reservation", async () => {
		globalQuotaLimit = 1;
		expect((await send()).status).toBe(429);
		expect(bytes.get("share-bytes-client")).toBe(0);
		expect(stored.size).toBe(0);
	});
	test("unsupported content types and malformed JSON do not write", async () => {
		expect((await app.request("http://keating.test/api/share", { method: "POST", body: "{}" })).status).toBe(415);
		expect((await send("{broken")).status).toBe(400);
		expect(stored.size).toBe(0);
	});
});
