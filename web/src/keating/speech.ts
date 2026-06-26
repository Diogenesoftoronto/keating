import type { AgentTool } from "@earendil-works/pi-agent-core";

export const KEATING_VOICE_TOOL_NAME = "keating_voice";
export const GEMINI_LIVE_SPEECH_MODEL = "gemini-3.1-flash-live-preview";
export const DEFAULT_SPEECH_VOICE = "Kore";
const SPEECH_SETTINGS_KEY = "keating:web:speech";
export const RECEIVE_SAMPLE_RATE = 24_000;

const VOICE_TAGS = new Set([
	"explain",
	"question",
	"verify",
	"redirect",
	"encourage",
	"pause",
	"recap",
]);

export type SpeechProviderId =
	| "gemini-live"
	| "openai-tts"
	| "openai-realtime"
	| "supertonic-3"
	| string; // allows "custom:<id>"

export interface CustomSpeechModel {
	id: string;            // stable client id; storage key is `custom:${id}`
	label: string;         // shown in dropdown
	baseUrl: string;       // for OpenAI-compatible TTS endpoints
	model: string;         // model id passed in request body
	voice: string;         // default voice
	providerKey: string;   // which providerKeys entry to use ("openai", custom name)
	apiPath?: string;      // default "/v1/audio/speech"
}

export interface WebSpeechSettings {
	enabled: boolean;
	/** Active provider. Defaults to "gemini-live" for back-compat. */
	providerId: SpeechProviderId;
	/** Active model for the chosen provider. */
	model: string;
	/** Active voice for the chosen provider. */
	voiceName: string;
	/** User-defined OpenAI-compatible TTS endpoints. */
	customModels: CustomSpeechModel[];
	/** When true, Realtime providers may capture mic input. */
	microphoneEnabled: boolean;
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
	providerId: "gemini-live",
	model: GEMINI_LIVE_SPEECH_MODEL,
	voiceName: DEFAULT_SPEECH_VOICE,
	customModels: [],
	microphoneEnabled: false,
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
		const customModels = Array.isArray(parsed.customModels)
			? parsed.customModels.filter(
					(m): m is CustomSpeechModel =>
						!!m && typeof m.id === "string" && typeof m.baseUrl === "string" && typeof m.model === "string",
				)
			: [];
		return {
			enabled: parsed.enabled === true,
			providerId: cleanString(parsed.providerId) || DEFAULT_WEB_SPEECH_SETTINGS.providerId,
			model: cleanString(parsed.model) || DEFAULT_WEB_SPEECH_SETTINGS.model,
			voiceName: cleanString(parsed.voiceName) || DEFAULT_WEB_SPEECH_SETTINGS.voiceName,
			customModels,
			microphoneEnabled: parsed.microphoneEnabled === true,
		};
	} catch {
		return DEFAULT_WEB_SPEECH_SETTINGS;
	}
}

export function saveWebSpeechSettings(settings: WebSpeechSettings): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(settings));
}

export type SpeechCredentialProvider = "openai" | "google";

export interface SpeechCredential {
	provider: SpeechCredentialProvider;
	apiKey: string;
}

/**
 * Pick the credential used for speech input (STT / realtime). Prefers a genuine
 * OpenAI key, then Google/Gemini. The OpenAI check uses the "openai" provider
 * only — that is the real api.openai.com. A custom-base OpenAI-compatible
 * provider is stored under its own name and is intentionally NOT treated as an
 * OpenAI speech credential, since the transcription/realtime endpoints are
 * OpenAI-specific.
 */
export async function resolveSpeechCredential(
	getApiKey: (provider: string) => Promise<string | undefined>,
): Promise<SpeechCredential | null> {
	const openai = await getApiKey("openai");
	if (openai) return { provider: "openai", apiKey: openai };
	const google = await getApiKey("google");
	if (google) return { provider: "google", apiKey: google };
	return null;
}

const DUPLEX_PROVIDER_IDS = new Set<SpeechProviderId>(["gemini-live", "openai-realtime"]);

export function isDuplexSpeechProvider(id: SpeechProviderId): boolean {
	return DUPLEX_PROVIDER_IDS.has(id);
}

/**
 * Decide whether the prompt mic button should open a live bidirectional session
 * or do one-shot speech-to-text. Duplex only when speech is enabled and the
 * active provider is a duplex provider (OpenAI Realtime / Gemini Live).
 */
export function speechInputMode(settings: WebSpeechSettings): "duplex" | "stt" {
	return settings.enabled && isDuplexSpeechProvider(settings.providerId) ? "duplex" : "stt";
}

let audioContext: AudioContext | null = null;
let scheduledUntil = 0;

export function getAudioContext(): AudioContext | null {
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

export function schedulePcmAudio(base64: string, sampleRate = RECEIVE_SAMPLE_RATE): boolean {
	const context = getAudioContext();
	if (!context) return false;

	const pcm = decodeBase64Pcm(base64);
	if (pcm.length === 0) return false;

	const buffer = context.createBuffer(1, pcm.length, sampleRate);
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

export async function scheduleAudioBlob(blob: Blob): Promise<boolean> {
	const context = getAudioContext();
	if (!context) return false;
	const arrayBuffer = await blob.arrayBuffer();
	const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
	const source = context.createBufferSource();
	source.buffer = audioBuffer;
	source.connect(context.destination);
	const startAt = Math.max(context.currentTime + 0.03, scheduledUntil);
	source.start(startAt);
	scheduledUntil = startAt + audioBuffer.duration;
	return true;
}

export function speechErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim()) return error.message.trim();
	if (typeof error === "string" && error.trim()) return error.trim();
	return fallback;
}

