import { afterEach, describe, expect, it } from "bun:test";
import { mockEvent } from "h3";
import { getOAuthServerConfigs } from "../../server/api/oauth/config";
import {
	pollGitHubCopilotDeviceFlow,
	refreshGitHubCopilotToken,
	startGitHubCopilotDeviceFlow,
} from "../../server/api/oauth/github-copilot";
import {
	cancelPendingOAuthRequest,
	completeOAuthFromInput,
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
				keatingDesktop: { prepareOAuthCallback: async () => ({ available: true }) },
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
		installLocalStorage();
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
			automatic: false,
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
		}) as unknown as typeof fetch;

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

function installOAuthWindow(desktop?: { prepareOAuthCallback?: (state: string, provider?: string) => Promise<{ available: boolean }>; cancelOAuthCallback?: () => Promise<void> }) {
	const destinations: string[] = [];
	let closed = false;
	const popup = { location: { replace: (url: string) => { destinations.push(url); } }, close: () => { closed = true; } };
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			...(desktop ? { keatingDesktop: desktop } : {}),
			open: (url: string) => {
				if (url === "about:blank") return popup;
				destinations.push(url);
				return null;
			},
		},
	});
	return { destinations, closed: () => closed };
}

function codexDeviceResponse(overrides: Record<string, unknown> = {}) {
	return { device_code: "private-device", user_code: "ABCD-EFGH", verification_uri: "https://auth.openai.com/codex/device", expires_in: 900, interval: 5, ...overrides };
}

