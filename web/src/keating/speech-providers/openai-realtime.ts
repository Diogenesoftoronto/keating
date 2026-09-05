import {
	getAudioContext,
	type LiveHistoryTurn,
	type LiveImageInput,
	type LiveSpeechRequest,
	type LiveSpeechSession,
	type LiveSpeechTool,
	type SpeechProvider,
	type SpeechSynthesisRequest,
	type SpeechSynthesisResult,
} from "../speech";
import { liveSpeechModelsFor } from "../live-models";
import { withApiRetry } from "../api-retry";
import { negotiateProviderCapabilities } from "../providers";
import {
	createRealtimeTelemetry,
	type RealtimeTelemetryObserver,
} from "../observability";
import {
	createRealtimeCanonicalBridge,
	jsonRecord,
	parseToolArguments,
	protocolError as sharedProtocolError,
	runLiveToolCall,
} from "./live-session-shared";
import {
	addAbortListener,
	createLiveSessionLifecycle,
	createLiveTurnTelemetry,
} from "./live-session-lifecycle";

export {
	createRealtimeCanonicalBridge,
	type RealtimeCanonicalBridge,
} from "./live-session-shared";

function protocolError(error: unknown, code: string) {
	return sharedProtocolError(error, code, "openai");
}

export function negotiateOpenAIRealtimeSession(model: string) {
	return negotiateProviderCapabilities(
		{ provider: "openai", id: model, api: "openai-realtime" },
		{ realtimeAudio: true, toolCalls: true, preferredTransports: ["webrtc"], allowAdapters: false },
	);
}

/** Only the reasoning-capable realtime models accept a reasoning budget. */
function supportsReasoningEffort(model: string): boolean {
	return /^gpt-realtime-2/i.test(model);
}

/**
 * Session configuration in the current nested shape.
 *
 * Turn detection, transcription, and voice all live under `audio.input` /
 * `audio.output`. The older flat layout (`turn_detection` and
 * `input_audio_transcription` at the session root) is silently ignored by the
 * GA endpoint, which means those settings never took effect.
 */
export function buildRealtimeSessionConfig(
	settings: LiveSpeechRequest["settings"],
	instructions?: string,
	tools: LiveSpeechTool[] = [],
): Record<string, unknown> {
	return {
		type: "realtime",
		output_modalities: ["audio"],
		audio: {
			input: {
				format: { type: "audio/pcm", rate: 24_000 },
				// Semantic VAD waits on meaning rather than a fixed silence
				// window, so a learner thinking mid-sentence is not cut off.
				turn_detection: { type: "semantic_vad", create_response: true, interrupt_response: true },
				transcription: { model: "gpt-4o-transcribe" },
			},
			output: {
				format: { type: "audio/pcm" },
				voice: cleanRealtimeVoice(settings.voiceName),
			},
		},
		...(supportsReasoningEffort(settings.model) ? { reasoning: { effort: settings.reasoningEffort } } : {}),
		...(instructions ? { instructions } : {}),
		...(tools.length > 0 ? {
			tools: tools.map((tool) => ({ type: "function", ...tool })),
			tool_choice: "auto",
		} : {}),
	};
}

