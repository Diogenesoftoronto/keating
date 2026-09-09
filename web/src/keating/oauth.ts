import { getAppStorage } from "./app-storage";
import { readOAuthJson } from "./oauth-response";
import { notOrganicDesktopCallbackPath } from "./notorganic-desktop";
import {
	getAuthorizationCodeOAuthProviderIds,
	getOAuthProviderConfig,
	isAuthorizationCodeOAuthProvider,
	type AuthorizationCodeOAuthProviderId,
	type OAuthProviderId,
} from "./oauth-provider-config";

export {
	getOAuthProviderConfig,
	type AuthorizationCodeOAuthProviderConfig as OAuthProviderConfig,
	type OAuthProviderId,
} from "./oauth-provider-config";

export interface OAuthCredentials {
	refresh: string;
	access: string;
	expires: number;
	provider: OAuthProviderId;
	apiKey?: string;
	idToken?: string;
}

export const OAUTH_MESSAGE_CHANNEL = "keating-oauth-result";

export function resolveOAuthRedirectUri(providerId: OAuthProviderId): string {
	if (!isAuthorizationCodeOAuthProvider(providerId)) {
		throw new Error(`${providerId} uses the OAuth device flow and has no redirect URI.`);
	}
	return getOAuthProviderConfig(providerId).redirectUri;
}

export function getOAuthProviderIds(): OAuthProviderId[] {
	return [...getAuthorizationCodeOAuthProviderIds(), "github-copilot"];
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	const verifier = base64UrlEncode(array);

	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await crypto.subtle.digest("SHA-256", data);
	const challenge = base64UrlEncode(new Uint8Array(digest));

	return { verifier, challenge };
}

