import { describe, expect, test } from "bun:test";
import type { AuthCredential } from "@earendil-works/pi-coding-agent";

import {
  ProviderLoginCancelledError,
  interactiveProviderChoices,
  loginProvider,
} from "../src/runtime/provider-login.js";

function fakeProvider() {
  return {
    id: "both",
    name: "Both Auth",
    getModels: () => [{ id: "one" }, { id: "two" }],
    auth: {
      oauth: {
        name: "Subscription",
        login: async (callbacks: { notify(event: { type: "progress"; message: string }): void }) => {
          callbacks.notify({ type: "progress", message: "Waiting" });
          return { type: "oauth" as const, access: "access", refresh: "refresh", expires: 123 };
        },
      },
      apiKey: {
        name: "API key",
        login: async (callbacks: { prompt(prompt: { type: "secret"; message: string }): Promise<string> }) => ({
          type: "api_key" as const,
          key: await callbacks.prompt({ type: "secret", message: "Key" }),
        }),
      },
    },
  };
}

describe("provider login", () => {
  test("exposes the broad built-in catalog and Codex subscription login", () => {
    const providers = interactiveProviderChoices();
    const codex = providers.find((provider) => provider.id === "openai-codex");

    expect(providers.length).toBeGreaterThan(20);
    expect(codex?.methods).toEqual(["oauth"]);
    expect(codex?.methodLabels.oauth).toContain("ChatGPT");
    expect(codex?.modelCount).toBeGreaterThanOrEqual(4);
  });

  test("lists every interactive auth method and model count", () => {
    expect(interactiveProviderChoices([fakeProvider() as never])).toEqual([{
      id: "both",
      name: "Both Auth",
      modelCount: 2,
      methods: ["oauth", "api_key"],
      methodLabels: { oauth: "Subscription", api_key: "API key" },
    }]);
  });

  test("runs API-key prompts and persists the returned credential", async () => {
    const saved: Array<{ provider: string; credential: AuthCredential }> = [];
    const result = await loginProvider("/tmp/project", "both", "api_key", {
      prompt: async (prompt) => prompt.type === "secret" ? "entered-key" : undefined,
      notify: () => {},
    }, {
      providers: [fakeProvider() as never],
      saveCredential: (provider, credential) => saved.push({ provider, credential }),
    });

    expect(result.method).toBe("api_key");
    expect(saved).toEqual([{ provider: "both", credential: { type: "api_key", key: "entered-key" } }]);
  });

  test("runs OAuth events and persists subscription credentials", async () => {
    const events: string[] = [];
    const saved: AuthCredential[] = [];
    await loginProvider("/tmp/project", "both", "oauth", {
      prompt: async () => undefined,
      notify: (event) => events.push(event.type),
    }, {
      providers: [fakeProvider() as never],
      saveCredential: (_provider, credential) => saved.push(credential),
    });

    expect(events).toEqual(["progress"]);
    expect(saved).toEqual([{ type: "oauth", access: "access", refresh: "refresh", expires: 123 }]);
  });

  test("turns UI cancellation into an auth-flow cancellation", async () => {
    expect(loginProvider("/tmp/project", "both", "api_key", {
      prompt: async () => undefined,
      notify: () => {},
    }, {
      providers: [fakeProvider() as never],
      saveCredential: () => {},
    })).rejects.toBeInstanceOf(ProviderLoginCancelledError);
  });
});
