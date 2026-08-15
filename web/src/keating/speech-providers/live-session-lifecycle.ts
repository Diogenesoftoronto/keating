import type { RealtimeTelemetry } from "../observability";
import type { LiveSpeechState } from "../speech";
import type { CapturedFrame, VideoCaptureHandle } from "../video-capture";
import type { LiveProviderId } from "./live-session-shared";

export type LiveSessionCompletionReason = "completed" | "cancelled" | "interrupted" | "error";

interface LiveTurnTelemetryOptions {
	provider: LiveProviderId;
	transport: "websocket" | "webrtc";
	telemetry: RealtimeTelemetry;
	setupStartedAt: number;
}

/** Track provider-neutral first-audio and turn timing without owning transport events. */
export function createLiveTurnTelemetry(options: LiveTurnTelemetryOptions) {
	let firstAudioObserved = false;
	let turn = 0;
	let activeTurnStartedAt: number | null = null;

	return {
		get turn() {
			return turn;
		},
		observeFirstAudio() {
			if (firstAudioObserved) return;
			firstAudioObserved = true;
			options.telemetry.emit(
				"audio.first",
				{ provider: options.provider, transport: options.transport },
				options.telemetry.durationSince(options.setupStartedAt),
			);
		},
		startTurn() {
			if (activeTurnStartedAt !== null) return;
			turn += 1;
			activeTurnStartedAt = options.telemetry.start();
			options.telemetry.emit("speech.turn.started", { provider: options.provider, turn });
		},
		completeTurn() {
			options.telemetry.emit(
				"speech.turn.completed",
				{ provider: options.provider, turn, outcome: "completed" },
				activeTurnStartedAt === null ? undefined : options.telemetry.durationSince(activeTurnStartedAt),
			);
			activeTurnStartedAt = null;
		},
	};
}

/** Attach an abort callback and return an idempotent way to detach it. */
export function addAbortListener(
	signal: AbortSignal | undefined,
	listener: () => void,
): () => void {
	if (!signal) return () => {};
	let attached = true;
	const handleAbort = () => {
		attached = false;
		listener();
	};
	signal.addEventListener("abort", handleAbort, { once: true });
	return () => {
		if (!attached) return;
		attached = false;
		signal.removeEventListener("abort", handleAbort);
	};
}

interface LiveSessionLifecycleOptions {
	signal?: AbortSignal;
	onState?: (state: LiveSpeechState) => void;
	onAbort: (beforeStart: boolean) => void;
	onComplete: (reason: LiveSessionCompletionReason) => void;
}

/**
 * Own the provider-neutral state, completion, cleanup, and abort contract for a
 * live session. Provider transports register their own resource cleanup.
 */
export function createLiveSessionLifecycle(options: LiveSessionLifecycleOptions) {
	let state: LiveSpeechState = "connecting";
	let completionReason: LiveSessionCompletionReason | null = null;
	let closed = false;
	let detachAbort = () => {};
	const cleanups: Array<() => void> = [];

	const complete = (reason: LiveSessionCompletionReason) => {
		if (completionReason) return;
		completionReason = reason;
		options.onComplete(reason);
	};

	const setState = (next: LiveSpeechState) => {
		if (state === "closed") return;
		state = next;
		options.onState?.(next);
	};

	const close = (reason: LiveSessionCompletionReason = "cancelled") => {
		if (closed) return;
		closed = true;
		detachAbort();
		for (let index = cleanups.length - 1; index >= 0; index -= 1) {
			try { cleanups[index](); } catch {}
		}
		state = "closed";
		options.onState?.("closed");
		complete(reason);
	};

	const start = (): boolean => {
		setState("connecting");
		if (options.signal?.aborted) {
			options.onAbort(true);
			close("interrupted");
			return false;
		}
		detachAbort = addAbortListener(options.signal, () => {
			options.onAbort(false);
			close("interrupted");
		});
		return true;
	};

	return {
		get state() {
			return state;
		},
		get completionReason() {
			return completionReason;
		},
		addCleanup(cleanup: () => void) {
			if (closed) {
				cleanup();
				return;
			}
			cleanups.push(cleanup);
		},
		complete,
		setState,
		close,
		start,
	};
}

interface LiveVideoSubscriptionOptions {
	capable: boolean;
	initial?: VideoCaptureHandle | null;
	onFrame: (frame: CapturedFrame) => void;
}

/**
 * Move a sampled-frame subscription between caller-owned capture handles.
 * Readiness stays explicit because Gemini can subscribe after socket setup,
 * while OpenAI must wait for its data channel to open.
 */
export function createLiveVideoSubscription(options: LiveVideoSubscriptionOptions) {
	let active = options.capable ? options.initial ?? null : null;
	let ready = false;
	let unsubscribe: (() => void) | null = null;

	const detach = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const subscribe = () => {
		detach();
		if (ready && active) unsubscribe = active.onFrame(options.onFrame);
	};

	return {
		get active() {
			return active;
		},
		setReady(next = true) {
			if (ready === next) return;
			ready = next;
			subscribe();
		},
		attach(next?: VideoCaptureHandle | null) {
			active = options.capable ? next ?? null : null;
			subscribe();
		},
		stop: detach,
	};
}