function base64UrlEncode(buffer: Uint8Array): string {
	let binary = "";
	for (const byte of buffer) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type DeviceOAuthProviderId = "github-copilot" | "openai-codex";

interface PendingAuthorizationCodeOAuthState {
	flow: "authorization-code";
	verifier: string;
	automatic?: boolean;
	provider: AuthorizationCodeOAuthProviderId;
	state: string;
	redirectUri: string;
	createdAt: number;
}

interface PendingDeviceOAuthState {
	flow: "device-code";
	provider: DeviceOAuthProviderId;
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	intervalSeconds: number;
	expiresAt: number;
	createdAt: number;
}

type PendingOAuthState = PendingAuthorizationCodeOAuthState | PendingDeviceOAuthState;

export type PendingOAuthRequest =
	| {
			flow: "authorization-code";
			automatic: boolean;
			provider: AuthorizationCodeOAuthProviderId;
			createdAt: number;
			expiresAt: number;
		}
	| {
			flow: "device-code";
			provider: DeviceOAuthProviderId;
			userCode: string;
			verificationUri: string;
			createdAt: number;
			expiresAt: number;
		};

const PENDING_KEY = "keating_oauth_pending";
const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;

function savePendingOAuth(state: PendingOAuthState): void {
	localStorage.setItem(PENDING_KEY, JSON.stringify(state));
}

function loadPendingOAuth(): PendingOAuthState | null {
	const raw = localStorage.getItem(PENDING_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PendingOAuthState;
	} catch {
		return null;
	}
}

function clearPendingOAuth(): void {
	localStorage.removeItem(PENDING_KEY);
}

/**
 * Return only the non-secret portion of an unfinished sign-in so the settings
 * UI can restore its completion controls after a reload or browser restore.
 */
export function getPendingOAuthRequest(now = Date.now()): PendingOAuthRequest | null {
	const pending = loadPendingOAuth();
	if (!pending) return null;

	if (pending.flow === "authorization-code") {
		const expiresAt = pending.createdAt + AUTHORIZATION_CODE_TTL_MS;
		if (now >= expiresAt) {
			clearPendingOAuth();
			return null;
		}
		return {
			flow: pending.flow,
			automatic: pending.automatic === true,
			provider: pending.provider,
			createdAt: pending.createdAt,
			expiresAt,
		};
	}

	if (
		now >= pending.expiresAt ||
		typeof pending.userCode !== "string" ||
		typeof pending.verificationUri !== "string"
	) {
		clearPendingOAuth();
		return null;
	}
	return {
		flow: pending.flow,
		provider: pending.provider,
		userCode: pending.userCode,
		verificationUri: pending.verificationUri,
		createdAt: pending.createdAt,
		expiresAt: pending.expiresAt,
	};
}

let oauthAttempt = 0;

export function cancelPendingOAuthRequest(): void {
	oauthAttempt++;
	clearPendingOAuth();
	if (typeof window !== "undefined") void window.keatingDesktop?.cancelOAuthCallback?.().catch(() => {});
}

function createState(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

export type OAuthInitiationResult =
	| { flow: "authorization-code"; automatic: boolean }
	| {
			flow: "device-code";
			provider: DeviceOAuthProviderId;
			userCode: string;
			verificationUri: string;
			expiresAt: number;
		};

function isDesktopOAuthHost(): boolean {
	return typeof window !== "undefined" && (!!window.keatingDesktop || !!window.keatingP2P);
}

function openOAuthPopup(providerId: OAuthProviderId): Window | null {
	// Electron denies about:blank child windows by policy. Its main process
	// already validates and externalizes safe HTTPS window.open destinations,
	// so defer opening until the real provider URL is available.
	if (isDesktopOAuthHost()) return null;
	const width = 600;
	const height = 700;
	const availableWidth = globalThis.screen?.width ?? width;
	const availableHeight = globalThis.screen?.height ?? height;
	const left = Math.max(0, (availableWidth - width) / 2);
	const top = Math.max(0, (availableHeight - height) / 2);
	const popup = window.open(
		"about:blank",
		`keating-oauth-${providerId}`,
		`width=${width},height=${height},left=${left},top=${top},popup=yes`,
	);
	if (!popup) throw new Error("The sign-in popup was blocked. Allow popups for Keating and try again.");
	return popup;
}

function openOAuthDestination(popup: Window | null, url: string): void {
	if (popup) {
		popup.location.replace(url);
		return;
	}
	// In Electron, setWindowOpenHandler sends this validated HTTPS URL to the
	// system browser and denies an in-app child window. Approval returns through
	// the desktop receiver, or is detected by device-code polling.
	window.open(url, "_blank", "noopener,noreferrer");
}

async function startDeviceSignIn(provider: DeviceOAuthProviderId, popup: Window | null, attempt: number): Promise<OAuthInitiationResult> {
	const response = await fetch(`/api/oauth/${provider}/device`, { method: "POST", headers: { Accept: "application/json" } });
	const device = await readOAuthJson(response);
	if (!response.ok) {
		const name = provider === "openai-codex" ? "OpenAI" : "GitHub";
		throw new Error(provider === "openai-codex"
			? "OpenAI device sign-in could not start. Check that device code login is enabled in your ChatGPT security settings, then try again."
			: `${name} device sign-in could not start. Please try again.`);
	}
	const expectedUrl = provider === "openai-codex" ? "https://auth.openai.com/codex/device" : "https://github.com/login/device";
	if (typeof device.device_code !== "string" || !device.device_code || typeof device.user_code !== "string" || !device.user_code
		|| device.verification_uri !== expectedUrl || typeof device.expires_in !== "number" || !Number.isFinite(device.expires_in) || device.expires_in <= 0
		|| (device.interval !== undefined && (typeof device.interval !== "number" || !Number.isFinite(device.interval) || device.interval < 0))) {
		throw new Error("The provider returned an invalid device sign-in response.");
	}
	if (attempt !== oauthAttempt) throw new Error("Sign-in was cancelled. Please try again.");
	const expiresAt = Date.now() + Math.min(device.expires_in, 1800) * 1000;
	savePendingOAuth({ flow: "device-code", provider, deviceCode: device.device_code, userCode: device.user_code,
		verificationUri: expectedUrl, intervalSeconds: Math.max(1, Math.min(device.interval ?? 5, 60)), expiresAt, createdAt: Date.now() });
	openOAuthDestination(popup, expectedUrl);
	return { flow: "device-code", provider, userCode: device.user_code, verificationUri: expectedUrl, expiresAt };
}

export async function initiateOAuth(providerId: OAuthProviderId, options: { method?: "device-code" | "manual" } = {}): Promise<OAuthInitiationResult> {
	const attempt = ++oauthAttempt;
	const popup = openOAuthPopup(providerId);
	try {
		if (window.keatingDesktop?.cancelOAuthCallback) await window.keatingDesktop.cancelOAuthCallback();
		if (attempt !== oauthAttempt) throw new Error("Sign-in was cancelled. Please try again.");
		if (providerId === "anthropic" && isDesktopOAuthHost() && options.method !== "manual" && !window.keatingDesktop?.prepareOAuthCallback) {
			throw new Error("Claude’s automatic return needs the updated desktop app. Restart Keating after updating it, or choose authorization-code sign-in below.");
		}
		if (providerId === "github-copilot" || (providerId === "openai-codex" && (options.method === "device-code" || !window.keatingDesktop?.prepareOAuthCallback))) {
			return await startDeviceSignIn(providerId, popup, attempt);
		}
		const config = getOAuthProviderConfig(providerId);
		let redirectUri = resolveOAuthRedirectUri(providerId);
		const { verifier, challenge } = await generatePKCE();
		const state = providerId === "anthropic" ? verifier : createState();
		if (attempt !== oauthAttempt) throw new Error("Sign-in was cancelled. Please try again.");
		let automatic = false;
		if (window.keatingDesktop?.prepareOAuthCallback && options.method !== "manual") {
			const receiver = await window.keatingDesktop.prepareOAuthCallback(state, providerId).catch(() => ({ available: false }));
			if (attempt !== oauthAttempt) throw new Error("Sign-in was cancelled. Please try again.");
			if (!receiver.available && providerId === "openai-codex") return await startDeviceSignIn(providerId, popup, attempt);
			automatic = receiver.available;
			if (!automatic && providerId === "anthropic") throw new Error("Claude’s automatic return could not start. Close any other Claude sign-in window and try again, or choose authorization-code sign-in below.");
			if (automatic && providerId === "anthropic") redirectUri = "http://localhost:53692/callback";
		}
		savePendingOAuth({ flow: "authorization-code", verifier, provider: providerId, state, redirectUri, automatic, createdAt: Date.now() });
		const params = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: redirectUri,
			scope: config.scopes.join(" "), code_challenge: challenge, code_challenge_method: "S256", state });
		if (config.extraAuthParams) for (const [key, value] of Object.entries(config.extraAuthParams)) params.set(key, value);
		openOAuthDestination(popup, `${config.authorizeUrl}?${params.toString()}`);
		return { flow: "authorization-code", automatic };
	} catch (error) {
		popup?.close();
		if (attempt === oauthAttempt) cancelPendingOAuthRequest();
		throw error;
	}
}

