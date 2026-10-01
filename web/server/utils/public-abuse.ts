import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "redis";
import { createError, getRequestIP, setHeader, type H3Event } from "h3";

export interface PublicAbuseStore {
  reserve(key: string, amount: number, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number; release: () => Promise<void> }>;
  acquire(key: string, limit: number, leaseSeconds: number): Promise<{ allowed: boolean; retryAfter: number; release: () => Promise<void> }>;
}

/** Local development only. Railway uses Redis so limits survive restarts and replicas. */
export class MemoryPublicAbuseStore implements PublicAbuseStore {
  private readonly counters = new Map<string, { amount: number; expires: number; generation: string }>();
  private readonly leases = new Map<string, Map<string, number>>();
  constructor(private readonly now = Date.now, private readonly maxKeys = 20_000) {}
  private prune(): void {
    const now = this.now();
    for (const [key, counter] of this.counters) if (counter.expires <= now) this.counters.delete(key);
    for (const [key, leases] of this.leases) {
      for (const [token, until] of leases) if (until <= now) leases.delete(token);
      if (!leases.size) this.leases.delete(key);
    }
  }
  async reserve(key: string, amount: number, limit: number, windowSeconds: number) {
    this.prune();
    let entry = this.counters.get(key);
    if (!entry) {
      if (this.counters.size + this.leases.size >= this.maxKeys) return { allowed: false, retryAfter: 60, release: async () => {} };
      entry = { amount: 0, expires: this.now() + windowSeconds * 1000, generation: randomUUID() };
      this.counters.set(key, entry);
    }
    const retryAfter = Math.max(1, Math.ceil((entry.expires - this.now()) / 1000));
    if (entry.amount + amount > limit) return { allowed: false, retryAfter, release: async () => {} };
    entry.amount += amount;
    const generation = entry.generation;
    let released = false;
    return { allowed: true, retryAfter, release: async () => {
      if (released) return;
      released = true;
      const current = this.counters.get(key);
      if (current?.generation === generation) current.amount = Math.max(0, current.amount - amount);
    } };
  }
  async acquire(key: string, limit: number, leaseSeconds: number) {
    this.prune();
    let leases = this.leases.get(key);
    if (!leases) {
      if (this.counters.size + this.leases.size >= this.maxKeys) return { allowed: false, retryAfter: 60, release: async () => {} };
      leases = new Map();
      this.leases.set(key, leases);
    }
    if (leases.size >= limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((Math.min(...leases.values()) - this.now()) / 1000)), release: async () => {} };
    const token = randomUUID();
    leases.set(token, this.now() + leaseSeconds * 1000);
    return { allowed: true, retryAfter: 1, release: async () => {
      const current = this.leases.get(key);
      current?.delete(token);
      if (current?.size === 0) this.leases.delete(key);
    } };
  }
}