describe("automatic OAuth and device authorization", () => {
	it("does not silently switch Claude to manual when its desktop receiver is unavailable", async () => {
		installLocalStorage();
		const ui = installOAuthWindow({ prepareOAuthCallback: async () => ({ available: false }) });
		await expect(initiateOAuth("anthropic")).rejects.toThrow("automatic return could not start");
		expect(ui.destinations).toHaveLength(0);
		expect(getPendingOAuthRequest()).toBeNull();
	});

	it("reports desktop preparation failures before opening Claude sign-in", async () => {
		installLocalStorage();
		const ui = installOAuthWindow({ prepareOAuthCallback: async () => { throw new Error("private-native-details"); } });
		await expect(initiateOAuth("anthropic")).rejects.toThrow("automatic return could not start");
		expect(ui.destinations).toHaveLength(0);
		expect(getPendingOAuthRequest()).toBeNull();
	});

	it("requires an update for an older desktop bridge instead of opening a manual Claude flow", async () => {
		installLocalStorage();
		const ui = installOAuthWindow({});
		await expect(initiateOAuth("anthropic")).rejects.toThrow("automatic return needs the updated desktop app");
		expect(ui.destinations).toHaveLength(0);
		expect(getPendingOAuthRequest()).toBeNull();
	});

	it("opens Claude's code page only when manual sign-in is explicitly selected on desktop", async () => {
		installLocalStorage();
		const ui = installOAuthWindow({ prepareOAuthCallback: async () => { throw new Error("Manual flow must not prepare a receiver"); } });
		expect(await initiateOAuth("anthropic", { method: "manual" })).toEqual({ flow: "authorization-code", automatic: false });
		expect(new URL(ui.destinations[0]).searchParams.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
		expect(getPendingOAuthRequest()).toMatchObject({ provider: "anthropic", automatic: false });
	});

	it.each([200, 404])("fails safely when Codex device startup returns an HTML %s page", async (status) => {
		installLocalStorage();
		const ui = installOAuthWindow();
		globalThis.fetch = (async () => new Response("<!doctype html><body>private-server-trace</body>", { status, headers: { "Content-Type": "text/html" } })) as unknown as typeof fetch;
		await expect(initiateOAuth("openai-codex")).rejects.toThrow("sign-in API returned a web page");
		expect(ui.destinations).toHaveLength(0);
		expect(ui.closed()).toBe(true);
		expect(getPendingOAuthRequest()).toBeNull();
	});

	it("returns a safe completion error when a valid Codex callback reaches an HTML token endpoint", async () => {
		const storage = installLocalStorage();
		installOAuthWindow({ prepareOAuthCallback: async () => ({ available: true }) });
		await initiateOAuth("openai-codex");
		const pending = JSON.parse(storage.getItem("keating_oauth_pending")!);
		globalThis.fetch = (async () => new Response("<html>private-token-endpoint-trace</html>", { status: 200 })) as unknown as typeof fetch;
		const result = await completeOAuthFromInput(`http://localhost:1455/auth/callback?code=code&state=${pending.state}`);
		expect(result.success).toBe(false);
		expect(result.error).toContain("sign-in API returned a web page");
		expect(result.error).not.toContain("private-token-endpoint-trace");
		expect(result.error).not.toContain("Unexpected token");
	});

	it("arms Anthropic with its PKCE verifier as state before opening the browser", async () => {
		const storage = installLocalStorage();
		let armed = false;
		const ui = installOAuthWindow({ prepareOAuthCallback: async (state, provider) => {
			expect(provider).toBe("anthropic");
			expect(state).toMatch(/^[A-Za-z0-9_-]{43,}$/);
			expect(ui.destinations).toHaveLength(0);
			armed = true;
			return { available: true };
		} });
		expect(await initiateOAuth("anthropic")).toEqual({ flow: "authorization-code", automatic: true });
		expect(armed).toBe(true);
		const pending = JSON.parse(storage.getItem("keating_oauth_pending")!);
		const url = new URL(ui.destinations[0]);
		expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:53692/callback");
		expect(url.searchParams.get("state")).toBe(pending.verifier);
		expect(pending.state).toBe(pending.verifier);
		expect(pending.automatic).toBe(true);
	});


	it("uses Anthropic's provider-hosted code page in browsers", async () => {
		installLocalStorage();
		const ui = installOAuthWindow();
		expect(await initiateOAuth("anthropic")).toEqual({ flow: "authorization-code", automatic: false });
		expect(new URL(ui.destinations[0]).searchParams.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
	});

	it("uses device authorization in browsers and opens only the trusted OpenAI confirmation page", async () => {
		installLocalStorage();
		const ui = installOAuthWindow();
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			expect(String(input)).toBe("/api/oauth/openai-codex/device");
			expect(init?.method).toBe("POST");
			return Response.json(codexDeviceResponse());
		}) as unknown as typeof fetch;
		expect(await initiateOAuth("openai-codex")).toMatchObject({ flow: "device-code", provider: "openai-codex", userCode: "ABCD-EFGH" });
		expect(ui.destinations).toEqual(["https://auth.openai.com/codex/device"]);
		expect(JSON.stringify(getPendingOAuthRequest())).not.toContain("private-device");
	});

	it("releases an earlier desktop receiver before switching to device or manual sign-in", async () => {
		for (const [provider, method] of [["openai-codex", "device-code"], ["anthropic", "manual"]] as const) {
			installLocalStorage();
			const events: string[] = [];
			const ui = installOAuthWindow({
				cancelOAuthCallback: async () => { events.push("cancel"); },
				prepareOAuthCallback: async () => { throw new Error("Explicit fallback must not arm the receiver"); },
			});
			globalThis.fetch = (async () => {
				expect(events).toEqual(["cancel"]);
				return Response.json(codexDeviceResponse());
			}) as unknown as typeof fetch;
			await initiateOAuth(provider, { method });
			expect(events).toEqual(["cancel"]);
			expect(ui.destinations).toHaveLength(1);
		}
	});

	it("falls back to Codex device authorization when the desktop port is unavailable", async () => {
		installLocalStorage();
		let prepared = false;
		const ui = installOAuthWindow({ prepareOAuthCallback: async () => { prepared = true; return { available: false }; } });
		globalThis.fetch = (async () => { expect(prepared).toBe(true); return Response.json(codexDeviceResponse()); }) as unknown as typeof fetch;
		expect(await initiateOAuth("openai-codex")).toMatchObject({ flow: "device-code" });
		expect(ui.destinations).toEqual(["https://auth.openai.com/codex/device"]);
	});

	it("refuses malformed or untrusted device challenges without opening a destination", async () => {
		for (const invalid of [{ verification_uri: "https://attacker.example/" }, { device_code: "" }, { user_code: "" }, { expires_in: -1 }, { interval: -1 }]) {
			installLocalStorage();
			const ui = installOAuthWindow();
			globalThis.fetch = (async () => Response.json(codexDeviceResponse(invalid))) as unknown as typeof fetch;
			await expect(initiateOAuth("openai-codex")).rejects.toThrow("invalid device sign-in response");
			expect(ui.destinations).toHaveLength(0);
			expect(ui.closed()).toBe(true);
			expect(getPendingOAuthRequest()).toBeNull();
		}
	});

	it("cancelling an in-flight device challenge cannot restore pending sign-in", async () => {
		installLocalStorage();
		const ui = installOAuthWindow();
		let respond!: (response: Response) => void;
		globalThis.fetch = (() => new Promise<Response>(resolve => { respond = resolve; })) as unknown as typeof fetch;
		const attempt = initiateOAuth("openai-codex");
		cancelPendingOAuthRequest();
		respond(Response.json(codexDeviceResponse()));
		await expect(attempt).rejects.toThrow("cancelled");
		expect(getPendingOAuthRequest()).toBeNull();
		expect(ui.destinations).toHaveLength(0);
	});

	it("cancelling while desktop preparation runs prevents the browser handoff", async () => {
		installLocalStorage();
		let ready!: (value: { available: boolean }) => void;
		let entered!: () => void;
		const started = new Promise<void>(resolve => { entered = resolve; });
		const ui = installOAuthWindow({ prepareOAuthCallback: () => { entered(); return new Promise(resolve => { ready = resolve; }); } });
		const attempt = initiateOAuth("anthropic");
		await started;
		cancelPendingOAuthRequest();
		ready({ available: true });
		await expect(attempt).rejects.toThrow("cancelled");
		expect(getPendingOAuthRequest()).toBeNull();
		expect(ui.destinations).toHaveLength(0);
	});

	it("refuses missing or mismatched state in automatic callbacks before token exchange", async () => {
		for (const state of [undefined, "wrong-state"]) {
			installLocalStorage();
			installOAuthWindow({ prepareOAuthCallback: async () => ({ available: true }) });
			await initiateOAuth("anthropic");
			let requests = 0;
			globalThis.fetch = (async () => { requests++; throw new Error("Token exchange must not run"); }) as unknown as typeof fetch;
			const query = state ? `?code=proof&state=${state}` : "?code=proof";
			expect(await completeOAuthFromInput(`http://localhost:53692/callback${query}`)).toMatchObject({ success: false, error: "OAuth state mismatch. Please try signing in again." });
			expect(requests).toBe(0);
		}
	});
});

