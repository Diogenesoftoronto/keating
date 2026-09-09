import { getOAuthServerConfigs } from "./config";

const AUTH_ORIGIN = "https://auth.openai.com";
const MAX_RESPONSE_BYTES = 65_536;
const REQUEST_TIMEOUT_MS = 15_000;

type Fetcher = typeof fetch;
type JsonObject = Record<string, unknown>;

export class CodexDeviceAuthError extends Error {
	constructor(message: string, readonly statusCode = 502) {
		super(message);
		this.name = "CodexDeviceAuthError";
	}
}

function boundedString(value: unknown, maxLength: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value;
}

async function readJson(response: Response): Promise<JsonObject> {
	const reader = response.body?.getReader();
	if (!reader) throw new CodexDeviceAuthError("OpenAI returned an invalid sign-in response.");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new Error("Response too large");
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid JSON object");
		return result as JsonObject;
	} catch {
		throw new CodexDeviceAuthError("OpenAI returned an invalid sign-in response.");
	} finally {
		reader.releaseLock();
	}
}

async function request(fetcher: Fetcher, path: string, body: string, form = false) {
	try {
		return await fetcher(`${AUTH_ORIGIN}${path}`, {
			method: "POST",
			headers: {
				"Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
				Accept: "application/json",
			},
			body,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			redirect: "error",
		});
	} catch {
		throw new CodexDeviceAuthError("Could not reach OpenAI. Try signing in again.");
	}
}

export async function startCodexDeviceAuth(fetcher: Fetcher = fetch) {
	const response = await request(fetcher, "/api/accounts/deviceauth/usercode", JSON.stringify({
		client_id: getOAuthServerConfigs()["openai-codex"].clientId,
	}));
	if (!response.ok) {
		await response.body?.cancel();
		throw new CodexDeviceAuthError(response.status === 404
			? "OpenAI device sign-in is unavailable. Check that device code authorization is enabled in your ChatGPT security settings."
			: "OpenAI could not start sign-in. Try again.");
	}
	const json = await readJson(response);
	const interval = typeof json.interval === "string" && /^\d+(?:\.\d+)?$/.test(json.interval)
		? Number(json.interval) : json.interval;
	if (!boundedString(json.device_auth_id, 1_024) || !boundedString(json.user_code, 64)
		|| typeof interval !== "number" || !Number.isFinite(interval) || interval < 0 || interval > 60) {
		throw new CodexDeviceAuthError("OpenAI returned an invalid sign-in response.");
	}
	return {
		device_code: json.device_auth_id,
		user_code: json.user_code,
		verification_uri: `${AUTH_ORIGIN}/codex/device`,
		interval: Math.max(1, Math.ceil(interval)),
		expires_in: 900,
	};
}

export async function pollCodexDeviceAuth(body: unknown, fetcher: Fetcher = fetch) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new CodexDeviceAuthError("A device code and user code are required.", 400);
	}
	const input = body as JsonObject;
	if (!boundedString(input.device_code, 1_024) || !boundedString(input.user_code, 64)) {
		throw new CodexDeviceAuthError("A valid device code and user code are required.", 400);
	}
	const response = await request(fetcher, "/api/accounts/deviceauth/token", JSON.stringify({
		device_auth_id: input.device_code,
		user_code: input.user_code,
	}));
	if (!response.ok) {
		const json = await readJson(response).catch(() => ({} as JsonObject));
		const error = json.error;
		const code = error && typeof error === "object" ? (error as JsonObject).code : error;
		// Explicit outcomes take precedence over the provider's usual pending HTTP status.
		if (code === "slow_down") return { status: "slow_down" as const };
		if (code === "access_denied" || code === "authorization_declined") {
			return { status: "denied" as const, error: "OpenAI sign-in was declined." };
		}
		if (code === "expired_token" || code === "device_code_expired") {
			return { status: "expired" as const, error: "This sign-in code expired. Start sign-in again." };
		}
		if (response.status === 403 || response.status === 404
			|| code === "authorization_pending" || code === "deviceauth_authorization_pending") {
			return { status: "pending" as const };
		}
		throw new CodexDeviceAuthError("OpenAI could not complete sign-in. Start sign-in again.");
	}
	const authorization = await readJson(response);
	if (!boundedString(authorization.authorization_code, 4_096) || !boundedString(authorization.code_verifier, 256)) {
		throw new CodexDeviceAuthError("OpenAI returned an invalid sign-in response.");
	}
	const tokenResponse = await request(fetcher, "/oauth/token", new URLSearchParams({
		grant_type: "authorization_code",
		code: authorization.authorization_code,
		code_verifier: authorization.code_verifier,
		redirect_uri: `${AUTH_ORIGIN}/deviceauth/callback`,
		client_id: getOAuthServerConfigs()["openai-codex"].clientId,
	}).toString(), true);
	if (!tokenResponse.ok) {
		await tokenResponse.body?.cancel();
		throw new CodexDeviceAuthError("OpenAI could not finish sign-in. Start sign-in again.");
	}
	const tokens = await readJson(tokenResponse);
	if (!boundedString(tokens.access_token, 32_768) || !boundedString(tokens.refresh_token, 16_384)
		|| typeof tokens.expires_in !== "number" || !Number.isFinite(tokens.expires_in)
		|| tokens.expires_in <= 0 || tokens.expires_in > 31_536_000) {
		throw new CodexDeviceAuthError("OpenAI returned invalid sign-in credentials. Start sign-in again.");
	}
	// Codex consumes the ChatGPT access token directly, never an exchanged API key.
	return {
		status: "complete" as const,
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token,
		expires_in: tokens.expires_in,
	};
}
