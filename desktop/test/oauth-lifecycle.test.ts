import { describe, expect, test } from "bun:test";
import { OAUTH_CALLBACK_PROVIDERS, normalizedOAuthCallback, createOAuthCallbackAttempt, OAUTH_CALLBACK_ATTEMPT_TTL_MS, type OAuthCallbackReceiverOptions, type OAuthCallbackReceiverStartResult } from "../src/oauth-callback.js";
import { DesktopOAuthLifecycle } from "../src/oauth-lifecycle.js";
import { nativeSenderAuthorized } from "../src/native-policy.js";

const STATE = "a".repeat(43);
function fakeStart() {
  const attempts: OAuthCallbackReceiverOptions[] = [];
  let stopped = 0;
  const start = async (options: OAuthCallbackReceiverOptions): Promise<OAuthCallbackReceiverStartResult> => {
    attempts.push(options);
    return { available: true, receiver: {
      origin: "http://127.0.0.1:1455",
      configuration: { host: "127.0.0.1", port: 1455, requestTimeoutMs: 5000, headersTimeoutMs: 2000, keepAliveTimeoutMs: 1000, maxHeaderBytes: 8192 },
      stop: async () => { stopped++; },
    } };
  };
  return { attempts, start, stopped: () => stopped };
}
function callback(state = STATE) {
  return { url: new URL(`http://127.0.0.1:1455/auth/callback?code=code&state=${state}`), code: "code", state };
}

