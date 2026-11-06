import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configDir } from "./paths.js";
import {
  createNotOrganicDpopProof, createNotOrganicLoopbackListener, parseNotOrganicCallback,
  resolveNotOrganicAuthorizationUrl, resolveNotOrganicIssuer,
  type NotOrganicLoginCallbacks, type NotOrganicLoginOptions,
} from "./notorganic-auth.js";

export const ACCOUNT_SYNC_SCOPE = "sync:key:read sync:read sync:write";
export interface AccountSyncCredential {
  version: 1;
  issuer: string;
  did: string;
  privateJwk: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
}

export function accountSyncAuthPath(cwd: string): string { return join(configDir(cwd), "account-sync-auth.json"); }

/** Atomic restrictive writes also protect the rotating refresh token. */
export async function writeAccountSyncJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function readAccountSyncJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function loadAccountSyncCredential(cwd: string): Promise<AccountSyncCredential | null> {
  const value = await readAccountSyncJson<AccountSyncCredential>(accountSyncAuthPath(cwd));
  if (!value) return null;
  if (value.version !== 1 || typeof value.did !== "string" || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(value.did)
    || typeof value.privateJwk !== "string" || typeof value.accessToken !== "string" || typeof value.refreshToken !== "string"
    || !Number.isFinite(value.expiresAt) || !Number.isFinite(value.refreshExpiresAt)) throw new Error("Account sync credentials are invalid. Run `keating sync login`.");
  resolveNotOrganicIssuer(value.issuer);
  return value;
}

function parseTokens(value: unknown): { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number } {
  if (!value || typeof value !== "object") throw new Error("Invalid account sync grant.");
  const token = value as Record<string, unknown>;
  if (token.token_type !== "DPoP" || typeof token.scope !== "string" || token.scope.split(/\s+/).sort().join(" ") !== ACCOUNT_SYNC_SCOPE
    || typeof token.access_token !== "string" || token.access_token.length < 16 || token.access_token.length > 16384
    || typeof token.refresh_token !== "string" || token.refresh_token.length < 16 || token.refresh_token.length > 4096
    || !Number.isInteger(token.expires_in) || (token.expires_in as number) < 1 || (token.expires_in as number) > 300
    || !Number.isInteger(token.refresh_expires_in) || (token.refresh_expires_in as number) < 1 || (token.refresh_expires_in as number) > 30 * 86400) {
    throw new Error("Not Organic returned an invalid or broader account sync grant.");
  }
  return token as unknown as ReturnType<typeof parseTokens>;
}

async function requestWithCredential(credential: AccountSyncCredential, path: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  if (!path.startsWith("/v1/") || path.startsWith("//")) throw new Error("Invalid account sync request path.");
  const url = new URL(path, credential.issuer);
  if (url.origin !== credential.issuer) throw new Error("Account sync request must stay on the provider origin.");
  const method = init.method ?? "GET";
  const proofUrl = new URL(url); proofUrl.search = ""; proofUrl.hash = "";
  const headers = new Headers(init.headers);
  headers.set("Authorization", `DPoP ${credential.accessToken}`);
  headers.set("DPoP", await createNotOrganicDpopProof({ privateJwk: credential.privateJwk, accessToken: credential.accessToken, method, url: proofUrl.toString() }));
  return fetcher(url, { ...init, method, headers, redirect: "error", signal: init.signal ?? AbortSignal.timeout(30_000) });
}

async function authenticatedDid(credential: AccountSyncCredential, fetcher: typeof fetch): Promise<string> {
  const response = await requestWithCredential(credential, "/v1/account", {}, fetcher);
  if (!response.ok) throw new Error("Not Organic could not verify the account sync identity.");
  const value = await response.json() as { account?: { did?: unknown } };
  if (typeof value.account?.did !== "string" || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(value.account.did)) throw new Error("Not Organic returned an invalid account identity.");
  return value.account.did;
}

