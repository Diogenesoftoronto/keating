import { describe, expect, test } from "bun:test";

import { createBrowserConversation } from "../src/browser-client";

describe("Flue browser boundary", () => {
  test("constructs the SDK client without network I/O", () => {
    let fetchCalls = 0;
    const client = createBrowserConversation({
      url: "https://agents.example/keating/account-123",
      authorizeRequest: async () => ({}),
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("construction must not fetch");
      },
    });

    expect(fetchCalls).toBe(0);
    expect(client.send).toBeFunction();
    expect(client.observe).toBeFunction();
    expect(client.abort).toBeFunction();
  });

  test("injects an account capability at request time", async () => {
    let authorization: string | null = null;
    let dpop: string | null = null;
    let signedMethod: string | null = null;
    let signedUrl: string | null = null;
    let contentType: string | null = null;
    const client = createBrowserConversation({
      url: "https://agents.example/keating/account-123",
      authorizeRequest: async ({ method, url }) => {
        signedMethod = method;
        signedUrl = url;
        return {
          authorization: "DPoP fresh-account-capability",
          dpop: "fresh-request-proof",
        };
      },
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        dpop = new Headers(init?.headers).get("dpop");
        contentType = new Headers(init?.headers).get("content-type");
        return new Response(
          JSON.stringify({
            name: "FlueApiError",
            message: "probe response",
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      },
    });

    await expect(
      client.send({ message: { kind: "user", body: "probe" } }),
    ).rejects.toThrow();
    expect(String(authorization)).toBe("DPoP fresh-account-capability");
    expect(String(dpop)).toBe("fresh-request-proof");
    expect(String(contentType)).toBe("application/json");
    expect(String(signedMethod)).toBe("POST");
    expect(String(signedUrl)).toBe(
      "https://agents.example/keating/account-123",
    );
  });
});
