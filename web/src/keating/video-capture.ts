/**
 * Provider-agnostic frame capture for live sessions.
 *
 * Both realtime providers Keating targets consume sampled JPEG frames rather
 * than a continuous video track — Gemini Live has a dedicated video lane capped
 * at 1 fps, and GPT Realtime accepts still images as conversation items. So
 * there is one capture pipeline here and the providers supply their own sink.
 *
 * Nothing in this module may import provider types.
 */

/** Both providers cap video at one frame per second. */
export const MIN_FRAME_INTERVAL_MS = 1000;
export const DEFAULT_MAX_EDGE = 768;
export const DEFAULT_JPEG_QUALITY = 0.6;
/**
 * Histogram distance below which a frame is considered a repeat of the previous
 * one and skipped. Tuned to drop a static desk/screen while still catching a
 * page scroll or a hand entering frame.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.02;

const HISTOGRAM_BINS = 32;

export type VideoSource = "camera" | "screen";

/** Which camera to open. "user" is the selfie camera, "environment" the rear one. */
export type CameraFacing = "user" | "environment";

export interface VideoCaptureOptions {
	source?: VideoSource;
	/** Milliseconds between sampled frames. Floored to MIN_FRAME_INTERVAL_MS. */
	intervalMs?: number;
	/** Longest edge of the encoded frame, in pixels. */
	maxEdge?: number;
	jpegQuality?: number;
	/** Set to 0 to emit every frame regardless of similarity. */
	similarityThreshold?: number;
	/** Camera side to prefer. Ignored for screen capture. */
	facing?: CameraFacing;
	/** Exact camera to open, when the learner has picked one. */
	deviceId?: string;
}

export interface NormalizedCaptureOptions {
	source: VideoSource;
	intervalMs: number;
	maxEdge: number;
	jpegQuality: number;
	similarityThreshold: number;
	facing: CameraFacing;
	deviceId?: string;
}

export interface CapturedFrame {
	/** Base64 JPEG payload, no data-URL prefix. */
	data: string;
	/** Full data URL, which is what the OpenAI image content part wants. */
	dataUrl: string;
	mimeType: "image/jpeg";
	width: number;
	height: number;
	capturedAt: number;
}

export type FrameListener = (frame: CapturedFrame) => void;

export interface VideoCaptureHandle {
	/** Live stream, for rendering a local preview. */
	readonly stream: MediaStream;
	readonly source: VideoSource;
	/** Which camera this handle opened, for the flip control. */
	readonly facing: CameraFacing;
	/** Frames emitted so far, including on-demand captures. */
	readonly frameCount: number;
	/** Subscribe to the sampled frame feed. Returns an unsubscribe function. */
	onFrame(listener: FrameListener): () => void;
	/** Grab a frame immediately, bypassing the interval and similarity skip. */
	captureFrameNow(): Promise<CapturedFrame | null>;
	/**
	 * Fires when capture ends on its own — the learner pressed the browser's
	 * "stop sharing" chrome, or the device was unplugged. Without it the UI keeps
	 * showing a preview of a stream that is already dead.
	 */
	onEnded(listener: () => void): () => void;
	readonly stopped: boolean;
	stop(): void;
}

export function normalizeCaptureOptions(options: VideoCaptureOptions = {}): NormalizedCaptureOptions {
	return {
		source: options.source === "screen" ? "screen" : "camera",
		intervalMs: Math.max(MIN_FRAME_INTERVAL_MS, Math.floor(options.intervalMs ?? MIN_FRAME_INTERVAL_MS)),
		maxEdge: Math.max(64, Math.floor(options.maxEdge ?? DEFAULT_MAX_EDGE)),
		jpegQuality: Math.min(1, Math.max(0.1, options.jpegQuality ?? DEFAULT_JPEG_QUALITY)),
		similarityThreshold: Math.max(0, options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD),
		facing: options.facing === "environment" ? "environment" : "user",
		deviceId: typeof options.deviceId === "string" && options.deviceId ? options.deviceId : undefined,
	};
}