/** A separate refreshable grant: never changes Pi's five-minute inference credential. */
export async function loginAccountSync(cwd: string, callbacks: NotOrganicLoginCallbacks, options: NotOrganicLoginOptions = {}): Promise<{ did: string; expiresAt: number }> {
  const issuer = resolveNotOrganicIssuer(options.issuer);
  const authorization = new URL(resolveNotOrganicAuthorizationUrl(options.authorizationUrl));
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
  const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = JSON.stringify(await webcrypto.subtle.exportKey("jwk", keys.privateKey));
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
  const cancellation = new AbortController();
  const signal = callbacks.signal ? AbortSignal.any([callbacks.signal, cancellation.signal]) : cancellation.signal;
  const listener = await (options.callbackListenerFactory ?? createNotOrganicLoopbackListener)({ state, signal });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = new URL(listener.clientId);
    const redirect = new URL(listener.redirectUri);
    if (client.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(client.hostname)
      || client.origin !== listener.clientId || redirect.origin !== client.origin || redirect.hash || redirect.username || redirect.password) throw new Error("Account sync requires a loopback callback.");
    for (const [key, value] of Object.entries({ prompt: "select_account", response_type: "code", client_id: client.origin, redirect_uri: redirect.toString(), code_challenge: challenge, code_challenge_method: "S256", scope: ACCOUNT_SYNC_SCOPE, state })) authorization.searchParams.set(key, value);
    callbacks.onAuth({ url: authorization.toString(), instructions: "Approve encrypted account sync for this terminal. This connection can refresh for 30 days." });
    const candidates = [listener.wait()];
    if (callbacks.onManualCodeInput) candidates.push(callbacks.onManualCodeInput(signal));
    candidates.push(new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Account sync login timed out.")), options.timeoutMs ?? 300_000); timeout.unref?.(); }));
    const code = parseNotOrganicCallback({ value: await Promise.race(candidates), expectedRedirectUri: redirect.toString(), expectedState: state });
    const response = await fetcher(`${issuer}/v1/public/token`, { method: "POST", headers: { "content-type": "application/json" }, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), body: JSON.stringify({ code, code_verifier: verifier, client_id: client.origin, redirect_uri: redirect.toString(), dpop_jwk: publicJwk, device_session: true, device_name: "Keating terminal" }) });
    if (!response.ok) throw new Error(`Account sync authorization failed (HTTP ${response.status}).`);
    const token = parseTokens(await response.json());
    const credential: AccountSyncCredential = { version: 1, issuer, did: "", privateJwk, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: now() + token.expires_in * 1000, refreshExpiresAt: now() + token.refresh_expires_in * 1000 };
    credential.did = await authenticatedDid(credential, fetcher);
    await writeAccountSyncJson(accountSyncAuthPath(cwd), credential);
    return { did: credential.did, expiresAt: credential.refreshExpiresAt };
  } finally { if (timeout) clearTimeout(timeout); cancellation.abort(); await listener.close(); }
}

export async function createAccountSyncRequester(cwd: string, options: { fetch?: typeof fetch; now?: () => number } = {}) {
  let credential = await loadAccountSyncCredential(cwd);
  if (!credential) throw new Error("Run `keating sync login` to connect this terminal.");
  const did = credential.did;
  const issuer = credential.issuer;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let refresh: Promise<void> | null = null;
  let identityInvalid = false;
  const ensure = async () => {
    if (identityInvalid) throw new Error("The refreshed account identity changed. Reconnect account sync.");
    if (credential!.expiresAt > now() + 30_000) return;
    if (!refresh) refresh = (async () => {
      // Runs under the CLI account-sync lease; reread before rotating so another
      // completed command cannot leave this process holding the previous token.
      const latest = await loadAccountSyncCredential(cwd);
      if (!latest || latest.did !== did || latest.issuer !== issuer) throw new Error("The account sync connection changed.");
      credential = latest;
      if (credential.expiresAt > now() + 30_000) return;
      if (credential.refreshExpiresAt <= now()) throw new Error("Account sync expired. Run `keating sync login`.");
      const url = `${issuer}/v1/public/device/token`;
      const proof = await createNotOrganicDpopProof({ privateJwk: credential.privateJwk, accessToken: credential.refreshToken, method: "POST", url, now });
      const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json", DPoP: proof }, body: JSON.stringify({ grant_type: "refresh_token", refresh_token: credential.refreshToken }), redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Account sync needs reconnecting (HTTP ${response.status}). Run \`keating sync login\`.`);
      const token = parseTokens(await response.json());
      credential = { ...credential, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: now() + token.expires_in * 1000, refreshExpiresAt: Math.min(credential.refreshExpiresAt, now() + token.refresh_expires_in * 1000) };
      await writeAccountSyncJson(accountSyncAuthPath(cwd), credential);
      if (await authenticatedDid(credential, fetcher) !== did) {
        identityInvalid = true;
        await rm(accountSyncAuthPath(cwd), { force: true });
        throw new Error("The refreshed account identity changed.");
      }
    })().finally(() => { refresh = null; });
    await refresh;
  };
  return { did, issuer, request: async (path: string, init: RequestInit = {}) => { await ensure(); return requestWithCredential(credential!, path, init, fetcher); } };
}

export async function logoutAccountSync(cwd: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const credential = await loadAccountSyncCredential(cwd);
  if (!credential) return true;
  let revoked = false;
  try {
    const url = `${credential.issuer}/v1/public/device/revoke`;
    const proof = await createNotOrganicDpopProof({ privateJwk: credential.privateJwk, accessToken: credential.refreshToken, method: "POST", url });
    const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json", DPoP: proof }, body: JSON.stringify({ refresh_token: credential.refreshToken }), redirect: "error", signal: AbortSignal.timeout(15_000) });
    revoked = response.ok;
  } catch { /* Local disconnection must remain available offline. */ }
  await rm(accountSyncAuthPath(cwd), { force: true });
  return revoked;
}
