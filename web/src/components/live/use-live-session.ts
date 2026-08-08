import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	getLiveSpeechBridge,
	getSpeechProvider,
	loadWebSpeechSettings,
	primeSpeechAudio,
	resolveSpeechRealtimeTier,
	saveWebSpeechSettings,
	type LiveSpeechSession,
	type LiveSpeechState,
	type WebSpeechSettings,
} from "../../keating/speech";
import {
	classifyCaptureFailure,
	classifyLiveFailure,
	type LiveFailure,
} from "../../keating/live-errors";
import {
	describeLiveModel,
	liveModelsFor,
	nextBestLiveModel,
	type LiveModelOption,
} from "../../keating/live-models";
import {
	appendLiveTranscript,
	emptyLiveTranscript,
	flushLiveTranscript,
	type LiveTranscriptState,
	type LiveTranscriptTurn,
} from "../../keating/live-transcript";
import {
	startVideoCapture,
	type CameraFacing,
	type VideoCaptureHandle,
	type VideoSource,
} from "../../keating/video-capture";
import type { ConversationEvent } from "../../keating/protocol";
import { getProviderApiKey } from "../../lib/provider-models";

/**
 * The whole runtime of a live conversation, minus the pixels.
 *
 * Live mode used to exist twice — once as a page, once as a dialog — and the
 * two copies drifted: only one of them could recover from a bad model, neither
 * could turn the camera on after the session had started. Everything stateful
 * lives here now so the surface is a rendering of this hook and nothing else.
 *
 * Two rules shape the design:
 *
 *  - The connection is disposable, the conversation is not. Switching model or
 *    retrying tears down the socket and keeps the transcript, the camera, and
 *    the learner's mute preference.
 *  - Video is an accessory. Anything that goes wrong with a camera degrades to
 *    a notice; only the voice channel can fail the session.
 */

export type LivePhase = "connecting" | "live" | "failed" | "ended";

export interface LiveToolActivity {
	callId: string;
	name: string;
	status: "running" | "completed" | "failed";
}

export interface UseLiveSessionOptions {
	/** Called once, on a clean end, with everything that was said. */
	onConversationComplete: (turns: LiveTranscriptTurn[]) => void | Promise<void>;
	/**
	 * A capture request already in flight from the opening click. Screen sharing
	 * needs transient user activation, which is gone by the time the provider
	 * handshake finishes, so the caller starts it and hands us the promise.
	 */
	initialVideoPromise?: Promise<VideoCaptureHandle | null> | null;
}

export interface LiveSessionController {
	phase: LivePhase;
	speechState: LiveSpeechState;
	failure: LiveFailure | null;
	/** Non-fatal problem, typically a camera. Clears on the next attempt. */
	notice: LiveFailure | null;
	dismissNotice: () => void;

	transcript: LiveTranscriptState;
	tools: LiveToolActivity[];

	providerId: string;
	model: LiveModelOption;
	models: LiveModelOption[];
	alternativeModel: LiveModelOption | undefined;
	tierLabel: string;
	visionCapable: boolean;

	micMuted: boolean;
	toggleMic: () => void;
	/** The live microphone, for the visualizer's level meter. */
	inputStream: MediaStream | null;

	videoSource: VideoSource | null;
	videoStarting: boolean;
	cameraFacing: CameraFacing;
	previewRef: React.RefObject<HTMLVideoElement | null>;
	startVideo: (source: VideoSource) => void;
	stopVideo: () => void;
	flipCamera: () => void;

	framesSent: number;
	elapsedMs: number;

	retry: () => void;
	switchModel: (model: string) => void;
	end: () => void;
}

/** Which stored credential a live provider needs. */
export function liveCredentialProvider(providerId: string): "google" | "openai" | null {
	if (providerId === "gemini-live") return "google";
	if (providerId === "openai-realtime") return "openai";
	return null;
}

