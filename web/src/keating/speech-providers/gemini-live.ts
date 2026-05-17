import {
	GEMINI_LIVE_SPEECH_MODEL,
	schedulePcmAudio,
	voiceTagLine,
	type SpeechProvider,
	type SpeechSynthesisRequest,
	type SpeechSynthesisResult,
} from "../speech";

const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Leda", "Orus", "Aoede"];

function contentParts(message: any): any[] {
	return Array.isArray(message?.serverContent?.modelTurn?.parts)
		? message.serverContent.modelTurn.parts
		: [];
}

async function synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
	const { utterance, settings, getApiKey, signal } = request;
	const apiKey = await getApiKey("google");
	if (!apiKey) {
		throw new Error("No Google API key configured. Sign in to Google in Settings → Providers & Models.");
	}

	const { GoogleGenAI, Modality, ThinkingLevel } = await import("@google/genai");
	const ai = new GoogleGenAI({ apiKey });

	let session: { sendRealtimeInput: (params: { text: string }) => void; close: () => void } | null = null;
	let done = false;
	let audioChunks = 0;
	let playedChunks = 0;
	let transcript = "";

	const finish = (resolve: (value: SpeechSynthesisResult) => void) => {
		if (done) return;
		done = true;
		session?.close();
		resolve({ audioChunks, playedChunks, transcript: transcript.trim() });
	};

	return await new Promise<SpeechSynthesisResult>((resolve, reject) => {
		const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
			if (done) return;
			done = true;
			session?.close();
			reject(new Error("Gemini Live speech timed out."));
		}, 30_000);

		const abort = () => {
			if (done) return;
			done = true;
			clearTimeout(timeout);
			session?.close();
			reject(new Error("Gemini Live speech aborted."));
		};

		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener("abort", abort, { once: true });

		ai.live
			.connect({
				model: settings.model || GEMINI_LIVE_SPEECH_MODEL,
				callbacks: {
					onmessage: (message: any) => {
						for (const part of contentParts(message)) {
							const data = part.inlineData?.data;
							if (typeof data === "string" && data.length > 0) {
								audioChunks += 1;
								if (schedulePcmAudio(data)) playedChunks += 1;
							}
							if (typeof part.text === "string") transcript += part.text;
						}

						const outputText = message?.serverContent?.outputTranscription?.text;
						if (typeof outputText === "string") transcript += outputText;

						if (message?.serverContent?.turnComplete || message?.serverContent?.generationComplete) {
							clearTimeout(timeout);
							signal?.removeEventListener("abort", abort);
							finish(resolve);
						}
					},
					onerror: (event: ErrorEvent) => {
						if (done) return;
						done = true;
						clearTimeout(timeout);
						signal?.removeEventListener("abort", abort);
						reject(new Error(event.message || "Gemini Live speech failed."));
					},
					onclose: () => {
						if (done) return;
						clearTimeout(timeout);
						signal?.removeEventListener("abort", abort);
						finish(resolve);
					},
				},
				config: {
					responseModalities: [Modality.AUDIO],
					outputAudioTranscription: {},
					speechConfig: {
						voiceConfig: {
							prebuiltVoiceConfig: { voiceName: utterance.voice },
						},
					},
					systemInstruction:
						"You are Keating's voice layer. Speak the provided learner-facing line only. Keep it natural, concise, and conversational. Do not add extra teaching content.",
					thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
				},
			})
			.then((liveSession) => {
				if (done) {
					liveSession.close();
					return;
				}
				session = liveSession;
				session.sendRealtimeInput({
					text: `${voiceTagLine(utterance)}\n\nSpeak this line exactly, preserving the teaching intent.`,
				});
			})
			.catch((error) => {
				if (done) return;
				done = true;
				clearTimeout(timeout);
				signal?.removeEventListener("abort", abort);
				reject(error);
			});
	});
}

export const geminiLiveProvider: SpeechProvider = {
	id: "gemini-live",
	label: "Gemini Live",
	kind: "tts",
	status: "stable",
	description: "Google Gemini Live audio-out. Best for expressive, low-latency speech with prebuilt voices.",
	models: [
		{ value: "gemini-2.0-flash-live-001", label: "Gemini 2.0 Flash Live" },
		{ value: "gemini-2.5-flash-live-preview", label: "Gemini 2.5 Flash Live (Preview)" },
		{ value: "gemini-3.0-flash-live-preview", label: "Gemini 3.0 Flash Live (Preview)" },
		{ value: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live (Preview)" },
	],
	voices: GEMINI_VOICES,
	needsApiKey: "google",
	synthesize,
};
