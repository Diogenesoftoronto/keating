import { getOAuthProviderConfig } from "../../../src/keating/oauth-provider-config";

export type OAuthServerProviderId = "anthropic" | "openai-codex";

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
	};
}
