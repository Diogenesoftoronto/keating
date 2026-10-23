import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { connectLearningIntelligence, learningIntelligenceAccount, learningIntelligenceEnabled, requestAccountLearningExtraction,
  setLearningIntelligenceEnabled, subscribeLearningIntelligence } from "../keating/learning-intelligence/account";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const sessionKey = "keating.notorganic.session";
const issuer = "https://learning-extraction.test";
const request = JSON.stringify({ state: "I have an exam Friday", fields: { constraint: { type: "text" } } });
const env = {
  VITE_NOTORGANIC_PUBLIC_ISSUER: issuer,
  VITE_NOTORGANIC_AUTHORIZATION_URL: "https://account.test/authorize",
  VITE_NOTORGANIC_CLIENT_ID: "https://keating.test/client",
  VITE_NOTORGANIC_REDIRECT_URI: "https://keating.test/notorganic/callback",
};
const globalKeys = ["localStorage", "sessionStorage", "indexedDB", "fetch", "window"] as const;
let previousGlobals: Map<string, PropertyDescriptor | undefined>;
let previousEnv: Map<string, string | undefined>;
function storeSession(id = "account-a", expired = false, scope = "extraction:run") {
  localStorage.setItem(sessionKey, JSON.stringify({ id, accessToken: `${id}-access`, expiresAt: Date.now() + (expired ? -1 : 300_000), scope,
    refreshToken: `${id}-refresh`, refreshExpiresAt: Date.now() + 86_400_000 }));
}
function setFetch(handler: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  globalThis.fetch = Object.assign(handler, { preconnect: globalThis.fetch.preconnect });
}
const renewedToken = () => Response.json({ access_token: "renewed-a", token_type: "DPoP", expires_in: 300,
  refresh_token: "rotated-a", refresh_expires_in: 86_400, scope: "extraction:run" });
