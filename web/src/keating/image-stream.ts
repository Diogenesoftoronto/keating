// Streaming image generation.
//
// The OpenAI images endpoint streams progressive renders when asked for them:
// `stream: true` plus `partial_images: n` turns the response into SSE carrying
// `image_generation.partial_image` events (each with a full base64 PNG of the
// image so far) followed by `image_generation.completed`.
//
// Servers that ignore `stream` answer with plain JSON instead, so the reader
// below accepts either shape and the caller gets the same result either way.

export interface ImageStreamEvent {
	type: string;
	b64_json?: string;
	partial_image_index?: number;
	error?: { message?: string };
}

export const PARTIAL_IMAGE_EVENT = "image_generation.partial_image";
export const COMPLETED_IMAGE_EVENT = "image_generation.completed";

/**
 * Incremental SSE parser. Feed it chunks in arrival order; it returns the
 * events completed by that chunk and buffers the rest. Only `data:` payloads
 * are decoded — the `event:` line duplicates the payload's own `type` field.
 */
export function createSseParser(): (chunk: string) => ImageStreamEvent[] {
	let buffer = "";
	return (chunk: string): ImageStreamEvent[] => {
		buffer += chunk;
		const events: ImageStreamEvent[] = [];
		// Records are separated by a blank line; \r\n is legal in SSE.
		const records = buffer.split(/\r?\n\r?\n/);
		buffer = records.pop() ?? "";
		for (const record of records) {
			for (const line of record.split(/\r?\n/)) {
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (!payload || payload === "[DONE]") continue;
				try {
					const parsed = JSON.parse(payload) as ImageStreamEvent;
					if (parsed && typeof parsed.type === "string") events.push(parsed);
				} catch {
					// A partial JSON payload means the record was split across chunks
					// in a way the blank-line split missed; drop it rather than throw.
				}
			}
		}
		return events;
	};
}

export function isEventStream(contentType: string | null | undefined): boolean {
	return (contentType ?? "").toLowerCase().includes("text/event-stream");
}

export function pngDataUrl(b64: string): string {
	return `data:image/png;base64,${b64}`;
}

export interface ImageStreamResult {
	b64: string;
	/** How many partial renders arrived before the final image. */
	partialCount: number;
}

/**
 * Read an SSE image stream to completion, invoking `onPartial` for each
 * progressive render. Resolves with the final image.
 */
export async function readImageStream(
	stream: ReadableStream<Uint8Array>,
	onPartial?: (dataUrl: string, index: number) => void,
): Promise<ImageStreamResult> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const parse = createSseParser();
	let latest = "";
	let final = "";
	let partialCount = 0;

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const event of parse(decoder.decode(value, { stream: true }))) {
				if (event.error?.message) throw new Error(event.error.message);
				if (typeof event.b64_json !== "string" || !event.b64_json) continue;
				if (event.type === PARTIAL_IMAGE_EVENT) {
					latest = event.b64_json;
					onPartial?.(pngDataUrl(event.b64_json), event.partial_image_index ?? partialCount);
					partialCount++;
				} else if (event.type === COMPLETED_IMAGE_EVENT) {
					final = event.b64_json;
				}
			}
		}
	} finally {
		reader.releaseLock();
	}

	// Some servers close after the last partial without a completed event; the
	// most recent partial is the finished image in that case.
	const b64 = final || latest;
	if (!b64) throw new Error("Image stream ended without image data.");
	return { b64, partialCount };
}

// --- progress channel -------------------------------------------------------
// The tool runs outside React, so partial renders reach the UI as window
// events. The in-flight tool card subscribes and shows the newest frame.

export const IMAGE_PROGRESS_EVENT = "keating:image-progress";

export interface ImageProgressDetail {
	/** Identifies one generation so concurrent calls don't overwrite each other. */
	requestId: string;
	title: string;
	/** Newest partial render, or undefined once the generation settles. */
	dataUrl?: string;
	index?: number;
	status: "started" | "partial" | "done" | "error";
}

export function emitImageProgress(detail: ImageProgressDetail): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent<ImageProgressDetail>(IMAGE_PROGRESS_EVENT, { detail }));
}

export function createImageRequestId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