// Each reservation is atomic, carries a TTL, and cannot roll back a later window.
const RESERVE = `
local current = tonumber(redis.call('HGET', KEYS[1], 'amount') or '0')
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then current = 0 end
if current + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return {0, math.max(1, ttl), ''} end
if ttl < 0 then
 redis.call('HSET', KEYS[1], 'generation', ARGV[4], 'amount', 0)
 redis.call('PEXPIRE', KEYS[1], ARGV[3])
 ttl = tonumber(ARGV[3])
end
redis.call('HINCRBY', KEYS[1], 'amount', ARGV[1])
return {1, ttl, redis.call('HGET', KEYS[1], 'generation')}`;
const ROLLBACK = `
if redis.call('HGET', KEYS[1], 'generation') == ARGV[1] then
 local current = tonumber(redis.call('HGET', KEYS[1], 'amount') or '0')
 redis.call('HSET', KEYS[1], 'amount', math.max(0, current - tonumber(ARGV[2])))
end
return 1`;
const ACQUIRE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
 local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
 return {0, math.max(1, tonumber(first[2]) - now)}
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], math.max(tonumber(ARGV[2]), redis.call('PTTL', KEYS[1])))
return {1, 1}`;

export class RedisPublicAbuseStore implements PublicAbuseStore {
  private readonly client;
  private connecting?: Promise<void>;
  constructor(url: string) {
    this.client = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 2000, reconnectStrategy: retries => Math.min(1000, 100 * (retries + 1)) } });
    // Never print connection strings or raw client errors (which may include credentials).
    this.client.on("error", () => {});
  }
  private async eval(script: string, key: string, args: string[]): Promise<unknown> {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().then(() => {}).finally(() => { this.connecting = undefined; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          await this.connecting;
          if (!this.client.isReady) throw new Error("Redis unavailable");
          return this.client.eval(script, { keys: [key], arguments: args });
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Redis timeout")), 2500); timer.unref?.(); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async reserve(key: string, amount: number, limit: number, windowSeconds: number) {
    const result = await this.eval(RESERVE, key, [String(amount), String(limit), String(windowSeconds * 1000), randomUUID()]) as [number, number, string];
    let released = false;
    return { allowed: result[0] === 1, retryAfter: Math.max(1, Math.ceil(result[1] / 1000)), release: async () => {
      if (released || result[0] !== 1) return;
      released = true;
      await this.eval(ROLLBACK, key, [result[2], String(amount)]);
    } };
  }
  async acquire(key: string, limit: number, leaseSeconds: number) {
    const token = randomUUID();
    const result = await this.eval(ACQUIRE, key, [String(limit), String(leaseSeconds * 1000), token]) as [number, number];
    let released = false;
    return { allowed: result[0] === 1, retryAfter: Math.max(1, Math.ceil(result[1] / 1000)), release: async () => {
      if (released || result[0] !== 1) return;
      released = true;
      await this.eval("return redis.call('ZREM', KEYS[1], ARGV[1])", key, [token]);
    } };
  }
  async close(): Promise<void> { if (this.client.isOpen) this.client.destroy(); }
}

let store: PublicAbuseStore | undefined;
let storeConfiguration: string | undefined;
let testStore: PublicAbuseStore | undefined;
export function setPublicAbuseStoreForTests(value?: PublicAbuseStore): void { testStore = value; }
function publicStore(): PublicAbuseStore {
  if (testStore) return testStore;
  const url = process.env.KEATING_ABUSE_REDIS_URL;
  if (!url && process.env.RAILWAY_ENVIRONMENT_ID) throw unavailable();
  const configuration = url || "local";
  if (!store || storeConfiguration !== configuration) {
    store = url ? new RedisPublicAbuseStore(url) : new MemoryPublicAbuseStore();
    storeConfiguration = configuration;
  }
  return store;
}
function unavailable() {
  return createError({ statusCode: 503, statusMessage: "This action is temporarily unavailable. Please try again shortly.", headers: { "Retry-After": "10" } });
}
function exceeded(retryAfter: number) {
  return createError({ statusCode: 429, statusMessage: "Too many requests. Please try again shortly.", headers: { "Retry-After": String(retryAfter) } });
}
function scopeKey(kind: string, bucket: string, key: string): string {
  return `keating:abuse:v1:${createHash("sha256").update(`${process.env.RAILWAY_ENVIRONMENT_ID ?? "local"}:${kind}:${bucket}:${key}`).digest("hex")}`;
}
export function publicClientIdentity(event: H3Event): string {
  // Railway overwrites X-Real-IP at the edge. Never trust arbitrary forwarded chains.
  const trustEdge = Boolean(process.env.RAILWAY_ENVIRONMENT_ID) || process.env.KEATING_ABUSE_TRUST_PROXY_IP === "true";
  const edgeIp = trustEdge ? event.req.headers.get("x-real-ip")?.trim() : undefined;
  const ip = edgeIp && isIP(edgeIp) ? edgeIp : getRequestIP(event) ?? "unknown";
  return createHash("sha256").update(ip).digest("hex");
}
type RateOptions = { bucket: string; key?: string; limit: number; windowSeconds: number };
type LeaseOptions = { bucket: string; key?: string; limit: number; leaseSeconds: number };
function validLimit(amount: number, limit: number, duration: number): void {
  if (![amount, limit, duration].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid abuse limit configuration");
}
export async function reservePublicQuota(options: { bucket: string; key: string; amount: number; limit: number; windowSeconds: number }): Promise<{ release: () => Promise<void> }> {
  validLimit(options.amount, options.limit, options.windowSeconds);
  let result;
  try { result = await publicStore().reserve(scopeKey("quota", options.bucket, options.key), options.amount, options.limit, options.windowSeconds); }
  catch { throw unavailable(); }
  if (!result.allowed) throw exceeded(result.retryAfter);
  return { release: async () => { try { await result.release(); } catch { /* TTL bounds a failed rollback conservatively. */ } } };
}
export async function consumePublicRateLimit(event: H3Event, options: RateOptions): Promise<void> {
  try { await reservePublicQuota({ ...options, key: options.key ?? publicClientIdentity(event), amount: 1 }); }
  catch (error) {
    const headers = (error as { headers?: HeadersInit }).headers;
    const retry = headers ? new Headers(headers).get("Retry-After") : undefined;
    if (retry) setHeader(event, "Retry-After", retry);
    throw error;
  }
}
export async function acquirePublicConcurrency(event: H3Event, options: LeaseOptions): Promise<() => Promise<void>> {
  validLimit(1, options.limit, options.leaseSeconds);
  let result;
  try { result = await publicStore().acquire(scopeKey("concurrency", options.bucket, options.key ?? publicClientIdentity(event)), options.limit, options.leaseSeconds); }
  catch { setHeader(event, "Retry-After", "10"); throw unavailable(); }
  if (!result.allowed) { setHeader(event, "Retry-After", String(result.retryAfter)); throw exceeded(result.retryAfter); }
  return async () => { try { await result.release(); } catch { /* The lease expires if the connection is lost. */ } };
}
