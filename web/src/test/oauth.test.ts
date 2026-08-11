import { afterEach, describe, expect, it } from "bun:test";
import { mockEvent } from "h3";
import { getOAuthServerConfigs } from "../../server/api/oauth/config";
import {
	pollGitHubCopilotDeviceFlow,
	refreshGitHubCopilotToken,
	startGitHubCopilotDeviceFlow,
} from "../../server/api/oauth/github-copilot";
import {
	getOAuthProviderConfig,
	getOAuthProviderIds,
	getPendingOAuthRequest,
	initiateOAuth,
	OAUTH_MESSAGE_CHANNEL,
	providerToOAuthId,
	resolveOAuthRedirectUri,
	subscribeDesktopOAuthCallback,
	type OAuthCallbackResult,
} from "../keating/oauth";

const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalLocalStorage) {
		Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
	} else {
		delete (globalThis as { localStorage?: unknown }).localStorage;
	}
	if (originalWindow) {
		Object.defineProperty(globalThis, "window", originalWindow);
	} else {
		delete (globalThis as { window?: unknown }).window;
	}
});

function installLocalStorage() {
	const entries = new Map<string, string>();
	const storage = {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => entries.set(key, value),
		removeItem: (key: string) => entries.delete(key),
	};
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: storage,
	});
	return storage;
}

