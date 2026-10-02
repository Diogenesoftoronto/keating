import { isNotOrganicDesktop, NOTORGANIC_DESKTOP_ORIGIN, NOTORGANIC_DESKTOP_CALLBACK } from "../keating/notorganic-desktop";
import { APP_ORIGIN, WEBSITE_ORIGIN, isApplicationPath } from "../lib/hosted-navigation";

/**
 * Browser-only Not Organic public-client boundary.
 *
 * Keating is deliberately not a payment or identity authority. This module
 * implements the client half of the provider's authorization-code contract:
 * PKCE protects the redirect handoff and a non-extractable browser DPoP key
 * binds the short-lived capability to this browser. No DID, product assertion,
 * or provider signing credential is accepted or stored here.
 */

export interface NotOrganicPublicClientConfig {
	issuer: string;
	authorizationUrl: string;
	clientId: string;
	redirectUri: string;
	scope: string;
}

export interface NotOrganicPublicToken {
	access_token: string;
	token_type: "DPoP";
	expires_in: number;
	scope: string;
	refresh_token?: string;
	refresh_expires_in?: number;
}

export interface NotOrganicProviderSession {
	accessToken: string;
	expiresAt: number;
	scope: string;
	returnTo?: string;
	/** Rotating device-session credential; lets the 5-minute access token renew without another sign-in. */
	refreshToken?: string;
	refreshExpiresAt?: number;
	/** Stable across refreshes; changes only when the learner signs in again. */
	id?: string;
}

interface AuthorizationTransaction {
	state: string;
	verifier: string;
	issuer: string;
	clientId: string;
	redirectUri: string;
	createdAt: number;
	returnTo?: string;
}

interface AuthorizationReceipt extends Omit<AuthorizationTransaction, "verifier"> {
	codeHash: string;
}

export function safeAuthorizationReturnTo(value: string | undefined): string {
	if (!value?.startsWith("/") || value.startsWith("//")) return "/pricing";
	const url = new URL(value, "https://keating.help");
	return url.origin === WEBSITE_ORIGIN && (["/", "/pricing"].includes(url.pathname) || isApplicationPath(url.pathname))
		? `${url.pathname}${url.search}` : "/pricing";
}

export class NotOrganicPublicClientError extends Error {}

const TRANSACTION_KEY = "keating.notorganic.authorization";
const RECEIPT_KEY = "keating.notorganic.authorization-completed";
const AUTHORIZATION_TTL = 10 * 60_000;
const pendingExchanges = new WeakMap<Storage, Map<string, Promise<NotOrganicProviderSession>>>();
const SESSION_KEY = "keating.notorganic.session";
const DPOP_DATABASE = "keating-notorganic";
const DPOP_STORE = "keys";
const DPOP_KEY = "browser-dpop";
const DEVICE_NAME = "Keating web";
const REFRESH_MARGIN = 15_000;
const refreshes = new Map<string, Promise<NotOrganicProviderSession | null>>();

