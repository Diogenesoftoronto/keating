import { defineEventHandler, readBody, createError } from "h3";
import { getOAuthServerConfigs, type OAuthServerProviderId } from "./config";

interface RefreshRequestBody {
	provider: string;
	refresh_token: string;
}

export default defineEventHandler(async (event) => {
	const body = await readBody<RefreshRequestBody>(event);

	if (!body?.provider || !body?.refresh_token) {
		throw createError({
			statusCode: 400,
			statusMessage: "Missing required fields: provider, refresh_token",
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

	const refreshParams: Record<string, string> = {
		grant_type: "refresh_token",
		refresh_token: body.refresh_token,
		client_id: config.clientId,
	};

	if (config.clientSecret) {
		refreshParams.client_secret = config.clientSecret;
	}

	try {
		const response = await fetch(config.tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(refreshParams).toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[oauth/refresh] ${body.provider} refresh failed: ${response.status} ${errorText}`);
			throw createError({
				statusCode: response.status === 401 || response.status === 403 ? 401 : 502,
				statusMessage: `Token refresh failed: ${response.status}`,
			});
		}

		const tokenData = await response.json();
		return tokenData;
	} catch (error) {
		if ((error as any).statusCode) throw error;
		console.error(`[oauth/refresh] Error refreshing token for ${body.provider}:`, error);
		throw createError({
			statusCode: 500,
			statusMessage: "Token refresh request failed",
		});
	}
});
