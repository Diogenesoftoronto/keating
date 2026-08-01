import {
	GEMINI_LIVE_SPEECH_MODEL,
	schedulePcmAudio,
	stopScheduledAudio,
	voiceTagLine,
	type LiveHistoryTurn,
	type LiveSpeechRequest,
	type LiveSpeechSession,
	type LiveSpeechState,
	type LiveSpeechTool,
	type SpeechProvider,
	type SpeechSynthesisRequest,
	type SpeechSynthesisResult,
} from "../speech";
import { withApiRetry } from "../api-retry";
import { negotiateProviderCapabilities } from "../providers";
import {
	createRealtimeTelemetry,
	type RealtimeTelemetryObserver,
} from "../observability";
import { startPcmCapture } from "../pcm-capture-worklet";
import type { CapturedFrame } from "../video-capture";
import {
	createRealtimeCanonicalBridge,
	parseToolArguments,
	protocolError as sharedProtocolError,
	runLiveToolCall,
} from "./live-session-shared";

const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Leda", "Orus", "Aoede"];

/** Gemini Live expects 16 kHz mono PCM on the input stream. */
const GEMINI_INPUT_SAMPLE_RATE = 16_000;

function protocolError(error: unknown, code: string) {
	return sharedProtocolError(error, code, "google");
}

export function negotiateGeminiLiveSession(model: string) {
	return negotiateProviderCapabilities(
		{ provider: "google", id: model, api: "google-live" },
		{
			realtimeAudio: true,
			realtimeVideo: true,
			toolCalls: true,
			preferredTransports: ["websocket"],
			allowAdapters: false,
		},
	);
}

/**
 * Non-blocking function calls let Keating keep talking while a tool renders,
 * instead of going silent mid-lesson. Only the 2.5 Live models support it —
 * 3.1 Live is synchronous-only, and sending the flag there is an error.
 */
export function supportsNonBlockingTools(model: string): boolean {
	return /gemini-2\.5-flash-live/i.test(model);
}

/** Map Keating's provider-neutral tool descriptors onto Gemini declarations. */
export function buildGeminiToolConfig(
	tools: LiveSpeechTool[],
	model: string,
): Record<string, unknown>[] | undefined {
	if (tools.length === 0) return undefined;
	const nonBlocking = supportsNonBlockingTools(model);
	return [{
		functionDeclarations: tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			...(nonBlocking ? { behavior: "NON_BLOCKING" } : {}),
		})),
	}];
}

/**
 * Gemini's tool result envelope. `id` must echo the call it answers.
 *
 * `scheduling` is a sibling of `response`, not a member of it, and the response
 * body uses the reserved `output` / `error` keys so failures are recognised as
 * failures rather than folded in as ordinary tool output.
 */
export function geminiFunctionResponse(
	id: string,
	name: string,
	response: unknown,
	model: string,
	options: { failed?: boolean } = {},
): Record<string, unknown> {
	return {
		id,
		name,
		response: options.failed ? { error: response } : { output: response },
		// WHEN_IDLE lets the model finish its current sentence before folding the
		// result in, which reads far better than cutting itself off. Ignored by
		// the server unless the declaration was NON_BLOCKING.
		...(supportsNonBlockingTools(model) ? { scheduling: "WHEN_IDLE" } : {}),
	};
}

/** Replay a prior chat turn so a voice session continues the same conversation. */
export function geminiHistoryTurn(turn: LiveHistoryTurn): Record<string, unknown> {
	return {
		role: turn.role === "assistant" ? "model" : "user",
		parts: [{ text: turn.text }],
	};
}

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