export interface OAuthCallbackResult {
	success: boolean;
	provider?: OAuthProviderId;
	error?: string;
}

export interface KeatingDesktopOAuthBridge {
	prepareOAuthCallback?(state: string, provider?: AuthorizationCodeOAuthProviderId | "notorganic"): Promise<{ available: boolean }>;
	cancelOAuthCallback?(): Promise<void>;
	onOAuthCallback(listener: (callbackUrl: string) => void): () => void;
}

declare global {
	interface Window {
		keatingDesktop?: KeatingDesktopOAuthBridge;
	}
}

function parseOAuthCallbackInput(input: string): { code?: string; state?: string; error?: string; errorDescription?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
		return {
			code: url.searchParams.get("code") ?? hashParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? hashParams.get("state") ?? undefined,
			error: url.searchParams.get("error") ?? hashParams.get("error") ?? undefined,
			errorDescription: url.searchParams.get("error_description") ?? hashParams.get("error_description") ?? undefined,
		};
	} catch {
		// Not a URL.
	}
	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return { code, state };
	}
	if (value.includes("code=") || value.includes("state=") || value.includes("error=")) {
		const params = new URLSearchParams(value.replace(/^\?/, ""));
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
			error: params.get("error") ?? undefined,
			errorDescription: params.get("error_description") ?? undefined,
		};
	}
	return { code: value };
}

export async function completeOAuthFromInput(input: string): Promise<OAuthCallbackResult> {
	const parsed = parseOAuthCallbackInput(input);
	if (parsed.error) {
		return { success: false, error: parsed.errorDescription ?? parsed.error };
	}
	if (!parsed.code) {
		return { success: false, error: "Paste the final callback URL or authorization code." };
	}
	return handleOAuthCallback(parsed.code, parsed.state);
}

/**
 * Subscribe to the Electron loopback handoff when present. The main process
 * supplies only the callback URL; the renderer remains responsible for PKCE
 * state validation and token exchange through the existing completion path.
 */
export function subscribeDesktopOAuthCallback(
	listener: (result: OAuthCallbackResult) => void,
): () => void {
	if (typeof window === "undefined" || !window.keatingDesktop) return () => {};
	return window.keatingDesktop.onOAuthCallback((callbackUrl) => {
		const accountCallback = notOrganicDesktopCallbackPath(callbackUrl);
		if (accountCallback) {
			window.location.assign(accountCallback);
			return;
		}
		const pendingProvider = getPendingOAuthRequest()?.provider;
		void completeOAuthFromInput(callbackUrl)
			.then((result) => listener({
				...result,
				provider: result.provider ?? pendingProvider,
			}))
			.catch((error) => listener({
				success: false,
				provider: pendingProvider,
				error: error instanceof Error ? error.message : "Desktop OAuth completion failed.",
			}));
	});
}

