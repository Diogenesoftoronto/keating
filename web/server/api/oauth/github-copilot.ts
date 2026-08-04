const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

const COPILOT_HEADERS = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.107.0",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
};

export class OAuthUpstreamError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "OAuthUpstreamError";
	}
}

export interface GitHubCopilotDeviceAuthorization {
	device_code: string;
	user_code: string;
	verification_uri: string;
	interval: number;
	expires_in: number;
}

export type GitHubCopilotDevicePollResult =
	| { status: "pending" }
	| { status: "slow_down" }
	| { status: "failed"; error: string }
	| {
			status: "complete";
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

function requireRecord(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== "object") throw new Error(message);
	return value as Record<string, unknown>;
}

async function readJson(response: Response, message: string): Promise<Record<string, unknown>> {
	if (!response.ok) throw new OAuthUpstreamError(`${message}: upstream returned ${response.status}`, response.status);
	return requireRecord(await response.json(), message);
}

export async function startGitHubCopilotDeviceFlow(
	fetcher: typeof fetch = fetch,
): Promise<GitHubCopilotDeviceAuthorization> {
	const response = await fetcher(GITHUB_DEVICE_CODE_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": COPILOT_HEADERS["User-Agent"],
		},
		body: new URLSearchParams({
			client_id: GITHUB_CLIENT_ID,
			scope: "read:user",
		}),
	});
	const data = await readJson(response, "GitHub device authorization failed");
	const verificationUri = typeof data.verification_uri === "string" ? data.verification_uri : "";
	let parsedVerificationUri: URL;
	try {
		parsedVerificationUri = new URL(verificationUri);
	} catch {
		throw new Error("GitHub returned an invalid device verification URL");
	}
	if (parsedVerificationUri.protocol !== "https:" || parsedVerificationUri.hostname !== "github.com") {
		throw new Error("GitHub returned an untrusted device verification URL");
	}
	if (
		typeof data.device_code !== "string" ||
		typeof data.user_code !== "string" ||
		typeof data.expires_in !== "number"
	) {
		throw new Error("GitHub returned an invalid device authorization response");
	}
	return {
		device_code: data.device_code,
		user_code: data.user_code,
		verification_uri: parsedVerificationUri.href,
		interval: typeof data.interval === "number" ? data.interval : 5,
		expires_in: data.expires_in,
	};
}

async function exchangeGitHubCopilotToken(
	githubAccessToken: string,
	fetcher: typeof fetch,
): Promise<Extract<GitHubCopilotDevicePollResult, { status: "complete" }>> {
	const response = await fetcher(GITHUB_COPILOT_TOKEN_URL, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${githubAccessToken}`,
			...COPILOT_HEADERS,
		},
	});
	const data = await readJson(response, "GitHub Copilot token exchange failed");
	if (typeof data.token !== "string" || typeof data.expires_at !== "number") {
		throw new Error("GitHub returned an invalid Copilot token response");
	}
	return {
		status: "complete",
		access_token: data.token,
		refresh_token: githubAccessToken,
		expires_in: Math.max(1, Math.floor(data.expires_at - Date.now() / 1000 - 300)),
	};
}

export async function pollGitHubCopilotDeviceFlow(
	deviceCode: string,
	fetcher: typeof fetch = fetch,
): Promise<GitHubCopilotDevicePollResult> {
	const response = await fetcher(GITHUB_ACCESS_TOKEN_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": COPILOT_HEADERS["User-Agent"],
		},
		body: new URLSearchParams({
			client_id: GITHUB_CLIENT_ID,
			device_code: deviceCode,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		}),
	});
	const data = await readJson(response, "GitHub device token polling failed");
	if (typeof data.access_token === "string") {
		return exchangeGitHubCopilotToken(data.access_token, fetcher);
	}
	if (data.error === "authorization_pending") return { status: "pending" };
	if (data.error === "slow_down") return { status: "slow_down" };
	const description = typeof data.error_description === "string" ? data.error_description : undefined;
	return {
		status: "failed",
		error: description ?? (typeof data.error === "string" ? data.error : "GitHub device authorization failed"),
	};
}

export async function refreshGitHubCopilotToken(
	githubAccessToken: string,
	fetcher: typeof fetch = fetch,
): Promise<Extract<GitHubCopilotDevicePollResult, { status: "complete" }>> {
	return exchangeGitHubCopilotToken(githubAccessToken, fetcher);
}
