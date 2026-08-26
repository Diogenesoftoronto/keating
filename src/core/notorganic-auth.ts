import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { AuthStorage, type ApiKeyCredential } from "@earendil-works/pi-coding-agent";

import { configDir } from "./paths.js";

export const NOTORGANIC_PROVIDER_ID = "notorganic";
export const NOTORGANIC_MODEL_ID = "balanced";
export const NOTORGANIC_SCOPE = "infer:balanced";
export const NOTORGANIC_DEFAULT_ISSUER = "https://api.notorganic.info";
export const NOTORGANIC_DEFAULT_AUTHORIZATION_URL = "https://id.notorganic.info/authorize";
export const NOTORGANIC_CAPABILITY_SECONDS = 300;
export const NOTORGANIC_DEFAULT_MAX_COST_MICROUSD = 100_000;

export const NOTORGANIC_AUTH_ENV = {
  issuer: "NOTORGANIC_ISSUER",
  privateJwk: "NOTORGANIC_DPOP_PRIVATE_JWK",
  publicJwk: "NOTORGANIC_DPOP_PUBLIC_JWK",
  expiresAt: "NOTORGANIC_EXPIRES_AT",
  scope: "NOTORGANIC_SCOPE",
  tokenType: "NOTORGANIC_TOKEN_TYPE",
  maxCostMicrousd: "NOTORGANIC_MAX_COST_MICROUSD"
} as const;

const CALLBACK_PATH = "/callback";
const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const CALLBACK_VALUE_LIMIT = 2_048;
const DEFAULT_LOGIN_TIMEOUT_MS = NOTORGANIC_CAPABILITY_SECONDS * 1_000;

export interface NotOrganicLoginCallbacks {
  onAuth(info: { url: string; instructions?: string }): void;
  onProgress?(message: string): void;
  onManualCodeInput?(signal: AbortSignal): Promise<string>;
  signal?: AbortSignal;
}

export interface NotOrganicCallbackListener {
  clientId: string;
  redirectUri: string;
  wait(): Promise<string>;
  close(): Promise<void>;
}

export interface NotOrganicCallbackListenerInput {
  state: string;
  signal?: AbortSignal;
}

export type NotOrganicCallbackListenerFactory = (
  input: NotOrganicCallbackListenerInput
) => Promise<NotOrganicCallbackListener>;

export interface NotOrganicLoginOptions {
  issuer?: string;
  authorizationUrl?: string;
  fetch?: typeof globalThis.fetch;
  callbackListenerFactory?: NotOrganicCallbackListenerFactory;
  now?: () => number;
  timeoutMs?: number;
  maxCostMicrousd?: number;
}

export interface NotOrganicLoginResult {
  provider: typeof NOTORGANIC_PROVIDER_ID;
  model: typeof NOTORGANIC_MODEL_ID;
  scope: typeof NOTORGANIC_SCOPE;
  expiresAt: number;
  expiresInSeconds: typeof NOTORGANIC_CAPABILITY_SECONDS;
  authPath: string;
  message: string;
}

export interface NotOrganicAuthStatus {
  configured: boolean;
  expired: boolean;
  expiresAt?: number;
  secondsRemaining?: number;
  scope?: string;
}

interface NotOrganicTokenResponse {
  access_token: string;
  token_type: "DPoP";
  expires_in: typeof NOTORGANIC_CAPABILITY_SECONDS;
  scope: typeof NOTORGANIC_SCOPE;
}

interface P256PrivateJwk extends webcrypto.JsonWebKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  d: string;
}

interface P256PublicJwk extends webcrypto.JsonWebKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  d?: never;
}

function base64Url(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64url");
}

function jsonBase64Url(value: unknown): string {
  return base64Url(JSON.stringify(value));
}

function randomBase64Url(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

function secureHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if ((url.protocol !== "https:" && !isLoopback(url)) || url.username || url.password || url.hash) {
    throw new Error(`${label} must be HTTPS (or an HTTP loopback URL) without credentials or a fragment.`);
  }
  return url;
}

