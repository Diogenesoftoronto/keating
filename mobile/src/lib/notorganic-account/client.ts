import { SPENDING_LIMITS, DEFAULT_MODELS } from "@keating/runtime-config";
import type {
  NotOrganicAccountConfig,
  NotOrganicAccountResponse,
  NotOrganicAccountSnapshot,
  NotOrganicDeviceSession,
  NotOrganicTokenResponse,
} from "./contracts";
import { defaultNotOrganicAccountConfig } from "./contracts";
import { deviceSessionGeneration, loadDeviceSession, saveDeviceSessionIfCurrent } from "./credentials";
import { randomBase64Url } from "./crypto";
import { createDpopProof, getDevicePublicJwk } from "./dpop";
import type { OnlineDecisionRequest } from "../../../../packages/learner-contracts/src/judgement/online-decision-policy";

export type AccountFetch = typeof fetch;
let accountFetch: AccountFetch = globalThis.fetch.bind(globalThis);
let refreshInFlight: Promise<NotOrganicDeviceSession> | null = null;

/** Isolated knowledge transport: never dispatch or release content after account/selection changes. */
export async function guardedKnowledgeRequest<T>(path: string, init: RequestInit, current: () => boolean, expected: { accountId: string; generation: number }, config = defaultNotOrganicAccountConfig()): Promise<T> {
  const session = await loadDeviceSession();
  const valid = () => current() && !init.signal?.aborted && deviceSessionGeneration() === expected.generation;
  if (!valid() || !session || session.accountId !== expected.accountId || session.issuer !== config.issuer || session.accessExpiresAt <= Date.now()) throw Error("The knowledge account changed.");
  const url = `${config.issuer}/v1/knowledge/${path}`;
  const method = (init.method ?? "GET").toUpperCase();
  const proof = await createDpopProof({ url, method, boundToken: session.accessToken });
  if (!valid()) throw Error("The knowledge account changed.");
  const headers = new Headers(init.headers);
  headers.set("authorization", `DPoP ${session.accessToken}`); headers.set("dpop", proof);
  const response = await accountFetch(url, { ...init, method, headers, redirect: "error" });
  const result = await parseResponse<T>(response);
  if (!valid()) throw Error("The knowledge account changed. Returned content was discarded.");
  return result;
}

export function setAccountFetchForTests(next: AccountFetch | null): void {
  accountFetch = next ?? globalThis.fetch.bind(globalThis);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as ({ error?: { message?: string } } & T) | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `Not Organic request failed (${response.status}).`);
  return body as T;
}

function tokenSession(token: NotOrganicTokenResponse, issuer: string | undefined, now = Date.now()): NotOrganicDeviceSession {
  if (!token.refresh_token || token.token_type !== "DPoP") throw new Error("Not Organic did not issue a mobile device session.");
  return {
    ...(issuer ? { issuer } : {}),
    accessToken: token.access_token,
    accessExpiresAt: now + token.expires_in * 1_000,
    refreshToken: token.refresh_token,
    refreshExpiresAt: now + token.refresh_expires_in * 1_000,
    scope: token.scope,
  };
}