export function useLiveSession(options: UseLiveSessionOptions): LiveSessionController {
	const { onConversationComplete, initialVideoPromise } = options;

	const [settings, setSettings] = useState<WebSpeechSettings>(() => loadWebSpeechSettings());
	const [phase, setPhase] = useState<LivePhase>("connecting");
	const [speechState, setSpeechState] = useState<LiveSpeechState>("connecting");
	const [failure, setFailure] = useState<LiveFailure | null>(null);
	const [notice, setNotice] = useState<LiveFailure | null>(null);
	const [transcript, setTranscript] = useState<LiveTranscriptState>(emptyLiveTranscript);
	const [tools, setTools] = useState<LiveToolActivity[]>([]);
	const [micMuted, setMicMuted] = useState(false);
	const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
	const [videoStarting, setVideoStarting] = useState(false);
	const [cameraFacing, setCameraFacing] = useState<CameraFacing>("user");
	const [framesSent, setFramesSent] = useState(0);
	const [elapsedMs, setElapsedMs] = useState(0);
	const [triedModels, setTriedModels] = useState<string[]>([]);
	const [visionCapable, setVisionCapable] = useState(false);
	// Held in state, not read off the session ref, so the visualizer remounts its
	// analyser when a reconnect hands us a different microphone.
	const [inputStream, setInputStream] = useState<MediaStream | null>(null);
	// Bumped to force a reconnect; the connect effect keys off it.
	const [attempt, setAttempt] = useState(0);

	const sessionRef = useRef<LiveSpeechSession | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const videoRef = useRef<VideoCaptureHandle | null>(null);
	const previewRef = useRef<HTMLVideoElement | null>(null);
	const transcriptRef = useRef<LiveTranscriptState>(transcript);
	const micMutedRef = useRef(micMuted);
	const finishedRef = useRef(false);
	const startedAtRef = useRef(Date.now());
	// Consumed exactly once: a reconnect must not re-await a settled handle.
	const pendingVideoRef = useRef(initialVideoPromise ?? null);

	const model = useMemo(
		() => describeLiveModel(settings.providerId, settings.model),
		[settings.providerId, settings.model],
	);
	const models = useMemo(() => liveModelsFor(settings.providerId), [settings.providerId]);
	const alternativeModel = useMemo(
		() => nextBestLiveModel(settings.providerId, settings.model, triedModels),
		[settings.providerId, settings.model, triedModels],
	);
	const tierLabel = useMemo(() => resolveSpeechRealtimeTier(settings).label, [settings]);

	const receiveTranscript = useCallback((role: "user" | "assistant", text: string, final: boolean) => {
		setTranscript((current) => {
			const next = appendLiveTranscript(current, role, text, final);
			transcriptRef.current = next;
			return next;
		});
	}, []);

	/** Point the preview element and the live session at a capture handle. */
	const bindVideo = useCallback((handle: VideoCaptureHandle | null) => {
		videoRef.current = handle;
		if (previewRef.current) {
			previewRef.current.srcObject = handle?.stream ?? null;
			if (handle) void previewRef.current.play().catch(() => {});
		}
		setVideoSource(handle?.source ?? null);
		if (handle) setCameraFacing(handle.facing);
		sessionRef.current?.setVideo?.(handle);
	}, []);

	const detachVideo = useCallback(() => {
		const handle = videoRef.current;
		videoRef.current = null;
		sessionRef.current?.setVideo?.(null);
		if (previewRef.current) previewRef.current.srcObject = null;
		setVideoSource(null);
		handle?.stop();
	}, []);

	const onConversationEvent = useCallback((event: ConversationEvent) => {
		// Persistence and the session recorder still listen on the window bus.
		window.dispatchEvent(new CustomEvent("keating:conversation-event", { detail: event }));
		switch (event.type) {
			case "tool.requested":
				setTools((prev) => [
					...prev.filter((entry) => entry.callId !== event.payload.callId),
					{ callId: event.payload.callId, name: event.payload.name, status: "running" },
				]);
				break;
			case "tool.completed":
			case "tool.failed":
				setTools((prev) => prev.map((entry) => entry.callId === event.payload.callId
					? { ...entry, status: event.type === "tool.completed" ? "completed" : "failed" }
					: entry));
				break;
			default:
				break;
		}
	}, []);

	// The connection itself. Re-runs on every retry and model switch; the
	// transcript, camera, and mute state deliberately live outside it.
	useEffect(() => {
		let active = true;
		const abort = new AbortController();
		abortRef.current = abort;
		setPhase("connecting");
		setSpeechState("connecting");
		setFailure(null);

		(async () => {
			try {
				await primeSpeechAudio();
				const provider = await getSpeechProvider(settings.providerId);
				if (!provider?.startLiveSession) {
					throw new Error(`${settings.providerId} does not support live voice.`);
				}

				const bridge = getLiveSpeechBridge();
				const conversationDetail: { ids?: { sessionId: string } } = {};
				window.dispatchEvent(new CustomEvent("keating:conversation-ids", { detail: conversationDetail }));

				// A handle from a previous attempt (or from the opening click) keeps
				// the camera alive across a reconnect.
				let video = videoRef.current;
				if (!video && pendingVideoRef.current) {
					const pending = pendingVideoRef.current;
					pendingVideoRef.current = null;
					video = await pending.catch(() => null);
					if (!active) {
						video?.stop();
						return;
					}
					if (video) bindVideo(video);
				}

				const session = await provider.startLiveSession({
					settings,
					getApiKey: getProviderApiKey,
					signal: abort.signal,
					instructions: bridge?.instructions,
					history: bridge?.history,
					tools: bridge?.tools,
					video,
					onToolCall: bridge ? (call) => bridge.execute(call, abort.signal) : undefined,
					onConversationEvent,
					conversationIds: conversationDetail.ids,
					onState: (next) => {
						if (!active) return;
						setSpeechState(next);
						if (next !== "closed") setPhase("live");
					},
					onUserTranscript: (text, final) => { if (active) receiveTranscript("user", text, final); },
					onAssistantTranscript: (text, final) => { if (active) receiveTranscript("assistant", text, final); },
					onError: (error) => {
						// Mid-session provider errors are reported but do not by
						// themselves end the conversation; the transport decides that.
						if (active) setNotice(classifyLiveFailure(error, { providerId: settings.providerId, model: settings.model }));
					},
				});

				if (!active) {
					void session.stop();
					return;
				}
				sessionRef.current = session;
				setVisionCapable(session.visionCapable !== false);
				setInputStream(session.inputStream ?? null);
				setPhase("live");
				// Re-apply choices the learner made before this connection existed.
				if (micMutedRef.current) session.setMicrophoneMuted?.(true);
			} catch (error) {
				if (!active) return;
				sessionRef.current = null;
				setFailure(classifyLiveFailure(error, { providerId: settings.providerId, model: settings.model }));
				setPhase("failed");
			}
		})();

		return () => {
			active = false;
			abort.abort();
			void sessionRef.current?.stop().catch(() => {});
			sessionRef.current = null;
			// The tracks are gone with the session; leaving the stream referenced
			// would have the meter analysing a corpse.
			setInputStream(null);
		};
	}, [attempt, bindVideo, onConversationEvent, receiveTranscript, settings]);

	// A live session holds a microphone, possibly a camera, and a metered socket.
	// None of that may outlive the surface.
	useEffect(() => () => {
		abortRef.current?.abort();
		void sessionRef.current?.stop().catch(() => {});
		sessionRef.current = null;
		videoRef.current?.stop();
		videoRef.current = null;
		// The opening click may have started a capture that no attempt consumed.
		void pendingVideoRef.current?.then((handle) => handle?.stop()).catch(() => {});
		pendingVideoRef.current = null;
	}, []);

	// Clock and frame counter, on one tick.
	useEffect(() => {
		if (phase !== "live") return;
		const timer = setInterval(() => {
			setElapsedMs(Date.now() - startedAtRef.current);
			setFramesSent(sessionRef.current?.framesSent ?? 0);
		}, 1000);
		return () => clearInterval(timer);
	}, [phase]);

	const toggleMic = useCallback(() => {
		setMicMuted((current) => {
			const next = !current;
			micMutedRef.current = next;
			sessionRef.current?.setMicrophoneMuted?.(next);
			return next;
		});
	}, []);

	const startVideo = useCallback((source: VideoSource) => {
		if (videoStarting) return;
		setNotice(null);
		setVideoStarting(true);
		const facing = source === "camera" ? cameraFacing : undefined;
		startVideoCapture({ source, facing, intervalMs: settings.frameIntervalMs })
			.then((handle) => {
				// The learner can close the surface while the permission prompt is up.
				if (finishedRef.current) {
					handle.stop();
					return;
				}
				videoRef.current?.stop();
				bindVideo(handle);
				handle.onEnded(() => {
					// Fires when the browser's own "stop sharing" bar is used.
					if (videoRef.current === handle) {
						videoRef.current = null;
						sessionRef.current?.setVideo?.(null);
						if (previewRef.current) previewRef.current.srcObject = null;
						setVideoSource(null);
					}
				});
				// Remember the choice so the next session opens the same way.
				const stored = loadWebSpeechSettings();
				saveWebSpeechSettings({ ...stored, videoEnabled: true, videoSource: source });
			})
			.catch((error) => {
				console.warn("[keating:live] capture failed", error);
				setNotice(classifyCaptureFailure(error, source));
			})
			.finally(() => setVideoStarting(false));
	}, [bindVideo, cameraFacing, settings.frameIntervalMs, videoStarting]);

	const stopVideo = useCallback(() => {
		detachVideo();
		const stored = loadWebSpeechSettings();
		saveWebSpeechSettings({ ...stored, videoEnabled: false });
	}, [detachVideo]);

	const flipCamera = useCallback(() => {
		const next: CameraFacing = cameraFacing === "user" ? "environment" : "user";
		setCameraFacing(next);
		if (videoRef.current?.source !== "camera") return;
		setVideoStarting(true);
		startVideoCapture({ source: "camera", facing: next, intervalMs: settings.frameIntervalMs })
			.then((handle) => {
				if (finishedRef.current) {
					handle.stop();
					return;
				}
				videoRef.current?.stop();
				bindVideo(handle);
			})
			.catch((error) => {
				setCameraFacing(cameraFacing);
				setNotice(classifyCaptureFailure(error, "camera"));
			})
			.finally(() => setVideoStarting(false));
	}, [bindVideo, cameraFacing, settings.frameIntervalMs]);

	const retry = useCallback(() => {
		setNotice(null);
		setAttempt((value) => value + 1);
	}, []);

	const switchModel = useCallback((next: string) => {
		setTriedModels((tried) => (tried.includes(settings.model) ? tried : [...tried, settings.model]));
		const stored = loadWebSpeechSettings();
		const updated = { ...stored, model: next };
		saveWebSpeechSettings(updated);
		setSettings(updated);
		setNotice(null);
		setAttempt((value) => value + 1);
	}, [settings.model]);

	const end = useCallback(() => {
		if (finishedRef.current) return;
		finishedRef.current = true;
		abortRef.current?.abort();
		void sessionRef.current?.stop().catch(() => {});
		sessionRef.current = null;
		videoRef.current?.stop();
		videoRef.current = null;
		setPhase("ended");

		const completed = flushLiveTranscript(transcriptRef.current);
		transcriptRef.current = completed;
		if (completed.turns.length > 0) {
			void Promise.resolve(onConversationComplete(completed.turns)).catch((error) => {
				console.error("Could not preserve the live conversation in chat:", error);
			});
		}
	}, [onConversationComplete]);

	return {
		phase,
		speechState,
		failure,
		notice,
		dismissNotice: useCallback(() => setNotice(null), []),
		transcript,
		tools,
		providerId: settings.providerId,
		model,
		models,
		alternativeModel,
		tierLabel,
		visionCapable,
		micMuted,
		toggleMic,
		inputStream,
		videoSource,
		videoStarting,
		cameraFacing,
		previewRef,
		startVideo,
		stopVideo,
		flipCamera,
		framesSent,
		elapsedMs,
		retry,
		switchModel,
		end,
	};
}