export function resolveNotOrganicIssuer(value = NOTORGANIC_DEFAULT_ISSUER): string {
  const issuer = secureHttpUrl(value, "Not Organic issuer");
  if (issuer.pathname !== "/" || issuer.search) {
    throw new Error("Not Organic issuer must be an origin without a path or query.");
  }
  return issuer.origin;
}

export function resolveNotOrganicAuthorizationUrl(
  value = NOTORGANIC_DEFAULT_AUTHORIZATION_URL
): string {
  const authorization = secureHttpUrl(value, "Not Organic authorization URL");
  if (authorization.search) {
    throw new Error("Not Organic authorization URL must not contain a query.");
  }
  return authorization.toString();
}

export function notOrganicAuthPath(cwd: string): string {
  return join(configDir(cwd), "auth.json");
}

function publicJwk(privateJwk: P256PrivateJwk): P256PublicJwk {
  return {
    kty: "EC",
    crv: "P-256",
    x: privateJwk.x,
    y: privateJwk.y
  };
}

function parsePrivateJwk(value: unknown): P256PrivateJwk {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The stored Not Organic DPoP key is invalid. Run `keating login` again.");
  }
  const candidate = value as Partial<P256PrivateJwk>;
  if (
    candidate.kty !== "EC"
    || candidate.crv !== "P-256"
    || typeof candidate.x !== "string"
    || typeof candidate.y !== "string"
    || typeof candidate.d !== "string"
    || !candidate.x
    || !candidate.y
    || !candidate.d
  ) {
    throw new Error("The stored Not Organic DPoP key is invalid. Run `keating login` again.");
  }
  return candidate as P256PrivateJwk;
}

export function parseNotOrganicPrivateJwk(value: string): P256PrivateJwk {
  try {
    return parsePrivateJwk(JSON.parse(value));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("The stored Not Organic DPoP key is invalid. Run `keating login` again.");
    }
    throw error;
  }
}

async function generateDpopKeyPair(): Promise<{
  privateJwk: P256PrivateJwk;
  publicJwk: P256PublicJwk;
}> {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = parsePrivateJwk(await webcrypto.subtle.exportKey("jwk", pair.privateKey));
  return { privateJwk, publicJwk: publicJwk(privateJwk) };
}