export async function handleOAuthCallback(code: string, state?: string | null): Promise<OAuthCallbackResult> {
	const pending = loadPendingOAuth();
	if (!pending) {
		return { success: false, error: "No pending OAuth request found. Please try again." };
	}
	if (pending.flow !== "authorization-code") {
		return { success: false, error: "The pending sign-in uses a device code, not an OAuth callback." };
	}

	const age = Date.now() - pending.createdAt;
	if (age >= AUTHORIZATION_CODE_TTL_MS) {
		clearPendingOAuth();
		return { success: false, error: "OAuth request expired. Please try again." };
	}

	if ((pending.automatic && !state) || (state && state !== pending.state)) {
		clearPendingOAuth();
		return { success: false, error: "OAuth state mismatch. Please try signing in again." };
	}

	if (!state && pending.provider === "anthropic") {
		state = pending.state;
	}

	try {
		const response = await fetch("/api/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				provider: pending.provider,
				code,
				state: state ?? pending.state,
				redirect_uri: pending.redirectUri,
				code_verifier: pending.verifier,
			}),
		});

		const tokens = await readOAuthJson(response);
		if (!response.ok) {
			throw new Error(`Sign-in could not finish (${response.status}). Please restart sign-in and try again.`);
		}

		if (typeof tokens.access_token !== "string" || !tokens.access_token || typeof tokens.refresh_token !== "string" || !tokens.refresh_token
			|| typeof tokens.expires_in !== "number" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
			throw new Error("The provider returned an invalid sign-in response. Please try again.");
		}
		const current = loadPendingOAuth();
		if (current?.flow !== "authorization-code" || current.state !== pending.state) return { success: false, error: "Sign-in was cancelled." };

		const credentials: OAuthCredentials = {
			refresh: tokens.refresh_token,
			access: tokens.access_token,
			expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			provider: pending.provider,
			apiKey: typeof tokens.api_key === "string" ? tokens.api_key : undefined,
			idToken: typeof tokens.id_token === "string" ? tokens.id_token : undefined,
		};

		await saveOAuthCredentials(credentials);
		clearPendingOAuth();

		return { success: true, provider: pending.provider };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error during OAuth",
		};
	}
}

function waitForDevicePoll(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("The sign-in was cancelled.", "AbortError"));
			return;
		}
		const onAbort = () => {
			globalThis.clearTimeout(timeout);
			reject(new DOMException("The sign-in was cancelled.", "AbortError"));
		};
		const timeout = globalThis.setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function completeOAuthDeviceFlow(
	provider: DeviceOAuthProviderId,
	signal?: AbortSignal,
): Promise<OAuthCallbackResult> {
	const pending = loadPendingOAuth();
	if (!pending || pending.flow !== "device-code" || pending.provider !== provider) {
		return { success: false, error: "No pending device sign-in was found." };
	}

	const stillPending = () => {
		const current = loadPendingOAuth();
		return !signal?.aborted && current?.flow === "device-code" && current.provider === provider && current.deviceCode === pending.deviceCode;
	};
	let intervalSeconds = pending.intervalSeconds;
	try {
		while (Date.now() < pending.expiresAt) {
			await waitForDevicePoll(intervalSeconds * 1000, signal);
			if (!stillPending()) return { success: false, error: "Sign-in was cancelled." };
			const response = await fetch(`/api/oauth/${provider}/poll`, {
				signal,
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ device_code: pending.deviceCode, ...(provider === "openai-codex" ? { user_code: pending.userCode } : {}) }),
			});
			if (response.status === 202) continue;
			if (response.status === 429) {
				intervalSeconds += 5;
				continue;
			}
			const tokens = await readOAuthJson(response);
			if (!response.ok) {
				throw new Error(`Device sign-in failed (${response.status}). Please try again.`);
			}
			if (tokens.status !== "complete" || typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") {
				throw new Error("The provider returned an invalid sign-in response.");
			}
			if (!stillPending()) return { success: false, error: "Sign-in was cancelled." };
			await saveOAuthCredentials({
				refresh: tokens.refresh_token,
				access: tokens.access_token,
				expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
				provider,
			});
			if (stillPending()) clearPendingOAuth();
			return { success: true, provider };
		}
		if (stillPending()) clearPendingOAuth();
		return { success: false, error: "Sign-in expired. Please try again." };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Device sign-in failed.",
		};
	}
}

