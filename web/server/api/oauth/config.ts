import { getOAuthProviderConfig } from "../../../src/keating/oauth";

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
			clientId: process.env.OAUTH_ANTHROPIC_CLIENT_ID ?? getOAuthProviderConfig("anthropic").clientId,
		},
		"openai-codex": {
			tokenUrl: "https://auth.openai.com/oauth/token",
			clientId: process.env.OAUTH_OPENAI_CLIENT_ID ?? getOAuthProviderConfig("openai-codex").clientId,
		},
		"google-gemini-cli": {
			tokenUrl: "https://oauth2.googleapis.com/token",
			clientId: process.env.OAUTH_GOOGLE_CLIENT_ID ?? getOAuthProviderConfig("google-gemini-cli").clientId,
			// Gemini CLI's public installed-app secret (Google does not treat
			// installed-app secrets as confidential and the CLI ships it in its
			// open-source repo), but GitHub push protection blocks the literal in
			// source, so it must come from env. See web/.env.example.
			clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET,
		},
	};
}
