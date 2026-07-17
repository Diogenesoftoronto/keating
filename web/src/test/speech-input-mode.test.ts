import { describe, expect, it } from "bun:test";
import {
	DEFAULT_WEB_SPEECH_SETTINGS,
	speechInputMode,
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
