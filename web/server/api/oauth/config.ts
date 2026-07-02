export type OAuthServerProviderId = "anthropic" | "openai-codex" | "google-gemini-cli";

export interface OAuthServerConfig {
	tokenUrl: string;
	clientId: string;
	clientSecret?: string;
}

export function getOAuthServerConfigs(): Record<OAuthServerProviderId, OAuthServerConfig> {
	return {
		anthropic: {
			tokenUrl: "https://platform.claude.com/v1/oauth/token",
			clientId: process.env.OAUTH_ANTHROPIC_CLIENT_ID ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
		},
		"openai-codex": {
			tokenUrl: "https://auth.openai.com/oauth/token",
			clientId: process.env.OAUTH_OPENAI_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann",
		},
		"google-gemini-cli": {
			tokenUrl: "https://oauth2.googleapis.com/token",
			clientId: process.env.OAUTH_GOOGLE_CLIENT_ID ?? "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
			// Gemini CLI's public installed-app secret. Google's docs state secrets for
			// installed applications are not treated as confidential, and the CLI ships
			// this value in its open-source repo.
			clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET ?? "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",
		},
	};
}
