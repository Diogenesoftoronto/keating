import {
	GEMINI_LIVE_SPEECH_MODEL,
	schedulePcmAudio,
	voiceTagLine,
	type LiveSpeechRequest,
	type LiveSpeechSession,
	type LiveSpeechState,
	type SpeechProvider,
	type SpeechSynthesisRequest,
	type SpeechSynthesisResult,
} from "../speech";
import { withApiRetry } from "../api-retry";

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

		withApiRetry(() => ai.live
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
			}), { signal })
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

function encodePcmBase64(input: Float32Array): string {
	const pcm = new Int16Array(input.length);
	for (let i = 0; i < input.length; i += 1) {
		const sample = Math.max(-1, Math.min(1, input[i]));
		pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
	}
	const bytes = new Uint8Array(pcm.buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
	return window.btoa(binary);
}

async function startLiveSession(request: LiveSpeechRequest): Promise<LiveSpeechSession> {
	const { settings, getApiKey, signal, instructions, onState, onUserTranscript, onAssistantTranscript, onError } = request;
	const apiKey = await getApiKey("google");
	if (!apiKey) {
		throw new Error("No Google API key configured. Sign in to Google in Settings → Providers & Models.");
	}
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
		throw new Error("Microphone unavailable for live voice.");
	}

	const { GoogleGenAI, Modality } = await import("@google/genai");
	const ai = new GoogleGenAI({ apiKey });

	let state: LiveSpeechState = "connecting";
	const setState = (next: LiveSpeechState) => {
		if (state === "closed") return;
		state = next;
		onState?.(next);
	};
	setState("connecting");

	const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
	// 16 kHz mono PCM is what Gemini Live expects on the input stream.
	const captureContext = new AudioContext({ sampleRate: 16_000 });
	const sourceNode = captureContext.createMediaStreamSource(micStream);
	const processor = captureContext.createScriptProcessor(4096, 1, 1);

	let session: { sendRealtimeInput: (params: any) => void; close: () => void } | null = null;
	let cleanedUp = false;
	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		try { processor.disconnect(); } catch {}
		try { sourceNode.disconnect(); } catch {}
		try { captureContext.close(); } catch {}
		micStream.getTracks().forEach((track) => track.stop());
		try { session?.close(); } catch {}
		setState("closed");
	};

	if (signal?.aborted) {
		cleanup();
		throw new Error("Gemini Live aborted before start.");
	}
	signal?.addEventListener("abort", cleanup, { once: true });

	processor.onaudioprocess = (event) => {
		if (!session || state === "closed") return;
		const base64 = encodePcmBase64(event.inputBuffer.getChannelData(0));
		try {
			session.sendRealtimeInput({ audio: { data: base64, mimeType: "audio/pcm;rate=16000" } });
		} catch {}
	};

	try {
		session = await withApiRetry(() => ai.live.connect({
			model: settings.model || GEMINI_LIVE_SPEECH_MODEL,
			callbacks: {
				onmessage: (message: any) => {
					for (const part of contentParts(message)) {
						const data = part.inlineData?.data;
						if (typeof data === "string" && data.length > 0) {
							setState("speaking");
							schedulePcmAudio(data);
						}
						if (typeof part.text === "string") onAssistantTranscript?.(part.text, false);
					}
					const outputText = message?.serverContent?.outputTranscription?.text;
					if (typeof outputText === "string") onAssistantTranscript?.(outputText, false);
					const inputText = message?.serverContent?.inputTranscription?.text;
					if (typeof inputText === "string") onUserTranscript?.(inputText, false);
					if (message?.serverContent?.turnComplete) setState("listening");
				},
				onerror: (event: ErrorEvent) => onError?.(new Error(event.message || "Gemini Live failed.")),
				onclose: () => cleanup(),
			},
			config: {
				responseModalities: [Modality.AUDIO],
				outputAudioTranscription: {},
				inputAudioTranscription: {},
				systemInstruction:
					instructions ||
					"You are Keating, a warm Socratic tutor on a live voice call with a learner. Keep replies natural, concise, and conversational.",
			},
		}), { signal });
	} catch (error) {
		cleanup();
		throw error;
	}

	// Connecting the processor to the destination pumps onaudioprocess; the
	// output buffer is left silent so the mic is not echoed back.
	sourceNode.connect(processor);
	processor.connect(captureContext.destination);
	setState("listening");

	return {
		get state() {
			return state;
		},
		async stop() {
			cleanup();
		},
	};
}

export const geminiLiveProvider: SpeechProvider = {
	id: "gemini-live",
	label: "Gemini Live",
	kind: "duplex",
	status: "stable",
	description: "Google Gemini Live bidirectional voice. Live mic-in/audio-out sessions plus expressive prebuilt voices.",
	models: [
		{ value: "gemini-2.0-flash-live-001", label: "Gemini 2.0 Flash Live" },
		{ value: "gemini-2.5-flash-live-preview", label: "Gemini 2.5 Flash Live (Preview)" },
		{ value: "gemini-3.0-flash-live-preview", label: "Gemini 3.0 Flash Live (Preview)" },
		{ value: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live (Preview)" },
	],
	voices: GEMINI_VOICES,
	needsApiKey: "google",
	synthesize,
	startLiveSession,
};
