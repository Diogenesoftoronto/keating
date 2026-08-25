export interface MediaPoint {
	x: number;
	y: number;
}

export interface MediaRect extends MediaPoint {
	width: number;
	height: number;
}

export interface MediaSize {
	width: number;
	height: number;
}

function isPositiveFinite(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

/** Returns the rendered content box for an object-fit: contain replaced element. */
export function containedMediaRect(frame: MediaRect, intrinsic: MediaSize): MediaRect | null {
	if (
		!Number.isFinite(frame.x)
		|| !Number.isFinite(frame.y)
		|| !isPositiveFinite(frame.width)
		|| !isPositiveFinite(frame.height)
		|| !isPositiveFinite(intrinsic.width)
		|| !isPositiveFinite(intrinsic.height)
	) return null;

	const scale = Math.min(frame.width / intrinsic.width, frame.height / intrinsic.height);
	const width = intrinsic.width * scale;
	const height = intrinsic.height * scale;
	return {
		x: frame.x + (frame.width - width) / 2,
		y: frame.y + (frame.height - height) / 2,
		width,
		height,
	};
}

/**
 * Maps a pointer into normalized intrinsic coordinates. Starts in letterboxing
 * can be rejected; an active drag can instead clamp to the nearest image edge.
 */
export function normalizedContainedMediaPoint(
	point: MediaPoint,
	frame: MediaRect,
	intrinsic: MediaSize,
	clampOutside = false,
): MediaPoint | null {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
	const content = containedMediaRect(frame, intrinsic);
	if (!content) return null;
	const right = content.x + content.width;
	const bottom = content.y + content.height;
	if (!clampOutside && (
		point.x < content.x
		|| point.x > right
		|| point.y < content.y
		|| point.y > bottom
	)) return null;

	return {
		x: clamp((point.x - content.x) / content.width, 0, 1),
		y: clamp((point.y - content.y) / content.height, 0, 1),
	};
}