export async function createNotOrganicDpopProof(input: {
  privateJwk: P256PrivateJwk | string;
  accessToken: string;
  method: string;
  url: string;
  now?: () => number;
  jti?: string;
}): Promise<string> {
  const privateJwk = typeof input.privateJwk === "string"
    ? parseNotOrganicPrivateJwk(input.privateJwk)
    : parsePrivateJwk(input.privateJwk);
  if (!input.accessToken) throw new Error("A Not Organic access token is required.");
  const requestUrl = secureHttpUrl(input.url, "Not Organic request URL");
  const method = input.method.trim().toUpperCase();
  if (!method || !/^[A-Z]+$/u.test(method)) throw new Error("Not Organic request method is invalid.");

  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: publicJwk(privateJwk)
  };
  const payload = {
    htm: method,
    htu: requestUrl.toString(),
    iat: Math.floor((input.now?.() ?? Date.now()) / 1_000),
    jti: input.jti ?? randomUUID(),
    ath: await sha256Base64Url(input.accessToken)
  };
  const signingInput = `${jsonBase64Url(header)}.${jsonBase64Url(payload)}`;
  const key = await webcrypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export function notOrganicCallbackHtml(success: boolean): string {
  const heading = success ? "Keating received the callback" : "Keating could not verify this callback";
  const body = success
    ? "Return to your terminal while Keating verifies the authorization and saves it."
    : "Return to your terminal and start the login again.";
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${heading}</title><main><h1>${heading}</h1><p>${body}</p></main>`;
}

export async function createNotOrganicLoopbackListener(
  input: NotOrganicCallbackListenerInput
): Promise<NotOrganicCallbackListener> {
  let origin = "";
  let settled = false;
  let resolveCallback!: (value: string) => void;
  let rejectCallback!: (error: Error) => void;
  const callback = new Promise<string>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server: Server = createServer((request, response) => {
    if (request.method !== "GET" || !request.url) {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Method not allowed");
      return;
    }
    const callbackUrl = new URL(request.url, origin);
    if (callbackUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Not found");
      return;
    }
    const validState = callbackUrl.searchParams.get("state") === input.state;
    response.writeHead(validState ? 200 : 400, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      "x-content-type-options": "nosniff"
    });
    response.end(notOrganicCallbackHtml(validState));
    // An unrelated request must not be able to terminate an in-progress login.
    // Keep waiting for the callback carrying the unpredictable state value.
    if (!validState || settled) return;
    settled = true;
    resolveCallback(callbackUrl.toString());
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
  server.on("error", (error) => {
    if (!settled) {
      settled = true;
      rejectCallback(error);
    }
  });

  const abort = () => {
    if (!settled) {
      settled = true;
      rejectCallback(new Error("Not Organic login was cancelled."));
    }
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();

  return {
    clientId: origin,
    redirectUri: `${origin}${CALLBACK_PATH}`,
    wait: () => callback,
    close: async () => {
      input.signal?.removeEventListener("abort", abort);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

function parseCallbackParameters(
  rawValue: string,
  expectedRedirectUri: string
): URLSearchParams {
  const value = rawValue.trim();
  if (!value || value.length > CALLBACK_VALUE_LIMIT) {
    throw new Error("Paste the complete Not Organic callback URL.");
  }
  if (value.includes("://")) {
    const callback = secureHttpUrl(value, "Not Organic callback URL");
    const expected = new URL(expectedRedirectUri);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
      throw new Error("The pasted Not Organic callback does not match this login attempt.");
    }
    return callback.searchParams;
  }
  if (value.startsWith("?")) return new URLSearchParams(value.slice(1));
  const separator = value.lastIndexOf("#");
  if (separator > 0) {
    return new URLSearchParams({ code: value.slice(0, separator), state: value.slice(separator + 1) });
  }
  throw new Error("Paste the complete callback URL or a code#state value.");
}

export function parseNotOrganicCallback(input: {
  value: string;
  expectedRedirectUri: string;
  expectedState: string;
}): string {
  const params = parseCallbackParameters(input.value, input.expectedRedirectUri);
  const error = params.get("error");
  if (error) {
    const safeError = error.slice(0, 120).replace(/[^A-Za-z0-9._ -]/gu, "");
    throw new Error(`Not Organic did not approve login${safeError ? `: ${safeError}` : "."}`);
  }
  if (params.get("state") !== input.expectedState) {
    throw new Error("Not Organic returned a callback with an invalid state. Start login again.");
  }
  const code = params.get("code");
  if (!code || code.length > 512) throw new Error("Not Organic did not return a valid authorization code.");
  return code;
}

function timeoutPromise(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Not Organic login timed out. Run `keating login` to try again.")),
      timeoutMs
    );
    timeout.unref?.();
  });
}

function validateMaxCost(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Not Organic maximum cost must be a positive integer in micro-USD.");
  }
  return value;
}

async function safeTokenError(response: Response): Promise<Error> {
  let message = `Not Organic token exchange failed with HTTP ${response.status}.`;
  try {
    const body = await response.json() as { error?: { message?: unknown; code?: unknown } };
    if (typeof body.error?.code === "string" && /^[a-z0-9_]{1,80}$/u.test(body.error.code)) {
      message = `Not Organic token exchange failed (${body.error.code}).`;
    }
  } catch {
    // Keep the bounded HTTP error.
  }
  // Provider text is intentionally not surfaced: an upstream error could echo
  // the one-time code or verifier. Never turn a response body into a log line.
  return new Error(message);
}

function parseTokenResponse(value: unknown): NotOrganicTokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Not Organic returned an invalid token response.");
  }
  const token = value as Partial<NotOrganicTokenResponse>;
  if (
    typeof token.access_token !== "string"
    || token.access_token.length < 16
    || token.access_token.length > 16_384
    || token.token_type !== "DPoP"
    || token.expires_in !== NOTORGANIC_CAPABILITY_SECONDS
    || token.scope !== NOTORGANIC_SCOPE
  ) {
    throw new Error("Not Organic returned an invalid or over-broad capability.");
  }
  return token as NotOrganicTokenResponse;
}

function credentialFor(input: {
  token: NotOrganicTokenResponse;
  issuer: string;
  privateJwk: P256PrivateJwk;
  publicJwk: P256PublicJwk;
  expiresAt: number;
  maxCostMicrousd: number;
}): ApiKeyCredential {
  return {
    type: "api_key",
    key: input.token.access_token,
    env: {
      [NOTORGANIC_AUTH_ENV.issuer]: input.issuer,
      [NOTORGANIC_AUTH_ENV.privateJwk]: JSON.stringify(input.privateJwk),
      [NOTORGANIC_AUTH_ENV.publicJwk]: JSON.stringify(input.publicJwk),
      [NOTORGANIC_AUTH_ENV.expiresAt]: String(input.expiresAt),
      [NOTORGANIC_AUTH_ENV.scope]: input.token.scope,
      [NOTORGANIC_AUTH_ENV.tokenType]: input.token.token_type,
      [NOTORGANIC_AUTH_ENV.maxCostMicrousd]: String(input.maxCostMicrousd)
    }
  };
}

export async function loginNotOrganic(
  cwd: string,
  callbacks: NotOrganicLoginCallbacks,
  options: NotOrganicLoginOptions = {}
): Promise<NotOrganicLoginResult> {
  if (callbacks.signal?.aborted) throw new Error("Not Organic login was cancelled.");
  const issuer = resolveNotOrganicIssuer(options.issuer);
  const authorizationUrl = resolveNotOrganicAuthorizationUrl(options.authorizationUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const maxCostMicrousd = validateMaxCost(
    options.maxCostMicrousd ?? NOTORGANIC_DEFAULT_MAX_COST_MICROUSD
  );
  const verifier = randomBase64Url();
  if (!PKCE_PATTERN.test(verifier)) throw new Error("Keating could not create a valid PKCE verifier.");
  const state = randomBase64Url();
  const codeChallenge = await sha256Base64Url(verifier);
  const dpop = await generateDpopKeyPair();
  const listenerFactory = options.callbackListenerFactory ?? createNotOrganicLoopbackListener;
  const listener = await listenerFactory({ state, signal: callbacks.signal });
  const manualInputController = callbacks.onManualCodeInput ? new AbortController() : undefined;
  const abortManualInput = () => manualInputController?.abort();
  callbacks.signal?.addEventListener("abort", abortManualInput, { once: true });
  if (callbacks.signal?.aborted) abortManualInput();

  try {
    const clientId = secureHttpUrl(listener.clientId, "Not Organic client ID");
    const redirect = secureHttpUrl(listener.redirectUri, "Not Organic redirect URI");
    if (clientId.pathname !== "/" || clientId.search || clientId.origin !== redirect.origin) {
      throw new Error("Not Organic loopback client and callback must share one origin.");
    }
    const authorization = new URL(authorizationUrl);
    authorization.searchParams.set("response_type", "code");
    authorization.searchParams.set("client_id", clientId.origin);
    authorization.searchParams.set("redirect_uri", redirect.toString());
    authorization.searchParams.set("code_challenge", codeChallenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    authorization.searchParams.set("scope", NOTORGANIC_SCOPE);
    authorization.searchParams.set("state", state);

    callbacks.onAuth({
      url: authorization.toString(),
      instructions: "Approve the five-minute infer:balanced capability. If this terminal is remote, paste the complete callback URL here."
    });
    callbacks.onProgress?.("Waiting for Not Organic approval…");

    const callbackCandidates: Promise<string>[] = [listener.wait()];
    if (callbacks.onManualCodeInput && manualInputController) {
      callbackCandidates.push(callbacks.onManualCodeInput(manualInputController.signal));
    }
    const callbackValue = await Promise.race([
      ...callbackCandidates,
      timeoutPromise(options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS)
    ]);
    const code = parseNotOrganicCallback({
      value: callbackValue,
      expectedRedirectUri: redirect.toString(),
      expectedState: state
    });

    callbacks.onProgress?.("Exchanging the one-time authorization code…");
    const response = await fetcher(`${issuer}/v1/public/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        client_id: clientId.origin,
        redirect_uri: redirect.toString(),
        dpop_jwk: dpop.publicJwk
      }),
      signal: callbacks.signal
    });
    if (!response.ok) throw await safeTokenError(response);
    const token = parseTokenResponse(await response.json());
    const expiresAt = now() + token.expires_in * 1_000;

    // Pi's API-key credential envelope is intentional here. The public-client
    // grant has no refresh token, so storing a fabricated OAuth `refresh`
    // value would teach AuthStorage to promise a refresh the provider cannot do.
    // The file backend keeps this capability and extractable CLI DPoP key at
    // mode 0600. Existing credentials remain untouched until every check above
    // succeeds.
    await mkdir(configDir(cwd), { recursive: true, mode: 0o700 });
    const storage = AuthStorage.create(notOrganicAuthPath(cwd));
    storage.set(NOTORGANIC_PROVIDER_ID, credentialFor({
      token,
      issuer,
      privateJwk: dpop.privateJwk,
      publicJwk: dpop.publicJwk,
      expiresAt,
      maxCostMicrousd
    }));
    const storageErrors = storage.drainErrors();
    if (storageErrors.length > 0) {
      throw new Error("Keating could not securely save the Not Organic capability.");
    }

    return {
      provider: NOTORGANIC_PROVIDER_ID,
      model: NOTORGANIC_MODEL_ID,
      scope: NOTORGANIC_SCOPE,
      expiresAt,
      expiresInSeconds: NOTORGANIC_CAPABILITY_SECONDS,
      authPath: notOrganicAuthPath(cwd),
      message: "Not Organic inference is ready for this session. The DPoP-bound capability expires in 300 seconds; run `keating login` again after it expires."
    };
  } finally {
    callbacks.signal?.removeEventListener("abort", abortManualInput);
    manualInputController?.abort();
    await listener.close();
  }
}

