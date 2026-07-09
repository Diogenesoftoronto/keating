import { defineEventHandler, readBody, createError } from "h3";
import { getOAuthServerConfigs, type OAuthServerProviderId } from "./config";
import { discoverGoogleCloudProject } from "./google-gemini";

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
		// Anthropic's token endpoint only accepts JSON bodies; the others take form encoding.
		const response = await fetch(config.tokenUrl, {
			method: "POST",
			...(body.provider === "anthropic"
				? {
						headers: { "Content-Type": "application/json", Accept: "application/json" },
						body: JSON.stringify(refreshParams),
					}
				: {
						headers: { "Content-Type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams(refreshParams).toString(),
					}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[oauth/refresh] ${body.provider} refresh failed: ${response.status} ${errorText}`);
			throw createError({
				statusCode: response.status === 401 || response.status === 403 ? 401 : 502,
				statusMessage: `Token refresh failed (${response.status}): ${errorText.slice(0, 240)}`,
			});
		}

		const tokenData = await response.json() as Record<string, unknown>;
		if (body.provider === "google-gemini-cli" && typeof tokenData.access_token === "string") {
			tokenData.project_id = await discoverGoogleCloudProject(tokenData.access_token);
		}
		return tokenData;
	} catch (error) {
		if ((error as any).statusCode) throw error;
		console.error(`[oauth/refresh] Error refreshing token for ${body.provider}:`, error);
		const message = error instanceof Error ? error.message : String(error);
		throw createError({ statusCode: 502, statusMessage: `Token refresh request failed: ${message}` });
	}
});