export interface SpeechSynthesisResult {
	audioChunks: number;
	playedChunks: number;
	transcript: string;
	warning?: string;
}

export interface SpeechSynthesisRequest {
	utterance: VoiceUtterance;
	settings: WebSpeechSettings;
	customModel?: CustomSpeechModel;
	getApiKey: (provider: string) => Promise<string | undefined>;
	signal?: AbortSignal;
}

export interface SpeechProviderDescriptor {
	id: SpeechProviderId;
	label: string;
	kind: "tts" | "duplex";
	status: "stable" | "preview" | "experimental";
	description: string;
	models: { value: string; label: string }[];
	voices: string[];
	needsApiKey?: string;
}

export interface SpeechProvider extends SpeechProviderDescriptor {
	synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;
}

const providerRegistry = new Map<SpeechProviderId, SpeechProvider>();
let registrationPromise: Promise<void> | null = null;

async function ensureProvidersRegistered(): Promise<void> {
	if (registrationPromise) return registrationPromise;
	registrationPromise = (async () => {
		const [gemini, oaiTts, oaiRealtime, supertonic] = await Promise.all([
			import("./speech-providers/gemini-live"),
			import("./speech-providers/openai-tts"),
			import("./speech-providers/openai-realtime"),
			import("./speech-providers/supertonic"),
		]);
		providerRegistry.set("gemini-live", gemini.geminiLiveProvider);
		providerRegistry.set("openai-tts", oaiTts.openAITtsProvider);
		providerRegistry.set("openai-realtime", oaiRealtime.openAIRealtimeProvider);
		providerRegistry.set("supertonic-3", supertonic.supertonicProvider);
	})();
	return registrationPromise;
}

export async function listSpeechProviders(): Promise<SpeechProviderDescriptor[]> {
	await ensureProvidersRegistered();
	return Array.from(providerRegistry.values()).map(({ synthesize: _ignored, ...info }) => info);
}

export async function getSpeechProvider(id: SpeechProviderId): Promise<SpeechProvider | null> {
	await ensureProvidersRegistered();
	return providerRegistry.get(id) ?? null;
}

function resolveCustomModel(settings: WebSpeechSettings): CustomSpeechModel | undefined {
	if (!settings.providerId.startsWith("custom:")) return undefined;
	const id = settings.providerId.slice("custom:".length);
	return settings.customModels.find((m) => m.id === id);
}

export function createSpeechTool(
	settings: WebSpeechSettings,
	getApiKey: (provider: string) => Promise<string | undefined>,
): AgentTool {
	return {
		name: KEATING_VOICE_TOOL_NAME,
		label: "Keating Voice",
		description:
			"Speak one short learner-facing utterance through the active speech provider (Gemini Live, OpenAI TTS, OpenAI Realtime, Supertonic-3, or a user-defined custom provider). Use for brief questions, recaps, redirects, and encouragement only.",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "The exact learner-facing sentence or short paragraph to speak." },
				tags: {
					type: "array",
					items: { type: "string", enum: Array.from(VOICE_TAGS) },
					description: "Voice tags such as question, explain, verify, redirect, encourage, pause, or recap.",
				},
				voice: { type: "string", description: "Optional voice name. Defaults to the configured voice." },
				pace: { type: "string", description: "Optional pacing hint." },
				affect: { type: "string", description: "Optional affect hint." },
			},
			required: ["text"],
			additionalProperties: false,
		},
		execute: async (_toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => {
			const utterance = normalizeVoiceUtterance(params, settings);
			const line = voiceTagLine(utterance);
			const customModel = resolveCustomModel(settings);

			let provider: SpeechProvider | null;
			if (customModel) {
				const mod = await import("./speech-providers/custom-tts");
				provider = mod.customTtsProvider;
			} else {
				provider = await getSpeechProvider(settings.providerId);
			}

			if (!provider) {
				return {
					content: [{
						type: "text",
						text: `${line}\n\nSpeech is enabled but no provider matched "${settings.providerId}". Open Settings → Speech to pick one.`,
					}],
					details: {
						provider: settings.providerId,
						status: "missing-provider",
						utterance,
					},
				};
			}

			try {
				const result = await provider.synthesize({
					utterance,
					settings,
					customModel,
					getApiKey,
					signal,
				});
				return {
					content: [{
						type: "text",
						text: `${line}\n\nSpeech played with ${provider.label}${result.warning ? ` (${result.warning})` : ""}. Audio chunks: ${result.audioChunks}.`,
					}],
					details: {
						provider: provider.id,
						label: provider.label,
						kind: provider.kind,
						model: settings.model,
						voiceName: utterance.voice,
						utterance,
						transcript: result.transcript,
						audioChunks: result.audioChunks,
						playedChunks: result.playedChunks,
						warning: result.warning,
					},
				};
			} catch (error) {
				const message = speechErrorMessage(error, `${provider.label} speech failed.`);
				console.warn(`[keating:speech] ${provider.id}/${settings.model} failed: ${message}`);
				return {
					content: [{
						type: "text",
						text: `${line}\n\n${provider.label} voice layer failed: ${message}\nThe main chat response can continue without speech audio.`,
					}],
					details: {
						provider: provider.id,
						label: provider.label,
						model: settings.model,
						voiceName: utterance.voice,
						utterance,
						status: "speech-error",
						error: message,
					},
				};
			}
		},
	} as unknown as AgentTool;
}

declare global {
	interface Window {
		webkitAudioContext?: typeof AudioContext;
	}
}
