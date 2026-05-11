import { getAppStorage } from "@mariozechner/pi-web-ui";

export type OAuthProviderId = "anthropic" | "openai-codex" | "google-gemini-cli";

export interface OAuthCredentials {
	refresh: string;
	access: string;
	expires: number;
	provider: OAuthProviderId;
}

interface OAuthProviderConfig {
	id: OAuthProviderId;
	name: string;
	clientId: string;
	authorizeUrl: string;
	tokenUrl: string;
	scopes: string[];
	/** Extra params appended to the authorize URL query */
	extraAuthParams?: Record<string, string>;
}

const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderConfig> = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
		authorizeUrl: "https://claude.ai/oauth/authorize",
		tokenUrl: "https://platform.claude.com/v1/oauth/token",
		scopes: [
			"org:create_api_key",
			"user:profile",
			"user:inference",
			"user:sessions:claude_code",
			"user:mcp_servers",
			"user:file_upload",
		],
	},
	"openai-codex": {
		id: "openai-codex",
		name: "OpenAI Codex",
		clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
		authorizeUrl: "https://auth.openai.com/oauth/authorize",
		tokenUrl: "https://auth.openai.com/oauth/token",
		scopes: ["openid", "profile", "email", "offline_access"],
	},
	"google-gemini-cli": {
		id: "google-gemini-cli",
		name: "Google Gemini CLI",
		clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
		authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
		tokenUrl: "https://oauth2.googleapis.com/token",
		scopes: [
			"https://www.googleapis.com/auth/cloud-platform",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile",
		],
		extraAuthParams: {
			access_type: "offline",
			prompt: "consent",
		},
	},
};

function getRedirectUri(): string {
	const origin = globalThis.location?.origin ?? "";
	return `${origin}/oauth/callback`;
}

export function getOAuthProviderConfig(id: OAuthProviderId): OAuthProviderConfig {
	return OAUTH_PROVIDERS[id];
}

export function getOAuthProviderIds(): OAuthProviderId[] {
	return Object.keys(OAUTH_PROVIDERS) as OAuthProviderId[];
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

interface PendingOAuthState {
	verifier: string;
	provider: OAuthProviderId;
	createdAt: number;
}

const PENDING_KEY = "keating_oauth_pending";

function savePendingOAuth(state: PendingOAuthState): void {
	sessionStorage.setItem(PENDING_KEY, JSON.stringify(state));
}

function loadPendingOAuth(): PendingOAuthState | null {
	const raw = sessionStorage.getItem(PENDING_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PendingOAuthState;
	} catch {
		return null;
	}
}

function clearPendingOAuth(): void {
	sessionStorage.removeItem(PENDING_KEY);
}

export function initiateOAuth(providerId: OAuthProviderId): void {
	const config = OAUTH_PROVIDERS[providerId];
	const redirectUri = getRedirectUri();

	generatePKCE().then(({ verifier, challenge }) => {
		savePendingOAuth({ verifier, provider: providerId, createdAt: Date.now() });

		const params = new URLSearchParams({
			response_type: "code",
			client_id: config.clientId,
			redirect_uri: redirectUri,
			scope: config.scopes.join(" "),
			code_challenge: challenge,
			code_challenge_method: "S256",
		});

		if (config.extraAuthParams) {
			for (const [key, value] of Object.entries(config.extraAuthParams)) {
				params.set(key, value);
			}
		}

		const authUrl = `${config.authorizeUrl}?${params.toString()}`;

		const width = 600;
		const height = 700;
		const left = Math.max(0, (screen.width - width) / 2);
		const top = Math.max(0, (screen.height - height) / 2);

		window.open(
			authUrl,
			`keating-oauth-${providerId}`,
			`width=${width},height=${height},left=${left},top=${top},popup=yes`,
		);
	});
}

export interface OAuthCallbackResult {
	success: boolean;
	provider?: OAuthProviderId;
	error?: string;
}

export async function handleOAuthCallback(code: string): Promise<OAuthCallbackResult> {
	const pending = loadPendingOAuth();
	if (!pending) {
		return { success: false, error: "No pending OAuth request found. Please try again." };
	}

	const age = Date.now() - pending.createdAt;
	if (age > 10 * 60 * 1000) {
		clearPendingOAuth();
		return { success: false, error: "OAuth request expired. Please try again." };
	}

	const config = OAUTH_PROVIDERS[pending.provider];
	const redirectUri = getRedirectUri();

	clearPendingOAuth();

	try {
		const response = await fetch("/api/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: pending.provider,
				code,
				redirect_uri: redirectUri,
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
		};

		await saveOAuthCredentials(credentials);

		return { success: true, provider: pending.provider };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error during OAuth",
		};
	}
}

const OAUTH_STORAGE_KEY_PREFIX = "oauth:";

function oauthStorageKey(provider: OAuthProviderId): string {
	return `${OAUTH_STORAGE_KEY_PREFIX}${provider}`;
}

export async function saveOAuthCredentials(credentials: OAuthCredentials): Promise<void> {
	const storage = getAppStorage();
	const key = oauthStorageKey(credentials.provider);
	await storage.providerKeys.set(key, JSON.stringify(credentials));
}

export async function loadOAuthCredentials(provider: OAuthProviderId): Promise<OAuthCredentials | null> {
	const storage = getAppStorage();
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
	const storage = getAppStorage();
	const key = oauthStorageKey(provider);
	await storage.providerKeys.delete(key);
}

export async function getOAuthAccessToken(provider: OAuthProviderId): Promise<string | null> {
	const credentials = await loadOAuthCredentials(provider);
	if (!credentials) return null;

	if (Date.now() >= credentials.expires - 60_000) {
		const refreshed = await refreshOAuthToken(provider, credentials);
		if (!refreshed) return null;
		return refreshed.access;
	}

	return credentials.access;
}

async function refreshOAuthToken(
	provider: OAuthProviderId,
	credentials: OAuthCredentials,
): Promise<OAuthCredentials | null> {
	const config = OAUTH_PROVIDERS[provider];

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
			return null;
		}

		const tokens = await response.json();

		const newCredentials: OAuthCredentials = {
			refresh: tokens.refresh_token ?? credentials.refresh,
			access: tokens.access_token,
			expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			provider,
		};

		await saveOAuthCredentials(newCredentials);
		return newCredentials;
	} catch {
		return null;
	}
}

export function isOAuthProvider(providerName: string): providerName is OAuthProviderId {
	return providerName in OAUTH_PROVIDERS;
}

export function providerToOAuthId(providerName: string): OAuthProviderId | null {
	if (providerName === "anthropic") return "anthropic";
	if (providerName === "openai-codex") return "openai-codex";
	if (providerName === "google") return "google-gemini-cli";
	return null;
}
