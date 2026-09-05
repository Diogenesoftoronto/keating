import type { LiveImageInput, LiveImageMimeType } from "./speech";
import { computeCaptureSize, DEFAULT_MAX_EDGE } from "./video-capture";

export const LIVE_IMAGE_ACCEPT = "image/jpeg,image/png";
export const MAX_LIVE_IMAGE_BYTES = 20 * 1024 * 1024;
const LIVE_IMAGE_JPEG_QUALITY = 0.78;

export interface PreparedLiveImage {
	image: LiveImageInput;
	/** The exact bounded image sent to the provider, suitable for local preview. */
	previewUrl: string;
}

export function validateLiveImageFile(file: Pick<File, "name" | "size" | "type">): string | null {
	if (file.size <= 0) return `${file.name || "The selected image"} is empty.`;
	if (file.size > MAX_LIVE_IMAGE_BYTES) return "Choose an image smaller than 20 MB.";
	if (file.type !== "image/jpeg" && file.type !== "image/png") {
		return "Choose a JPEG or PNG image.";
	}
	return null;
}

function dataUrlParts(dataUrl: string): { data: string; mimeType: LiveImageMimeType } {
	const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
	if (!match) throw new Error("The browser could not encode this image.");
	return { mimeType: match[1] as LiveImageMimeType, data: match[2] };
}

/**
 * Decode, bound, and JPEG-encode one learner-selected image before it crosses
 * the WebRTC data channel. Raw phone photos are too large to send safely.
 */
export async function prepareLiveImage(file: File): Promise<PreparedLiveImage> {
	const validationError = validateLiveImageFile(file);
	if (validationError) throw new Error(validationError);
	if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
		throw new Error("Still-image sharing is not supported in this browser.");
	}

	const bitmap = await createImageBitmap(file);
	try {
		const size = computeCaptureSize(bitmap.width, bitmap.height, DEFAULT_MAX_EDGE);
		if (size.width === 0 || size.height === 0) throw new Error("The selected image has no visible pixels.");

		const canvas = document.createElement("canvas");
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("The browser could not prepare this image.");
		context.drawImage(bitmap, 0, 0, size.width, size.height);

		const previewUrl = canvas.toDataURL("image/jpeg", LIVE_IMAGE_JPEG_QUALITY);
		const encoded = dataUrlParts(previewUrl);
		return {
			image: { ...encoded, filename: file.name },
			previewUrl,
		};
	} finally {
		bitmap.close();
	}
}
