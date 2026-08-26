import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID, webcrypto } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthStorage } from "@earendil-works/pi-coding-agent";

import { DEFAULT_KEATING_CONFIG } from "../src/core/config.js";
import { providerIsConfigured } from "../src/core/provider-auth.js";
import {
  createNotOrganicDpopProof,
  loginNotOrganic,
  logoutNotOrganic,
  NOTORGANIC_AUTH_ENV,
  NOTORGANIC_CAPABILITY_SECONDS,
  NOTORGANIC_MODEL_ID,
  NOTORGANIC_PROVIDER_ID,
  NOTORGANIC_SCOPE,
  notOrganicAuthPath,
  notOrganicAuthStatus,
  notOrganicCallbackHtml,
  parseNotOrganicCallback,
  resolveNotOrganicAuthorizationUrl,
  resolveNotOrganicIssuer,
  type NotOrganicCallbackListenerFactory
} from "../src/core/notorganic-auth.js";
import {
  createNotOrganicProviderConfig,
  createNotOrganicRequestHeaders,
  NOTORGANIC_BALANCED_MODEL,
  NOTORGANIC_LIVE_ACCEPTANCE_VERIFIED,
  NOTORGANIC_PI_API,
  notOrganicChatCompletionsUrl,
  streamNotOrganic
} from "../src/pi/notorganic-provider.js";
import registerNotOrganicProvider from "../src/pi/notorganic-provider-extension.js";
import { selectAuthenticatedProvider } from "../src/runtime/pi.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "keating-notorganic-"));
  temporaryDirectories.push(path);
  return path;
}

function listenerFactory(input: {
  onState?(state: string): void;
  callback?: (state: string, redirectUri: string) => string | Promise<string>;
  never?: boolean;
} = {}): NotOrganicCallbackListenerFactory {
  return async ({ state }) => {
    input.onState?.(state);
    const clientId = "http://127.0.0.1:43119";
    const redirectUri = `${clientId}/callback`;
    return {
      clientId,
      redirectUri,
      wait: input.never
        ? () => new Promise<string>(() => undefined)
        : async () => input.callback?.(state, redirectUri)
          ?? `${redirectUri}?code=one-time-code&state=${encodeURIComponent(state)}`,
      close: async () => undefined
    };
  };
}

