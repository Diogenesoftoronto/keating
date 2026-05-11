import { defineEventHandler, readBody, createError } from "h3";
import { getOAuthServerConfigs, type OAuthServerProviderId } from "./config";

interface TokenRequestBody {
	provider: string;
	code: string;
	redirect_uri: string;
	code_verifier: string;
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

	if (config.clientSecret) {
		tokenParams.client_secret = config.clientSecret;
	}

	try {
		const response = await fetch(config.tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(tokenParams).toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[oauth/token] ${body.provider} token exchange failed: ${response.status} ${errorText}`);
			throw createError({
				statusCode: 502,
				statusMessage: `Upstream token exchange failed: ${response.status}`,
			});
		}

		const tokenData = await response.json();
		return tokenData;
	} catch (error) {
		if ((error as any).statusCode) throw error;
		console.error(`[oauth/token] Error exchanging token for ${body.provider}:`, error);
		throw createError({
			statusCode: 500,
			statusMessage: "Token exchange request failed",
		});
	}
});