describe("OAuth provider wiring", () => {
	it("exports the browser callback message channel", () => {
		expect(OAUTH_MESSAGE_CHANNEL).toBe("keating-oauth-result");
	});

	it("keeps OpenAI API-key auth separate from Codex subscription auth", () => {
		expect(providerToOAuthId("openai")).toBeNull();
		expect(providerToOAuthId("openai-codex")).toBe("openai-codex");
	});

	it("uses OAuth for every subscription-backed catalog provider", () => {
		expect(providerToOAuthId("anthropic")).toBe("anthropic");
		expect(providerToOAuthId("github-copilot")).toBe("github-copilot");
		expect(getOAuthProviderIds()).toEqual(["anthropic", "openai-codex", "github-copilot"]);
	});

	it("uses the registered CLI loopback callback for Codex OAuth", () => {
		const config = getOAuthProviderConfig("openai-codex");
		expect(config.redirectUri).toBe("http://localhost:1455/auth/callback");
		expect(config.authorizeUrl).toBe("https://auth.openai.com/oauth/authorize");
	});

	it("keeps registered provider callbacks in production", () => {
		(globalThis as { location?: unknown }).location = {
			hostname: "keating.help",
			origin: "https://keating.help",
		};
		try {
			expect(resolveOAuthRedirectUri("openai-codex")).toBe("http://localhost:1455/auth/callback");
			// Anthropic keeps its provider-hosted code-display callback everywhere.
			expect(resolveOAuthRedirectUri("anthropic")).toBe("https://platform.claude.com/oauth/code/callback");
		} finally {
			delete (globalThis as { location?: unknown }).location;
		}
	});

	it("falls back to CLI loopback callbacks outside production", () => {
		(globalThis as { location?: unknown }).location = {
			hostname: "localhost",
			origin: "http://localhost:5173",
		};
		try {
			expect(resolveOAuthRedirectUri("openai-codex")).toBe("http://localhost:1455/auth/callback");
		} finally {
			delete (globalThis as { location?: unknown }).location;
		}
	});

	it("uses Anthropic's manual OAuth callback instead of a dead localhost redirect", () => {
		const config = getOAuthProviderConfig("anthropic");
		expect(config.authorizeUrl).toBe("https://claude.ai/oauth/authorize");
		expect(config.redirectUri).toBe("https://platform.claude.com/oauth/code/callback");
	});

	it("keeps Nitro provider config independent from browser storage modules", () => {
		const configs = getOAuthServerConfigs();
		expect(configs.anthropic.clientId).toBe(getOAuthProviderConfig("anthropic").clientId);
		expect(configs["openai-codex"].clientId).toBe(getOAuthProviderConfig("openai-codex").clientId);
	});

	it("requests the copy-paste code display flow for Anthropic", () => {
		const config = getOAuthProviderConfig("anthropic");
		expect(config.extraAuthParams?.code).toBe("true");
	});

	it("hands the real provider URL to Electron instead of opening a denied about:blank popup", async () => {
		installLocalStorage();
		const opened: Array<{ url: string; target?: string; features?: string }> = [];
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {
				keatingP2P: {},
				open: (url: string, target?: string, features?: string) => {
					opened.push({ url, target, features });
					return null;
				},
			},
		});

		await initiateOAuth("openai-codex");

		expect(opened).toHaveLength(1);
		expect(opened[0]?.url).toStartWith("https://auth.openai.com/oauth/authorize?");
		expect(opened[0]?.url).not.toContain("about:blank");
		expect(opened[0]).toMatchObject({ target: "_blank", features: "noopener,noreferrer" });
		expect(getPendingOAuthRequest()).toMatchObject({ flow: "authorization-code", provider: "openai-codex" });
	});

	it("hands a desktop loopback callback through the existing state-validated completion path", async () => {
		let callback: ((url: string) => void) | undefined;
		let unsubscribed = false;
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {
				keatingDesktop: {
					onOAuthCallback(listener: (url: string) => void) {
						callback = listener;
						return () => { unsubscribed = true; };
					},
				},
			},
		});
		const result = new Promise<OAuthCallbackResult>((resolve) => {
			const unsubscribe = subscribeDesktopOAuthCallback((value) => {
				unsubscribe();
				resolve(value);
			});
		});
		callback?.("http://localhost:1455/auth/callback?code=code&state=state");

		expect(await result).toMatchObject({ success: false, error: "No pending OAuth request found. Please try again." });
		expect(unsubscribed).toBe(true);
	});

	it("restores a pending Codex handoff after reload without exposing PKCE secrets", () => {
		const storage = installLocalStorage();
		storage.setItem("keating_oauth_pending", JSON.stringify({
			flow: "authorization-code",
			provider: "openai-codex",
			verifier: "pkce-secret",
			state: "oauth-state",
			redirectUri: "http://localhost:1455/auth/callback",
			createdAt: 1_000,
		}));

		const pending = getPendingOAuthRequest(2_000);
		expect(pending).toEqual({
			flow: "authorization-code",
			provider: "openai-codex",
			createdAt: 1_000,
			expiresAt: 601_000,
		});
		expect(JSON.stringify(pending)).not.toContain("pkce-secret");
		expect(JSON.stringify(pending)).not.toContain("oauth-state");
	});

	it("clears expired authorization-code handoffs instead of restoring stale UI", () => {
		const storage = installLocalStorage();
		storage.setItem("keating_oauth_pending", JSON.stringify({
			flow: "authorization-code",
			provider: "openai-codex",
			verifier: "pkce-secret",
			state: "oauth-state",
			redirectUri: "http://localhost:1455/auth/callback",
			createdAt: 1_000,
		}));

		expect(getPendingOAuthRequest(601_000)).toBeNull();
		expect(storage.getItem("keating_oauth_pending")).toBeNull();
	});

	it("restores a GitHub challenge without exposing its device credential", () => {
		const storage = installLocalStorage();
		storage.setItem("keating_oauth_pending", JSON.stringify({
			flow: "device-code",
			provider: "github-copilot",
			deviceCode: "device-secret",
			userCode: "ABCD-EFGH",
			verificationUri: "https://github.com/login/device",
			intervalSeconds: 5,
			expiresAt: 901_000,
			createdAt: 1_000,
		}));

		const pending = getPendingOAuthRequest(2_000);
		expect(pending).toEqual({
			flow: "device-code",
			provider: "github-copilot",
			userCode: "ABCD-EFGH",
			verificationUri: "https://github.com/login/device",
			createdAt: 1_000,
			expiresAt: 901_000,
		});
		expect(JSON.stringify(pending)).not.toContain("device-secret");
	});

	it("preserves the Codex OAuth access token for the SDK transport", async () => {
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			const params = new URLSearchParams(String(init?.body ?? ""));
			expect(params.get("grant_type")).toBe("authorization_code");
			return new Response(JSON.stringify({
				access_token: "codex-access-token",
				refresh_token: "codex-refresh-token",
				expires_in: 3600,
				id_token: "codex-id-token",
			}), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const handler = (await import("../../server/api/oauth/token")).default;
		const event = mockEvent(new Request("https://keating.test/api/oauth/token", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: "openai-codex",
				code: "authorization-code",
				redirect_uri: "http://localhost:1455/auth/callback",
				code_verifier: "verifier",
			}),
		}));
		const result = await handler(event) as Record<string, unknown>;

		expect(result.access_token).toBe("codex-access-token");
		expect(result.api_key).toBeUndefined();
	});
});

