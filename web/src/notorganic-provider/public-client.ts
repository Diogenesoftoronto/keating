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
}

export interface NotOrganicProviderSession {
	accessToken: string;
	expiresAt: number;
	scope: string;
}

interface AuthorizationTransaction {
	state: string;
	verifier: string;
	redirectUri: string;
	createdAt: number;
}

export class NotOrganicPublicClientError extends Error {}

const TRANSACTION_KEY = "keating.notorganic.authorization";
const SESSION_KEY = "keating.notorganic.session";
const DPOP_DATABASE = "keating-notorganic";
const DPOP_STORE = "keys";
const DPOP_KEY = "browser-dpop";

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

export function publicClientConfig(env: Record<string, string | undefined> = publicClientEnv()): NotOrganicPublicClientConfig | null {
	const issuer = env.VITE_NOTORGANIC_PUBLIC_ISSUER?.replace(/\/+$/, "");
	const authorizationUrl = env.VITE_NOTORGANIC_AUTHORIZATION_URL;
	const clientId = env.VITE_NOTORGANIC_CLIENT_ID;
	const redirectUri = env.VITE_NOTORGANIC_REDIRECT_URI;
	if (!issuer || !authorizationUrl || !clientId || !redirectUri) return null;
	return {
		issuer,
		authorizationUrl,
		clientId,
		redirectUri,
		scope: env.VITE_NOTORGANIC_SCOPE
			?? "wallet:read usage:read billing:checkout infer:balanced realtime:connect evolution:read evolution:write evolution:execute",
	};
}

export function publicClientMaxCostMicrousd(env: Record<string, string | undefined> = publicClientEnv()): number {
	const configured = Number(env.VITE_NOTORGANIC_MAX_COST_MICROUSD ?? "100000");
	if (!Number.isSafeInteger(configured) || configured <= 0) {
		throw new NotOrganicPublicClientError("VITE_NOTORGANIC_MAX_COST_MICROUSD must be a positive integer.");
	}
	return configured;
}

export class NotOrganicPublicClient {
	constructor(readonly config: NotOrganicPublicClientConfig, private readonly fetcher: typeof fetch = fetch) {}

	async authorizationUrl(returnTo = "/pricing"): Promise<string> {
		const verifier = randomBase64Url();
		const state = randomBase64Url();
		writeJson(TRANSACTION_KEY, { state, verifier, redirectUri: this.config.redirectUri, createdAt: Date.now() } satisfies AuthorizationTransaction);
		const url = new URL(this.config.authorizationUrl);
		url.searchParams.set("client_id", this.config.clientId);
		url.searchParams.set("redirect_uri", this.config.redirectUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("code_challenge_method", "S256");
		url.searchParams.set("code_challenge", await sha256Base64Url(verifier));
		url.searchParams.set("scope", this.config.scope);
		url.searchParams.set("state", state);
		url.searchParams.set("return_to", returnTo);
		return url.toString();
	}

	getSession(): NotOrganicProviderSession | null {
		const session = readJson<NotOrganicProviderSession>(SESSION_KEY);
		if (!session || !session.accessToken || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() + 15_000) {
			requireBrowserStorage().removeItem(SESSION_KEY);
			return null;
		}
		return session;
	}

	async completeAuthorization(search: URLSearchParams): Promise<NotOrganicProviderSession> {
		const error = search.get("error");
		if (error) throw new NotOrganicPublicClientError(`Not Organic sign-in was not approved: ${error}`);
		const code = search.get("code");
		const state = search.get("state");
		const transaction = readJson<AuthorizationTransaction>(TRANSACTION_KEY);
		requireBrowserStorage().removeItem(TRANSACTION_KEY);
		if (!code || !state || !transaction || transaction.state !== state || transaction.redirectUri !== this.config.redirectUri || Date.now() - transaction.createdAt > 10 * 60_000) {
			throw new NotOrganicPublicClientError("Not Organic sign-in could not be verified. Start the connection again.");
		}
		const response = await this.fetcher(`${this.config.issuer}/v1/public/token`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code, code_verifier: transaction.verifier, client_id: this.config.clientId, redirect_uri: this.config.redirectUri, dpop_jwk: await dpopPublicJwk() }),
		});
		const token = await response.json().catch(() => null) as Partial<NotOrganicPublicToken> | null;
		if (!response.ok || !token || typeof token.access_token !== "string" || token.token_type !== "DPoP" || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in)) {
			throw new NotOrganicPublicClientError("Not Organic could not finish sign-in. Try connecting again.");
		}
		const session = { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1_000, scope: typeof token.scope === "string" ? token.scope : "" };
		writeJson(SESSION_KEY, session);
		return session;
	}

	async request(path: string, init: RequestInit = {}): Promise<Response> {
		const session = this.getSession();
		if (!session) throw new NotOrganicPublicClientError("Connect your Not Organic account to continue.");
		const url = new URL(path, `${this.config.issuer}/`).toString();
		const headers = await this.headersFor(init.method ?? "GET", url, init.headers);
		const method = (init.method ?? "GET").toUpperCase();
		if (method !== "GET" && method !== "HEAD" && !headers.has("idempotency-key")) {
			headers.set("idempotency-key", requestId());
		}
		return await this.fetcher(url, { ...init, headers });
	}

	async headersFor(method: string, url: string, initial?: HeadersInit): Promise<Headers> {
		const session = this.getSession();
		if (!session) throw new NotOrganicPublicClientError("Connect your Not Organic account to continue.");
		const headers = new Headers(initial);
		headers.set("authorization", `DPoP ${session.accessToken}`);
		headers.set("dpop", await dpopProof({ method, url, accessToken: session.accessToken }));
		return headers;
	}

	async signOut(): Promise<void> {
		requireBrowserStorage().removeItem(SESSION_KEY);
		requireBrowserStorage().removeItem(TRANSACTION_KEY);
		await deleteDpopKey();
	}
}
