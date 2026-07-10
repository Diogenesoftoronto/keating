import { defineEventHandler, readBody, createError } from "h3";
import { getOAuthServerConfigs, type OAuthServerProviderId } from "./config";
import { discoverGoogleCloudProject } from "./google-gemini";
import { exchangeOpenAiCodexApiKey } from "./openai-codex";

interface TokenRequestBody {
	provider: string;
	code: string;
	redirect_uri: string;
	code_verifier: string;
	state?: string;
}

export default defineEventHandler(async (event) => {
	const body = await readBody<TokenRequestBody>(event);

	if (!body?.provider || !body?.code || !body?.redirect_uri || !body?.code_verifier) {
		throw createError({
			statusCode: 400,
			statusMessage: "Missing required fields: provider, code, redirect_uri, code_verifier",
		});
	}

	const configs = getOAuthServerConfigs();
	const config = configs[body.provider as OAuthServerProviderId];
	if (!config) {
		throw createError({
			statusCode: 400,
			statusMessage: `Unsupported OAuth provider: ${body.provider}`,
		});
	}

	const tokenParams: Record<string, string> = {
		grant_type: "authorization_code",
		code: body.code,
		redirect_uri: body.redirect_uri,
		code_verifier: body.code_verifier,
		client_id: config.clientId,
	};

	if (body.provider === "anthropic" && body.state) {
		tokenParams.state = body.state;
	}

	if (config.clientSecret) {
		tokenParams.client_secret = config.clientSecret;
	}

	try {
		// Anthropic's token endpoint only accepts JSON bodies; the others take form encoding.
		const response = await fetch(config.tokenUrl, {
			method: "POST",
			...(body.provider === "anthropic"
				? {
						headers: { "Content-Type": "application/json", Accept: "application/json" },
						body: JSON.stringify(tokenParams),
					}
				: {
						headers: { "Content-Type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams(tokenParams).toString(),
					}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[oauth/token] ${body.provider} token exchange failed: ${response.status} ${errorText}`);
			throw createError({
				statusCode: 502,
				statusMessage: `${body.provider} token exchange failed (${response.status}): ${errorText.slice(0, 240)}`,
			});
		}

		const tokenData = await response.json() as Record<string, unknown>;
		if (body.provider === "openai-codex" && typeof tokenData.id_token === "string") {
			tokenData.api_key = await exchangeOpenAiCodexApiKey(config.clientId, tokenData.id_token, config.clientSecret, "token");
		}
		if (body.provider === "google-gemini-cli" && typeof tokenData.access_token === "string") {
			tokenData.project_id = await discoverGoogleCloudProject(tokenData.access_token);
		}
		return tokenData;
	} catch (error) {
		if ((error as any).statusCode) throw error;
		console.error(`[oauth/token] Error exchanging token for ${body.provider}:`, error);
		const message = error instanceof Error ? error.message : String(error);
		throw createError({ statusCode: 502, statusMessage: `Token exchange request failed: ${message}` });
	}
});
