/**
 * Turning live-session failures into something a learner can act on.
 *
 * A realtime session can fail in a dozen ways that all arrive as a bare
 * `Error` with a provider's wording in it — an HTTP status buried in a mint
 * response, a DOMException from a declined permission prompt, a websocket that
 * closed without saying why. Showing that string is what made live mode feel
 * broken: "Realtime session mint failed (404)" tells the learner nothing about
 * what to press next.
 *
 * So every failure is classified once, here, into a kind plus the set of
 * recoveries that make sense for it. The UI renders buttons from the flags
 * rather than pattern-matching messages itself, and the classification is pure
 * so it can be tested without a browser or a socket.
 */

import { describeLiveModel } from "./live-models";
import type { VideoSource } from "./video-capture";

export type LiveFailureKind =
	| "missing-key"
	| "auth"
	| "model-unavailable"
	| "rate-limit"
	| "microphone-denied"
	| "microphone-unavailable"
	| "camera-denied"
	| "camera-unavailable"
	| "camera-in-use"
	| "screen-denied"
	| "vision-unsupported"
	| "network"
	| "unsupported-provider"
	| "unknown";

export interface LiveFailure {
	kind: LiveFailureKind;
	/** Short headline, sentence case, no trailing period. */
	title: string;
	/** One or two sentences explaining what happened. */
	message: string;
	/** What to do about it, phrased as an instruction. Optional. */
	hint?: string;
	/** Reconnecting with the same settings could plausibly work. */
	retry: boolean;
	/** The model is implicated; offer the next one in the fallback chain. */
	switchModel: boolean;
	/** Which settings tab would fix this, if any. */
	settings: "providers" | "speech" | null;
	/** Falling back to push-to-talk dictation would still let them work. */
	dictation: boolean;
	/** Only vision failed — the voice session is unaffected and continues. */
	videoOnly: boolean;
	/** The raw provider text, kept for the details disclosure. */
	detail?: string;
}

function text(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	if (typeof error === "string") return error;
	if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
	return String(error ?? "");
}

function rawDetail(error: unknown): string | undefined {
	const value = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 400) : undefined;
}

const BASE: Omit<LiveFailure, "kind" | "title" | "message"> = {
	retry: false,
	switchModel: false,
	settings: null,
	dictation: false,
	videoOnly: false,
};

/**
 * Classify a failure that stopped (or degraded) a live session.
 *
 * `model` is used to name the model in the message: "gemini-3.1-flash-live-preview
 * isn't available on this key" is diagnosable, "404" is not.
 */
export function classifyLiveFailure(
	error: unknown,
	context: { providerId: string; model: string },
): LiveFailure {
	const haystack = text(error).toLowerCase();
	const detail = rawDetail(error);
	const modelLabel = describeLiveModel(context.providerId, context.model).label;
	const providerLabel = context.providerId === "openai-realtime" ? "OpenAI" : "Google";

	if (/no (openai|google|anthropic)? ?api key|missing_api_key|no api key configured/.test(haystack)) {
		return {
			...BASE,
			kind: "missing-key",
			title: `${providerLabel} key needed`,
			message: `Live mode talks to ${providerLabel} directly from this browser, and there is no key for it yet.`,
			hint: "Add one under Providers & Models, then start the conversation again.",
			settings: "providers",
			dictation: true,
			detail,
		};
	}

	// 404 on the mint/connect call almost always means the model id is not
	// enabled for this account, not that the endpoint moved.
	if (/\b404\b|not found|does not exist|unknown model|unsupported model|model_not_found/.test(haystack)) {
		return {
			...BASE,
			kind: "model-unavailable",
			title: `${modelLabel} is not available on this key`,
			message: `${providerLabel} refused the session because this account cannot reach that model. Realtime previews are rolled out per-account, so another live model will usually connect straight away.`,
			hint: "Try the next model, or pick a different one in Speech settings.",
			retry: true,
			switchModel: true,
			settings: "speech",
			dictation: true,
			detail,
		};
	}

	if (/\b401\b|\b403\b|unauthorized|invalid api key|permission denied|api_key_invalid|forbidden/.test(haystack)) {
		return {
			...BASE,
			kind: "auth",
			title: `${providerLabel} rejected the key`,
			message: `The stored key is expired, revoked, or lacks realtime access.`,
			hint: "Replace it under Providers & Models and try again.",
			retry: true,
			settings: "providers",
			dictation: true,
			detail,
		};
	}

	if (/\b429\b|rate limit|quota|resource_exhausted|insufficient_quota|billing/.test(haystack)) {
		return {
			...BASE,
			kind: "rate-limit",
			title: "Out of realtime quota",
			message: `${providerLabel} is throttling this key, or the realtime allowance is spent.`,
			hint: "Wait a moment and retry, or switch to a smaller live model.",
			retry: true,
			switchModel: true,
			dictation: true,
			detail,
		};
	}

	if (/microphone unavailable|microphone_unavailable/.test(haystack)) {
		return {
			...BASE,
			kind: "microphone-unavailable",
			title: "No microphone",
			message: "Keating could not open a microphone, so there is nothing to listen to.",
			hint: "Check that a mic is connected and that this site is allowed to use it.",
			retry: true,
			dictation: true,
			detail,
		};
	}

	if (/notallowederror|permission dismissed|permission denied by user/.test(haystack)) {
		return {
			...BASE,
			kind: "microphone-denied",
			title: "Microphone blocked",
			message: "The browser is blocking microphone access for this site.",
			hint: "Allow the microphone from the padlock in the address bar, then start again.",
			retry: true,
			dictation: true,
			detail,
		};
	}

	if (/cannot satisfy duplex|does not support live voice|cannot hold a live session|capability_mismatch/.test(haystack)) {
		return {
			...BASE,
			kind: "unsupported-provider",
			title: "This model cannot hold a live conversation",
			message: `${modelLabel} has no realtime voice lane, so there is nothing to connect to.`,
			hint: "Choose a live model in Speech settings.",
			switchModel: true,
			settings: "speech",
			dictation: true,
			detail,
		};
	}

	if (/websocket|webrtc|network|failed to fetch|econn|timed out|timeout|disconnected|socket/.test(haystack)) {
		return {
			...BASE,
			kind: "network",
			title: "Connection lost",
			message: `The live connection to ${providerLabel} dropped.`,
			hint: "Reconnect when your network settles.",
			retry: true,
			dictation: true,
			detail,
		};
	}

	return {
		...BASE,
		kind: "unknown",
		title: "The live session stopped",
		message: detail ?? "Keating could not keep the conversation open.",
		retry: true,
		switchModel: true,
		dictation: true,
		detail,
	};
}

