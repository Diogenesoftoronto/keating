import type {
  NotOrganicAccountConfig,
  NotOrganicAccountSnapshot,
  NotOrganicDeviceSession,
  NotOrganicTokenResponse,
} from "./contracts";
import { defaultNotOrganicAccountConfig } from "./contracts";
import { deviceSessionGeneration, loadDeviceSession, saveDeviceSessionIfCurrent } from "./credentials";
import { createDpopProof, getDevicePublicJwk } from "./dpop";

export type AccountFetch = typeof fetch;
let accountFetch: AccountFetch = globalThis.fetch.bind(globalThis);
let refreshInFlight: Promise<NotOrganicDeviceSession> | null = null;

export function setAccountFetchForTests(next: AccountFetch | null): void {
  accountFetch = next ?? globalThis.fetch.bind(globalThis);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as ({ error?: { message?: string } } & T) | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `Not Organic request failed (${response.status}).`);
  return body as T;
}

function tokenSession(token: NotOrganicTokenResponse, now = Date.now()): NotOrganicDeviceSession {
  if (!token.refresh_token || token.token_type !== "DPoP") throw new Error("Not Organic did not issue a mobile device session.");
  return {
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
  const session = tokenSession(await parseResponse<NotOrganicTokenResponse>(response));
  await saveDeviceSessionIfCurrent(session, generation);
  return session;
}

export async function refreshDeviceSession(config = defaultNotOrganicAccountConfig()): Promise<NotOrganicDeviceSession> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const generation = deviceSessionGeneration();
    const current = await loadDeviceSession();
    if (!current || current.refreshExpiresAt <= Date.now()) throw new Error("Your Not Organic login has expired. Sign in again.");
    const url = `${config.issuer}/v1/public/device/token`;
    const response = await accountFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", dpop: await createDpopProof({ url, method: "POST", boundToken: current.refreshToken }) },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: current.refreshToken }),
    });
    const next = tokenSession(await parseResponse<NotOrganicTokenResponse>(response));
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
  const account = await notOrganicAccountRequest<NotOrganicAccountSnapshot>("/v1/account", {}, config);
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