function successfulTokenResponse(): Response {
  return Response.json({
    access_token: "capability-token-long-enough",
    token_type: "DPoP",
    expires_in: NOTORGANIC_CAPABILITY_SECONDS,
    scope: NOTORGANIC_SCOPE
  });
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function privateJwk(): Promise<Record<string, unknown>> {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  return await webcrypto.subtle.exportKey("jwk", pair.privateKey) as Record<string, unknown>;
}

describe("Not Organic CLI public-client login", () => {
  test("uses loopback PKCE S256, exact narrow scope, and a JSON public-token exchange", async () => {
    const cwd = await temporaryProject();
    let authorizationUrl = "";
    let exchangeUrl = "";
    let exchangeBody: Record<string, unknown> = {};
    const now = 1_700_000_000_000;

    const result = await loginNotOrganic(cwd, {
      onAuth: ({ url }) => { authorizationUrl = url; }
    }, {
      issuer: "https://gateway.test",
      authorizationUrl: "https://portal.test/authorize",
      callbackListenerFactory: listenerFactory(),
      now: () => now,
      fetch: (async (input, init) => {
        exchangeUrl = String(input);
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
        exchangeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return successfulTokenResponse();
      }) as typeof fetch
    });

    const authorization = new URL(authorizationUrl);
    expect(authorization.origin).toBe("https://portal.test");
    expect(authorization.pathname).toBe("/authorize");
    expect(authorization.searchParams.get("response_type")).toBe("code");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get("scope")).toBe("infer:balanced");
    expect(authorization.searchParams.get("client_id")).toBe("http://127.0.0.1:43119");
    expect(authorization.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43119/callback");
    expect(exchangeUrl).toBe("https://gateway.test/v1/public/token");
    expect(exchangeBody).toMatchObject({
      code: "one-time-code",
      client_id: "http://127.0.0.1:43119",
      redirect_uri: "http://127.0.0.1:43119/callback"
    });
    expect(exchangeBody.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(exchangeBody.dpop_jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect((exchangeBody.dpop_jwk as Record<string, unknown>).d).toBeUndefined();
    expect(result).toMatchObject({
      provider: "notorganic",
      model: "balanced",
      scope: "infer:balanced",
      expiresAt: now + 300_000,
      expiresInSeconds: 300
    });
    expect(result.message).toContain("expires in 300 seconds");
    expect(result.message).toContain("DPoP-bound capability");
    expect(result.message).not.toContain("device-bound");
    expect(JSON.stringify(result)).not.toContain("capability-token");
    expect(JSON.stringify(result)).not.toContain("DPOP_PRIVATE");
  });

  test("persists the DPoP-bound capability in Pi AuthStorage with mode 0600 and no fake refresh", async () => {
    const cwd = await temporaryProject();
    await loginNotOrganic(cwd, { onAuth: () => undefined }, {
      issuer: "https://gateway.test",
      authorizationUrl: "https://portal.test/authorize",
      callbackListenerFactory: listenerFactory(),
      fetch: (async () => successfulTokenResponse()) as typeof fetch,
      now: () => 10_000
    });

    const path = notOrganicAuthPath(cwd);
    const document = JSON.parse(await readFile(path, "utf8")) as Record<string, Record<string, unknown>>;
    const credential = document.notorganic;
    expect(credential.type).toBe("api_key");
    expect(credential.key).toBe("capability-token-long-enough");
    expect(credential.refresh).toBeUndefined();
    const env = credential.env as Record<string, string>;
    expect(env[NOTORGANIC_AUTH_ENV.scope]).toBe("infer:balanced");
    expect(env[NOTORGANIC_AUTH_ENV.tokenType]).toBe("DPoP");
    const storedPrivateJwk = JSON.parse(env[NOTORGANIC_AUTH_ENV.privateJwk]!) as Record<string, unknown>;
    expect(storedPrivateJwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(typeof storedPrivateJwk.d).toBe("string");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("keeps the previous credential when callback or exchange validation fails", async () => {
    const cwd = await temporaryProject();
    const storage = AuthStorage.create(notOrganicAuthPath(cwd));
    storage.set(NOTORGANIC_PROVIDER_ID, { type: "api_key", key: "existing-capability" });

    await expect(loginNotOrganic(cwd, { onAuth: () => undefined }, {
      issuer: "https://gateway.test",
      authorizationUrl: "https://portal.test/authorize",
      callbackListenerFactory: listenerFactory(),
      fetch: (async () => Response.json({
        error: { message: "authorization code rejected", code: "invalid_authorization_code" }
      }, { status: 401 })) as typeof fetch
    })).rejects.toThrow("invalid_authorization_code");

    const persisted = JSON.parse(await readFile(notOrganicAuthPath(cwd), "utf8")) as Record<string, { key?: string }>;
    expect(persisted.notorganic?.key).toBe("existing-capability");
  });

  test("supports headless login by racing a manually pasted callback", async () => {
    const cwd = await temporaryProject();
    let expectedState = "";
    await loginNotOrganic(cwd, {
      onAuth: () => undefined,
      onManualCodeInput: async () => `manual-code#${expectedState}`
    }, {
      issuer: "https://gateway.test",
      authorizationUrl: "https://portal.test/authorize",
      callbackListenerFactory: listenerFactory({
        never: true,
        onState: (state) => { expectedState = state; }
      }),
      fetch: (async (_input, init) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({ code: "manual-code" });
        return successfulTokenResponse();
      }) as typeof fetch
    });
    expect(notOrganicAuthStatus(cwd).configured).toBe(true);
  });

  test("cancels a losing manual input reader when the loopback callback wins", async () => {
    const cwd = await temporaryProject();
    let manualInputAborted = false;
    await loginNotOrganic(cwd, {
      onAuth: () => undefined,
      onManualCodeInput: async (signal) => await new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          manualInputAborted = true;
          reject(new Error("manual input cancelled"));
        }, { once: true });
      })
    }, {
      issuer: "https://gateway.test",
      authorizationUrl: "https://portal.test/authorize",
      callbackListenerFactory: listenerFactory(),
      fetch: (async () => successfulTokenResponse()) as typeof fetch
    });

    expect(manualInputAborted).toBe(true);
  });

  test("logout removes only Not Organic credentials", async () => {
    const cwd = await temporaryProject();
    const storage = AuthStorage.create(notOrganicAuthPath(cwd));
    storage.set("openai", { type: "api_key", key: "other-provider" });
    storage.set(NOTORGANIC_PROVIDER_ID, { type: "api_key", key: "notorganic-capability" });
    expect(logoutNotOrganic(cwd)).toBe(true);
    expect(logoutNotOrganic(cwd)).toBe(false);
    const after = JSON.parse(await readFile(notOrganicAuthPath(cwd), "utf8")) as Record<string, unknown>;
    expect(after.openai).toBeDefined();
    expect(after.notorganic).toBeUndefined();
  });

  test("does not report an expired stored capability as configured", async () => {
    const cwd = await temporaryProject();
    const storage = AuthStorage.create(notOrganicAuthPath(cwd));
    storage.set(NOTORGANIC_PROVIDER_ID, {
      type: "api_key",
      key: "expired-capability",
      env: {
        [NOTORGANIC_AUTH_ENV.expiresAt]: "1000",
        [NOTORGANIC_AUTH_ENV.scope]: NOTORGANIC_SCOPE
      }
    });
    expect(notOrganicAuthStatus(cwd, () => 2_000)).toMatchObject({
      configured: false,
      expired: true,
      secondsRemaining: 0
    });
    expect(providerIsConfigured(cwd, {}, NOTORGANIC_PROVIDER_ID)).toBe(false);
  });

  test("selects an active Not Organic capability as the hosted fallback", async () => {
    const cwd = await temporaryProject();
    const jwk = await privateJwk();
    const storage = AuthStorage.create(notOrganicAuthPath(cwd));
    storage.set(NOTORGANIC_PROVIDER_ID, {
      type: "api_key",
      key: "active-capability",
      env: {
        [NOTORGANIC_AUTH_ENV.expiresAt]: String(Date.now() + 60_000),
        [NOTORGANIC_AUTH_ENV.scope]: NOTORGANIC_SCOPE,
        [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP",
        [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(jwk)
      }
    });
    const selection = selectAuthenticatedProvider(cwd, {
      ...DEFAULT_KEATING_CONFIG,
      pi: {
        ...DEFAULT_KEATING_CONFIG.pi,
        defaultProvider: "unconfigured-test-provider",
        defaultModel: "unconfigured-model"
      }
    }, []);
    expect(selection).toMatchObject({ provider: "notorganic", model: "balanced" });
  });
});

describe("Not Organic DPoP and provider contract", () => {
  test("signs RFC9449-style proofs with exact request claims, ath, and fresh jti", async () => {
    const jwk = await privateJwk();
    const input = {
      privateJwk: JSON.stringify(jwk),
      accessToken: "the-access-token",
      method: "POST",
      url: "https://gateway.test/v1/chat/completions",
      now: () => 1_700_000_123_000
    };
    const proof = await createNotOrganicDpopProof(input);
    const second = await createNotOrganicDpopProof(input);
    const [encodedHeader, encodedPayload, encodedSignature] = proof.split(".");
    const header = decodeJwtPart(encodedHeader!);
    const payload = decodeJwtPart(encodedPayload!);
    const secondPayload = decodeJwtPart(second.split(".")[1]!);
    expect(header).toMatchObject({ typ: "dpop+jwt", alg: "ES256" });
    expect(header.jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect((header.jwk as Record<string, unknown>).d).toBeUndefined();
    expect(payload).toMatchObject({
      htm: "POST",
      htu: "https://gateway.test/v1/chat/completions",
      iat: 1_700_000_123
    });
    const expectedAth = Buffer.from(await webcrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("the-access-token")
    )).toString("base64url");
    expect(payload.ath).toBe(expectedAth);
    expect(payload.jti).not.toBe(secondPayload.jti);

    const verificationKey = await webcrypto.subtle.importKey(
      "jwk",
      header.jwk as webcrypto.JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    expect(await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verificationKey,
      Buffer.from(encodedSignature!, "base64url"),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    )).toBe(true);
  });

  test("builds DPoP, idempotency, and max-cost headers and fails closed after expiry", async () => {
    const jwk = await privateJwk();
    const now = 50_000;
    const env = {
      [NOTORGANIC_AUTH_ENV.issuer]: "https://gateway.test",
      [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(jwk),
      [NOTORGANIC_AUTH_ENV.expiresAt]: String(now + 300_000),
      [NOTORGANIC_AUTH_ENV.scope]: NOTORGANIC_SCOPE,
      [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP",
      [NOTORGANIC_AUTH_ENV.maxCostMicrousd]: "75000"
    };
    const headers = await createNotOrganicRequestHeaders({
      accessToken: "capability",
      env,
      url: "https://gateway.test/v1/chat/completions",
      now: () => now,
      jti: randomUUID(),
      idempotencyKey: "idem-test"
    });
    expect(headers.authorization).toBe("DPoP capability");
    expect(headers.dpop.split(".")).toHaveLength(3);
    expect(headers["idempotency-key"]).toBe("idem-test");
    expect(headers["x-notorganic-max-cost-microusd"]).toBe("75000");

    await expect(createNotOrganicRequestHeaders({
      accessToken: "capability",
      env: { ...env, [NOTORGANIC_AUTH_ENV.expiresAt]: String(now) },
      url: "https://gateway.test/v1/chat/completions",
      now: () => now
    })).rejects.toThrow("five-minute Not Organic capability expired");
  });

  test("preserves the registered Not Organic API on streamed response messages", async () => {
    const originalFetch = globalThis.fetch;
    let requestHeaders: Headers | undefined;
    let requestUrl = "";
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requestUrl = request.url;
      requestHeaders = request.headers;
      const chunks = [
        {
          id: "cmpl_keating_1",
          model: NOTORGANIC_MODEL_ID,
          choices: [{ index: 0, delta: { role: "assistant", content: "A careful answer." }, finish_reason: null }]
        },
        {
          id: "cmpl_keating_1",
          model: NOTORGANIC_MODEL_ID,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
        }
      ];
      return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" }
      });
    }) as typeof fetch;

    try {
      const jwk = await privateJwk();
      const now = Date.now();
      const provider = createNotOrganicProviderConfig("https://gateway.test");
      const registeredModel = {
        ...provider.models![0]!,
        provider: NOTORGANIC_PROVIDER_ID,
        baseUrl: provider.baseUrl!
      };
      const stream = streamNotOrganic(registeredModel as never, {
        messages: [{ role: "user", content: "Explain the hinge.", timestamp: now }]
      }, {
        apiKey: "capability-token",
        env: {
          [NOTORGANIC_AUTH_ENV.issuer]: "https://gateway.test",
          [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(jwk),
          [NOTORGANIC_AUTH_ENV.expiresAt]: String(now + 60_000),
          [NOTORGANIC_AUTH_ENV.scope]: NOTORGANIC_SCOPE,
          [NOTORGANIC_AUTH_ENV.tokenType]: "DPoP",
          [NOTORGANIC_AUTH_ENV.maxCostMicrousd]: "100000"
        }
      });
      const events = [];
      for await (const event of stream) events.push(event);
      const done = events.find((event) => event.type === "done");

      expect(requestUrl).toBe("https://gateway.test/v1/chat/completions");
      expect(requestHeaders?.get("authorization")).toBe("DPoP capability-token");
      expect(requestHeaders?.get("dpop")?.split(".")).toHaveLength(3);
      expect(requestHeaders?.get("idempotency-key")).toMatch(/^keating_/);
      expect(requestHeaders?.get("x-notorganic-max-cost-microusd")).toBe("100000");
      expect(done?.type === "done" ? done.message.api : undefined).toBe(NOTORGANIC_PI_API);
      expect(events.every((event) => !("partial" in event) || event.partial.api === NOTORGANIC_PI_API)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("registers only the balanced alias with truthful metadata", () => {
    const config = createNotOrganicProviderConfig("https://gateway.test");
    expect(config).toMatchObject({
      name: "Not Organic Hosted",
      baseUrl: "https://gateway.test/v1",
      apiKey: "$NOTORGANIC_ACCESS_TOKEN",
      api: NOTORGANIC_PI_API
    });
    expect(config.models).toHaveLength(1);
    expect(config.models?.[0]).toMatchObject({
      id: NOTORGANIC_MODEL_ID,
      name: "Not Organic Balanced",
      reasoning: true,
      contextWindow: 256_000,
      maxTokens: 16_384
    });
    expect(NOTORGANIC_BALANCED_MODEL.input).toEqual(["text"]);
    expect(typeof config.streamSimple).toBe("function");
    expect(notOrganicChatCompletionsUrl("https://gateway.test")).toBe(
      "https://gateway.test/v1/chat/completions"
    );
    expect(NOTORGANIC_LIVE_ACCEPTANCE_VERIFIED).toBe(false);
  });

  test("registers the provider through the standalone extension entrypoint", () => {
    let registered: { name: string; config: unknown } | undefined;
    registerNotOrganicProvider({
      registerProvider(name: string, config: unknown) {
        registered = { name, config };
      }
    } as never);
    expect(registered?.name).toBe("notorganic");
    expect(registered?.config).toMatchObject({ baseUrl: "https://api.notorganic.info/v1" });
  });
});

describe("Not Organic input validation", () => {
  test("requires secure origins and exact callback state", () => {
    expect(resolveNotOrganicIssuer()).toBe("https://api.notorganic.info");
    expect(resolveNotOrganicAuthorizationUrl()).toBe("https://id.notorganic.info/authorize");
    expect(() => resolveNotOrganicIssuer("http://gateway.example")).toThrow("HTTPS");
    expect(() => resolveNotOrganicIssuer("https://gateway.test/v1")).toThrow("origin");
    expect(() => resolveNotOrganicIssuer("https://gateway.test?token=secret")).toThrow("origin");
    expect(() => resolveNotOrganicAuthorizationUrl("https://user:pass@portal.test/authorize")).toThrow("without credentials");
    expect(() => parseNotOrganicCallback({
      value: "http://127.0.0.1:43119/callback?code=code&state=wrong",
      expectedRedirectUri: "http://127.0.0.1:43119/callback",
      expectedState: "right"
    })).toThrow("invalid state");
    expect(() => parseNotOrganicCallback({
      value: "bare-code",
      expectedRedirectUri: "http://127.0.0.1:43119/callback",
      expectedState: "right"
    })).toThrow("complete callback URL");
  });

  test("uses pending callback copy until token exchange and persistence finish", () => {
    expect(notOrganicCallbackHtml(true)).toContain("received the callback");
    expect(notOrganicCallbackHtml(true)).toContain("verifies the authorization");
    expect(notOrganicCallbackHtml(true)).not.toContain("is connected");
  });
});

describe("Not Organic CLI argument safety", () => {
  const cliEntry = join(process.cwd(), "src", "cli", "main.ts");

  function runCli(cwd: string, ...args: string[]) {
    return spawnSync(process.execPath, [cliEntry, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" }
    });
  }

  test("login and logout help are side-effect free", async () => {
    const cwd = await temporaryProject();
    const loginHelp = runCli(cwd, "login", "--help");
    const logoutHelp = runCli(cwd, "logout", "--help");

    expect(loginHelp.status).toBe(0);
    expect(loginHelp.stdout).toContain("Usage: keating login");
    expect(logoutHelp.status).toBe(0);
    expect(logoutHelp.stdout).toContain("Usage: keating logout");
    expect(existsSync(notOrganicAuthPath(cwd))).toBe(false);
  });

  test("logout rejects status and unknown flags without touching auth storage", async () => {
    const cwd = await temporaryProject();
    const statusWord = runCli(cwd, "logout", "status");
    const statusFlag = runCli(cwd, "logout", "--status");

    expect(statusWord.status).toBe(1);
    expect(statusWord.stderr).toContain("Unsupported logout provider: status");
    expect(statusFlag.status).toBe(1);
    expect(statusFlag.stderr).toContain("Unknown logout option: --status");
    expect(existsSync(notOrganicAuthPath(cwd))).toBe(false);
  });

  test("login rejects unknown options without starting authorization", async () => {
    const cwd = await temporaryProject();
    const result = runCli(cwd, "login", "--definitely-not-a-login-option");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown login option");
    expect(result.stdout).not.toContain("https://id.notorganic.info/authorize");
    expect(existsSync(notOrganicAuthPath(cwd))).toBe(false);
  });
});
