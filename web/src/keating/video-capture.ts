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

export interface VideoCaptureOptions {
	source?: VideoSource;
	/** Milliseconds between sampled frames. Floored to MIN_FRAME_INTERVAL_MS. */
	intervalMs?: number;
	/** Longest edge of the encoded frame, in pixels. */
	maxEdge?: number;
	jpegQuality?: number;
	/** Set to 0 to emit every frame regardless of similarity. */
	similarityThreshold?: number;
}

export interface NormalizedCaptureOptions {
	source: VideoSource;
	intervalMs: number;
	maxEdge: number;
	jpegQuality: number;
	similarityThreshold: number;
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
	/** Frames emitted so far, including on-demand captures. */
	readonly frameCount: number;
	/** Subscribe to the sampled frame feed. Returns an unsubscribe function. */
	onFrame(listener: FrameListener): () => void;
	/** Grab a frame immediately, bypassing the interval and similarity skip. */
	captureFrameNow(): Promise<CapturedFrame | null>;
	stop(): void;
}

export function normalizeCaptureOptions(options: VideoCaptureOptions = {}): NormalizedCaptureOptions {
	return {
		source: options.source === "screen" ? "screen" : "camera",
		intervalMs: Math.max(MIN_FRAME_INTERVAL_MS, Math.floor(options.intervalMs ?? MIN_FRAME_INTERVAL_MS)),
		maxEdge: Math.max(64, Math.floor(options.maxEdge ?? DEFAULT_MAX_EDGE)),
		jpegQuality: Math.min(1, Math.max(0.1, options.jpegQuality ?? DEFAULT_JPEG_QUALITY)),
		similarityThreshold: Math.max(0, options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD),
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
 * True when a frame should not be sent: the document is hidden, or the frame is
 * indistinguishable from the last one we sent. Extracted so the policy is
 * testable without a camera.
 */
export function shouldSkipFrame(input: {
	documentHidden: boolean;
	previousHistogram: ArrayLike<number> | null;
	nextHistogram: ArrayLike<number>;
	similarityThreshold: number;
}): boolean {
	if (input.documentHidden) return true;
	return framesAreSimilar(input.previousHistogram, input.nextHistogram, input.similarityThreshold);
}

async function requestStream(source: VideoSource): Promise<MediaStream> {
	if (typeof navigator === "undefined" || !navigator.mediaDevices) {
		throw new Error("Video capture is unavailable in this environment.");
	}
	if (source === "screen") {
		if (!navigator.mediaDevices.getDisplayMedia) {
			throw new Error("Screen sharing is not supported by this browser.");
		}
		return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
	}
	if (!navigator.mediaDevices.getUserMedia) {
		throw new Error("Camera capture is not supported by this browser.");
	}
	return await navigator.mediaDevices.getUserMedia({
		video: { width: { ideal: 1280 }, height: { ideal: 720 } },
		audio: false,
	});
}

/**
 * Begin sampling frames from the camera or screen. The returned handle is inert
 * until something subscribes via onFrame; the timer runs regardless so that
 * captureFrameNow always has a warm video element.
 */
export async function startVideoCapture(options: VideoCaptureOptions = {}): Promise<VideoCaptureHandle> {
	const config = normalizeCaptureOptions(options);
	const stream = await requestStream(config.source);

	const video = document.createElement("video");
	video.autoplay = true;
	video.muted = true;
	video.playsInline = true;
	video.srcObject = stream;

	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d", { willReadFrequently: true });

	const listeners = new Set<FrameListener>();
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
	};

	// A screen share ends when the user clicks the browser's "stop sharing"
	// chrome, which surfaces only as a track ending.
	stream.getVideoTracks().forEach((track) => track.addEventListener("ended", stop, { once: true }));

	return {
		stream,
		source: config.source,
		get frameCount() {
			return frameCount;
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
