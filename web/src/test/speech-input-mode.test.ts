import { describe, expect, it } from "bun:test";
import {
	DEFAULT_WEB_SPEECH_SETTINGS,
	resolveSpeechRealtimeTier,
	speechInputMode,
	speechProviderModel,
} from "../keating/speech";

describe("speech input mode", () => {
	it("uses hold-to-speak dictation until microphone access is enabled", () => {
		expect(speechInputMode({
			...DEFAULT_WEB_SPEECH_SETTINGS,
			enabled: true,
			providerId: "openai-realtime",
			microphoneEnabled: false,
		})).toBe("stt");
	});

	it("opens realtime voice only for enabled duplex providers with microphone access", () => {
		expect(speechInputMode({
			...DEFAULT_WEB_SPEECH_SETTINGS,
			enabled: true,
			providerId: "openai-realtime",
			microphoneEnabled: true,
		})).toBe("duplex");
	});
});

describe("realtime tier from speech settings", () => {
	it("maps each duplex speech provider onto its LLM provider", () => {
		expect(speechProviderModel({
			...DEFAULT_WEB_SPEECH_SETTINGS,
			providerId: "openai-realtime",
			model: "gpt-realtime-2.1",
		})).toEqual({ provider: "openai", id: "gpt-realtime-2.1", api: "openai-realtime" });

		expect(speechProviderModel({
			...DEFAULT_WEB_SPEECH_SETTINGS,
			providerId: "gemini-live",
			model: "gemini-3.1-flash-live-preview",
		})).toEqual({ provider: "google", id: "gemini-3.1-flash-live-preview", api: "google-live" });
	});

	it("treats synthesis-only providers as having no live session", () => {
		for (const providerId of ["openai-tts", "supertonic-3", "custom:my-endpoint"]) {
			expect(speechProviderModel({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId })).toBeNull();
			const tier = resolveSpeechRealtimeTier({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId });
			expect(tier.tier).toBe(0);
			expect(tier.video).toBe(false);
		}
	});

	it("resolves the full cascade from settings the user can actually pick", () => {
		const cases = [
			["gemini-live", "gemini-3.1-flash-live-preview", 3, "native"],
			["openai-realtime", "gpt-realtime-2.1", 2, "sampled"],
			["openai-realtime", "gpt-4o-realtime-preview-2024-12-17", 1, "none"],
		] as const;

		for (const [providerId, model, tier, videoRoute] of cases) {
			const resolved = resolveSpeechRealtimeTier({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId, model });
			expect(resolved.tier).toBe(tier);
			expect(resolved.videoRoute).toBe(videoRoute);
		}
	});
});
