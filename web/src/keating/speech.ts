import type { AgentTool } from "@mariozechner/pi-agent-core";

export const KEATING_VOICE_TOOL_NAME = "keating_voice";
export const GEMINI_LIVE_SPEECH_MODEL = "gemini-3.1-flash-live-preview";
export const DEFAULT_SPEECH_VOICE = "Kore";
const SPEECH_SETTINGS_KEY = "keating:web:speech";
const RECEIVE_SAMPLE_RATE = 24_000;

const VOICE_TAGS = new Set([
	"explain",
	"question",
	"verify",
	"redirect",
	"encourage",
	"pause",
	"recap",
]);

export interface WebSpeechSettings {
	enabled: boolean;
	model: string;
	voiceName: string;
}

export interface VoiceUtterance {
	text: string;
	voice: string;
	tags: string[];
	pace: string;
	affect: string;
}

export const DEFAULT_WEB_SPEECH_SETTINGS: WebSpeechSettings = {
	enabled: false,
	model: GEMINI_LIVE_SPEECH_MODEL,
	voiceName: DEFAULT_SPEECH_VOICE,
};

function cleanString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function cleanTags(value: unknown): string[] {
	const rawTags = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tags = rawTags
		.map((tag) => cleanString(tag).toLowerCase())
		.filter((tag) => VOICE_TAGS.has(tag));
	return Array.from(new Set(tags));
}

export function normalizeVoiceUtterance(input: Record<string, unknown>, settings: WebSpeechSettings): VoiceUtterance {
	const text = cleanString(input.text);
	if (!text) throw new Error("keating_voice requires non-empty text.");

	return {
		text,
		voice: cleanString(input.voice) || settings.voiceName,
		tags: cleanTags(input.tags ?? input.tag),
		pace: cleanString(input.pace) || "conversational",
		affect: cleanString(input.affect) || "warm",
	};
}

export function voiceTagLine(utterance: VoiceUtterance): string {
	const tags = utterance.tags.length ? utterance.tags.join(",") : "none";
	return `[voice voice=${utterance.voice} tags=${tags} pace=${utterance.pace} affect=${utterance.affect}] ${utterance.text}`;
}

export function loadWebSpeechSettings(): WebSpeechSettings {
	if (typeof window === "undefined") return DEFAULT_WEB_SPEECH_SETTINGS;
	try {
		const raw = window.localStorage.getItem(SPEECH_SETTINGS_KEY);
		if (!raw) return DEFAULT_WEB_SPEECH_SETTINGS;
		const parsed = JSON.parse(raw) as Partial<WebSpeechSettings>;
		return {
			enabled: parsed.enabled === true,
			model: cleanString(parsed.model) || DEFAULT_WEB_SPEECH_SETTINGS.model,
			voiceName: cleanString(parsed.voiceName) || DEFAULT_WEB_SPEECH_SETTINGS.voiceName,
		};
	} catch {
		return DEFAULT_WEB_SPEECH_SETTINGS;
	}
}

export function saveWebSpeechSettings(settings: WebSpeechSettings): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(settings));
}

let audioContext: AudioContext | null = null;
let scheduledUntil = 0;

function getAudioContext(): AudioContext | null {
	if (typeof window === "undefined") return null;
	const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
	if (!AudioContextCtor) return null;
	audioContext ??= new AudioContextCtor();
	return audioContext;
}

export async function primeSpeechAudio(): Promise<void> {
	const context = getAudioContext();
	if (context && context.state === "suspended") await context.resume();
}

function decodeBase64Pcm(base64: string): Int16Array {
	const binary = window.atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return new Int16Array(bytes.buffer);
}

function schedulePcmAudio(base64: string): boolean {
	const context = getAudioContext();
	if (!context) return false;

	const pcm = decodeBase64Pcm(base64);
	if (pcm.length === 0) return false;

	const buffer = context.createBuffer(1, pcm.length, RECEIVE_SAMPLE_RATE);
	const channel = buffer.getChannelData(0);
	for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 32768;

	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	const startAt = Math.max(context.currentTime + 0.03, scheduledUntil);
	source.start(startAt);
	scheduledUntil = startAt + buffer.duration;
	return true;
}

