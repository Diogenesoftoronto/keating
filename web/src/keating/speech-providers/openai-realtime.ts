import {
	getAudioContext,
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
import {
	conversationEvent,
	type ConversationEvent,
	type JsonValue,
	type ProtocolError,
} from "../protocol";

export function negotiateOpenAIRealtimeSession(model: string) {
	return negotiateProviderCapabilities(
		{ provider: "openai", id: model, api: "openai-realtime" },
		{ realtimeAudio: true, toolCalls: true, preferredTransports: ["webrtc"], allowAdapters: false },
	);
}

function randomId(prefix: string): string {
	const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `${prefix}-${id}`;
}

function jsonValue(value: unknown): JsonValue {
	if (value === undefined) return null;
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return String(value);
	}
}

function jsonRecord(value: unknown): Record<string, JsonValue> {
	const converted = jsonValue(value);
	return converted && typeof converted === "object" && !Array.isArray(converted)
		? converted as Record<string, JsonValue>
		: {};
}

function protocolError(error: unknown, code: string): ProtocolError {
	return {
		code,
		message: error instanceof Error ? error.message : String(error),
		provider: "openai",
	};
}

export interface RealtimeCanonicalBridge {
	readonly sessionId: string;
	readonly runId: string;
	emit<T extends ConversationEvent["type"]>(
		type: T,
		payload: Extract<ConversationEvent, { type: T }>["payload"],
	): void;
}

export function createRealtimeCanonicalBridge(
	onEvent?: (event: ConversationEvent) => void,
	ids: { sessionId?: string; runId?: string } = {},
): RealtimeCanonicalBridge {
	const sessionId = ids.sessionId ?? randomId("voice-session");
	const runId = ids.runId ?? randomId("voice-run");
	let sequence = 0;
	return {
		sessionId,
		runId,
		emit(type, payload) {
			if (!onEvent) return;
			onEvent(conversationEvent(type, payload as never, {
				id: randomId("voice-event"),
				sequence: sequence++,
				timestamp: new Date().toISOString(),
				sessionId,
				runId,
			}));
		},
	};
}

export function buildRealtimeSessionUpdate(
	settings: LiveSpeechRequest["settings"],
	instructions?: string,
	tools: LiveSpeechTool[] = [],
): Record<string, unknown> {
	return {
		type: "session.update",
		session: {
			type: "realtime",
			turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
			input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
			...(settings.model.startsWith("gpt-realtime-2") ? { reasoning: { effort: settings.reasoningEffort } } : {}),
			...(instructions ? { instructions } : {}),
			...(tools.length > 0 ? {
				tools: tools.map((tool) => ({ type: "function", ...tool })),
				tool_choice: "auto",
			} : {}),
		},
	};
}

export function realtimeFunctionOutput(callId: string, output: unknown): Record<string, unknown> {
	return {
		type: "conversation.item.create",
		item: {
			type: "function_call_output",
			call_id: callId,
			output: typeof output === "string" ? output : JSON.stringify(output),
		},
	};
}

const REALTIME_MODELS = [
	{ value: "gpt-realtime-2.1", label: "gpt-realtime-2.1 (latest)" },
	{ value: "gpt-realtime-2.1-mini", label: "gpt-realtime-2.1-mini" },
	{ value: "gpt-realtime-2", label: "gpt-realtime-2" },
	{ value: "gpt-realtime", label: "gpt-realtime" },
	{ value: "gpt-realtime-mini", label: "gpt-realtime-mini" },
	{ value: "gpt-4o-realtime-preview-2024-12-17", label: "gpt-4o-realtime-preview" },
	{ value: "gpt-4o-mini-realtime-preview-2024-12-17", label: "gpt-4o-mini-realtime-preview" },
];

const REALTIME_VOICES = [
	"alloy",
	"ash",
	"ballad",
	"cedar",
	"coral",
	"echo",
	"marin",
	"sage",
	"shimmer",
	"verse",
];

function cleanRealtimeVoice(value: string | undefined): string {
	const requested = (value ?? "").trim().toLowerCase();
	return REALTIME_VOICES.includes(requested) ? requested : "marin";
}