export function notOrganicAuthStatus(
  cwd: string,
  now: () => number = Date.now
): NotOrganicAuthStatus {
  const credential = AuthStorage.create(notOrganicAuthPath(cwd)).get(NOTORGANIC_PROVIDER_ID);
  if (credential?.type !== "api_key") return { configured: false, expired: false };
  const expiresAt = Number(credential.env?.[NOTORGANIC_AUTH_ENV.expiresAt]);
  const scope = credential.env?.[NOTORGANIC_AUTH_ENV.scope];
  if (!Number.isFinite(expiresAt)) return { configured: false, expired: true, scope };
  const secondsRemaining = Math.max(0, Math.ceil((expiresAt - now()) / 1_000));
  const expired = secondsRemaining === 0;
  if (expired) {
    return { configured: false, expired: true, expiresAt, secondsRemaining, scope };
  }
  const privateJwk = credential.env?.[NOTORGANIC_AUTH_ENV.privateJwk];
  if (
    scope !== NOTORGANIC_SCOPE
    || credential.env?.[NOTORGANIC_AUTH_ENV.tokenType] !== "DPoP"
    || !privateJwk
  ) {
    return { configured: false, expired: false, expiresAt, secondsRemaining, scope };
  }
  try {
    parseNotOrganicPrivateJwk(privateJwk);
  } catch {
    return { configured: false, expired: false, expiresAt, secondsRemaining, scope };
  }
  return {
    configured: true,
    expired: false,
    expiresAt,
    secondsRemaining,
    scope
  };
}

export function logoutNotOrganic(cwd: string): boolean {
  const storage = AuthStorage.create(notOrganicAuthPath(cwd));
  const existed = storage.has(NOTORGANIC_PROVIDER_ID);
  storage.remove(NOTORGANIC_PROVIDER_ID);
  const storageErrors = storage.drainErrors();
  if (storageErrors.length > 0) {
    throw new Error("Keating could not remove the stored Not Organic capability.");
  }
  return existed;
}