const OAUTH_STORAGE_KEY_PREFIX = "oauth:";

function oauthStorageKey(provider: OAuthProviderId): string {
	return `${OAUTH_STORAGE_KEY_PREFIX}${provider}`;
}

export async function saveOAuthCredentials(credentials: OAuthCredentials): Promise<void> {
	const storage = await getAppStorage();
	const key = oauthStorageKey(credentials.provider);
	await storage.providerKeys.set(key, JSON.stringify(credentials));
}

export async function loadOAuthCredentials(provider: OAuthProviderId): Promise<OAuthCredentials | null> {
	const storage = await getAppStorage();
	const key = oauthStorageKey(provider);
	const raw = await storage.providerKeys.get(key);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.refresh === "string" && typeof parsed.access === "string") {
			return parsed as OAuthCredentials;
		}
		return null;
	} catch {
		return null;
	}
}

export async function deleteOAuthCredentials(provider: OAuthProviderId): Promise<void> {
	const storage = await getAppStorage();
	const key = oauthStorageKey(provider);
	await storage.providerKeys.delete(key);
}

const pendingAccessTokens = new Map<OAuthProviderId, Promise<string | null>>();

export async function getOAuthAccessToken(provider: OAuthProviderId): Promise<string | null> {
	const pending = pendingAccessTokens.get(provider);
	if (pending) return pending;
	// Model discovery and chat can request a credential together. Serialize the
	// storage read too, so both callers cannot consume the same rotating token.
	const request = resolveOAuthAccessToken(provider);
	pendingAccessTokens.set(provider, request);
	try {
		return await request;
	} finally {
		pendingAccessTokens.delete(provider);
	}
}

async function resolveOAuthAccessToken(provider: OAuthProviderId): Promise<string | null> {
	const credentials = await loadOAuthCredentials(provider);
	if (!credentials) return null;

	if (Date.now() >= credentials.expires - 60_000) {
		const refreshed = await refreshOAuthToken(provider, credentials);
		if (!refreshed) return null;
		return oauthCredentialToken(refreshed);
	}

	return oauthCredentialToken(credentials);
}

function oauthCredentialToken(credentials: OAuthCredentials): string {
	// Codex's SDK transport needs the ChatGPT OAuth JWT so it can derive the
	// account id and call the subscription-backed Codex Responses endpoint.
	// Older Keating builds also stored an exchanged API key; deliberately ignore
	// that legacy field for Codex while retaining it for any migrated providers.
	return credentials.provider === "openai-codex"
		? credentials.access
		: credentials.apiKey ?? credentials.access;
}

async function refreshOAuthToken(
	provider: OAuthProviderId,
	credentials: OAuthCredentials,
): Promise<OAuthCredentials | null> {
	try {
		const response = await fetch("/api/oauth/refresh", {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({
				provider,
				refresh_token: credentials.refresh,
			}),
		});

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				await deleteOAuthCredentials(provider);
			}
			console.warn(
				`OAuth refresh failed for ${provider}: ${response.status}`,
			);
			return null;
		}

		const tokens = await readOAuthJson(response);
		if (typeof tokens.access_token !== "string" || !tokens.access_token) {
			throw new Error("The provider returned an invalid access token. Please try again.");
		}

		const newCredentials: OAuthCredentials = {
			refresh: tokens.refresh_token ?? credentials.refresh,
			access: tokens.access_token,
			expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			provider,
			apiKey: provider === "openai-codex"
				? undefined
				: typeof tokens.api_key === "string" ? tokens.api_key : credentials.apiKey,
			idToken: typeof tokens.id_token === "string" ? tokens.id_token : credentials.idToken,
		};

		await saveOAuthCredentials(newCredentials);
		return newCredentials;
	} catch (error) {
		console.warn(
			`OAuth refresh request failed for ${provider}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}

export function isOAuthProvider(providerName: string): providerName is OAuthProviderId {
	return getOAuthProviderIds().includes(providerName as OAuthProviderId);
}

export function providerToOAuthId(providerName: string): OAuthProviderId | null {
	if (providerName === "anthropic") return "anthropic";
	if (providerName === "openai-codex") return "openai-codex";
	if (providerName === "github-copilot") return "github-copilot";
	return null;
}
