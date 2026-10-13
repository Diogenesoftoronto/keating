import { buildHealthChecks } from "../lib/diagnostics-insights";
import { describe, expect, test } from "bun:test";
import { readConnectedProviders, type ProviderConnectionReaders } from "../lib/provider-connection";

function readers(hostedSession: ProviderConnectionReaders["hostedSession"]): ProviderConnectionReaders {
  return { hostedSession, apiKey: async () => undefined, oauth: async () => null };
}

describe("provider credential availability", () => {
  test("a current hosted session is connected without an API key or legacy OAuth entry", async () => {
    const connected = await readConnectedProviders(["notorganic", "openai"], readers(async () => ({ accessToken: "test-only" })));
    expect([...connected]).toEqual(["notorganic"]);
  });

  test("signout and expired hosted credentials cannot fall back to a legacy key", async () => {
    for (const hostedSession of [async () => null, async () => { throw new Error("Session expired"); }]) {
      const connected = await readConnectedProviders(["notorganic"], {
        ...readers(hostedSession), apiKey: async () => "legacy-test-key", oauth: async () => ({ legacy: true }),
      });
      expect(connected.size).toBe(0);
    }
  });

  test("ordinary provider keys and OAuth keep their existing connection behavior", async () => {
    const connected = await readConnectedProviders(["openai", "anthropic", "google"], {
      ...readers(async () => null),
      apiKey: async provider => provider === "openai" ? "test-key" : undefined,
      oauth: async provider => provider === "anthropic" ? { subscription: true } : null,
    });
    expect(connected.has("openai")).toBe(true);
    expect(connected.has("anthropic")).toBe(true);
    expect(connected.has("google")).toBe(false);
  });
});

test("hosted connection is available while an unrelated local credential read is pending", async () => {
  let finish!: (value: string | null) => void;
  const pending = new Promise<string | null>(resolve => { finish = resolve; });
  const updates: Set<string>[] = [];
  const result = readConnectedProviders(["openai", "notorganic"], {
    hostedSession: async () => ({ accessToken: "test-only" }),
    apiKey: async () => pending,
    oauth: async () => null,
  }, connected => updates.push(connected));
  await Promise.resolve(); await Promise.resolve();
  expect(updates[0]?.has("notorganic")).toBe(true);
  finish(null);
  expect((await result).has("notorganic")).toBe(true);
});

test("health distinguishes pending access from verified absence", () => {
  const runtime = { appVersion: "test", pathname: "/chat", online: true, userAgent: "test", platform: "test", serviceWorkerAvailable: false, serviceWorkerControlled: false, localStorageAvailable: true, indexedDbAvailable: true };
  const provider = (count: number | null) => buildHealthChecks({ runtime, entries: [], connectedProviderCount: count }).find(check => check.id === "provider")!;
  expect(provider(null).detail).toBe("Checking model access…");
  expect(provider(null).fix).toBeUndefined();
  expect(provider(0).status).toBe("problem");
  expect(provider(1).status).toBe("ok");
});