describe("GitHub Copilot device OAuth", () => {
	it("starts a trusted github.com device authorization", async () => {
		let requestBody = "";
		const device = await startGitHubCopilotDeviceFlow((async (input, init) => {
			expect(String(input)).toBe("https://github.com/login/device/code");
			requestBody = String(init?.body ?? "");
			return Response.json({
				device_code: "device-secret",
				user_code: "ABCD-EFGH",
				verification_uri: "https://github.com/login/device",
				interval: 5,
				expires_in: 900,
			});
		}) as typeof fetch);

		expect(new URLSearchParams(requestBody).get("scope")).toBe("read:user");
		expect(device).toEqual({
			device_code: "device-secret",
			user_code: "ABCD-EFGH",
			verification_uri: "https://github.com/login/device",
			interval: 5,
			expires_in: 900,
		});
	});

	it("reports authorization_pending without exposing an upstream token", async () => {
		const result = await pollGitHubCopilotDeviceFlow("device-secret", (async () =>
			Response.json({ error: "authorization_pending" })) as unknown as typeof fetch);
		expect(result).toEqual({ status: "pending" });
	});

	it("exchanges an approved device code for a refreshable Copilot credential", async () => {
		const urls: string[] = [];
		const fetcher = (async (input, init) => {
			urls.push(String(input));
			if (urls.length === 1) {
				expect(new URLSearchParams(String(init?.body)).get("device_code")).toBe("device-secret");
				return Response.json({ access_token: "github-access" });
			}
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-access");
			return Response.json({ token: "copilot-access", expires_at: Math.floor(Date.now() / 1000) + 1800 });
		}) as typeof fetch;

		const result = await pollGitHubCopilotDeviceFlow("device-secret", fetcher);
		expect(urls).toEqual([
			"https://github.com/login/oauth/access_token",
			"https://api.github.com/copilot_internal/v2/token",
		]);
		expect(result.status).toBe("complete");
		if (result.status === "complete") {
			expect(result.access_token).toBe("copilot-access");
			expect(result.refresh_token).toBe("github-access");
			expect(result.expires_in).toBeGreaterThan(1400);
		}
	});

	it("refreshes through the Nitro route using the durable GitHub token", async () => {
		globalThis.fetch = (async (_input, init) => {
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-access");
			return Response.json({ token: "copilot-refreshed", expires_at: Math.floor(Date.now() / 1000) + 1800 });
		}) as typeof fetch;
		const handler = (await import("../../server/api/oauth/refresh")).default;
		const event = mockEvent(
			new Request("https://keating.test/api/oauth/refresh", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "github-copilot", refresh_token: "github-access" }),
			}),
		);
		const result = await handler(event);
		expect(result.status).toBe("complete");
		expect(result.access_token).toBe("copilot-refreshed");
	});

	it("supports direct refresh helper coverage for a production smoke harness", async () => {
		const result = await refreshGitHubCopilotToken(
			"github-access",
			(async () => Response.json({ token: "copilot-refreshed", expires_at: Math.floor(Date.now() / 1000) + 1800 })) as unknown as typeof fetch,
		);
		expect(result.status).toBe("complete");
	});

	it("preserves a GitHub credential when refresh fails transiently", async () => {
		globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
		const handler = (await import("../../server/api/oauth/refresh")).default;
		const event = mockEvent(
			new Request("https://keating.test/api/oauth/refresh", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "github-copilot", refresh_token: "github-access" }),
			}),
		);
		try {
			await handler(event);
			throw new Error("Expected refresh to fail");
		} catch (error) {
			expect((error as { statusCode?: number }).statusCode).toBe(502);
		}
	});
});