export function buildRealtimeSessionUpdate(
	settings: LiveSpeechRequest["settings"],
	instructions?: string,
	tools: LiveSpeechTool[] = [],
): Record<string, unknown> {
	return {
		type: "session.update",
		session: buildRealtimeSessionConfig(settings, instructions, tools),
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

/**
 * A sampled frame, as a conversation item.
 *
 * Realtime has no video lane, so vision arrives as still images attached to the
 * conversation. Deliberately not followed by `response.create`: a frame is
 * context for the next turn, not a turn of its own, and forcing a response on
 * every frame would make the model narrate the camera feed.
 */
export function realtimeImageItem(dataUrl: string): Record<string, unknown> {
	return {
		type: "conversation.item.create",
		item: {
			type: "message",
			role: "user",
			content: [{ type: "input_image", image_url: dataUrl }],
		},
	};
}

/** Wait for an RTC data channel instead of silently dropping a learner action. */
export function waitForRealtimeDataChannel(
	channel: Pick<RTCDataChannel, "readyState" | "addEventListener" | "removeEventListener">,
	signal?: AbortSignal,
): Promise<void> {
	if (channel.readyState === "open") return Promise.resolve();
	if (channel.readyState === "closing" || channel.readyState === "closed") {
		return Promise.reject(new Error("The Realtime image channel is closed."));
	}
	if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			channel.removeEventListener("open", onOpen);
			channel.removeEventListener("close", onClose);
			channel.removeEventListener("error", onError);
			signal?.removeEventListener("abort", onAbort);
		};
		const settle = (callback: () => void) => {
			cleanup();
			callback();
		};
		const onOpen = () => settle(resolve);
		const onClose = () => settle(() => reject(new Error("The Realtime image channel closed before the image was sent.")));
		const onError = () => settle(() => reject(new Error("The Realtime image channel could not send the image.")));
		const onAbort = () => settle(() => reject(new DOMException("Aborted", "AbortError")));

		channel.addEventListener("open", onOpen, { once: true });
		channel.addEventListener("close", onClose, { once: true });
		channel.addEventListener("error", onError, { once: true });
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** Seed a prior chat turn so a voice session continues the same conversation. */
export function realtimeHistoryItem(turn: LiveHistoryTurn): Record<string, unknown> {
	return {
		type: "conversation.item.create",
		item: {
			type: "message",
			role: turn.role,
			content: [{
				type: turn.role === "assistant" ? "output_text" : "input_text",
				text: turn.text,
			}],
		},
	};
}

const REALTIME_MODELS = liveSpeechModelsFor("openai-realtime");

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

/**
 * Exchange the local SDP offer for the provider's answer.
 *
 * Session config rides along in the same multipart request so turn detection,
 * voice, and tools are correct from the very first utterance. Waiting for the
 * data channel to open before sending `session.update` leaves a window where
 * the model is listening under default settings.
 */
async function exchangeSdp(
	offerSdp: string,
	ephemeralKey: string,
	session: Record<string, unknown> | null,
	signal?: AbortSignal,
): Promise<string> {
	const response = await withApiRetry(async () => {
		const body = session === null ? offerSdp : (() => {
			const form = new FormData();
			form.set("sdp", offerSdp);
			form.set("session", JSON.stringify(session));
			return form;
		})();
		const result = await fetch("https://api.openai.com/v1/realtime/calls", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ephemeralKey}`,
				// FormData sets its own multipart boundary; setting it by hand breaks the parse.
				...(session === null ? { "Content-Type": "application/sdp" } : {}),
			},
			body,
			signal,
		});
		if (!result.ok) {
			const errText = await result.text().catch(() => "");
			const retryAfter = result.headers.get("retry-after");
			throw new Error(
				`Realtime SDP exchange failed (${result.status})`
				+ `${errText ? `: ${errText.slice(0, 200)}` : ""}`
				+ `${retryAfter ? ` retry-after: ${retryAfter}` : ""}`,
			);
		}
		return result;
	}, { signal });
	return await response.text();
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
	let detachAbort = () => {};

	const cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		detachAbort();
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
	detachAbort = addAbortListener(signal, cleanup);

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
					output_modalities: ["audio"],
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

			// One-shot synthesis needs no session config beyond the minted voice.
			const answerSdp = await exchangeSdp(offer.sdp ?? "", ephemeralKey, null, signal);
			await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
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
	const { settings, getApiKey, signal, instructions, tools, history, onToolCall, onState, onUserTranscript, onAssistantTranscript, onError } = request;
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
	// Still-image input is distinct from video. GPT Realtime can accept an image
	// item mid-conversation, but Keating never opens a camera or screen stream for
	// it and never drips sampled frames into the session.
	const imageCapable = capability.capabilities.realtimeImage === "native";
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

	let reconnectAttempt = 0;
	const turnTelemetry = createLiveTurnTelemetry({
		provider: "openai",
		transport: "webrtc",
		telemetry,
		setupStartedAt,
	});

	let ephemeralKey: string;
	try {
		ephemeralKey = await mintEphemeralKey(apiKey, model, voice, signal);
	} catch (error) {
		telemetry.emit("connection.setup.completed", {
			provider: "openai", model, transport: "webrtc", outcome: "failed",
		}, telemetry.durationSince(setupStartedAt));
		telemetry.emit("session.error", { provider: "openai", errorCode: "ephemeral_key_failed" });
		canonical.emit("error", { error: protocolError(error, "ephemeral_key_failed"), fatal: true });
		canonical.emit("run.completed", { reason: "error" });
		telemetry.emit("session.completed", { provider: "openai", outcome: "error" });
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
	const lifecycle = createLiveSessionLifecycle({
		signal,
		onState,
		onAbort: (beforeStart) => {
			canonical.emit("conversation.interrupted", {
				by: "host",
				reason: beforeStart ? "abort signal before start" : "abort signal",
			});
			telemetry.emit("speech.interrupted", { provider: "openai", reason: "abort", turn: turnTelemetry.turn });
		},
		onComplete: (reason) => {
			canonical.emit("run.completed", { reason });
			telemetry.emit("session.completed", { provider: "openai", outcome: reason });
		},
	});
	lifecycle.addCleanup(() => {
		try { pc.close(); } catch {}
		micStream?.getTracks().forEach((track) => track.stop());
		if (audioEl) {
			try { audioEl.pause(); } catch {}
			audioEl.srcObject = null;
			audioEl.remove();
		}
	});

	if (!lifecycle.start()) {
		throw new Error("OpenAI Realtime aborted before start.");
	}

	pc.ontrack = (event) => {
		if (audioEl && event.streams[0]) {
			audioEl.srcObject = event.streams[0];
			audioEl.play().catch(() => {});
		}
	};
	pc.addEventListener("connectionstatechange", () => {
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
			lifecycle.complete("error");
		}
	});

	const dataChannel = pc.createDataChannel("oai-events");
	let responseActive = false;

	const sessionTools = tools ?? [];

	micStream = await attachMicrophone(pc);
	if (!micStream) {
		const error = new Error("Microphone unavailable for live voice.");
		telemetry.emit("connection.setup.completed", {
			provider: "openai", model, transport: "webrtc", outcome: "failed",
		}, telemetry.durationSince(setupStartedAt));
		telemetry.emit("session.error", { provider: "openai", errorCode: "microphone_unavailable" });
		canonical.emit("error", { error: protocolError(error, "microphone_unavailable"), fatal: true });
		lifecycle.close("error");
		throw error;
	}

	const send = (payload: Record<string, unknown>) => {
		if (dataChannel.readyState !== "open") return;
		try {
			dataChannel.send(JSON.stringify(payload));
		} catch (error) {
			console.warn("[keating:realtime] send failed", error);
		}
	};

	dataChannel.addEventListener("open", () => {
		// Re-sent even though the same config rode along with the SDP offer: the
		// update is idempotent and guarantees tools are registered before the
		// learner's first utterance.
		send(buildRealtimeSessionUpdate(settings, instructions, sessionTools));

		// Replay prior chat turns so the voice session continues the same
		// conversation instead of reintroducing itself.
		for (const turnItem of history ?? []) {
			if (turnItem.text.trim()) send(realtimeHistoryItem(turnItem));
		}

		lifecycle.setState("listening");
		telemetry.emit("connection.setup.completed", {
			provider: "openai", model, transport: "webrtc", outcome: "success",
		}, telemetry.durationSince(setupStartedAt));
	});

	dataChannel.addEventListener("message", (event) => {
		try {
			const msg = JSON.parse(event.data);
			switch (msg.type) {
			case "input_audio_buffer.speech_started":
				turnTelemetry.startTurn();
				if (responseActive) {
					dataChannel.send(JSON.stringify({ type: "response.cancel" }));
					dataChannel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
					responseActive = false;
					canonical.emit("conversation.interrupted", { by: "user", reason: "barge-in" });
					telemetry.emit("speech.interrupted", { provider: "openai", reason: "barge-in", turn: turnTelemetry.turn });
				}
				lifecycle.setState("listening");
				break;
			case "response.created":
				responseActive = true;
				break;
			case "response.output_audio.delta":
			case "response.audio.delta":
					turnTelemetry.observeFirstAudio();
					lifecycle.setState("speaking");
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
				lifecycle.setState("listening");
				turnTelemetry.completeTurn();
				break;
			case "response.function_call_arguments.done": {
				if (typeof msg.name !== "string" || typeof msg.call_id !== "string") break;
				const call = {
					callId: msg.call_id,
					name: msg.name,
					arguments: parseToolArguments(msg.arguments),
				};
				void runLiveToolCall({
					call,
					provider: "openai",
					canonical,
					telemetry,
					execute: async (pending) => {
						if (!onToolCall) throw new Error(`No handler is available for tool ${pending.name}.`);
						return await onToolCall(pending);
					},
					respond: (callId, output) => {
						send(realtimeFunctionOutput(callId, output));
						send({ type: "response.create" });
					},
					respondError: (callId, message) => {
						send(realtimeFunctionOutput(callId, { error: message }));
						send({ type: "response.create" });
					},
				});
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

		// Session config travels with the offer so turn detection, voice, and
		// tools are in force before the learner's first word.
		const answerSdp = await exchangeSdp(
			offer.sdp ?? "",
			ephemeralKey,
			buildRealtimeSessionConfig(settings, instructions, sessionTools),
			signal,
		);
		await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
	} catch (error) {
		telemetry.emit("connection.setup.completed", { provider: "openai", model, transport: "webrtc", outcome: "failed" }, telemetry.durationSince(setupStartedAt));
		telemetry.emit("session.error", { provider: "openai", errorCode: "session_setup_failed" });
		canonical.emit("error", { error: protocolError(error, "session_setup_failed"), fatal: true });
		lifecycle.close("error");
		throw error;
	}

	return {
		get state() {
			return lifecycle.state;
		},
		videoRoute: "none",
		videoCapable: false,
		imageCapable,
		get inputStream() {
			return micStream;
		},
		setMicrophoneMuted(muted: boolean) {
			// Disabling the track keeps the WebRTC sender alive and transmitting
			// silence, which is what the server's turn detection expects; removing
			// the track would end the session's input stream outright.
			micStream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
		},
		async sendImage(image: LiveImageInput) {
			if (!imageCapable) throw new Error(`${model} cannot accept image input.`);
			if (!image.data) throw new Error("The selected image is empty.");
			await waitForRealtimeDataChannel(dataChannel, signal);
			if (lifecycle.state === "closed") throw new Error("The Realtime session is closed.");
			const dataUrl = `data:${image.mimeType};base64,${image.data}`;
			try {
				dataChannel.send(JSON.stringify(realtimeImageItem(dataUrl)));
			} catch (error) {
				throw new Error("OpenAI Realtime could not accept the image payload.", { cause: error });
			}
		},
		async stop() {
			lifecycle.close("cancelled");
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
