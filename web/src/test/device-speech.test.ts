import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createSpeechTool, DEFAULT_WEB_SPEECH_SETTINGS, speechReplyMode } from "../keating/speech";
import { deviceSpeechProvider } from "../keating/speech-providers/device-speech";

class DeviceUtterance {
	volume = 1;
	rate = 1;
	lang = "";
	voice = null;
	onend: (() => void) | null = null;
	onerror: ((event: { error: string }) => void) | null = null;
	constructor(readonly text: string) {}
}

const keys = ["speechSynthesis", "SpeechSynthesisUtterance", "fetch", "navigator"] as const;
const originals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let spoken: DeviceUtterance[] = [];
let cancelled = 0;
let networkRequests = 0;
let microphoneRequests = 0;
let finishAutomatically = true;

beforeEach(() => {
	spoken = []; cancelled = 0; networkRequests = 0; microphoneRequests = 0; finishAutomatically = true;
	Object.defineProperties(globalThis, {
		SpeechSynthesisUtterance: { configurable: true, value: DeviceUtterance },
		speechSynthesis: { configurable: true, value: {
			getVoices: () => [],
			cancel: () => { cancelled++; },
			speak: (utterance: DeviceUtterance) => {
				spoken.push(utterance);
				if (finishAutomatically) queueMicrotask(() => utterance.onend?.());
			},
		} },
		fetch: { configurable: true, value: async () => { networkRequests++; throw new Error("Unexpected hosted request"); } },
		navigator: { configurable: true, value: { language: "en-CA", mediaDevices: {
			getUserMedia: async () => { microphoneRequests++; throw new Error("Unexpected microphone capture"); },
		} } },
	});
});

afterEach(() => {
	for (const key of keys) {
		const descriptor = originals.get(key);
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
});

function request(signal?: AbortSignal) {
	return {
		utterance: { text: "Here is a short explanation.", voice: "", tags: [], pace: "conversational", affect: "warm" },
		settings: DEFAULT_WEB_SPEECH_SETTINGS,
		getApiKey: async () => { throw new Error("Device speech must not request credentials"); },
		signal,
	};
}

describe("device spoken replies", () => {
	for (const providerId of ["tavus", "gpt-live"]) {
		it(`speaks normal chat replies with ${providerId} selected for Live`, async () => {
			const tool = createSpeechTool({ ...DEFAULT_WEB_SPEECH_SETTINGS, enabled: true, providerId, microphoneEnabled: true }, request().getApiKey);
			const result = await tool.execute("speech", { text: "Here is a short explanation." });
			expect(result.details).toMatchObject({ provider: "device-speech", model: "device-default", playedChunks: 1, transcript: "Here is a short explanation." });
			expect(spoken.map((utterance) => utterance.text)).toEqual(["Here is a short explanation."]);
			expect(networkRequests).toBe(0);
			expect(microphoneRequests).toBe(0);
		});
	}

	it("keeps legacy synthesis providers selected and uses device voice for Live-only providers", () => {
		expect(speechReplyMode({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "openai-tts" })).toBe("provider");
		expect(speechReplyMode({ ...DEFAULT_WEB_SPEECH_SETTINGS, providerId: "gpt-live", replyMode: "provider" })).toBe("device");
	});

	it("cancels active speech even when the native engine emits no cancellation event", async () => {
		finishAutomatically = false;
		const controller = new AbortController();
		const playback = deviceSpeechProvider.synthesize(request(controller.signal));
		controller.abort();
		await expect(playback).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelled).toBe(1);
		// A new request can still complete after the cancelled request is removed.
		finishAutomatically = true;
		await expect(deviceSpeechProvider.synthesize(request())).resolves.toMatchObject({ playedChunks: 1 });
	});

	it("does not speak a request that was already cancelled", async () => {
		const controller = new AbortController(); controller.abort();
		await expect(deviceSpeechProvider.synthesize(request(controller.signal))).rejects.toMatchObject({ name: "AbortError" });
		expect(spoken).toHaveLength(0);
	});

	it("reports playback being blocked instead of claiming successful audio", async () => {
		finishAutomatically = false;
		const playback = deviceSpeechProvider.synthesize(request());
		spoken[0]!.onerror?.({ error: "not-allowed" });
		await expect(playback).rejects.toThrow("browser blocked device speech");
	});

	it("reports unavailable device speech without falling back to a hosted provider", async () => {
		Reflect.deleteProperty(globalThis, "speechSynthesis");
		const tool = createSpeechTool({ ...DEFAULT_WEB_SPEECH_SETTINGS, enabled: true }, request().getApiKey);
		const result = await tool.execute("speech", { text: "A short explanation." });
		expect(result.details).toMatchObject({ provider: "device-speech", status: "speech-error" });
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Device speech is unavailable") });
		expect(networkRequests).toBe(0);
	});
});
