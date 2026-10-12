import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { connectOnlineLearning, onlineLearningAccount, onlineLearningModels, requestOnlinePredictions } from "../keating/judgement/tabular-account";
import type { OnlineDecisionRequest } from "../../../packages/learner-contracts/src/judgement/online-decision-policy";

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
const issuer = "https://tabular.test";
const request: OnlineDecisionRequest = {
  schemaVersion: 1, task: "regression", model: "v3.5_default", featureNames: ["observations"],
  trainFeatures: [[0], [1]], trainTargets: [0, 1], testFeatures: [[.5]],
};
const prediction = { model: "v3.5_default", predictions: [.6] };
const catalogue = { models: [{ id: "v3.5_default", name: "TabPFN 3.5", provider: "priorlabs", available: true, priceMicrousd: 1_000 }] };
const env = {
  VITE_NOTORGANIC_PUBLIC_ISSUER: issuer,
  VITE_NOTORGANIC_AUTHORIZATION_URL: "https://account.test/authorize",
  VITE_NOTORGANIC_CLIENT_ID: "https://keating.test/client",
  VITE_NOTORGANIC_REDIRECT_URI: "https://keating.test/notorganic/callback",
};
const globalKeys = ["localStorage", "sessionStorage", "indexedDB", "fetch"] as const;
let previousGlobals: Map<string, PropertyDescriptor | undefined>;
let previousEnv: Map<string, string | undefined>;
function session(id = "account-a", expired = false, scope = "tabular:predict") {
  return { id, accessToken: `${id}-access`, expiresAt: Date.now() + (expired ? -1 : 300_000), scope,
    refreshToken: `${id}-refresh`, refreshExpiresAt: Date.now() + 86_400_000 };
}
function storeSession(id = "account-a", expired = false, scope = "tabular:predict") {
  localStorage.setItem(sessionKey, JSON.stringify(session(id, expired, scope)));
}
function setFetch(handler: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  globalThis.fetch = Object.assign(handler, { preconnect: globalThis.fetch.preconnect });
}
const renewedToken = () => Response.json({ access_token: "renewed-a", token_type: "DPoP", expires_in: 300,
  refresh_token: "rotated-a", refresh_expires_in: 86_400, scope: "tabular:predict" });

beforeEach(() => {
  previousGlobals = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  previousEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: new MemoryStorage() });
  }
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: new IDBFactory() });
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

describe("account-bound online predictions", () => {
  it("adding tabular permission preserves existing judgement consent", async () => {
    storeSession("account-a", false, "judgement:evaluate wallet:read");
    const url = new URL(await connectOnlineLearning("/chat?settings=learning"));
    const scopes = new Set(url.searchParams.get("scope")!.split(" "));
    expect(scopes.has("tabular:predict")).toBe(true);
    expect(scopes.has("judgement:evaluate")).toBe(true);
    expect(scopes.has("wallet:read")).toBe(true);
    expect(url.searchParams.get("return_to")).toBe("/chat?settings=learning");
  });
  it("prediction rechecks the background job guard after signing, before paid dispatch", async () => {
    const scope = onlineLearningAccount().scope!, signed = deferred<void>(), release = deferred<void>();
    let current = true, requests = 0;
    const sign = crypto.subtle.sign.bind(crypto.subtle);
    const signing = spyOn(crypto.subtle, "sign").mockImplementation(async (...args) => {
      signed.resolve(); await release.promise; return sign(...args);
    });
    setFetch(async () => { requests++; return Response.json(prediction); });
    try {
      const result = requestOnlinePredictions(request, scope, undefined, () => current).then(() => null, error => error as Error);
      await signed.promise;
      current = false;
      release.resolve();
      expect((await result)?.message).toContain("authorization changed");
      expect(requests).toBe(0);
    } finally { release.resolve(); signing.mockRestore(); }
  });
  for (const operation of ["prediction", "catalogue"] as const) {
    const dispatch = (scope: string, signal?: AbortSignal) => operation === "prediction"
      ? requestOnlinePredictions(request, scope, signal) : onlineLearningModels(scope, signal);
    it(`${operation} cannot dispatch under a different account after token refresh`, async () => {
      storeSession("account-a", true);
      const scope = onlineLearningAccount().scope!;
      const started = deferred<void>(), refresh = deferred<Response>();
      const paths: string[] = [];
      setFetch(async input => {
        const path = new URL(String(input)).pathname; paths.push(path);
        if (path === "/v1/public/device/token") { started.resolve(); return refresh.promise; }
        throw new Error("A request escaped the account guard.");
      });
      const result = dispatch(scope).then(() => null, error => error as Error);
      await started.promise;
      storeSession("account-b");
      refresh.resolve(renewedToken());
      expect((await result)?.message).toContain("authorization changed");
      expect(paths).toEqual(["/v1/public/device/token"]);
      expect(JSON.parse(localStorage.getItem(sessionKey)!).id).toBe("account-b");
    });

    for (const change of ["account", "permission", "abort"] as const) {
      it(`${operation} rechecks ${change} after DPoP signing and before dispatch`, async () => {
        const scope = onlineLearningAccount().scope!;
        const signed = deferred<void>(), release = deferred<void>();
        const sign = crypto.subtle.sign.bind(crypto.subtle);
        const signing = spyOn(crypto.subtle, "sign").mockImplementation(async (...args) => {
          signed.resolve(); await release.promise; return sign(...args);
        });
        const paths: string[] = [];
        setFetch(async input => { paths.push(String(input)); throw new Error("A request escaped the account guard."); });
        const controller = new AbortController();
        try {
          const result = dispatch(scope, controller.signal).then(() => null, error => error as Error);
          await signed.promise;
          if (change === "account") storeSession("account-b");
          if (change === "permission") storeSession("account-a", false, "wallet:read");
          if (change === "abort") controller.abort();
          release.resolve();
          expect((await result)?.message).toContain("authorization changed");
          expect(paths).toEqual([]);
        } finally { release.resolve(); signing.mockRestore(); }
      });
    }

    it(`${operation} allows a normal refresh within the same signed-in session`, async () => {
      storeSession("account-a", true);
      const scope = onlineLearningAccount().scope!;
      const calls: Array<{ path: string; headers: Headers; body: unknown }> = [];
      setFetch(async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push({ path, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
        return path === "/v1/public/device/token" ? renewedToken() : Response.json(operation === "prediction" ? prediction : catalogue);
      });
      expect(await dispatch(scope)).toEqual(operation === "prediction" ? prediction : catalogue.models);
      expect(calls.map(call => call.path)).toEqual(["/v1/public/device/token", `/v1/tabular/${operation === "prediction" ? "predict" : "models"}`]);
      expect(calls[1]!.headers.get("authorization")).toBe("DPoP renewed-a");
      expect(onlineLearningAccount().scope).toBe(scope);
      if (operation === "prediction") expect(calls[1]!.body).toEqual(request);
    });
  }
});
