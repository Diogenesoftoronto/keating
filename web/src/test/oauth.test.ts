import { afterEach, describe, expect, it } from "bun:test";
import { exchangeOpenAiCodexApiKey } from "../../server/api/oauth/openai-codex";
import { getOAuthProviderConfig, providerToOAuthId } from "../keating/oauth";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("OAuth provider wiring", () => {
	it("uses Codex OAuth for the built-in OpenAI provider", () => {
		expect(providerToOAuthId("openai")).toBe("openai-codex");
		expect(providerToOAuthId("openai-codex")).toBe("openai-codex");
	});

	it("uses the web app callback for Codex OAuth instead of the CLI loopback callback", () => {
		const config = getOAuthProviderConfig("openai-codex");
		expect(config.redirectUri).toBeUndefined();
		expect(config.authorizeUrl).toBe("https://auth.openai.com/oauth/authorize");
	});

	it("uses Anthropic's manual OAuth callback instead of a dead localhost redirect", () => {
		const config = getOAuthProviderConfig("anthropic");
		expect(config.authorizeUrl).toBe("https://platform.claude.com/oauth/authorize");
		expect(config.redirectUri).toBe("https://platform.claude.com/oauth/code/callback");
	});

	it("exchanges a Codex id_token for an OpenAI API key", async () => {
		let requestBody = "";
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			requestBody = String(init?.body ?? "");
			return new Response(JSON.stringify({ api_key: "sk-test" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const apiKey = await exchangeOpenAiCodexApiKey("client-id", "id-token", undefined, "token");

		expect(apiKey).toBe("sk-test");
		const params = new URLSearchParams(requestBody);
		expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
		expect(params.get("requested_token")).toBe("openai-api-key");
		expect(params.get("subject_token")).toBe("id-token");
		expect(params.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:id_token");
	});
});
