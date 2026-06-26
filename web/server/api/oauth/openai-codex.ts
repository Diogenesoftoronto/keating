import { createError } from "h3";

const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";

export async function exchangeOpenAiCodexApiKey(
	clientId: string,
	idToken: string,
	clientSecret: string | undefined,
	logPrefix: "token" | "refresh",
): Promise<string> {
	const params: Record<string, string> = {
		grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
		client_id: clientId,
		requested_token: "openai-api-key",
		subject_token: idToken,
		subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
	};

	if (clientSecret) {
		params.client_secret = clientSecret;
	}

	const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params).toString(),
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error(`[oauth/${logPrefix}] openai-codex API-key exchange failed: ${response.status} ${errorText}`);
		throw createError({
			statusCode: response.status === 401 || response.status === 403 ? 401 : 502,
			statusMessage: `OpenAI Codex API-key exchange failed: ${response.status}`,
		});
	}

	const exchangeData = await response.json();
	if (typeof exchangeData.api_key !== "string" || !exchangeData.api_key) {
		console.error(`[oauth/${logPrefix}] openai-codex API-key exchange returned no api_key`);
		throw createError({
			statusCode: 502,
			statusMessage: "OpenAI Codex API-key exchange returned no api_key",
		});
	}

	return exchangeData.api_key;
}
