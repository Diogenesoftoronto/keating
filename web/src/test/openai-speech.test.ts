import { afterEach, describe, expect, it } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("OpenAI speech providers", () => {
	it("falls back from a non-OpenAI voice to a supported gpt-4o-mini-tts voice", async () => {
		const { openAITtsProvider } = await import("../keating/speech-providers/openai-tts");
		let body: any = null;
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			body = JSON.parse(String(init?.body ?? "{}"));
			return new Response(new Blob(["fake mp3"], { type: "audio/mpeg" }), { status: 200 });
		}) as typeof fetch;

		await openAITtsProvider.synthesize({
			utterance: {
				text: "Try one more time.",
				voice: "Kore",
				tags: ["encourage"],
				pace: "normal",
				affect: "warm",
			},
			settings: {
				enabled: true,
				providerId: "openai-tts",
				model: "gpt-4o-mini-tts",
				voiceName: "Kore",
				customModels: [],
				microphoneEnabled: false,
			},
			getApiKey: async () => "openai-test-key",
		});

		expect(body.voice).toBe("marin");
		expect(body.instructions).toContain("warm");
	});

	it("keeps legacy tts models on their legacy voice set", async () => {
		const { openAITtsProvider } = await import("../keating/speech-providers/openai-tts");
		let body: any = null;
		globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			body = JSON.parse(String(init?.body ?? "{}"));
			return new Response(new Blob(["fake mp3"], { type: "audio/mpeg" }), { status: 200 });
		}) as typeof fetch;

		await openAITtsProvider.synthesize({
			utterance: {
				text: "Try one more time.",
				voice: "marin",
				tags: ["encourage"],
				pace: "normal",
				affect: "warm",
			},
			settings: {
				enabled: true,
				providerId: "openai-tts",
				model: "tts-1",
				voiceName: "marin",
				customModels: [],
				microphoneEnabled: false,
			},
			getApiKey: async () => "openai-test-key",
		});

		expect(body.voice).toBe("alloy");
		expect(body.instructions).toBeUndefined();
	});
});
