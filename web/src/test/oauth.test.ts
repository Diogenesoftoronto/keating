import { describe, expect, it } from "bun:test";
import { getOAuthProviderConfig, providerToOAuthId, resolveOAuthRedirectUri } from "../keating/oauth";

describe("OAuth provider wiring", () => {
	it("uses Codex OAuth for the built-in OpenAI provider", () => {
		expect(providerToOAuthId("openai")).toBe("openai-codex");
		expect(providerToOAuthId("openai-codex")).toBe("openai-codex");
	});

	it("uses the registered CLI loopback callback for Codex OAuth", () => {
		const config = getOAuthProviderConfig("openai-codex");
		expect(config.redirectUri).toBe("http://localhost:1455/auth/callback");
		expect(config.authorizeUrl).toBe("https://auth.openai.com/oauth/authorize");
	});

	it("uses a loopback callback for the Gemini CLI installed-app client", () => {
		const config = getOAuthProviderConfig("google-gemini-cli");
		expect(config.redirectUri).toBe("http://localhost:8085/oauth2callback");
	});

	it("redirects to the keating.help web callback in production", () => {
		(globalThis as { location?: unknown }).location = {
			hostname: "keating.help",
			origin: "https://keating.help",
		};
		try {
			expect(resolveOAuthRedirectUri("openai-codex")).toBe("https://keating.help/oauth/callback");
			expect(resolveOAuthRedirectUri("google-gemini-cli")).toBe("https://keating.help/oauth/callback");
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
			expect(resolveOAuthRedirectUri("google-gemini-cli")).toBe("http://localhost:8085/oauth2callback");
		} finally {
			delete (globalThis as { location?: unknown }).location;
		}
	});

	it("uses Anthropic's manual OAuth callback instead of a dead localhost redirect", () => {
		const config = getOAuthProviderConfig("anthropic");
		expect(config.authorizeUrl).toBe("https://platform.claude.com/oauth/authorize");
		expect(config.redirectUri).toBe("https://platform.claude.com/oauth/code/callback");
	});

	it("requests the copy-paste code display flow for Anthropic", () => {
		const config = getOAuthProviderConfig("anthropic");
		expect(config.extraAuthParams?.code).toBe("true");
	});

});