beforeEach(() => {
  previousGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  previousEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: new MemoryStorage() });
  }
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: new EventTarget() });
  storeSession();
});
afterEach(() => {
  for (const [key, value] of previousGlobals) {
    if (value) Object.defineProperty(globalThis, key, value);
    else Reflect.deleteProperty(globalThis, key);
  }
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
describe("account-bound learning extraction", () => {
  it("defaults to off and durably saves explicit opt-in and opt-out", () => {
    expect(learningIntelligenceEnabled()).toBe(false);
    setLearningIntelligenceEnabled(true);
    expect(learningIntelligenceEnabled()).toBe(true);
    setLearningIntelligenceEnabled(false);
    expect(learningIntelligenceEnabled()).toBe(false);
  });
  it("notifies subscribers for preferences and cross-tab authority changes", () => {
    let calls = 0;
    const unsubscribe = subscribeLearningIntelligence(() => { calls++; });
    setLearningIntelligenceEnabled(true);
    window.dispatchEvent(new Event("storage"));
    expect(calls).toBe(2);
    unsubscribe();
    setLearningIntelligenceEnabled(false);
    expect(calls).toBe(2);
  });
  it("exposes only stable issuer/session identity, never raw credentials", () => {
    const account = learningIntelligenceAccount();
    expect(account).toEqual({ scope: JSON.stringify([issuer, "account-a"]), configured: true, authorized: true });
    expect(JSON.stringify(account)).not.toContain("account-a-access");
    storeSession("account-b");
    expect(learningIntelligenceAccount().scope).not.toBe(account.scope);
  });
  it("requires an extraction capability and stable session identity", () => {
    storeSession("account-a", false, "judgement:evaluate wallet:read");
    expect(learningIntelligenceAccount().authorized).toBe(false);
    const session = JSON.parse(localStorage.getItem(sessionKey)!); delete session.id;
    session.scope = "extraction:run";
    localStorage.setItem(sessionKey, JSON.stringify(session));
    expect(learningIntelligenceAccount()).toEqual({ scope: null, configured: true, authorized: false });
  });
  it("adding extraction permission preserves existing scopes and return path", async () => {
    storeSession("account-a", false, "judgement:evaluate tabular:predict wallet:read");
    const url = new URL(await connectLearningIntelligence("/chat?settings=learning"));
    const scopes = new Set(url.searchParams.get("scope")!.split(" "));
    for (const scope of ["extraction:run", "judgement:evaluate", "tabular:predict", "wallet:read"]) expect(scopes.has(scope)).toBe(true);
    expect(url.searchParams.get("return_to")).toBe("/chat?settings=learning");
  });
  it("blocks dispatch when local opt-in has not been granted", async () => {
    let calls = 0;
    setFetch(async () => { calls++; return Response.json({}); });
    await expect(requestAccountLearningExtraction(request, learningIntelligenceAccount().scope!)).rejects.toThrow("authorization changed");
    expect(calls).toBe(0);
  });
  it("cannot dispatch under a replacement account after refresh", async () => {
    setLearningIntelligenceEnabled(true);
    storeSession("account-a", true);
    const scope = learningIntelligenceAccount().scope!, started = deferred<void>(), refresh = deferred<Response>();
    const paths: string[] = [];
    setFetch(async input => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path === "/v1/public/device/token") { started.resolve(); return refresh.promise; }
      throw new Error("A paid request escaped the account guard.");
    });
    const result = requestAccountLearningExtraction(request, scope).then(() => null, error => error as Error);
    await started.promise;
    storeSession("account-b");
    refresh.resolve(renewedToken());
    expect((await result)?.message).toContain("authorization changed");
    expect(paths).toEqual(["/v1/public/device/token"]);
    expect(JSON.parse(localStorage.getItem(sessionKey)!).id).toBe("account-b");
  });
  for (const change of ["account", "permission", "opt-out", "abort", "job"] as const) {
    it(`rechecks ${change} after DPoP signing and before paid dispatch`, async () => {
      setLearningIntelligenceEnabled(true);
      const scope = learningIntelligenceAccount().scope!, signed = deferred<void>(), release = deferred<void>();
      const sign = crypto.subtle.sign.bind(crypto.subtle);
      const signing = spyOn(crypto.subtle, "sign").mockImplementation(async (...args) => {
        signed.resolve(); await release.promise; return sign(...args);
      });
      let calls = 0, current = true;
      setFetch(async () => { calls++; throw new Error("A paid request escaped the account guard."); });
      const controller = new AbortController();
      try {
        const result = requestAccountLearningExtraction(request, scope, controller.signal, () => current).then(() => null, error => error as Error);
        await signed.promise;
        if (change === "account") storeSession("account-b");
        if (change === "permission") storeSession("account-a", false, "wallet:read");
        if (change === "opt-out") setLearningIntelligenceEnabled(false);
        if (change === "abort") controller.abort();
        if (change === "job") current = false;
        release.resolve();
        expect((await result)?.message).toContain("authorization changed");
        expect(calls).toBe(0);
      } finally { release.resolve(); signing.mockRestore(); }
    });
  }
  it("renews the same session with DPoP, idempotency, and account spending ceiling", async () => {
    setLearningIntelligenceEnabled(true);
    storeSession("account-a", true);
    const scope = learningIntelligenceAccount().scope!;
    const calls: Array<{ path: string; headers: Headers; body: unknown }> = [];
    setFetch(async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
      return path === "/v1/public/device/token" ? renewedToken() : Response.json({ ok: true });
    });
    const response = await requestAccountLearningExtraction(request, scope);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls.map(call => call.path)).toEqual(["/v1/public/device/token", "/v1/extraction"]);
    expect(calls[1]!.headers.get("authorization")).toBe("DPoP renewed-a");
    expect(calls[1]!.headers.get("dpop")?.split(".")).toHaveLength(3);
    expect(calls[1]!.headers.get("idempotency-key")).toStartWith("keating-extraction-");
    expect(Number(calls[1]!.headers.get("x-notorganic-max-cost-microusd"))).toBeGreaterThan(0);
    expect(calls[1]!.body).toEqual(JSON.parse(request));
    expect(learningIntelligenceAccount().scope).toBe(scope);
  });
});