function requestId(): string {
	return `keating_${crypto.randomUUID()}`;
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
	return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function sha256Base64Url(value: string): Promise<string> {
	return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function randomBase64Url(size = 32): string {
	const bytes = new Uint8Array(size);
	crypto.getRandomValues(bytes);
	return base64Url(bytes);
}

function requireBrowserStorage(): Storage {
	if (typeof sessionStorage === "undefined") {
		throw new NotOrganicPublicClientError("Not Organic browser sign-in requires browser session storage.");
	}
	return sessionStorage;
}

function readJson<T>(key: string): T | null {
	const value = requireBrowserStorage().getItem(key);
	if (!value) return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		requireBrowserStorage().removeItem(key);
		return null;
	}
}

/** The signed-in session outlives a tab; PKCE state stays tab-scoped in sessionStorage. */
function sessionStore(): Storage {
	try {
		if (typeof localStorage !== "undefined") return localStorage;
	} catch { /* Blocked storage falls back to the tab. */ }
	return requireBrowserStorage();
}

function readSession(): NotOrganicProviderSession | null {
	const storage = sessionStore();
	const value = storage.getItem(SESSION_KEY);
	if (!value) return null;
	try {
		return JSON.parse(value) as NotOrganicProviderSession;
	} catch {
		storage.removeItem(SESSION_KEY);
		return null;
	}
}

function writeSession(session: NotOrganicProviderSession): void {
	sessionStore().setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(): void {
	sessionStore().removeItem(SESSION_KEY);
	requireBrowserStorage().removeItem(SESSION_KEY);
}

const accessValid = (session: NotOrganicProviderSession, now: number) =>
	!!session.accessToken && Number.isFinite(session.expiresAt) && session.expiresAt > now + REFRESH_MARGIN;
const refreshValid = (session: NotOrganicProviderSession, now: number) =>
	typeof session.refreshToken === "string" && !!session.refreshToken
	&& Number.isFinite(session.refreshExpiresAt) && session.refreshExpiresAt! > now + REFRESH_MARGIN;

/** Refresh tokens rotate, so only one tab may spend one at a time. */
async function withRefreshLock<T>(name: string, task: () => Promise<T>): Promise<T> {
	const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
	return locks ? await locks.request(name, task) : await task();
}

function writeJson(key: string, value: unknown): void {
	requireBrowserStorage().setItem(key, JSON.stringify(value));
}

function openDpopDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DPOP_DATABASE, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(DPOP_STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function loadOrCreateDpopKey(): Promise<CryptoKeyPair> {
	if (typeof indexedDB === "undefined") {
		throw new NotOrganicPublicClientError("Not Organic browser sign-in requires IndexedDB for its device-bound key.");
	}
	const database = await openDpopDatabase();
	try {
		const existing = await new Promise<CryptoKeyPair | undefined>((resolve, reject) => {
			const request = database.transaction(DPOP_STORE, "readonly").objectStore(DPOP_STORE).get(DPOP_KEY);
			request.onsuccess = () => resolve(request.result as CryptoKeyPair | undefined);
			request.onerror = () => reject(request.error);
		});
		if (existing) return existing;
		const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
		await new Promise<void>((resolve, reject) => {
			const request = database.transaction(DPOP_STORE, "readwrite").objectStore(DPOP_STORE).put(pair, DPOP_KEY);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
		return pair;
	} finally {
		database.close();
	}
}

async function deleteDpopKey(): Promise<void> {
	if (typeof indexedDB === "undefined") return;
	const database = await openDpopDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const request = database.transaction(DPOP_STORE, "readwrite").objectStore(DPOP_STORE).delete(DPOP_KEY);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} finally {
		database.close();
	}
}

async function dpopPublicJwk(): Promise<JsonWebKey> {
	return await crypto.subtle.exportKey("jwk", (await loadOrCreateDpopKey()).publicKey);
}

async function dpopProof(input: { method: string; url: string; accessToken: string }): Promise<string> {
	const pair = await loadOrCreateDpopKey();
	const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
	const header = encodeJson({ typ: "dpop+jwt", alg: "ES256", jwk });
	const payload = encodeJson({
		htm: input.method.toUpperCase(),
		htu: input.url,
		iat: Math.floor(Date.now() / 1000),
		jti: crypto.randomUUID(),
		ath: await sha256Base64Url(input.accessToken),
	});
	const signingInput = `${header}.${payload}`;
	const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(signingInput)));
	return `${signingInput}.${base64Url(signature)}`;
}


function publicClientEnv(): Record<string, string | undefined> {
	return import.meta.env ?? {};
}

function publicClientOrigin(origin: string | undefined): string | undefined {
	if (!origin) return undefined;
	try {
		const url = new URL(origin);
		const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return undefined;
		return url.origin;
	} catch {
		return undefined;
	}
}

export function publicClientConfig(
	env: Record<string, string | undefined> = publicClientEnv(),
	origin = globalThis.location?.origin,
	desktop = isNotOrganicDesktop(),
): NotOrganicPublicClientConfig | null {
	// Account authorization is independent of the hosted inference gate. The
	// account menu offers sign-in even while VITE_NOTORGANIC_ENABLED is false.
	// Require the explicit issuer/authorization contract in either case.
	const issuer = env.VITE_NOTORGANIC_PUBLIC_ISSUER?.trim().replace(/\/+$/, "");
	const authorizationUrl = env.VITE_NOTORGANIC_AUTHORIZATION_URL?.trim();
	// The provider accepts dynamic public clients at HTTPS and loopback origins.
	// Derive these together so localhost, 127.0.0.1, and custom dev ports return
	// to the exact origin holding the PKCE transaction and DPoP key.
	const browserOrigin = publicClientOrigin(origin);
	// The same hosted build serves the website and chat subdomain. A pinned
	// callback on the other host loses the tab's PKCE state and device-bound key.
	const hostedOrigin = browserOrigin === APP_ORIGIN || browserOrigin === WEBSITE_ORIGIN;
	const clientId = desktop ? NOTORGANIC_DESKTOP_ORIGIN : hostedOrigin ? browserOrigin : env.VITE_NOTORGANIC_CLIENT_ID?.trim() || browserOrigin;
	const redirectUri = desktop ? NOTORGANIC_DESKTOP_CALLBACK : hostedOrigin ? `${browserOrigin}/notorganic/callback` : env.VITE_NOTORGANIC_REDIRECT_URI?.trim()
		|| (browserOrigin ? `${browserOrigin}/notorganic/callback` : undefined);
	if (!issuer || !authorizationUrl || !clientId || !redirectUri) return null;
	return {
		issuer,
		authorizationUrl,
		clientId,
		redirectUri,
		 scope: env.VITE_NOTORGANIC_SCOPE
			?? "wallet:read usage:read billing:checkout infer:balanced infer:image realtime:connect",
	};
}

export function publicClientMaxCostMicrousd(env: Record<string, string | undefined> = publicClientEnv()): number {
	const configured = Number(env.VITE_NOTORGANIC_MAX_COST_MICROUSD ?? "100000");
	if (!Number.isSafeInteger(configured) || configured <= 0) {
		throw new NotOrganicPublicClientError("VITE_NOTORGANIC_MAX_COST_MICROUSD must be a positive integer.");
	}
	return configured;
}

function sessionFromToken(token: Partial<NotOrganicPublicToken>, base: Pick<NotOrganicProviderSession, "id" | "returnTo" | "refreshToken" | "refreshExpiresAt">): NotOrganicProviderSession | null {
	if (typeof token.access_token !== "string" || !token.access_token || token.token_type !== "DPoP"
		|| typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) return null;
	const now = Date.now();
	const rotated = typeof token.refresh_token === "string" && !!token.refresh_token
		&& typeof token.refresh_expires_in === "number" && Number.isFinite(token.refresh_expires_in) && token.refresh_expires_in > 0;
	return {
		accessToken: token.access_token,
		expiresAt: now + token.expires_in * 1_000,
		scope: typeof token.scope === "string" ? token.scope : "",
		...(base.id ? { id: base.id } : {}),
		...(base.returnTo ? { returnTo: base.returnTo } : {}),
		...(rotated
			? { refreshToken: token.refresh_token, refreshExpiresAt: now + token.refresh_expires_in! * 1_000 }
			: base.refreshToken ? { refreshToken: base.refreshToken, refreshExpiresAt: base.refreshExpiresAt } : {}),
	};
}

export class NotOrganicPublicClient {
	private readonly fetcher: typeof fetch;
	// Native browser fetch checks its receiver in Firefox. Storing it unbound
	// and invoking this.fetcher() incorrectly makes this client the Window.
	constructor(readonly config: NotOrganicPublicClientConfig, fetcher: typeof fetch = globalThis.fetch) {
		this.fetcher = fetcher === globalThis.fetch ? fetcher.bind(globalThis) : fetcher;
	}

	async authorizationUrl(returnTo = "/pricing"): Promise<string> {
		const verifier = randomBase64Url();
		const state = randomBase64Url();
		requireBrowserStorage().removeItem(RECEIPT_KEY);
		writeJson(TRANSACTION_KEY, { state, verifier, issuer: this.config.issuer, clientId: this.config.clientId, redirectUri: this.config.redirectUri, createdAt: Date.now(), returnTo: safeAuthorizationReturnTo(returnTo) } satisfies AuthorizationTransaction);
		const url = new URL(this.config.authorizationUrl);
		// A portal cookie can survive Keating sign-out. A fresh app session must
		// start at the account chooser; adding scopes to a session can reuse it.
		if (!this.getSession()) url.searchParams.set("prompt", "select_account");
		url.searchParams.set("client_id", this.config.clientId);
		url.searchParams.set("redirect_uri", this.config.redirectUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("code_challenge", await sha256Base64Url(verifier));
		url.searchParams.set("scope", this.config.scope);
		url.searchParams.set("state", state);
		url.searchParams.set("return_to", safeAuthorizationReturnTo(returnTo));
		return url.toString();
	}

	/**
	 * The signed-in session, if its access token is current or can be renewed.
	 * Its access token may be stale: send requests through request()/headersFor(),
	 * or await activeSession() for a current one.
	 */
	getSession(): NotOrganicProviderSession | null {
		const session = readSession();
		const now = Date.now();
		if (!session || (!accessValid(session, now) && !refreshValid(session, now))) {
			if (session) clearSession();
			return null;
		}
		return session;
	}

	/** The session with a current access token, renewing it through the device session when needed. */
	async activeSession(): Promise<NotOrganicProviderSession | null> {
		const session = this.getSession();
		if (!session) return null;
		if (accessValid(session, Date.now())) return session;
		const key = this.config.issuer;
		const pending = refreshes.get(key);
		if (pending) return await pending;
		const refresh = withRefreshLock(`keating-notorganic-refresh:${key}`, () => this.refreshSession())
			.finally(() => refreshes.delete(key));
		refreshes.set(key, refresh);
		return await refresh;
	}

	private async refreshSession(): Promise<NotOrganicProviderSession | null> {
		// Another tab may have rotated the token while this one waited for the lock.
		const current = this.getSession();
		if (!current || accessValid(current, Date.now())) return current;
		const refreshToken = current.refreshToken!;
		const url = `${this.config.issuer}/v1/public/device/token`;
		const response = await this.fetcher(url, {
			method: "POST",
			headers: { "content-type": "application/json", dpop: await dpopProof({ method: "POST", url, accessToken: refreshToken }) },
			body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
		});
		const token = await response.json().catch(() => null) as Partial<NotOrganicPublicToken> | null;
		// Signing out while the request was in flight cancels its authority to write.
		if (readSession()?.refreshToken !== refreshToken) return this.getSession();
		if (response.status === 400 || response.status === 401 || response.status === 403) {
			clearSession();
			return null;
		}
		const next = response.ok && token ? sessionFromToken(token, current) : null;
		if (!next) throw new NotOrganicPublicClientError("Not Organic could not renew your session. Check your connection and try again.");
		writeSession(next);
		return next;
	}

	async completeAuthorization(search: URLSearchParams): Promise<NotOrganicProviderSession> {
		const code = search.get("code");
		const state = search.get("state");
		const storage = requireBrowserStorage();
		const transaction = readJson<AuthorizationTransaction>(TRANSACTION_KEY);
		const matches = (value: AuthorizationTransaction | AuthorizationReceipt | null) => value
			&& value.state === state && value.issuer === this.config.issuer && value.clientId === this.config.clientId
			&& value.redirectUri === this.config.redirectUri && Number.isFinite(value.createdAt)
			&& value.createdAt <= Date.now() && Date.now() - value.createdAt < AUTHORIZATION_TTL;
		// A completed callback can be mounted again (or reloaded). Only return the
		// existing session when a locally recorded completion matches this exact
		// code, state and client. The callback alone never establishes a session.
		if (!transaction && code && state && !search.has("error")) {
			const receipt = readJson<AuthorizationReceipt>(RECEIPT_KEY);
			if (receipt && matches(receipt) && receipt.codeHash === await sha256Base64Url(code)) {
				const session = await this.activeSession().catch(() => this.getSession());
				if (session) return session;
			}
		}
		if (!transaction) {
			throw new NotOrganicPublicClientError("Not Organic sign-in could not be verified in this tab. Return to the browser tab where you started signing in, or start the connection again.");
		}
		if (!state || !matches(transaction) || typeof transaction.verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(transaction.verifier)) {
			throw new NotOrganicPublicClientError("Not Organic sign-in could not be verified. Start the connection again.");
		}
		if (search.has("error")) {
			storage.removeItem(TRANSACTION_KEY);
			throw new NotOrganicPublicClientError("Not Organic sign-in was not approved. Try connecting again.");
		}
		if (!code) throw new NotOrganicPublicClientError("Not Organic sign-in could not be verified. Start the connection again.");
		let exchanges = pendingExchanges.get(storage);
		if (!exchanges) pendingExchanges.set(storage, exchanges = new Map());
		const key = JSON.stringify([this.config.issuer, this.config.clientId, this.config.redirectUri, state, code]);
		const pending = exchanges.get(key);
		if (pending) return pending;
		const activeExchanges = exchanges;
		const exchange = this.exchangeAuthorization(code, transaction).finally(() => activeExchanges.delete(key));
		exchanges.set(key, exchange);
		return exchange;
	}

	private async exchangeAuthorization(code: string, transaction: AuthorizationTransaction): Promise<NotOrganicProviderSession> {
		const response = await this.fetcher(`${this.config.issuer}/v1/public/token`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code, code_verifier: transaction.verifier, client_id: this.config.clientId, redirect_uri: this.config.redirectUri, dpop_jwk: await dpopPublicJwk(), device_session: true, device_name: DEVICE_NAME }),
		});
		const token = await response.json().catch(() => null) as Partial<NotOrganicPublicToken> | null;
		const session = response.ok && token
			? sessionFromToken(token, { id: crypto.randomUUID(), returnTo: safeAuthorizationReturnTo(transaction.returnTo) })
			: null;
		if (!session) throw new NotOrganicPublicClientError("Not Organic could not finish sign-in. Try connecting again.");
		const codeHash = await sha256Base64Url(code);
		// Signing out or starting a newer login while the request was in flight
		// cancels its authority to replace the current session/transaction.
		if (readJson<AuthorizationTransaction>(TRANSACTION_KEY)?.state !== transaction.state
			|| Date.now() - transaction.createdAt >= AUTHORIZATION_TTL) {
			throw new NotOrganicPublicClientError("Not Organic sign-in could not be verified. Start the connection again.");
		}
		writeSession(session);
		writeJson(RECEIPT_KEY, { state: transaction.state, issuer: transaction.issuer, clientId: transaction.clientId, redirectUri: transaction.redirectUri, createdAt: transaction.createdAt, codeHash } satisfies AuthorizationReceipt);
		requireBrowserStorage().removeItem(TRANSACTION_KEY);
		return session;
	}

	async request(path: string, init: RequestInit = {}): Promise<Response> {
		const url = new URL(path, `${this.config.issuer}/`).toString();
		const headers = await this.headersFor(init.method ?? "GET", url, init.headers);
		const method = (init.method ?? "GET").toUpperCase();
		if (method !== "GET" && method !== "HEAD" && !headers.has("idempotency-key")) {
			headers.set("idempotency-key", requestId());
		}
		return await this.fetcher(url, { ...init, headers });
	}

	async headersFor(method: string, url: string, initial?: HeadersInit): Promise<Headers> {
		const session = await this.activeSession();
		if (!session) throw new NotOrganicPublicClientError("Connect your Not Organic account to continue.");
		const headers = new Headers(initial);
		headers.set("authorization", `DPoP ${session.accessToken}`);
		headers.set("dpop", await dpopProof({ method, url, accessToken: session.accessToken }));
		return headers;
	}

	async signOut(): Promise<void> {
		const refreshToken = readSession()?.refreshToken;
		clearSession();
		// Invalidate callback authority immediately, even if revocation is slow.
		requireBrowserStorage().removeItem(TRANSACTION_KEY);
		requireBrowserStorage().removeItem(RECEIPT_KEY);
		if (refreshToken) {
			// Best effort: the local session is already gone, and the key is deleted below.
			const url = `${this.config.issuer}/v1/public/device/revoke`;
			await dpopProof({ method: "POST", url, accessToken: refreshToken })
				.then(dpop => this.fetcher(url, { method: "POST", headers: { "content-type": "application/json", dpop }, body: JSON.stringify({ refresh_token: refreshToken }), signal: AbortSignal.timeout(5_000) }))
				.catch(() => undefined);
		}
		await deleteDpopKey();
	}
}