/**
 * Classify a camera or screen-capture failure.
 *
 * These are always non-fatal: vision is an accessory to the conversation, so
 * every result is `videoOnly` and the session carries on with audio.
 */
export function classifyCaptureFailure(error: unknown, source: VideoSource): LiveFailure {
	const name = error instanceof Error ? error.name : "";
	const haystack = text(error).toLowerCase();
	const detail = rawDetail(error);
	const isScreen = source === "screen";
	const noun = isScreen ? "Screen sharing" : "The camera";

	if (name === "NotAllowedError" || /notallowederror|permission denied|dismissed/.test(haystack)) {
		return {
			...BASE,
			kind: isScreen ? "screen-denied" : "camera-denied",
			title: isScreen ? "Screen sharing was declined" : "Camera blocked",
			message: isScreen
				? "Nothing was shared, so Keating is listening only."
				: "The browser is blocking camera access for this site, so Keating is listening only.",
			hint: isScreen
				? "Press the screen button again and pick a window to share."
				: "Allow the camera from the padlock in the address bar, then turn it on again.",
			retry: true,
			videoOnly: true,
			detail,
		};
	}

	if (name === "NotFoundError" || /notfounderror|no camera|requested device not found/.test(haystack)) {
		return {
			...BASE,
			kind: "camera-unavailable",
			title: "No camera found",
			message: `${noun} could not be opened because this device has no available video input.`,
			videoOnly: true,
			detail,
		};
	}

	if (name === "NotReadableError" || name === "AbortError" || /notreadableerror|could not start video source|in use/.test(haystack)) {
		return {
			...BASE,
			kind: "camera-in-use",
			title: "Camera is busy",
			message: "Another app is holding the camera, so Keating could not open it.",
			hint: "Close the other app — a video call is the usual culprit — and try again.",
			retry: true,
			videoOnly: true,
			detail,
		};
	}

	if (/not supported|unavailable in this environment/.test(haystack)) {
		return {
			...BASE,
			kind: "camera-unavailable",
			title: `${noun} is not supported here`,
			message: isScreen
				? "This browser has no screen-sharing API. Screen sharing needs a desktop browser."
				: "This browser cannot open a camera from a page.",
			videoOnly: true,
			detail,
		};
	}

	return {
		...BASE,
		kind: isScreen ? "screen-denied" : "camera-unavailable",
		title: `${noun} could not start`,
		message: detail ?? "Keating is continuing with audio only.",
		retry: true,
		videoOnly: true,
		detail,
	};
}

/** A model this model cannot see; used to explain a disabled camera button. */
export function visionUnsupportedFailure(providerId: string, model: string): LiveFailure {
	const label = describeLiveModel(providerId, model).label;
	return {
		...BASE,
		kind: "vision-unsupported",
		title: "This model cannot see",
		message: `${label} accepts voice only, so the camera and screen buttons are switched off.`,
		hint: "Switch to a live model with vision to show Keating your work.",
		switchModel: true,
		settings: "speech",
		videoOnly: true,
	};
}