/**
 * Scale a frame so its longest edge is at most maxEdge, preserving aspect
 * ratio. Frames already within budget are left alone — upscaling would only
 * cost tokens without adding detail.
 */
export function computeCaptureSize(
	width: number,
	height: number,
	maxEdge: number,
): { width: number; height: number } {
	if (width <= 0 || height <= 0) return { width: 0, height: 0 };
	const longest = Math.max(width, height);
	if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
	const scale = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/**
 * Normalized luma histogram over RGBA pixel data. Cheap enough to run on every
 * candidate frame and stable against sensor noise, which a per-pixel diff is
 * not.
 */
export function lumaHistogram(pixels: ArrayLike<number>, bins = HISTOGRAM_BINS): Float64Array {
	const histogram = new Float64Array(bins);
	const pixelCount = Math.floor(pixels.length / 4);
	if (pixelCount === 0) return histogram;
	for (let i = 0; i < pixelCount; i += 1) {
		const offset = i * 4;
		// Rec. 601 luma; the exact weights matter less than being consistent.
		const luma = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
		const bin = Math.min(bins - 1, Math.floor((luma / 256) * bins));
		histogram[bin] += 1;
	}
	for (let i = 0; i < bins; i += 1) histogram[i] /= pixelCount;
	return histogram;
}

/** Total variation distance between two normalized histograms, in [0, 1]. */
export function histogramDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
	if (a.length !== b.length) return 1;
	let sum = 0;
	for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
	return sum / 2;
}

export function framesAreSimilar(
	previous: ArrayLike<number> | null,
	next: ArrayLike<number>,
	threshold: number,
): boolean {
	if (previous === null || threshold <= 0) return false;
	return histogramDistance(previous, next) < threshold;
}

/**
 * True when a frame should not be sent: nobody is looking at the tab, or the
 * frame is indistinguishable from the last one we sent. Extracted so the policy
 * is testable without a camera.
 *
 * A hidden document stops camera frames — the learner has walked away from the
 * page and the camera is pointed at nothing they care about. Screen sharing is
 * the opposite: the whole point is to show another window, which necessarily
 * makes this tab hidden. Dropping those frames was why "show Keating my screen"
 * appeared to do nothing at all.
 */
export function shouldSkipFrame(input: {
	documentHidden: boolean;
	previousHistogram: ArrayLike<number> | null;
	nextHistogram: ArrayLike<number>;
	similarityThreshold: number;
	source?: VideoSource;
}): boolean {
	if (input.documentHidden && input.source !== "screen") return true;
	return framesAreSimilar(input.previousHistogram, input.nextHistogram, input.similarityThreshold);
}

/**
 * Cameras this device exposes, for the picker.
 *
 * Labels are empty until the page has held a camera permission at least once,
 * which is why the picker only appears once video is already running.
 */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
	try {
		const devices = await navigator.mediaDevices.enumerateDevices();
		return devices.filter((device) => device.kind === "videoinput");
	} catch {
		return [];
	}
}

async function requestStream(config: NormalizedCaptureOptions): Promise<MediaStream> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices) {
		throw new Error("Video capture is unavailable in this environment.");
	}
	if (config.source === "screen") {
		if (!navigator.mediaDevices.getDisplayMedia) {
			throw new Error("Screen sharing is not supported by this browser.");
		}
		return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
	}
	if (!navigator.mediaDevices.getUserMedia) {
		throw new Error("Camera capture is not supported by this browser.");
	}

	const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
	if (config.deviceId) {
		try {
			return await navigator.mediaDevices.getUserMedia({
				video: { ...size, deviceId: { exact: config.deviceId } },
				audio: false,
			});
		} catch (error) {
			// A remembered camera can disappear between sessions (unplugged, or a
			// phone that renumbers its devices). Falling back to any camera beats
			// telling the learner their camera is broken.
			if (!(error instanceof Error) || error.name !== "OverconstrainedError") throw error;
		}
	}

	try {
		// `ideal` rather than `exact`: a desktop with one webcam has no
		// "environment" camera, and an exact facingMode would fail outright
		// instead of returning the only camera there is.
		return await navigator.mediaDevices.getUserMedia({
			video: { ...size, facingMode: { ideal: config.facing } },
			audio: false,
		});
	} catch (error) {
		if (error instanceof Error && error.name === "OverconstrainedError") {
			return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
		}
		throw error;
	}
}