async function startLiveSession(
	request: LiveSpeechRequest,
	observer?: RealtimeTelemetryObserver,
): Promise<LiveSpeechSession> {
	const {
		settings, getApiKey, signal, instructions, tools, history, video,
		onToolCall, onState, onUserTranscript, onAssistantTranscript, onError,
	} = request;

	const model = settings.model || GEMINI_LIVE_SPEECH_MODEL;
	const telemetry = createRealtimeTelemetry(observer);
	const canonical = createRealtimeCanonicalBridge(request.onConversationEvent, request.conversationIds);
	const setupStartedAt = telemetry.start();
	telemetry.emit("connection.setup.started", { provider: "google", model, transport: "websocket" });

	const capability = negotiateGeminiLiveSession(model);
	if (capability.realtimeAudio !== "native" || capability.transport !== "websocket" || capability.toolCalls !== "native") {
		telemetry.emit("session.error", { provider: "google", errorCode: "capability_mismatch" });
		telemetry.emit("session.completed", { provider: "google", outcome: "error" });
		throw new Error(`Gemini Live model ${model} cannot satisfy duplex audio and native tool-call requirements.`);
	}

	// Gemini has a real video lane, so frames go straight in at full tier.
	const visionEnabled = Boolean(video) && capability.realtimeVideo === "native";
	canonical.emit("run.started", { mode: visionEnabled ? "multimodal" : "voice" });

	const apiKey = await getApiKey("google");
	if (!apiKey) {
		const error = new Error("No Google API key configured. Sign in to Google in Settings → Providers & Models.");
		telemetry.emit("session.error", { provider: "google", errorCode: "missing_api_key" });
		telemetry.emit("session.completed", { provider: "google", outcome: "error" });
		canonical.emit("error", { error: protocolError(error, "missing_api_key"), fatal: true });
		canonical.emit("run.completed", { reason: "error" });
		throw error;
	}

	const { GoogleGenAI, Modality, MediaResolution } = await import("@google/genai");
	const ai = new GoogleGenAI({ apiKey });

	let state: LiveSpeechState = "connecting";
	let completionReason: "completed" | "cancelled" | "interrupted" | "error" | null = null;
	let firstAudioObserved = false;
	let turn = 0;
	let activeTurnStartedAt: number | null = null;
	let framesSent = 0;

	const complete = (reason: NonNullable<typeof completionReason>) => {
		if (completionReason) return;
		completionReason = reason;
		canonical.emit("run.completed", { reason });
		telemetry.emit("session.completed", { provider: "google", outcome: reason });
	};
	const setState = (next: LiveSpeechState) => {
		if (state === "closed") return;
		state = next;
		onState?.(next);
	};
	setState("connecting");

	let session: {
		sendRealtimeInput: (params: any) => void;
		sendClientContent: (params: any) => void;
		sendToolResponse: (params: any) => void;
		close: () => void;
	} | null = null;
	let capture: Awaited<ReturnType<typeof startPcmCapture>> | null = null;
	let unsubscribeFrames: (() => void) | null = null;
	let cleanedUp = false;

	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		unsubscribeFrames?.();
		unsubscribeFrames = null;
		capture?.stop();
		capture = null;
		try { session?.close(); } catch {}
		setState("closed");
		complete("cancelled");
	};

	if (signal?.aborted) {
		canonical.emit("conversation.interrupted", { by: "host", reason: "abort signal before start" });
		telemetry.emit("speech.interrupted", { provider: "google", reason: "abort", turn });
		complete("interrupted");
		cleanup();
		throw new Error("Gemini Live aborted before start.");
	}
	signal?.addEventListener("abort", () => {
		canonical.emit("conversation.interrupted", { by: "host", reason: "abort signal" });
		telemetry.emit("speech.interrupted", { provider: "google", reason: "abort", turn });
		complete("interrupted");
		cleanup();
	}, { once: true });

	const handleToolCall = (functionCalls: any[]) => {
		for (const functionCall of functionCalls) {
			if (typeof functionCall?.name !== "string") continue;
			const callId = typeof functionCall.id === "string" ? functionCall.id : functionCall.name;
			void runLiveToolCall({
				call: { callId, name: functionCall.name, arguments: parseToolArguments(functionCall.args) },
				provider: "google",
				canonical,
				telemetry,
				execute: async (pending) => {
					if (!onToolCall) throw new Error(`No handler is available for tool ${pending.name}.`);
					return await onToolCall(pending);
				},
				respond: (id, output) => {
					session?.sendToolResponse({
						functionResponses: [geminiFunctionResponse(id, functionCall.name, output, model)],
					});
				},
				respondError: (id, message) => {
					session?.sendToolResponse({
						functionResponses: [geminiFunctionResponse(id, functionCall.name, message, model, { failed: true })],
					});
				},
			});
		}
	};

	try {
		session = await withApiRetry(() => ai.live.connect({
			model,
			callbacks: {
				onmessage: (message: any) => {
					// Barge-in: the server cancels generation when the learner
					// speaks over the model. Queued PCM must be dropped too, or
					// the learner keeps hearing the sentence they interrupted.
					if (message?.serverContent?.interrupted) {
						stopScheduledAudio();
						canonical.emit("conversation.interrupted", { by: "user", reason: "barge-in" });
						telemetry.emit("speech.interrupted", { provider: "google", reason: "barge-in", turn });
						setState("listening");
					}

					if (Array.isArray(message?.toolCall?.functionCalls)) {
						handleToolCall(message.toolCall.functionCalls);
					}

					for (const part of contentParts(message)) {
						const data = part.inlineData?.data;
						if (typeof data === "string" && data.length > 0) {
							if (!firstAudioObserved) {
								firstAudioObserved = true;
								telemetry.emit("audio.first", { provider: "google", transport: "websocket" },
									telemetry.durationSince(setupStartedAt));
							}
							setState("speaking");
							schedulePcmAudio(data);
							canonical.emit("audio.delta", {
								streamId: "assistant-audio",
								role: "assistant",
								encoding: "pcm16",
								sampleRate: 24_000,
								data,
							});
						}
						if (typeof part.text === "string") {
							onAssistantTranscript?.(part.text, false);
							canonical.emit("transcript.delta", {
								transcriptId: "assistant-transcript",
								role: "assistant",
								delta: part.text,
								final: false,
							});
						}
					}

					const outputText = message?.serverContent?.outputTranscription?.text;
					if (typeof outputText === "string") {
						onAssistantTranscript?.(outputText, false);
						canonical.emit("transcript.delta", {
							transcriptId: "assistant-transcript",
							role: "assistant",
							delta: outputText,
							final: false,
						});
					}

					const inputText = message?.serverContent?.inputTranscription?.text;
					if (typeof inputText === "string") {
						if (activeTurnStartedAt === null) {
							turn += 1;
							activeTurnStartedAt = telemetry.start();
							telemetry.emit("speech.turn.started", { provider: "google", turn });
						}
						onUserTranscript?.(inputText, false);
						canonical.emit("transcript.delta", {
							transcriptId: "user-transcript",
							role: "user",
							delta: inputText,
							final: false,
						});
					}

					if (message?.serverContent?.turnComplete) {
						onAssistantTranscript?.("", true);
						canonical.emit("transcript.delta", {
							transcriptId: "assistant-transcript",
							role: "assistant",
							delta: "",
							final: true,
						});
						telemetry.emit("speech.turn.completed", { provider: "google", turn, outcome: "completed" },
							activeTurnStartedAt === null ? undefined : telemetry.durationSince(activeTurnStartedAt));
						activeTurnStartedAt = null;
						setState("listening");
					}
				},
				onerror: (event: ErrorEvent) => {
					const error = new Error(event.message || "Gemini Live failed.");
					onError?.(error);
					canonical.emit("error", { error: protocolError(error, "provider_error"), fatal: false });
					telemetry.emit("session.error", { provider: "google", errorCode: "provider_error" });
				},
				onclose: () => cleanup(),
			},
			config: {
				responseModalities: [Modality.AUDIO],
				outputAudioTranscription: {},
				inputAudioTranscription: {},
				speechConfig: {
					voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voiceName || "Kore" } },
				},
				// Frames are already downscaled client-side; low resolution keeps
				// the token cost of continuous vision manageable.
				...(visionEnabled ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
				...(buildGeminiToolConfig(tools ?? [], model) ? { tools: buildGeminiToolConfig(tools ?? [], model) } : {}),
				systemInstruction:
					instructions ||
					"You are Keating, a warm Socratic tutor on a live voice call with a learner. Keep replies natural, concise, and conversational.",
			},
		}), { signal });
	} catch (error) {
		telemetry.emit("connection.setup.completed", {
			provider: "google", model, transport: "websocket", outcome: "failed",
		}, telemetry.durationSince(setupStartedAt));
		telemetry.emit("session.error", { provider: "google", errorCode: "session_setup_failed" });
		canonical.emit("error", { error: protocolError(error, "session_setup_failed"), fatal: true });
		complete("error");
		cleanup();
		throw error;
	}

	// Replay prior chat turns so the voice session continues the conversation
	// rather than reintroducing itself.
	const seedTurns = (history ?? []).filter((entry) => entry.text.trim());
	if (seedTurns.length > 0) {
		try {
			session.sendClientContent({ turns: seedTurns.map(geminiHistoryTurn), turnComplete: false });
		} catch (error) {
			console.warn("[keating:gemini-live] history seed failed", error);
		}
	}

	try {
		capture = await startPcmCapture({
			sampleRate: GEMINI_INPUT_SAMPLE_RATE,
			onChunk: (base64) => {
				if (!session || state === "closed") return;
				try {
					session.sendRealtimeInput({
						audio: { data: base64, mimeType: `audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}` },
					});
				} catch {
					// A closed socket surfaces on the next message callback.
				}
			},
		});
	} catch (error) {
		telemetry.emit("session.error", { provider: "google", errorCode: "microphone_unavailable" });
		canonical.emit("error", { error: protocolError(error, "microphone_unavailable"), fatal: true });
		complete("error");
		cleanup();
		throw error;
	}

	if (visionEnabled && video) {
		unsubscribeFrames = video.onFrame((frame: CapturedFrame) => {
			if (!session || state === "closed") return;
			try {
				session.sendRealtimeInput({ video: { data: frame.data, mimeType: frame.mimeType } });
				framesSent += 1;
			} catch {
				// Same as audio: a dead socket reports through the callbacks.
			}
		});
	}

	setState("listening");
	telemetry.emit("connection.setup.completed", {
		provider: "google", model, transport: "websocket", outcome: "success",
	}, telemetry.durationSince(setupStartedAt));

	return {
		get state() {
			return state;
		},
		get framesSent() {
			return framesSent;
		},
		videoRoute: visionEnabled ? "native" : "none",
		async stop() {
			complete("cancelled");
			cleanup();
		},
	};
}

const geminiLiveProviderDefinition: Omit<SpeechProvider, "startLiveSession"> = {
	id: "gemini-live",
	label: "Gemini Live",
	kind: "duplex",
	status: "stable",
	description: "Google Gemini Live bidirectional voice and video. Native live video, tool calls, and expressive prebuilt voices.",
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

export function createGeminiLiveProvider(observer?: RealtimeTelemetryObserver): SpeechProvider {
	return {
		...geminiLiveProviderDefinition,
		startLiveSession: (request) => startLiveSession(request, observer),
	};
}

export const geminiLiveProvider: SpeechProvider = createGeminiLiveProvider();
