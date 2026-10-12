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