async function mintEphemeralKey(apiKey: string, model: string, voice: string, signal?: AbortSignal): Promise<string> {
	const response = await withApiRetry(async () => {
		const result = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				session: {
					type: "realtime",
					model,
					audio: {
						output: { voice },
					},
				},
			}),
			signal,
		});
		if (!result.ok) {
			const errText = await result.text().catch(() => "");
			const retryAfter = result.headers.get("retry-after");
			throw new Error(`Realtime session mint failed (${result.status}): ${errText.slice(0, 200) || result.statusText}${retryAfter ? ` retry-after: ${retryAfter}` : ""}`);
		}
		return result;
	}, { signal });
	const data = (await response.json()) as { value?: string; client_secret?: { value?: string } };
	const value = data.value ?? data.client_secret?.value;
	if (!value) throw new Error("Realtime session mint returned no ephemeral secret value");
	return value;
}

async function attachMicrophone(pc: RTCPeerConnection): Promise<MediaStream | null> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
		return stream;
	} catch (err) {
		console.warn("[keating:realtime] microphone unavailable", err);
		return null;
	}
}

async function synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
	const { utterance, settings, getApiKey, signal } = request;
	const apiKey = await getApiKey("openai");
	if (!apiKey) {
		throw new Error("No OpenAI API key configured. Add one in Settings → Providers & Models.");
	}

	const model = settings.model || "gpt-realtime-2.1";
	const voice = cleanRealtimeVoice(utterance.voice || settings.voiceName);

	const ephemeralKey = await mintEphemeralKey(apiKey, model, voice, signal);

	const pc = new RTCPeerConnection();
	const audioEl = typeof document !== "undefined" ? document.createElement("audio") : null;
	if (audioEl) {
		audioEl.autoplay = true;
		audioEl.style.display = "none";
		document.body.appendChild(audioEl);
	}

	let audioChunks = 0;
	let playedChunks = 0;
	let micStream: MediaStream | null = null;
	let cleanedUp = false;

	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		try { pc.close(); } catch {}
		micStream?.getTracks().forEach((t) => t.stop());
		if (audioEl) {
			try { audioEl.pause(); } catch {}
			audioEl.srcObject = null;
			audioEl.remove();
		}
	};

	if (signal?.aborted) {
		cleanup();
		throw new Error("OpenAI Realtime aborted before start.");
	}
	signal?.addEventListener("abort", cleanup, { once: true });

	pc.ontrack = (event) => {
		audioChunks += 1;
		if (audioEl && event.streams[0]) {
			audioEl.srcObject = event.streams[0];
			audioEl.play().then(() => { playedChunks += 1; }).catch(() => {});
		}
	};

	const dataChannel = pc.createDataChannel("oai-events");

	if (settings.microphoneEnabled) {
		micStream = await attachMicrophone(pc);
	}

	return await new Promise<SpeechSynthesisResult>(async (resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("OpenAI Realtime response timed out."));
		}, 60_000);

		dataChannel.addEventListener("open", () => {
			dataChannel.send(JSON.stringify({
				type: "response.create",
				response: {
					modalities: ["audio", "text"],
					instructions: `Speak this learner-facing line exactly. Affect: ${utterance.affect}. Pace: ${utterance.pace}.\n\n${utterance.text}`,
				},
			}));
		});

		dataChannel.addEventListener("message", (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "response.done") {
					clearTimeout(timer);
					cleanup();
					resolve({
						audioChunks,
						playedChunks,
						transcript: utterance.text,
						warning: settings.microphoneEnabled && !micStream ? "Microphone unavailable" : undefined,
					});
				}
				if (msg.type === "error") {
					clearTimeout(timer);
					cleanup();
					reject(new Error(`Realtime error: ${msg.error?.message ?? "unknown"}`));
				}
			} catch {}
		});

		try {
			getAudioContext();
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);

			const sdpResponse = await withApiRetry(async () => {
				const result = await fetch("https://api.openai.com/v1/realtime/calls", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${ephemeralKey}`,
						"Content-Type": "application/sdp",
					},
					body: offer.sdp,
					signal,
				});
				if (!result.ok) {
					const retryAfter = result.headers.get("retry-after");
					throw new Error(`Realtime SDP exchange failed (${result.status})${retryAfter ? ` retry-after: ${retryAfter}` : ""}`);
				}
				return result;
			}, { signal });
			const answer: RTCSessionDescriptionInit = {
				type: "answer",
				sdp: await sdpResponse.text(),
			};
			await pc.setRemoteDescription(answer);
		} catch (error) {
			clearTimeout(timer);
			cleanup();
			reject(error);
		}
	});
}

async function startLiveSession(
	request: LiveSpeechRequest,
	observer?: RealtimeTelemetryObserver,
): Promise<LiveSpeechSession> {
	const { settings, getApiKey, signal, instructions, tools, onToolCall, onState, onUserTranscript, onAssistantTranscript, onError } = request;
	const telemetry = createRealtimeTelemetry(observer);
	const canonical = createRealtimeCanonicalBridge(request.onConversationEvent, request.conversationIds);
	const setupStartedAt = telemetry.start();
	telemetry.emit("connection.setup.started", {
		provider: "openai",
		model: settings.model || "gpt-realtime-2.1",
		transport: "webrtc",
	});
	const capability = negotiateOpenAIRealtimeSession(settings.model || "gpt-realtime-2.1");
	if (capability.realtimeAudio !== "native" || capability.transport !== "webrtc" || capability.toolCalls !== "native") {
		telemetry.emit("session.error", { provider: "openai", errorCode: "capability_mismatch" });
		telemetry.emit("session.completed", { provider: "openai", outcome: "error" });
		throw new Error(`OpenAI Realtime model ${settings.model} cannot satisfy duplex WebRTC and native tool-call requirements.`);
	}
	canonical.emit("run.started", { mode: "voice" });
	const apiKey = await getApiKey("openai");
	if (!apiKey) {
		const error = new Error("No OpenAI API key configured. Add one in Settings → Providers & Models.");
		telemetry.emit("session.error", { provider: "openai", errorCode: "missing_api_key" });
		telemetry.emit("session.completed", { provider: "openai", outcome: "error" });
		canonical.emit("error", { error: protocolError(error, "missing_api_key"), fatal: true });
		canonical.emit("run.completed", { reason: "error" });
		throw error;
	}

	const model = settings.model || "gpt-realtime-2.1";
	const voice = cleanRealtimeVoice(settings.voiceName);

	let state: LiveSpeechState = "connecting";
	let completionReason: "completed" | "cancelled" | "interrupted" | "error" | null = null;
	let reconnectAttempt = 0;
	let runStarted = true;
	let firstAudioObserved = false;
	let turn = 0;
	let activeTurnStartedAt: number | null = null;
	const toolStartedAt = new Map<string, number>();
	const complete = (reason: NonNullable<typeof completionReason>) => {
		if (completionReason) return;
		completionReason = reason;
		canonical.emit("run.completed", { reason });
		telemetry.emit("session.completed", { provider: "openai", outcome: reason });
	};
	const setState = (next: LiveSpeechState) => {
		if (state === "closed") return;
		state = next;
		onState?.(next);
	};
	setState("connecting");

	let ephemeralKey: string;
	try {
		ephemeralKey = await mintEphemeralKey(apiKey, model, voice, signal);
	} catch (error) {
		telemetry.emit("connection.setup.completed", {
			provider: "openai", model, transport: "webrtc", outcome: "failed",
		}, telemetry.durationSince(setupStartedAt));
		telemetry.emit("session.error", { provider: "openai", errorCode: "ephemeral_key_failed" });
		canonical.emit("error", { error: protocolError(error, "ephemeral_key_failed"), fatal: true });
		complete("error");
		throw error;
	}

	const pc = new RTCPeerConnection();
	const audioEl = typeof document !== "undefined" ? document.createElement("audio") : null;
	if (audioEl) {
		audioEl.autoplay = true;
		audioEl.style.display = "none";
		document.body.appendChild(audioEl);
	}

	let micStream: MediaStream | null = null;
	let cleanedUp = false;
	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		try { pc.close(); } catch {}
		micStream?.getTracks().forEach((track) => track.stop());
		if (audioEl) {
			try { audioEl.pause(); } catch {}
			audioEl.srcObject = null;
			audioEl.remove();
		}
		setState("closed");
		complete("cancelled");
	};

	if (signal?.aborted) {
		canonical.emit("conversation.interrupted", { by: "host", reason: "abort signal before start" });
		telemetry.emit("speech.interrupted", { provider: "openai", reason: "abort", turn });
		complete("interrupted");
		cleanup();
		throw new Error("OpenAI Realtime aborted before start.");
	}
	signal?.addEventListener("abort", () => {
		canonical.emit("conversation.interrupted", { by: "host", reason: "abort signal" });
		telemetry.emit("speech.interrupted", { provider: "openai", reason: "abort", turn });
		complete("interrupted");
		cleanup();
	}, { once: true });

	pc.ontrack = (event) => {
		if (audioEl && event.streams[0]) {
			audioEl.srcObject = event.streams[0];
			audioEl.play().catch(() => {});
		}
	};
	pc.addEventListener("connectionstatechange", () => {
		if (!runStarted) return;
		if (pc.connectionState === "disconnected") {
			reconnectAttempt += 1;
			telemetry.emit("reconnect.started", { provider: "openai", attempt: reconnectAttempt });
			canonical.emit("reconnect.started", { attempt: reconnectAttempt, reason: "WebRTC transport disconnected" });
		} else if (pc.connectionState === "connected" && reconnectAttempt > 0) {
			telemetry.emit("reconnect.completed", { provider: "openai", attempt: reconnectAttempt, outcome: "success" });
			canonical.emit("reconnect.succeeded", { attempt: reconnectAttempt });
			reconnectAttempt = 0;
		} else if (pc.connectionState === "failed") {
			telemetry.emit("reconnect.completed", { provider: "openai", attempt: Math.max(1, reconnectAttempt), outcome: "failed" });
			telemetry.emit("session.error", { provider: "openai", errorCode: "webrtc_connection_failed" });
			const error = protocolError(new Error("WebRTC transport failed"), "webrtc_connection_failed");
			canonical.emit("reconnect.failed", { attempt: Math.max(1, reconnectAttempt), error, retryable: false });
			canonical.emit("error", { error, fatal: true });
			complete("error");
		}
	});

	const dataChannel = pc.createDataChannel("oai-events");
	let responseActive = false;

	micStream = await attachMicrophone(pc);
	if (!micStream) {
		const error = new Error("Microphone unavailable for live voice.");
		telemetry.emit("connection.setup.completed", {
			provider: "openai", model, transport: "webrtc", outcome: "failed",
		}, telemetry.durationSince(setupStartedAt));
		telemetry.emit("session.error", { provider: "openai", errorCode: "microphone_unavailable" });
		canonical.emit("error", { error: protocolError(error, "microphone_unavailable"), fatal: true });
		complete("error");
		cleanup();
		throw error;
	}

	dataChannel.addEventListener("open", () => {
		// Enable continuous server-side voice-activity turn detection so the
		// model keeps listening and replies without an explicit response.create.
		dataChannel.send(JSON.stringify(buildRealtimeSessionUpdate(settings, instructions, tools)));
		setState("listening");
		telemetry.emit("connection.setup.completed", {
			provider: "openai", model, transport: "webrtc", outcome: "success",
		}, telemetry.durationSince(setupStartedAt));
	});

	dataChannel.addEventListener("message", (event) => {
		try {
			const msg = JSON.parse(event.data);
			switch (msg.type) {
			case "input_audio_buffer.speech_started":
				turn += 1;
				activeTurnStartedAt = telemetry.start();
				telemetry.emit("speech.turn.started", { provider: "openai", turn });
				if (responseActive) {
					dataChannel.send(JSON.stringify({ type: "response.cancel" }));
					dataChannel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
					responseActive = false;
					canonical.emit("conversation.interrupted", { by: "user", reason: "barge-in" });
					telemetry.emit("speech.interrupted", { provider: "openai", reason: "barge-in", turn });
				}
				setState("listening");
				break;
			case "response.created":
				responseActive = true;
				break;
			case "response.output_audio.delta":
				case "response.audio.delta":
					if (!firstAudioObserved) {
						firstAudioObserved = true;
						telemetry.emit("audio.first", { provider: "openai", transport: "webrtc" }, telemetry.durationSince(setupStartedAt));
					}
					setState("speaking");
					if (typeof msg.delta === "string") canonical.emit("audio.delta", {
						streamId: typeof msg.item_id === "string" ? `assistant-audio-${msg.item_id}` : "assistant-audio",
						messageId: typeof msg.item_id === "string" ? msg.item_id : undefined,
						role: "assistant",
						encoding: "pcm16",
						sampleRate: 24_000,
						data: msg.delta,
					});
					break;
				case "response.audio_transcript.delta":
				case "response.output_audio_transcript.delta":
					onAssistantTranscript?.(typeof msg.delta === "string" ? msg.delta : "", false);
					canonical.emit("transcript.delta", {
						transcriptId: typeof msg.item_id === "string" ? `assistant-transcript-${msg.item_id}` : "assistant-transcript",
						messageId: typeof msg.item_id === "string" ? msg.item_id : undefined,
						role: "assistant",
						delta: typeof msg.delta === "string" ? msg.delta : "",
						final: false,
					});
					break;
				case "response.audio_transcript.done":
				case "response.output_audio_transcript.done":
					onAssistantTranscript?.(typeof msg.transcript === "string" ? msg.transcript : "", true);
					canonical.emit("transcript.delta", {
						transcriptId: typeof msg.item_id === "string" ? `assistant-transcript-${msg.item_id}` : "assistant-transcript",
						messageId: typeof msg.item_id === "string" ? msg.item_id : undefined,
						role: "assistant", delta: "", final: true,
					});
					if (typeof msg.item_id === "string") canonical.emit("message.completed", { messageId: msg.item_id });
					break;
				case "conversation.item.input_audio_transcription.delta":
					onUserTranscript?.(typeof msg.delta === "string" ? msg.delta : "", false);
					canonical.emit("transcript.delta", {
						transcriptId: typeof msg.item_id === "string" ? `user-transcript-${msg.item_id}` : "user-transcript",
						messageId: typeof msg.item_id === "string" ? msg.item_id : undefined,
						role: "user", delta: typeof msg.delta === "string" ? msg.delta : "", final: false,
					});
					break;
				case "conversation.item.input_audio_transcription.completed":
					onUserTranscript?.(typeof msg.transcript === "string" ? msg.transcript : "", true);
					canonical.emit("transcript.delta", {
						transcriptId: typeof msg.item_id === "string" ? `user-transcript-${msg.item_id}` : "user-transcript",
						messageId: typeof msg.item_id === "string" ? msg.item_id : undefined,
						role: "user", delta: "", final: true,
					});
					if (typeof msg.item_id === "string") canonical.emit("message.completed", { messageId: msg.item_id });
					break;
			case "response.done":
				responseActive = false;
				setState("listening");
				telemetry.emit("speech.turn.completed", { provider: "openai", turn, outcome: "completed" },
					activeTurnStartedAt === null ? undefined : telemetry.durationSince(activeTurnStartedAt));
				activeTurnStartedAt = null;
				break;
			case "response.function_call_arguments.done": {
				if (!onToolCall || typeof msg.name !== "string" || typeof msg.call_id !== "string") break;
				let parsed: Record<string, unknown> = {};
				try { parsed = typeof msg.arguments === "string" && msg.arguments ? JSON.parse(msg.arguments) : {}; } catch {}
				canonical.emit("tool.requested", { callId: msg.call_id, name: msg.name, arguments: jsonRecord(parsed) });
				canonical.emit("tool.started", { callId: msg.call_id });
				toolStartedAt.set(msg.call_id, telemetry.start());
				telemetry.emit("tool.started", { provider: "openai", toolName: msg.name });
				void (async () => {
					try {
						const output = await onToolCall({ callId: msg.call_id, name: msg.name, arguments: parsed });
						canonical.emit("tool.completed", { callId: msg.call_id, result: jsonValue(output) });
						const startedAt = toolStartedAt.get(msg.call_id);
						telemetry.emit("tool.completed", { provider: "openai", toolName: msg.name, outcome: "success" },
							startedAt === undefined ? undefined : telemetry.durationSince(startedAt));
						toolStartedAt.delete(msg.call_id);
						dataChannel.send(JSON.stringify(realtimeFunctionOutput(msg.call_id, output)));
						dataChannel.send(JSON.stringify({ type: "response.create" }));
					} catch (error) {
						canonical.emit("tool.failed", { callId: msg.call_id, error: protocolError(error, "tool_execution_failed") });
						const startedAt = toolStartedAt.get(msg.call_id);
						telemetry.emit("tool.completed", { provider: "openai", toolName: msg.name, outcome: "failed" },
							startedAt === undefined ? undefined : telemetry.durationSince(startedAt));
						toolStartedAt.delete(msg.call_id);
						dataChannel.send(JSON.stringify(realtimeFunctionOutput(msg.call_id, {
							error: error instanceof Error ? error.message : String(error),
						})));
						dataChannel.send(JSON.stringify({ type: "response.create" }));
					}
				})();
				break;
			}
				case "error":
					{
						const error = new Error(`Realtime error: ${msg.error?.message ?? "unknown"}`);
						onError?.(error);
						canonical.emit("error", { error: protocolError(error, "provider_error"), fatal: false });
						telemetry.emit("session.error", { provider: "openai", errorCode: "provider_error" });
					}
					break;
			}
		} catch (error) {
			canonical.emit("error", { error: protocolError(error, "invalid_provider_event"), fatal: false });
			telemetry.emit("session.error", { provider: "openai", errorCode: "invalid_provider_event" });
		}
	});

	try {
		getAudioContext();
		const offer = await pc.createOffer();
		await pc.setLocalDescription(offer);

		const sdpResponse = await withApiRetry(async () => {
			const result = await fetch("https://api.openai.com/v1/realtime/calls", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${ephemeralKey}`,
					"Content-Type": "application/sdp",
				},
				body: offer.sdp,
				signal,
			});
			if (!result.ok) {
				const retryAfter = result.headers.get("retry-after");
				throw new Error(`Realtime SDP exchange failed (${result.status})${retryAfter ? ` retry-after: ${retryAfter}` : ""}`);
			}
			return result;
		}, { signal });
		await pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
	} catch (error) {
		telemetry.emit("connection.setup.completed", { provider: "openai", model, transport: "webrtc", outcome: "failed" }, telemetry.durationSince(setupStartedAt));
		telemetry.emit("session.error", { provider: "openai", errorCode: "session_setup_failed" });
		canonical.emit("error", { error: protocolError(error, "session_setup_failed"), fatal: true });
		complete("error");
		cleanup();
		throw error;
	}

	return {
		get state() {
			return state;
		},
		async stop() {
			complete("cancelled");
			cleanup();
		},
	};
}

const openAIRealtimeProviderDefinition: Omit<SpeechProvider, "startLiveSession"> = {
	id: "openai-realtime",
	label: "OpenAI Realtime",
	kind: "duplex",
	status: "preview",
	description: "WebRTC duplex voice with OpenAI Realtime. Live bidirectional voice sessions with continuous turn detection.",
	models: REALTIME_MODELS,
	voices: REALTIME_VOICES,
	needsApiKey: "openai",
	synthesize,
};

export function createOpenAIRealtimeProvider(observer?: RealtimeTelemetryObserver): SpeechProvider {
	return {
		...openAIRealtimeProviderDefinition,
		startLiveSession: (request) => startLiveSession(request, observer),
	};
}

export const openAIRealtimeProvider: SpeechProvider = createOpenAIRealtimeProvider();
