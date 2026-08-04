import { getAppStorage as piGetAppStorage } from "@earendil-works/pi-web-ui";
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

type AppStorage = Awaited<ReturnType<typeof piGetAppStorage>>;

function getAppStorage(): AppStorage {
	return piGetAppStorage();
}

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

interface PendingAuthorizationCodeOAuthState {
	flow: "authorization-code";
	verifier: string;
	provider: AuthorizationCodeOAuthProviderId;
	state: string;
	redirectUri: string;
	createdAt: number;
}

interface PendingDeviceOAuthState {
	flow: "device-code";
	provider: "github-copilot";
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
			provider: AuthorizationCodeOAuthProviderId;
			createdAt: number;
			expiresAt: number;
		}
	| {
			flow: "device-code";
			provider: "github-copilot";
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

export function cancelPendingOAuthRequest(): void {
	clearPendingOAuth();
}

function createState(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

export type OAuthInitiationResult =
	| { flow: "authorization-code" }
	| {
			flow: "device-code";
			provider: "github-copilot";
			userCode: string;
			verificationUri: string;
			expiresAt: number;
		};

function openOAuthPopup(providerId: OAuthProviderId): Window {
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

export async function initiateOAuth(providerId: OAuthProviderId): Promise<OAuthInitiationResult> {
	const popup = openOAuthPopup(providerId);
	try {
		if (providerId === "github-copilot") {
			const response = await fetch("/api/oauth/github-copilot/device", { method: "POST" });
			if (!response.ok) throw new Error(`GitHub device authorization failed: ${response.status}`);
			const device = await response.json();
			if (
				typeof device.device_code !== "string" ||
				typeof device.user_code !== "string" ||
				typeof device.verification_uri !== "string" ||
				typeof device.expires_in !== "number"
			) {
				throw new Error("GitHub returned an invalid device authorization response.");
			}
			const expiresAt = Date.now() + device.expires_in * 1000;
			savePendingOAuth({
				flow: "device-code",
				provider: providerId,
				deviceCode: device.device_code,
				userCode: device.user_code,
				verificationUri: device.verification_uri,
				intervalSeconds: typeof device.interval === "number" ? device.interval : 5,
				expiresAt,
				createdAt: Date.now(),
			});
			popup.location.replace(device.verification_uri);
			return {
				flow: "device-code",
				provider: providerId,
				userCode: device.user_code,
				verificationUri: device.verification_uri,
				expiresAt,
			};
		}

		const config = getOAuthProviderConfig(providerId);
		const redirectUri = resolveOAuthRedirectUri(providerId);
		const { verifier, challenge } = await generatePKCE();
		const state = providerId === "anthropic" ? verifier : createState();
		savePendingOAuth({
			flow: "authorization-code",
			verifier,
			provider: providerId,
			state,
			redirectUri,
			createdAt: Date.now(),
		});

		const params = new URLSearchParams({
			response_type: "code",
			client_id: config.clientId,
			redirect_uri: redirectUri,
			scope: config.scopes.join(" "),
			code_challenge: challenge,
			code_challenge_method: "S256",
			state,
		});

		if (config.extraAuthParams) {
			for (const [key, value] of Object.entries(config.extraAuthParams)) {
				params.set(key, value);
			}
		}

		popup.location.replace(`${config.authorizeUrl}?${params.toString()}`);
		return { flow: "authorization-code" };
	} catch (error) {
		popup.close();
		throw error;
	}
}

export interface OAuthCallbackResult {
	success: boolean;
	provider?: OAuthProviderId;
	error?: string;
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

	if (state && state !== pending.state) {
		clearPendingOAuth();
		return { success: false, error: "OAuth state mismatch. Please try signing in again." };
	}

	if (!state && pending.provider === "anthropic") {
		state = pending.state;
	}

	try {
		const response = await fetch("/api/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: pending.provider,
				code,
				state: state ?? pending.state,
				redirect_uri: pending.redirectUri,
				code_verifier: pending.verifier,
			}),
		});

		if (!response.ok) {
			const errorBody = await response.text();
			throw new Error(`Token exchange failed: ${response.status} ${errorBody}`);
		}

		const tokens = await response.json();

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
	provider: "github-copilot",
	signal?: AbortSignal,
): Promise<OAuthCallbackResult> {
	const pending = loadPendingOAuth();
	if (!pending || pending.flow !== "device-code" || pending.provider !== provider) {
		return { success: false, error: "No pending GitHub Copilot sign-in was found." };
	}

	let intervalSeconds = pending.intervalSeconds;
	try {
		while (Date.now() < pending.expiresAt) {
			await waitForDevicePoll(intervalSeconds * 1000, signal);
			const response = await fetch("/api/oauth/github-copilot/poll", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ device_code: pending.deviceCode }),
			});
			if (response.status === 202) continue;
			if (response.status === 429) {
				intervalSeconds += 5;
				continue;
			}
			if (!response.ok) {
				throw new Error(`GitHub Copilot sign-in failed: ${response.status}`);
			}
			const tokens = await response.json();
			if (tokens.status !== "complete" || typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") {
				throw new Error("GitHub returned an invalid Copilot token response.");
			}
			await saveOAuthCredentials({
				refresh: tokens.refresh_token,
				access: tokens.access_token,
				expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
				provider,
			});
			clearPendingOAuth();
			return { success: true, provider };
		}
		clearPendingOAuth();
		return { success: false, error: "GitHub Copilot sign-in expired. Please try again." };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "GitHub Copilot sign-in failed.",
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

export async function getOAuthAccessToken(provider: OAuthProviderId): Promise<string | null> {
	const credentials = await loadOAuthCredentials(provider);
	if (!credentials) return null;

	if (Date.now() >= credentials.expires - 60_000) {
		const refreshed = await refreshOAuthToken(provider, credentials);
		if (!refreshed) return null;
		return refreshed.apiKey ?? refreshed.access;
	}

	return credentials.apiKey ?? credentials.access;
}

async function refreshOAuthToken(
	provider: OAuthProviderId,
	credentials: OAuthCredentials,
): Promise<OAuthCredentials | null> {
	try {
		const response = await fetch("/api/oauth/refresh", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				provider,
				refresh_token: credentials.refresh,
			}),
		});

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				await deleteOAuthCredentials(provider);
			}
			const detail = await response.text().catch(() => "");
			console.warn(
				`OAuth refresh failed for ${provider}: ${response.status}${detail ? ` ${detail.slice(0, 240)}` : ""}`,
			);
			return null;
		}

		const tokens = await response.json();

		const newCredentials: OAuthCredentials = {
			refresh: tokens.refresh_token ?? credentials.refresh,
			access: tokens.access_token,
			expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			provider,
			apiKey: typeof tokens.api_key === "string" ? tokens.api_key : credentials.apiKey,
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
	if (providerName === "openai") return "openai-codex";
	if (providerName === "openai-codex") return "openai-codex";
	if (providerName === "github-copilot") return "github-copilot";
	return null;
}
