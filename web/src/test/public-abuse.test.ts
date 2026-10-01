import { afterEach, describe, expect, test } from "bun:test";
import { H3 } from "h3";
import { randomUUID } from "node:crypto";
import { MemoryPublicAbuseStore, RedisPublicAbuseStore, acquirePublicConcurrency, consumePublicRateLimit, publicClientIdentity, reservePublicQuota, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";
import { readBoundedBody } from "../../server/utils/bounded-body";

const originalRailway = process.env.RAILWAY_ENVIRONMENT_ID;
const originalRedis = process.env.KEATING_ABUSE_REDIS_URL;
afterEach(() => {
  setPublicAbuseStoreForTests();
  if (originalRailway === undefined) delete process.env.RAILWAY_ENVIRONMENT_ID; else process.env.RAILWAY_ENVIRONMENT_ID = originalRailway;
  if (originalRedis === undefined) delete process.env.KEATING_ABUSE_REDIS_URL; else process.env.KEATING_ABUSE_REDIS_URL = originalRedis;
});

test("parallel quota reservations stay atomic and rollback is idempotent", async () => {
  const store = new MemoryPublicAbuseStore();
  const results = await Promise.all(Array.from({ length: 20 }, () => store.reserve("quota", 2, 10, 60)));
  expect(results.filter(x => x.allowed)).toHaveLength(5);
  await results[0].release(); await results[0].release();
  expect((await store.reserve("quota", 2, 10, 60)).allowed).toBe(true);
  expect((await store.reserve("quota", 1, 10, 60)).allowed).toBe(false);
});

test("old-window rollback cannot reduce a new window", async () => {
  let now = 0;
  const store = new MemoryPublicAbuseStore(() => now);
  const old = await store.reserve("q", 5, 5, 1);
  now = 1001;
  expect((await store.reserve("q", 5, 5, 1)).allowed).toBe(true);
  await old.release();
  expect((await store.reserve("q", 1, 5, 1)).allowed).toBe(false);
});

test("abandoned concurrency expires and old release cannot remove a new lease", async () => {
  let now = 0;
  const store = new MemoryPublicAbuseStore(() => now);
  const first = await store.acquire("streams", 1, 1);
  expect((await store.acquire("streams", 1, 1)).allowed).toBe(false);
  now = 1001;
  const next = await store.acquire("streams", 1, 1);
  expect(next.allowed).toBe(true);
  await first.release();
  expect((await store.acquire("streams", 1, 1)).allowed).toBe(false);
  await next.release();
  expect((await store.acquire("streams", 1, 1)).allowed).toBe(true);
});

test("memory store bounds attacker-controlled key growth", async () => {
  const store = new MemoryPublicAbuseStore(Date.now, 2);
  await store.reserve("one", 1, 1, 60);
  await store.acquire("two", 1, 60);
  expect((await store.reserve("three", 1, 1, 60)).allowed).toBe(false);
});

test("Railway fails closed without shared store; ordinary reads remain unrestricted", async () => {
  process.env.RAILWAY_ENVIRONMENT_ID = "test-env";
  delete process.env.KEATING_ABUSE_REDIS_URL;
  const app = new H3().get("/", () => "welcome").post("/action", async event => {
    await consumePublicRateLimit(event, { bucket: "action", limit: 2, windowSeconds: 60 });
    return "ok";
  });
  expect((await app.request("http://test/")).status).toBe(200);
  const response = await app.request("http://test/action", { method: "POST" });
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("10");
});

test("only Railway's validated edge IP is trusted, never forwarded-for", async () => {
  const app = new H3().get("/", event => publicClientIdentity(event));
  delete process.env.RAILWAY_ENVIRONMENT_ID;
  const one = await (await app.request("http://test/", { headers: { "x-real-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2" } })).text();
  const two = await (await app.request("http://test/", { headers: { "x-real-ip": "192.0.2.3" } })).text();
  expect(one).toBe(two);
  process.env.RAILWAY_ENVIRONMENT_ID = "test-env";
  const three = await (await app.request("http://test/", { headers: { "x-real-ip": "192.0.2.1" } })).text();
  const four = await (await app.request("http://test/", { headers: { "x-real-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.5" } })).text();
  expect(three).toBe(four);
  expect(three).not.toBe(one);
  expect(three).not.toContain("192.0.2.1");
});

test("quota and concurrency rejections preserve Retry-After", async () => {
  setPublicAbuseStoreForTests(new MemoryPublicAbuseStore());
  const app = new H3().post("/quota", async () => { await reservePublicQuota({ bucket: "q", key: "global", amount: 1, limit: 1, windowSeconds: 60 }); return "ok"; })
    .post("/lease", async event => { await acquirePublicConcurrency(event, { bucket: "lease", key: "global", limit: 1, leaseSeconds: 60 }); return "ok"; });
  await app.request("http://test/quota", { method: "POST" });
  await app.request("http://test/lease", { method: "POST" });
  for (const path of ["quota", "lease"]) {
    const response = await app.request(`http://test/${path}`, { method: "POST" });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  }
});

test("bounded reader rejects lying content length and chunked overflow, and cancels slow input", async () => {
  const oversized = new Request("http://test/", { method: "POST", body: "abc", headers: { "content-length": "1000" } });
  await expect(readBoundedBody(oversized, 3)).rejects.toMatchObject({ statusCode: 413 });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request("http://test/", { method: "POST", body });
  await expect(readBoundedBody(request, 3, 20)).rejects.toMatchObject({ statusCode: 408 });
  expect(cancelled).toBe(true);
});

describe.skipIf(!process.env.KEATING_ABUSE_TEST_REDIS_URL)("real Redis across independent clients", () => {
  test("parallel rate/quota decisions and stream leases share atomic state", async () => {
    const first = new RedisPublicAbuseStore(process.env.KEATING_ABUSE_TEST_REDIS_URL!);
    const second = new RedisPublicAbuseStore(process.env.KEATING_ABUSE_TEST_REDIS_URL!);
    const key = `test:abuse:${randomUUID()}`;
    try {
      const results = await Promise.all(Array.from({ length: 30 }, (_, index) => (index % 2 ? first : second).reserve(`${key}:quota`, 1, 10, 60)));
      expect(results.filter(x => x.allowed)).toHaveLength(10);
      await results[0].release(); await results[0].release();
      expect((await second.reserve(`${key}:quota`, 1, 10, 60)).allowed).toBe(true);
      expect((await first.reserve(`${key}:quota`, 1, 10, 60)).allowed).toBe(false);
      const leases = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).acquire(`${key}:leases`, 4, 1)));
      expect(leases.filter(x => x.allowed)).toHaveLength(4);
      await Promise.all(leases.map(x => x.release()));
      const abandoned = await first.acquire(`${key}:expiry`, 1, 1);
      expect(abandoned.allowed).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect((await second.acquire(`${key}:expiry`, 1, 1)).allowed).toBe(true);
      await abandoned.release();
      expect((await first.acquire(`${key}:expiry`, 1, 1)).allowed).toBe(false);
    } finally { await first.close(); await second.close(); }
  });
});
