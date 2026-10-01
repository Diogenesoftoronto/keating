import { describe, expect, it } from "bun:test";
import { buildKeyProbe, interpretProbeStatus, testProviderKey } from "./provider-key-test";

describe("provider key probe", () => {
	it("uses bearer auth for openai-compatible APIs", () => {
		const p = buildKeyProbe({ provider: "groq", api: "openai-completions", baseUrl: "https://api.groq.com/openai/v1/" }, "k");
		expect(p?.url).toBe("https://api.groq.com/openai/v1/models");
		expect(p?.headers.Authorization).toBe("Bearer k");
	});
	it("skips templated base URLs and unknown APIs", () => {
		expect(buildKeyProbe({ provider: "x", api: "openai-completions", baseUrl: "https://a/{ID}/v1" }, "k")).toBeNull();
		expect(buildKeyProbe({ provider: "x", api: "bedrock-converse-stream", baseUrl: "https://a" }, "k")).toBeNull();
		expect(buildKeyProbe({ provider: "fireworks", api: "anthropic-messages", baseUrl: "https://a" }, "k")).toBeNull();
	});
	it("maps statuses", () => {
		expect(interpretProbeStatus(200).status).toBe("ok");
		expect(interpretProbeStatus(401).status).toBe("invalid");
		expect(interpretProbeStatus(429).status).toBe("ok");
		expect(interpretProbeStatus(500).status).toBe("error");
	});
	it("reports network failure as error and unsupported without fetching", async () => {
		const boom = (async () => { throw new TypeError("fail"); }) as unknown as typeof fetch;
		const t = { provider: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1" };
		expect((await testProviderKey(t, "k", { fetchImpl: boom })).status).toBe("error");
		expect((await testProviderKey({ ...t, api: "nope" }, "k", { fetchImpl: boom })).status).toBe("unsupported");
	});
});