function contentParts(message: any): any[] {
	return Array.isArray(message?.serverContent?.modelTurn?.parts)
		? message.serverContent.modelTurn.parts
		: [];
}

async function speakWithGeminiLive(
	utterance: VoiceUtterance,
	settings: WebSpeechSettings,
	apiKey: string,
	signal?: AbortSignal,
): Promise<{ audioChunks: number; playedChunks: number; transcript: string }> {
	const { GoogleGenAI, Modality, ThinkingLevel } = await import("@google/genai");
	const ai = new GoogleGenAI({ apiKey });

	let session: { sendRealtimeInput: (params: { text: string }) => void; close: () => void } | null = null;
	let done = false;
	let audioChunks = 0;
	let playedChunks = 0;
	let transcript = "";

	const finish = (resolve: (value: { audioChunks: number; playedChunks: number; transcript: string }) => void) => {
		if (done) return;
		done = true;
		session?.close();
		resolve({ audioChunks, playedChunks, transcript: transcript.trim() });
	};

	return await new Promise((resolve, reject) => {
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

		ai.live.connect({
			model: settings.model,
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
		}).then((liveSession) => {
			if (done) {
				liveSession.close();
				return;
			}
			session = liveSession;
			session.sendRealtimeInput({
				text: `${voiceTagLine(utterance)}\n\nSpeak this line exactly, preserving the teaching intent.`,
			});
		}).catch((error) => {
			if (done) return;
			done = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			reject(error);
		});
	});
}

export function createSpeechTool(
	settings: WebSpeechSettings,
	getGoogleApiKey: () => Promise<string | undefined>,
): AgentTool {
	return {
		name: KEATING_VOICE_TOOL_NAME,
		label: "Keating Voice",
		description:
			"Speak one short learner-facing utterance through the optional Gemini 3.1 Flash Live speech layer. Use for brief questions, recaps, redirects, and encouragement only.",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "The exact learner-facing sentence or short paragraph to speak." },
				tags: {
					type: "array",
					items: { type: "string", enum: Array.from(VOICE_TAGS) },
					description: "Voice tags such as question, explain, verify, redirect, encourage, pause, or recap.",
				},
				voice: { type: "string", description: "Optional voice name. Defaults to the configured Gemini Live voice." },
				pace: { type: "string", description: "Optional pacing hint." },
				affect: { type: "string", description: "Optional affect hint." },
			},
			required: ["text"],
			additionalProperties: false,
		},
		execute: async (_toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => {
			const utterance = normalizeVoiceUtterance(params, settings);
			const line = voiceTagLine(utterance);
			const apiKey = await getGoogleApiKey();

			if (!apiKey) {
				return {
					content: [{
						type: "text",
						text: `${line}\n\nSpeech is enabled, but no Google API key is configured. Add a Google API key in Settings to play Gemini Live audio.`,
					}],
					details: {
						provider: "gemini-live",
						model: settings.model,
						voiceName: utterance.voice,
						utterance,
						status: "missing-api-key",
					},
				};
			}

			const result = await speakWithGeminiLive(utterance, settings, apiKey, signal);
			return {
				content: [{
					type: "text",
					text: `${line}\n\nSpeech played with ${settings.model}. Audio chunks: ${result.audioChunks}.`,
				}],
				details: {
					provider: "gemini-live",
					model: settings.model,
					voiceName: utterance.voice,
					utterance,
					transcript: result.transcript,
					audioChunks: result.audioChunks,
					playedChunks: result.playedChunks,
				},
			};
		},
	} as unknown as AgentTool;
}

declare global {
	interface Window {
		webkitAudioContext?: typeof AudioContext;
	}
}
