import type { SpeechProvider, SpeechSynthesisRequest, SpeechSynthesisResult } from "../speech";

const pending = new Set<(error: Error) => void>();

function deviceSpeechAvailable(): boolean {
	return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Called from the learner's save/enable gesture to unlock browsers that require one. */
export function primeDeviceSpeech(): void {
	if (!deviceSpeechAvailable() || speechSynthesis.speaking) return;
	try {
		const utterance = new SpeechSynthesisUtterance(" ");
		utterance.volume = 0;
		speechSynthesis.speak(utterance);
	} catch {
		// The actual speech request reports unsupported or blocked playback.
	}
}

function cancelDeviceSpeech(error: Error): void {
	for (const reject of [...pending]) reject(error);
	if (deviceSpeechAvailable()) speechSynthesis.cancel();
}

async function synthesize({ utterance, signal }: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
	if (signal?.aborted) throw new DOMException("Speech interrupted.", "AbortError");
	if (!deviceSpeechAvailable()) {
		throw new Error("Device speech is unavailable in this browser. Choose a speech-output provider in Speech settings.");
	}
	const spoken = new SpeechSynthesisUtterance(utterance.text);
	const voice = speechSynthesis.getVoices().find((entry) => entry.name === utterance.voice);
	if (voice) {
		spoken.voice = voice;
		spoken.lang = voice.lang;
	} else {
		spoken.lang = (typeof document !== "undefined" && document.documentElement.lang)
			|| (typeof navigator !== "undefined" ? navigator.language : "");
	}
	spoken.rate = utterance.pace === "slow" ? 0.85 : utterance.pace === "fast" ? 1.15 : 1;
	const warning = utterance.voice && !voice ? "Requested device voice unavailable; used the device default." : undefined;
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			pending.delete(fail);
			signal?.removeEventListener("abort", abort);
			spoken.onend = null;
			spoken.onerror = null;
			if (error) reject(error);
			else resolve({ audioChunks: 1, playedChunks: 1, transcript: utterance.text, warning });
		};
		const fail = (error: Error) => finish(error);
		const abort = () => cancelDeviceSpeech(new DOMException("Speech interrupted.", "AbortError"));
		const timeout = setTimeout(() => cancelDeviceSpeech(new Error("Device speech timed out. Check audio playback or choose a speech-output provider in Speech settings.")), 60_000);
		pending.add(fail);
		signal?.addEventListener("abort", abort, { once: true });
		spoken.onend = () => finish();
		spoken.onerror = (event) => finish(new Error(event.error === "not-allowed"
			? "The browser blocked device speech. Enable spoken responses from Speech settings and try again."
			: `Device speech failed: ${event.error}.`));
		try { speechSynthesis.speak(spoken); } catch (error) { finish(error instanceof Error ? error : new Error("Device speech failed.")); }
	});
}

export const deviceSpeechProvider: SpeechProvider = {
	id: "device-speech",
	label: "Device voice",
	kind: "tts",
	status: "stable",
	description: "Read short chat replies with your browser's speech engine. No Keating provider key is needed.",
	models: [{ value: "device-default", label: "Device default" }],
	voices: [],
	synthesize,
};