export async function exchangeAuthorizationCode(input: { code: string; verifier: string; deviceName?: string; config?: NotOrganicAccountConfig }): Promise<NotOrganicDeviceSession> {
  const generation = deviceSessionGeneration();
  const config = input.config ?? defaultNotOrganicAccountConfig();
  const response = await accountFetch(`${config.issuer}/v1/public/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: input.code,
      code_verifier: input.verifier,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      dpop_jwk: await getDevicePublicJwk(),
      device_session: true,
      device_name: input.deviceName ?? "Keating mobile",
    }),
  });
  const session = tokenSession(await parseResponse<NotOrganicTokenResponse>(response), config.issuer);
  await saveDeviceSessionIfCurrent(session, generation);
  return session;
}

export async function refreshDeviceSession(config = defaultNotOrganicAccountConfig()): Promise<NotOrganicDeviceSession> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const generation = deviceSessionGeneration();
    const current = await loadDeviceSession();
    if (!current || current.refreshExpiresAt <= Date.now()) throw new Error("Your Not Organic login has expired. Sign in again.");
    if (current.issuer && current.issuer !== config.issuer) throw new Error("Sign in to the configured Not Organic account service.");
    const url = `${config.issuer}/v1/public/device/token`;
    const response = await accountFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", dpop: await createDpopProof({ url, method: "POST", boundToken: current.refreshToken }) },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: current.refreshToken }),
    });
    const next = tokenSession(await parseResponse<NotOrganicTokenResponse>(response), current.issuer);
    next.accountId = current.accountId;
    await saveDeviceSessionIfCurrent(next, generation);
    return next;
  })();
  try { return await refreshInFlight; } finally { refreshInFlight = null; }
}

export async function activeDeviceSession(config = defaultNotOrganicAccountConfig()): Promise<NotOrganicDeviceSession> {
  const session = await loadDeviceSession();
  if (!session) throw new Error("Sign in to your Not Organic account.");
  if (session.accessExpiresAt > Date.now() + 15_000) return session;
  return refreshDeviceSession(config);
}

export async function notOrganicAccountRequest<T>(path: string, init: RequestInit = {}, config = defaultNotOrganicAccountConfig()): Promise<T> {
  const session = await activeDeviceSession(config);
  const url = `${config.issuer}${path.startsWith("/") ? path : `/${path}`}`;
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("authorization", `DPoP ${session.accessToken}`);
  headers.set("dpop", await createDpopProof({ url, method, boundToken: session.accessToken }));
  const response = await accountFetch(url, { ...init, method, headers });
  return parseResponse<T>(response);
}

/** Headers proving the current mobile account to another Keating service. */
export async function notOrganicAccountCapabilityHeaders(
  providerPath = "/v1/account",
  method = "GET",
  config = defaultNotOrganicAccountConfig(),
): Promise<Headers> {
  const session = await activeDeviceSession(config);
  const providerUrl = `${config.issuer}${providerPath.startsWith("/") ? providerPath : `/${providerPath}`}`;
  const headers = new Headers();
  headers.set("authorization", `DPoP ${session.accessToken}`);
  headers.set("x-notorganic-dpop", await createDpopProof({ url: providerUrl, method, boundToken: session.accessToken }));
  return headers;
}

export async function loadAccountSnapshot(config = defaultNotOrganicAccountConfig()): Promise<NotOrganicAccountSnapshot> {
  const accountGeneration = deviceSessionGeneration();
  const response = await notOrganicAccountRequest<NotOrganicAccountResponse>("/v1/account", {}, config);
  const account = response?.account;
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    throw new Error("Not Organic did not return an account record.");
  }
  const session = await loadDeviceSession();
  if (session && accountGeneration === deviceSessionGeneration()) {
    session.accountId = typeof account.did === "string" ? account.did : typeof account.id === "string" ? account.id : session.accountId;
    await saveDeviceSessionIfCurrent(session, accountGeneration);
  }
  return account;
}

export async function revokeDeviceSession(config = defaultNotOrganicAccountConfig()): Promise<void> {
  const session = await loadDeviceSession();
  if (!session) return;
  const url = `${config.issuer}/v1/public/device/revoke`;
  await accountFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", dpop: await createDpopProof({ url, method: "POST", boundToken: session.refreshToken }) },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  }).catch(() => null);
}

/** First-party judgement only. Older or differently issued sessions cannot be forwarded. */
export async function notOrganicJudgementRequest(
  body: string, signal?: AbortSignal, config = defaultNotOrganicAccountConfig(),
): Promise<Response> {
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash
    || issuer.pathname !== "/") throw new Error("Judgement account configuration is invalid.");
  const stored = await loadDeviceSession();
  if (stored?.issuer !== config.issuer || !stored.scope.split(/\s+/).includes("judgement:evaluate")) {
    return new Response(null, { status: 403 });
  }
  const session = await activeDeviceSession(config);
  if (signal?.aborted || session.issuer !== config.issuer || !session.scope.split(/\s+/).includes("judgement:evaluate")
    || !Number.isFinite(session.accessExpiresAt) || session.accessExpiresAt <= Date.now()) return new Response(null, { status: 403 });
  const generation = deviceSessionGeneration();
  const url = `${config.issuer}/v1/judgement`;
  const proof = await createDpopProof({ url, method: "POST", boundToken: session.accessToken });
  const idempotencyKey = `keating-mobile-judgement-${await randomBase64Url(24)}`;
  if (signal?.aborted || generation !== deviceSessionGeneration()) return new Response(null, { status: 403 });
  return accountFetch(url, { method: "POST", body, signal, redirect: "error",
    headers: { "content-type": "application/json", authorization: `DPoP ${session.accessToken}`, dpop: proof,
      "idempotency-key": idempotencyKey, "x-notorganic-max-cost-microusd": String(SPENDING_LIMITS.notorganicRequestMicrousd) } });
}

/** Numerical learner predictions use a separately granted, issuer-bound first-party capability. */
export async function notOrganicTabularRequest(
  body: OnlineDecisionRequest, signal?: AbortSignal, config = defaultNotOrganicAccountConfig(),
  current: () => boolean | Promise<boolean> = () => true,
): Promise<Response> {
  if (signal?.aborted || !await current()) return new Response(null, { status: 403 });
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== "/") {
    throw new Error("Online learning account configuration is invalid.");
  }
  const stored = await loadDeviceSession();
  if (signal?.aborted || stored?.issuer !== config.issuer || !stored.accountId || !stored.scope.split(/\s+/).includes("tabular:predict")) {
    return new Response(null, { status: 403 });
  }
  const session = await activeDeviceSession(config);
  if (signal?.aborted || session.issuer !== config.issuer || session.accountId !== stored.accountId
    || !session.scope.split(/\s+/).includes("tabular:predict") || !Number.isFinite(session.accessExpiresAt) || session.accessExpiresAt <= Date.now()) {
    return new Response(null, { status: 403 });
  }
  const generation = deviceSessionGeneration(), url = `${config.issuer}/v1/tabular/predict`;
  const proof = await createDpopProof({ url, method: "POST", boundToken: session.accessToken });
  const idempotencyKey = `keating-mobile-tabular-${await randomBase64Url(24)}`;
  if (signal?.aborted || generation !== deviceSessionGeneration() || !await current()
    || signal?.aborted || generation !== deviceSessionGeneration()) return new Response(null, { status: 403 });
  const response = await accountFetch(url, { method: "POST", body: JSON.stringify(body), signal, redirect: "error",
    headers: { "content-type": "application/json", authorization: `DPoP ${session.accessToken}`, dpop: proof,
      "idempotency-key": idempotencyKey, "x-notorganic-max-cost-microusd": String(SPENDING_LIMITS.notorganicRequestMicrousd) } });
  return signal?.aborted || generation !== deviceSessionGeneration() || !await current()
    || signal?.aborted || generation !== deviceSessionGeneration() ? new Response(null, { status: 403 }) : response;
}

export interface MobileTabularModel {
  id: typeof DEFAULT_MODELS.judgement.tabular; name: string; provider: string; task: "regression"; available: boolean;
  priceMicrousd: number | null;
  limits: { maxTrainRows: number; maxTestRows: number; maxFeatures: number };
}

/** Catalogue requests do not run inference or spend credits. */
export async function loadMobileTabularModels(signal?: AbortSignal, config = defaultNotOrganicAccountConfig()): Promise<MobileTabularModel[]> {
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== "/") throw Error("Online learning account configuration is invalid.");
  const stored = await loadDeviceSession();
  if (!stored?.accountId || stored.issuer !== config.issuer) throw Error("Sign in to the configured account service.");
  const session = await activeDeviceSession(config), generation = deviceSessionGeneration();
  if (signal?.aborted || session.accountId !== stored.accountId || session.issuer !== config.issuer) throw Error("The account changed.");
  const url = `${config.issuer}/v1/tabular/models`, proof = await createDpopProof({ url, method: "GET", boundToken: session.accessToken });
  if (signal?.aborted || generation !== deviceSessionGeneration()) throw Error("The account changed.");
  const response = await accountFetch(url, { signal, redirect: "error", headers: { authorization: `DPoP ${session.accessToken}`, dpop: proof } });
  if (signal?.aborted || generation !== deviceSessionGeneration()) throw Error("The account changed.");
  const body = await parseResponse<{ models?: unknown }>(response);
  if (!Array.isArray(body?.models)) throw Error("The model catalogue is unavailable.");
  return body.models.filter((value): value is MobileTabularModel => !!value && typeof value === "object" && value.id === DEFAULT_MODELS.judgement.tabular
    && value.task === "regression" && typeof value.available === "boolean" && typeof value.name === "string" && typeof value.provider === "string"
    && (value.priceMicrousd === null || Number.isSafeInteger(value.priceMicrousd) && value.priceMicrousd >= 0)
    && !!value.limits && Number.isSafeInteger(value.limits.maxTrainRows) && Number.isSafeInteger(value.limits.maxTestRows) && Number.isSafeInteger(value.limits.maxFeatures));
}