/**
 * Begin sampling frames from the camera or screen. The returned handle is inert
 * until something subscribes via onFrame; the timer runs regardless so that
 * captureFrameNow always has a warm video element.
 */
export async function startVideoCapture(options: VideoCaptureOptions = {}): Promise<VideoCaptureHandle> {
	const config = normalizeCaptureOptions(options);
	const stream = await requestStream(config);

	const video = document.createElement("video");
	video.autoplay = true;
	video.muted = true;
	video.playsInline = true;
	video.srcObject = stream;

	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d", { willReadFrequently: true });

	const listeners = new Set<FrameListener>();
	const endListeners = new Set<() => void>();
	let previousHistogram: Float64Array | null = null;
	let frameCount = 0;
	let stopped = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	await video.play().catch(() => {
		// Autoplay of a muted local stream is permitted; a rejection here means
		// the track ended before playback started, which stop() will clean up.
	});

	const grab = (options: { force: boolean }): CapturedFrame | null => {
		if (stopped || !context) return null;
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (width === 0 || height === 0) return null;

		const size = computeCaptureSize(width, height, config.maxEdge);
		canvas.width = size.width;
		canvas.height = size.height;
		context.drawImage(video, 0, 0, size.width, size.height);

		const histogram = lumaHistogram(context.getImageData(0, 0, size.width, size.height).data);
		if (!options.force) {
			const skip = shouldSkipFrame({
				documentHidden: typeof document !== "undefined" && document.hidden,
				previousHistogram,
				nextHistogram: histogram,
				similarityThreshold: config.similarityThreshold,
				source: config.source,
			});
			if (skip) return null;
		}
		previousHistogram = histogram;

		const dataUrl = canvas.toDataURL("image/jpeg", config.jpegQuality);
		frameCount += 1;
		return {
			data: dataUrl.slice(dataUrl.indexOf(",") + 1),
			dataUrl,
			mimeType: "image/jpeg",
			width: size.width,
			height: size.height,
			capturedAt: Date.now(),
		};
	};

	const emit = (frame: CapturedFrame | null) => {
		if (!frame) return;
		for (const listener of listeners) {
			try {
				listener(frame);
			} catch (error) {
				console.warn("[keating:video] frame listener failed", error);
			}
		}
	};

	timer = setInterval(() => {
		if (listeners.size === 0) return;
		emit(grab({ force: false }));
	}, config.intervalMs);

	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (timer !== null) clearInterval(timer);
		timer = null;
		listeners.clear();
		stream.getTracks().forEach((track) => track.stop());
		video.srcObject = null;
		try {
			video.remove();
		} catch {}
		for (const listener of endListeners) {
			try {
				listener();
			} catch (error) {
				console.warn("[keating:video] end listener failed", error);
			}
		}
		endListeners.clear();
	};

	// A screen share ends when the user clicks the browser's "stop sharing"
	// chrome, which surfaces only as a track ending.
	stream.getVideoTracks().forEach((track) => track.addEventListener("ended", stop, { once: true }));

	return {
		stream,
		source: config.source,
		facing: config.facing,
		get stopped() {
			return stopped;
		},
		get frameCount() {
			return frameCount;
		},
		onEnded(listener) {
			if (stopped) {
				listener();
				return () => {};
			}
			endListeners.add(listener);
			return () => endListeners.delete(listener);
		},
		onFrame(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async captureFrameNow() {
			const frame = grab({ force: true });
			emit(frame);
			return frame;
		},
		stop,
	};
}