describe("GitHub Copilot device OAuth", () => {
	it("starts a trusted github.com device authorization", async () => {
		let requestBody = "";
		const device = await startGitHubCopilotDeviceFlow((async (input: string | URL | Request, init?: RequestInit) => {
			expect(String(input)).toBe("https://github.com/login/device/code");
			requestBody = String(init?.body ?? "");
			return Response.json({
				device_code: "device-secret",
				user_code: "ABCD-EFGH",
				verification_uri: "https://github.com/login/device",
				interval: 5,
				expires_in: 900,
			});
		}) as unknown as typeof fetch);

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
			Response.json({ error: "authorization_pending" })) as unknown as unknown as typeof fetch);
		expect(result).toEqual({ status: "pending" });
	});

	it("exchanges an approved device code for a refreshable Copilot credential", async () => {
		const urls: string[] = [];
		const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
			urls.push(String(input));
			if (urls.length === 1) {
				expect(new URLSearchParams(String(init?.body)).get("device_code")).toBe("device-secret");
				return Response.json({ access_token: "github-access" });
			}
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-access");
			return Response.json({ token: "copilot-access", expires_at: Math.floor(Date.now() / 1000) + 1800 });
		}) as unknown as typeof fetch;

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
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-access");
			return Response.json({ token: "copilot-refreshed", expires_at: Math.floor(Date.now() / 1000) + 1800 });
		}) as unknown as typeof fetch;
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
			(async () => Response.json({ token: "copilot-refreshed", expires_at: Math.floor(Date.now() / 1000) + 1800 })) as unknown as unknown as typeof fetch,
		);
		expect(result.status).toBe("complete");
	});

	it("preserves a GitHub credential when refresh fails transiently", async () => {
		globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as unknown as unknown as typeof fetch;
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
