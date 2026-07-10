type AppStorage = Awaited<ReturnType<typeof import("@earendil-works/pi-web-ui").getAppStorage>>;

let _getAppStorage: (() => AppStorage) | null = null;
async function getAppStorage(): Promise<AppStorage> {
	if (!_getAppStorage) {
		const mod = await import("@earendil-works/pi-web-ui");
		_getAppStorage = mod.getAppStorage;
	}
	return _getAppStorage();
}

export type OAuthProviderId = "anthropic" | "openai-codex" | "google-gemini-cli";

export interface OAuthCredentials {
	refresh: string;
	access: string;
	expires: number;
	provider: OAuthProviderId;
	apiKey?: string;
	idToken?: string;
	projectId?: string;
	email?: string;
}

export const OAUTH_MESSAGE_CHANNEL = "keating-oauth-result";

interface OAuthProviderConfig {
	id: OAuthProviderId;
	name: string;
	clientId: string;
	authorizeUrl: string;
	tokenUrl: string;
	scopes: string[];
	redirectUri?: string;
	/** Extra params appended to the authorize URL query */
	extraAuthParams?: Record<string, string>;
}

const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderConfig> = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
		authorizeUrl: "https://platform.claude.com/oauth/authorize",
		tokenUrl: "https://platform.claude.com/v1/oauth/token",
		redirectUri: "https://platform.claude.com/oauth/code/callback",
		scopes: [
			"org:create_api_key",
			"user:profile",
			"user:inference",
			"user:sessions:claude_code",
			"user:mcp_servers",
			"user:file_upload",
		],
		// `code=true` makes the callback page display the authorization code for copy-paste.
		extraAuthParams: {
			code: "true",
		},
	},
	"openai-codex": {
		id: "openai-codex",
		name: "OpenAI Codex",
		clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
		authorizeUrl: "https://auth.openai.com/oauth/authorize",
		tokenUrl: "https://auth.openai.com/oauth/token",
		// The Codex CLI client only has this loopback URI registered; a web origin is
		// rejected at the authorize step. The localhost page won't load — the user
		// pastes the final URL back into the app to finish sign-in.
		redirectUri: "http://localhost:1455/auth/callback",
		scopes: ["openid", "profile", "email", "offline_access"],
		extraAuthParams: {
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: "pi",
		},
	},
	"google-gemini-cli": {
		id: "google-gemini-cli",
		name: "Google Gemini CLI",
		clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
		authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
		tokenUrl: "https://oauth2.googleapis.com/token",
		redirectUri: "http://localhost:8085/oauth2callback",
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
	const origin = globalThis.location?.origin ?? "https://keating.help";
	return `${origin}/oauth/callback`;
}

const PROD_WEB_CALLBACK_HOSTS = new Set(["keating.help", "www.keating.help"]);

function isProdWebHost(): boolean {
	const host = globalThis.location?.hostname ?? "";
	return PROD_WEB_CALLBACK_HOSTS.has(host);
}

export function resolveOAuthRedirectUri(providerId: OAuthProviderId): string {
	const config = OAUTH_PROVIDERS[providerId];
	// Anthropic always uses its provider-hosted code-display callback. Google is
	// an installed app and therefore must always use its registered loopback URI;
	// its final URL is completed through the existing manual-paste UI. OpenAI is
	// the only browser OAuth flow that uses the keating.help callback in prod.
	if (providerId === "anthropic" || providerId === "google-gemini-cli") return config.redirectUri ?? getRedirectUri();
	if (isProdWebHost()) return getRedirectUri();
	return config.redirectUri ?? getRedirectUri();
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
	state: string;
	redirectUri: string;
	createdAt: number;
}

const PENDING_KEY = "keating_oauth_pending";

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

function createState(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

export function initiateOAuth(providerId: OAuthProviderId): void {
	const config = OAUTH_PROVIDERS[providerId];
	const redirectUri = resolveOAuthRedirectUri(providerId);

	generatePKCE().then(({ verifier, challenge }) => {
		const state = providerId === "anthropic" ? verifier : createState();
		savePendingOAuth({ verifier, provider: providerId, state, redirectUri, createdAt: Date.now() });

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

	const age = Date.now() - pending.createdAt;
	if (age > 10 * 60 * 1000) {
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
			apiKey: pending.provider === "openai-codex" ? undefined : typeof tokens.api_key === "string" ? tokens.api_key : undefined,
			idToken: typeof tokens.id_token === "string" ? tokens.id_token : undefined,
			projectId: typeof tokens.project_id === "string" ? tokens.project_id : undefined,
			email: typeof tokens.email === "string" ? tokens.email : undefined,
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
		return oauthCredentialToken(provider, refreshed);
	}

	return oauthCredentialToken(provider, credentials);
}

function oauthCredentialToken(provider: OAuthProviderId, credentials: OAuthCredentials): string {
	if (provider === "google-gemini-cli") {
		return JSON.stringify({ token: credentials.access, projectId: credentials.projectId });
	}
	// Codex models authenticate against chatgpt.com with the OAuth access token.
	// Ignore the stale API-key field written by older Keating builds.
	return provider === "openai-codex" ? credentials.access : credentials.apiKey ?? credentials.access;
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
			return null;
		}

		const tokens = await response.json();

		const newCredentials: OAuthCredentials = {
			refresh: tokens.refresh_token ?? credentials.refresh,
			access: tokens.access_token,
			expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			provider,
			apiKey: provider === "openai-codex" ? undefined : typeof tokens.api_key === "string" ? tokens.api_key : credentials.apiKey,
			idToken: typeof tokens.id_token === "string" ? tokens.id_token : credentials.idToken,
			projectId: typeof tokens.project_id === "string" ? tokens.project_id : credentials.projectId,
			email: typeof tokens.email === "string" ? tokens.email : credentials.email,
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
	if (providerName === "openai") return "openai-codex";
	if (providerName === "openai-codex") return "openai-codex";
	if (providerName === "google") return "google-gemini-cli";
	if (providerName === "google-gemini-cli") return "google-gemini-cli";
	return null;
}