describe("desktop automatic OAuth lifecycle", () => {
  test("providers use fixed loopback routes and reject another provider's callback path", () => {
    expect(OAUTH_CALLBACK_PROVIDERS).toEqual({
      "openai-codex": { port: 1455, path: "/auth/callback" },
      anthropic: { port: 53692, path: "/callback" },
      notorganic: { port: 53693, path: "/notorganic/callback" },
    });
    for (const provider of Object.keys(OAUTH_CALLBACK_PROVIDERS) as Array<keyof typeof OAUTH_CALLBACK_PROVIDERS>) {
      const route = OAUTH_CALLBACK_PROVIDERS[provider];
      const origin = `http://127.0.0.1:${route.port}`;
      const accepted = normalizedOAuthCallback(`${route.path}?code=proof&state=${STATE}`, origin, provider);
      expect(accepted?.url.origin).toBe(origin);
      expect(accepted?.url.pathname).toBe(route.path);
      const otherPath = provider === "openai-codex" ? "/callback" : "/auth/callback";
      expect(normalizedOAuthCallback(`${otherPath}?code=proof&state=${STATE}`, origin, provider)).toBeNull();
      expect(normalizedOAuthCallback(`//attacker.example${route.path}?code=proof&state=${STATE}`, origin, provider)).toBeNull();
    }
  });
  test("prepare defaults to Codex, supports Anthropic, and rejects arbitrary providers", async () => {
    const fake = fakeStart();
    const lifecycle = new DesktopOAuthLifecycle(() => {}, fake.start);
    await lifecycle.prepare(STATE);
    expect(fake.attempts[0].provider).toBe("openai-codex");
    await lifecycle.prepare("b".repeat(43), "anthropic");
    expect(fake.attempts[1].provider).toBe("anthropic");
    expect(() => fake.attempts[0].onCallback(callback())).toThrow("cancelled");
    expect(fake.stopped()).toBe(1);
    // Simulate an untyped hostile IPC payload at the lifecycle boundary.
    await expect(lifecycle.prepare(STATE, "https://attacker.example" as "anthropic")).rejects.toThrow("Unsupported desktop OAuth provider");
    expect(fake.attempts).toHaveLength(2);
    await lifecycle.cancel();
  });
  test("wrong or empty state does not consume attempt; valid state works only once", () => {
    const accept = createOAuthCallbackAttempt(STATE);
    expect(accept("")).toBe(400);
    expect(accept("b".repeat(43))).toBe(400);
    expect(accept(STATE)).toBe(200);
    expect(accept(STATE)).toBe(410);
  });
  test("state expires after ten minutes and a fresh attempt can succeed", () => {
    let now = 0;
    const accept = createOAuthCallbackAttempt(STATE, () => now);
    now = OAUTH_CALLBACK_ATTEMPT_TTL_MS;
    expect(accept(STATE)).toBe(410);
    expect(createOAuthCallbackAttempt("b".repeat(43), () => now)("b".repeat(43))).toBe(200);
    expect(() => createOAuthCallbackAttempt("short")).toThrow("Invalid OAuth");
  });
  test("startup reserves no port, prepare delivers, cancellation revokes, and retry binds afresh", async () => {
    const fake = fakeStart();
    const seen: string[] = [];
    const lifecycle = new DesktopOAuthLifecycle(url => { seen.push(url); }, fake.start);
    expect(fake.attempts).toHaveLength(0);
    expect(await lifecycle.prepare(STATE)).toEqual({ available: true });
    await fake.attempts[0].onCallback(callback());
    expect(seen).toHaveLength(1);
    const cancelled = lifecycle.cancel();
    expect(() => fake.attempts[0].onCallback(callback())).toThrow("cancelled");
    await cancelled;
    expect(fake.stopped()).toBe(1);
    expect(await lifecycle.prepare("b".repeat(43))).toEqual({ available: true });
    expect(fake.attempts[1].expectedState).toBe("b".repeat(43));
    await lifecycle.cancel();
  });
  test("overlapping prepares arm only the latest state", async () => {
    const fake = fakeStart();
    const lifecycle = new DesktopOAuthLifecycle(() => {}, fake.start);
    const first = lifecycle.prepare(STATE);
    const second = lifecycle.prepare("b".repeat(43));
    expect(await first).toEqual({ available: false });
    expect(await second).toEqual({ available: true });
    expect(fake.attempts).toHaveLength(1);
    expect(fake.attempts[0].expectedState).toBe("b".repeat(43));
    await lifecycle.cancel();
  });
  test("cancel during pending bind stops resulting receiver and never reports ready", async () => {
    const fake = fakeStart();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const lifecycle = new DesktopOAuthLifecycle(() => {}, async (options) => {
      started();
      await waiting;
      return fake.start(options);
    });
    const preparing = lifecycle.prepare(STATE);
    await began;
    const cancelling = lifecycle.cancel();
    release();
    expect(await preparing).toEqual({ available: false });
    await cancelling;
    expect(fake.stopped()).toBe(1);
  });
  test("port failure is recoverable on the next attempt", async () => {
    const fake = fakeStart();
    let fail = true;
    const lifecycle = new DesktopOAuthLifecycle(() => {}, async options => fail
      ? { available: false, reason: "port-unavailable", action: "device-code", message: "Use device code" }
      : fake.start(options));
    expect(await lifecycle.prepare(STATE)).toEqual({ available: false });
    fail = false;
    expect(await lifecycle.prepare("b".repeat(43))).toEqual({ available: true });
    await lifecycle.cancel();
  });
  test("OAuth IPC policy rejects another window, same-origin child frames, and external navigation", () => {
    const frame = { url: "http://localhost:3000/chat" };
    const window = { webContents: { mainFrame: frame } };
    expect(nativeSenderAuthorized({ sender: window.webContents, senderFrame: frame }, window, "http://localhost:3000")).toBe(true);
    expect(nativeSenderAuthorized({ sender: {}, senderFrame: frame }, window, "http://localhost:3000")).toBe(false);
    expect(nativeSenderAuthorized({ sender: window.webContents, senderFrame: { ...frame } }, window, "http://localhost:3000")).toBe(false);
    frame.url = "https://attacker.example/";
    expect(nativeSenderAuthorized({ sender: window.webContents, senderFrame: frame }, window, "http://localhost:3000")).toBe(false);
  });
});
