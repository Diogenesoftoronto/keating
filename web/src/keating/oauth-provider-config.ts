export type OAuthProviderId = "anthropic" | "openai-codex" | "github-copilot";

export type AuthorizationCodeOAuthProviderId = Exclude<OAuthProviderId, "github-copilot">;

export interface AuthorizationCodeOAuthProviderConfig {
	id: AuthorizationCodeOAuthProviderId;
	name: string;
	clientId: string;
	authorizeUrl: string;
	tokenUrl: string;
	scopes: string[];
	redirectUri: string;
	/** Extra params appended to the authorize URL query. */
	extraAuthParams?: Record<string, string>;
}

const AUTHORIZATION_CODE_OAUTH_PROVIDERS: Record<
	AuthorizationCodeOAuthProviderId,
	AuthorizationCodeOAuthProviderConfig
> = {
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
		authorizeUrl: "https://claude.ai/oauth/authorize",
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
		// This public Codex client registers only the CLI loopback callback. The
		// browser cannot listen on localhost, so users paste the final URL back.
		redirectUri: "http://localhost:1455/auth/callback",
		scopes: ["openid", "profile", "email", "offline_access"],
		extraAuthParams: {
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: "pi",
		},
	},
};

export function isAuthorizationCodeOAuthProvider(
	providerId: OAuthProviderId,
): providerId is AuthorizationCodeOAuthProviderId {
	return providerId !== "github-copilot";
}

export function getOAuthProviderConfig(
	id: AuthorizationCodeOAuthProviderId,
): AuthorizationCodeOAuthProviderConfig {
	return AUTHORIZATION_CODE_OAUTH_PROVIDERS[id];
}

export function getAuthorizationCodeOAuthProviderIds(): AuthorizationCodeOAuthProviderId[] {
	return Object.keys(AUTHORIZATION_CODE_OAUTH_PROVIDERS) as AuthorizationCodeOAuthProviderId[];
}
