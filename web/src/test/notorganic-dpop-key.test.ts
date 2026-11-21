import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { NotOrganicPublicClient } from "../notorganic-provider/public-client";

class MemoryStorage { #m = new Map<string, string>(); getItem(k: string) { return this.#m.get(k) ?? null; } setItem(k: string, v: string) { this.#m.set(k, v); }
  removeItem(k: string) { this.#m.delete(k); } clear() { this.#m.clear(); } key(i: number) { return [...this.#m.keys()][i] ?? null; } get length() { return this.#m.size; } }

test("concurrent first signed requests share one device key", async () => {
  const saved = { indexedDB: globalThis.indexedDB, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true, writable: true });
  try {
    localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "access", expiresAt: Date.now() + 600_000, scope: "infer:text", id: "s" }));
    const client = new NotOrganicPublicClient({ issuer: "https://api.example.test", clientId: "https://app.example.test", redirectUri: "https://app.example.test/cb" } as never);
    const headers = await Promise.all(Array.from({ length: 6 }, () => client.headersFor("GET", "https://api.example.test/v1/wallet")));
    const keys = headers.map(h => JSON.stringify(JSON.parse(atob(h.get("dpop")!.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"))).jwk));
    expect(new Set(keys).size).toBe(1);
    // A later request still signs with the stored key.
    const later = await client.headersFor("GET", "https://api.example.test/v1/usage");
    expect(JSON.stringify(JSON.parse(atob(later.get("dpop")!.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"))).jwk)).toBe(keys[0]);
  } finally {
    for (const [name, value] of Object.entries(saved)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
});
