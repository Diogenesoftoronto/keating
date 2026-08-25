import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { KeatingStorage, KeatingStoragePortableData, LessonPlan } from "./storage";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	artifactVersionKey,
	messageReviewAnchor,
	reviewMessageText,
	sha256ContentHash,
	type ArtifactReviewKind,
	type ArtifactSourceReference,
	type ArtifactVersionReference,
	type ReviewArtifactSnapshot,
} from "./trajectory-review";

type ArtifactSeed = {
	store?: string;
	source?: ArtifactSourceReference;
	id: string;
	kind: ArtifactReviewKind;
	format: string;
	label: string;
	topic?: string;
	content: string;
	secondaryContent?: string;
	createdAt: number;
	updatedAt?: number;
	metadata?: Record<string, unknown>;
	media?: Omit<NonNullable<ReviewArtifactSnapshot["media"]>, "assetHash">;
};

const GENERATED_IMAGE_TAG_PREFIX = "<keating-image json=";
const LOCAL_RASTER_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const SHA256_HASH = /^sha256:[0-9a-f]{64}$/;
const ARTIFACT_HASH_FRAME = "keating-review-artifact-content-v1";
const IMAGE_HASH_FRAME = "keating-review-raster-v1";

export const TRAJECTORY_IMAGE_CAPTURE_LIMITS = Object.freeze({
	maxImages: 16,
	maxRawTagCharacters: 18 * 1024 * 1024,
	maxRawSessionCharacters: 64 * 1024 * 1024,
	maxDecodedBytesPerImage: 12 * 1024 * 1024,
	maxDecodedBytesPerSession: 48 * 1024 * 1024,
	maxDimension: 32_768,
	maxPixels: 40_000_000,
});

type LocalRaster = {
	dataUrl: string;
	mimeType: string;
	width: number;
	height: number;
};

type ImageCaptureBudget = {
	candidates: number;
	rawCharacters: number;
	decodedBytes: number;
};

type CanonicalImageTag = {
	encodedPayload?: string;
	occurrence: number;
	rawLength: number;
	start: number;
};

type GeneratedImagePayload = {
	title: string;
	alt: string;
	dataUrl: string;
	mimeType: string;
	model: string;
	prompt: string;
};

function imageCaptureBudget(): ImageCaptureBudget {
	return { candidates: 0, rawCharacters: 0, decodedBytes: 0 };
}

function reserveRawImageCandidate(budget: ImageCaptureBudget, rawLength: number, maximumRawLength: number): boolean {
	if (budget.candidates >= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxImages) return false;
	budget.candidates += 1;
	if (!Number.isSafeInteger(rawLength) || rawLength <= 0) return false;
	if (budget.rawCharacters + rawLength > TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxRawSessionCharacters) {
		budget.rawCharacters = TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxRawSessionCharacters;
		return false;
	}
	budget.rawCharacters += rawLength;
	return rawLength <= maximumRawLength;
}

function reserveDecodedImageBytes(budget: ImageCaptureBudget, decodedBytes: number): boolean {
	if (
		!Number.isSafeInteger(decodedBytes) ||
		decodedBytes <= 0 ||
		decodedBytes > TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDecodedBytesPerImage
	)
		return false;
	if (budget.decodedBytes + decodedBytes > TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDecodedBytesPerSession) {
		budget.decodedBytes = TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDecodedBytesPerSession;
		return false;
	}
	budget.decodedBytes += decodedBytes;
	return true;
}

function imageCaptureBudgetExhausted(budget: ImageCaptureBudget): boolean {
	return (
		budget.candidates >= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxImages ||
		budget.rawCharacters >= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxRawSessionCharacters ||
		budget.decodedBytes >= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDecodedBytesPerSession
	);
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint32BigEndian(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
	return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let value = "";
	for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
	return value;
}

function dimensionsWithinLimits(width: number, height: number): boolean {
	return (
		Number.isSafeInteger(width) &&
		Number.isSafeInteger(height) &&
		width > 0 &&
		height > 0 &&
		width <= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDimension &&
		height <= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDimension &&
		width <= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxPixels / height
	);
}

function rasterDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
	if (
		mimeType === "image/png" &&
		bytes.length >= 33 &&
		bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
		uint32BigEndian(bytes, 8) === 13 &&
		ascii(bytes, 12, 4) === "IHDR" &&
		bytes[26] === 0 &&
		bytes[27] === 0 &&
		(bytes[28] === 0 || bytes[28] === 1)
	) {
		const width = uint32BigEndian(bytes, 16);
		const height = uint32BigEndian(bytes, 20);
		return dimensionsWithinLimits(width, height) ? { width, height } : null;
	}
	if (
		mimeType === "image/gif" &&
		bytes.length >= 13 &&
		(ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")
	) {
		const width = bytes[6] | (bytes[7] << 8);
		const height = bytes[8] | (bytes[9] << 8);
		return dimensionsWithinLimits(width, height) ? { width, height } : null;
	}
	if (mimeType === "image/jpeg" && bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
		while (offset + 4 <= bytes.length) {
			if (bytes[offset] !== 0xff) return null;
			while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
			if (offset >= bytes.length) return null;
			const marker = bytes[offset];
			offset += 1;
			if (marker === 0xd9) break;
			if (marker === 0xda || offset + 1 >= bytes.length) break;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
			const length = uint16BigEndian(bytes, offset);
			if (length < 2 || offset + length > bytes.length) break;
			if (startOfFrame.has(marker) && length >= 7) {
				const height = uint16BigEndian(bytes, offset + 3);
				const width = uint16BigEndian(bytes, offset + 5);
				return dimensionsWithinLimits(width, height) ? { width, height } : null;
			}
			offset += length;
		}
	}
	if (
		mimeType === "image/webp" &&
		bytes.length >= 30 &&
		ascii(bytes, 0, 4) === "RIFF" &&
		uint32LittleEndian(bytes, 4) + 8 === bytes.length &&
		ascii(bytes, 8, 4) === "WEBP"
	) {
		const chunk = ascii(bytes, 12, 4);
		const chunkSize = uint32LittleEndian(bytes, 16);
		if (chunk === "VP8X" && chunkSize >= 10) {
			const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
			const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
			return dimensionsWithinLimits(width, height) ? { width, height } : null;
		}
		if (chunk === "VP8L" && chunkSize >= 5 && bytes[20] === 0x2f) {
			const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
			const height = 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
			return dimensionsWithinLimits(width, height) ? { width, height } : null;
		}
		if (chunk === "VP8 " && chunkSize >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
			const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
			const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
			return dimensionsWithinLimits(width, height) ? { width, height } : null;
		}
	}
	return null;
}

function base64DecodedLength(encoded: string): number | null {
	if (encoded.length === 0 || encoded.length % 4 !== 0) return null;
	const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
	return (encoded.length / 4) * 3 - padding;
}

async function runtimeDecodedDimensions(
	bytes: Uint8Array,
	mimeType: string,
): Promise<{ width: number; height: number } | null | undefined> {
	if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.Blob !== "function") return undefined;
	let bitmap: ImageBitmap | undefined;
	try {
		const ownedBytes = new Uint8Array(bytes.byteLength);
		ownedBytes.set(bytes);
		bitmap = await globalThis.createImageBitmap(new Blob([ownedBytes.buffer], { type: mimeType }));
		return dimensionsWithinLimits(bitmap.width, bitmap.height) ? { width: bitmap.width, height: bitmap.height } : null;
	} catch {
		return null;
	} finally {
		bitmap?.close();
	}
}

async function localRaster(value: string, budget: ImageCaptureBudget): Promise<LocalRaster | null> {
	const match = value.match(LOCAL_RASTER_DATA_URL);
	if (!match) return null;
	const mimeType = match[1];
	const encoded = match[2];
	const decodedLength = base64DecodedLength(encoded);
	if (decodedLength === null || !reserveDecodedImageBytes(budget, decodedLength)) return null;
	try {
		const binary = globalThis.atob(encoded);
		if (binary.length !== decodedLength || globalThis.btoa(binary) !== encoded) return null;
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		const headerDimensions = rasterDimensions(bytes, mimeType);
		if (!headerDimensions) return null;
		const decodedDimensions = await runtimeDecodedDimensions(bytes, mimeType);
		if (decodedDimensions === null) return null;
		const dimensions = decodedDimensions ?? headerDimensions;
		if (dimensions.width !== headerDimensions.width || dimensions.height !== headerDimensions.height) return null;
		return {
			dataUrl: `data:${mimeType};base64,${encoded}`,
			mimeType,
			width: dimensions.width,
			height: dimensions.height,
		};
	} catch {
		return null;
	}
}

function canonicalImageTags(
	value: string,
	maximumTags: number = TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxImages,
): CanonicalImageTag[] {
	const tags: CanonicalImageTag[] = [];
	let cursor = 0;
	let occurrence = 0;
	while (cursor < value.length && tags.length < maximumTags) {
		const start = value.indexOf(GENERATED_IMAGE_TAG_PREFIX, cursor);
		if (start < 0) break;
		const payloadStart = start + GENERATED_IMAGE_TAG_PREFIX.length;
		if (value[payloadStart] !== '"') {
			cursor = payloadStart;
			continue;
		}
		const scanEnd = Math.min(value.length, start + TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxRawTagCharacters + 1);
		let escaped = false;
		let closingQuote = -1;
		for (let index = payloadStart + 1; index < scanEnd; index += 1) {
			const character = value[index];
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') {
				closingQuote = index;
				break;
			}
		}
		if (closingQuote < 0) {
			tags.push({
				occurrence,
				rawLength: TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxRawTagCharacters + 1,
				start,
			});
			occurrence += 1;
			cursor = payloadStart + 1;
			continue;
		}
		const end = closingQuote + 4;
		if (value.slice(closingQuote + 1, end) !== " />") {
			cursor = closingQuote + 1;
			continue;
		}
		const rawLength = end - start;
		tags.push({
			encodedPayload:
				rawLength <= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxRawTagCharacters
					? value.slice(payloadStart, closingQuote + 1)
					: undefined,
			occurrence,
			rawLength,
			start,
		});
		occurrence += 1;
		cursor = end;
	}
	return tags;
}

function decodedImageTagPayload(value: string): GeneratedImagePayload | null {
	try {
		const firstPass = JSON.parse(value) as unknown;
		if (typeof firstPass !== "string") return null;
		const decoded = JSON.parse(firstPass) as unknown;
		if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
		const payload = decoded as Record<string, unknown>;
		const keys = Object.keys(payload);
		if (
			keys.length !== 6 ||
			!["title", "alt", "dataUrl", "mimeType", "model", "prompt"].every((key) => keys.includes(key))
		)
			return null;
		if (
			![payload.title, payload.alt, payload.dataUrl, payload.mimeType, payload.model, payload.prompt].every(
				(field) => typeof field === "string",
			)
		)
			return null;
		return payload as GeneratedImagePayload;
	} catch {
		return null;
	}
}

function decodedDisplayImagePayload(value: string): { title?: string; dataUrl: string } | null {
	try {
		const firstPass = JSON.parse(value) as unknown;
		if (typeof firstPass !== "string") return null;
		const decoded = JSON.parse(firstPass) as unknown;
		if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
		const payload = decoded as Record<string, unknown>;
		if (typeof payload.dataUrl !== "string") return null;
		const match = payload.dataUrl.match(LOCAL_RASTER_DATA_URL);
		const decodedLength = match ? base64DecodedLength(match[2]) : null;
		if (decodedLength === null || decodedLength > TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDecodedBytesPerImage) return null;
		return {
			title: typeof payload.title === "string" ? payload.title : undefined,
			dataUrl: payload.dataUrl,
		};
	} catch {
		return null;
	}
}

function payloadHasBoundedLocalRaster(payload: GeneratedImagePayload): boolean {
	if (payload.mimeType !== payload.mimeType.toLowerCase()) return false;
	const match = payload.dataUrl.match(LOCAL_RASTER_DATA_URL);
	if (!match || match[1] !== payload.mimeType) return false;
	const decodedLength = base64DecodedLength(match[2]);
	return decodedLength !== null && decodedLength <= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDecodedBytesPerImage;
}

export function reviewArtifactDisplayText(value: string): string {
	const tags = canonicalImageTags(value).filter((tag) => {
		return tag.encodedPayload ? decodedDisplayImagePayload(tag.encodedPayload) !== null : false;
	});
	if (tags.length === 0) return value.trim();
	let cursor = 0;
	let output = "";
	for (const tag of tags) {
		if (!tag.encodedPayload) continue;
		const rawLength = tag.rawLength;
		const payload = decodedDisplayImagePayload(tag.encodedPayload);
		if (!payload) continue;
		output += value.slice(cursor, tag.start);
		output += `[Generated image artifact${payload.title?.trim() ? `: ${payload.title.trim()}` : ""}]`;
		cursor = tag.start + rawLength;
	}
	return `${output}${value.slice(cursor)}`.trim();
}

function imageSeed(options: {
	sessionId: string;
	messageId: string;
	id: string;
	label: string;
	alt: string;
	content: string;
	createdAt: number;
	raster: LocalRaster;
	metadata?: Record<string, unknown>;
}): ArtifactSeed {
	return {
		id: options.id,
		source: {
			source: "session",
			sessionId: options.sessionId,
			id: options.id,
			messageId: options.messageId,
		},
		kind: "image",
		format: options.raster.mimeType,
		label: options.label,
		content: options.content,
		createdAt: options.createdAt,
		metadata: options.metadata,
		media: {
			kind: "image",
			dataUrl: options.raster.dataUrl,
			alt: options.alt,
			mimeType: options.raster.mimeType,
			naturalWidth: options.raster.width,
			naturalHeight: options.raster.height,
		},
	};
}

function successfulGenerateImageResult(message: AgentMessage): boolean {
	const entry = message as unknown as {
		role?: unknown;
		toolCallId?: unknown;
		toolName?: unknown;
		isError?: unknown;
		details?: unknown;
	};
	const details =
		entry.details && typeof entry.details === "object" && !Array.isArray(entry.details)
			? (entry.details as Record<string, unknown>)
			: null;
	return (
		entry.role === "toolResult" &&
		typeof entry.toolCallId === "string" &&
		entry.toolCallId.length > 0 &&
		entry.toolName === "generate_image" &&
		entry.isError === false &&
		details?.tool === "generate_image"
	);
}

async function imageSeedsForSession(messages: readonly AgentMessage[], sessionId: string): Promise<ArtifactSeed[]> {
	const seeds: ArtifactSeed[] = [];
	const seenCaptureRecords = new Set<string>();
	const budget = imageCaptureBudget();
	for (let ordinal = 0; ordinal < messages.length; ordinal += 1) {
		if (imageCaptureBudgetExhausted(budget)) break;
		const message = messages[ordinal];
		const anchor = messageReviewAnchor(sessionId, message, ordinal);
		const createdAt = anchor.timestamp ?? 0;
		if (successfulGenerateImageResult(message)) {
			const text = reviewMessageText(message);
			for (const tag of canonicalImageTags(text, TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxImages - budget.candidates)) {
				if (imageCaptureBudgetExhausted(budget)) break;
				if (
					!reserveRawImageCandidate(budget, tag.rawLength, TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxRawTagCharacters) ||
					!tag.encodedPayload
				)
					continue;
				const payload = decodedImageTagPayload(tag.encodedPayload);
				if (!payload || !payloadHasBoundedLocalRaster(payload)) continue;
				const raster = await localRaster(payload.dataUrl, budget);
				if (!raster || raster.mimeType !== payload.mimeType) continue;
				const id = `generated-image:${anchor.id}:${tag.occurrence}`;
				if (seenCaptureRecords.has(id)) continue;
				seenCaptureRecords.add(id);
				const title = payload.title.trim() || `Generated image · turn ${ordinal + 1}`;
				const alt = payload.alt.trim() || title;
				const prompt = payload.prompt.trim();
				seeds.push(
					imageSeed({
						sessionId,
						messageId: anchor.id,
						id,
						label: title,
						alt,
						content: [title, alt, prompt ? `Generation prompt: ${prompt}` : ""].filter(Boolean).join("\n\n"),
						createdAt,
						raster,
						metadata: {
							model: payload.model,
							generationPrompt: prompt || undefined,
						},
					}),
				);
			}
		}

		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (let partIndex = 0; partIndex < content.length; partIndex += 1) {
			if (imageCaptureBudgetExhausted(budget)) break;
			const part = content[partIndex] as {
				type?: unknown;
				mimeType?: unknown;
				data?: unknown;
				filename?: unknown;
			};
			if (part?.type !== "image" || typeof part.mimeType !== "string" || typeof part.data !== "string") continue;
			const rawLength = part.mimeType.length + part.data.length + 13;
			const maximumRawLength = Math.ceil(TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDecodedBytesPerImage / 3) * 4 + 64;
			if (!reserveRawImageCandidate(budget, rawLength, maximumRawLength)) continue;
			const raster = await localRaster(`data:${part.mimeType};base64,${part.data}`, budget);
			if (!raster) continue;
			const id = `message-image:${anchor.id}:${partIndex}`;
			if (seenCaptureRecords.has(id)) continue;
			seenCaptureRecords.add(id);
			const label =
				typeof part.filename === "string" && part.filename.trim()
					? part.filename.trim()
					: `Session image · turn ${ordinal + 1}`;
			seeds.push(
				imageSeed({
					sessionId,
					messageId: anchor.id,
					id,
					label,
					alt: label,
					content: `${label}\n\nFrozen image from the ${anchor.role} turn.`,
					createdAt,
					raster,
					metadata: { messageRole: anchor.role, partIndex },
				}),
			);
		}
	}
	return seeds;
}

function planKind(plan: LessonPlan): ArtifactReviewKind {
	if (plan.metadata?.type === "quiz") return "quiz";
	if (plan.metadata?.type === "openui") return "openui";
	return "plan";
}

function collectSessionSeeds<T extends { sessionId?: string }>(
	target: ArtifactSeed[],
	records: readonly T[],
	sessionId: string,
	toSeed: (record: T) => ArtifactSeed,
): void {
	for (const record of records) {
		if (record.sessionId === sessionId) target.push(toSeed(record));
	}
}

function seedsForSession(data: KeatingStoragePortableData, sessionId: string): ArtifactSeed[] {
	const seeds: ArtifactSeed[] = [];
	collectSessionSeeds(seeds, data.lessonPlans, sessionId, (record) => ({
		store: "lesson-plans",
		id: record.id,
		kind: planKind(record),
		format: "markdown",
		label: `${planKind(record) === "quiz" ? "Quiz" : "Plan"}: ${record.topic}`,
		topic: record.topic,
		content: record.content,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		metadata: record.metadata,
	}));
	collectSessionSeeds(seeds, data.lessonMaps, sessionId, (record) => ({
		store: "lesson-maps",
		id: record.id,
		kind: "map" as const,
		format: "mermaid",
		label: `Map: ${record.topic}`,
		topic: record.topic,
		content: record.mmdContent,
		secondaryContent: record.svgContent,
		createdAt: record.createdAt,
	}));
	collectSessionSeeds(seeds, data.animations, sessionId, (record) => ({
		store: "animations",
		id: record.id,
		kind: "animation" as const,
		format: record.renderer === "hyperframes" ? "hyperframes-html" : "html",
		label: `Animation: ${record.topic}`,
		topic: record.topic,
		content: record.scene,
		secondaryContent: record.storyboard,
		createdAt: record.createdAt,
		metadata: { manifest: record.manifest, renderer: record.renderer },
	}));
	collectSessionSeeds(seeds, data.verifications, sessionId, (record) => ({
		store: "verifications",
		id: record.id,
		kind: "verification" as const,
		format: "markdown",
		label: `Verification: ${record.topic}`,
		topic: record.topic,
		content: record.checklist,
		createdAt: record.createdAt,
		metadata: { completed: record.completed },
	}));
	collectSessionSeeds(seeds, data.benchmarks, sessionId, (record) => ({
		store: "benchmarks",
		id: record.id,
		kind: "benchmark" as const,
		format: "markdown",
		label: `Benchmark: ${record.topic ?? "general"}`,
		topic: record.topic,
		content: record.report,
		secondaryContent: record.trace,
		createdAt: record.createdAt,
		metadata: { score: record.score },
	}));
	collectSessionSeeds(seeds, data.evolutions, sessionId, (record) => ({
		store: "evolutions",
		id: record.id,
		kind: "evolution" as const,
		format: "markdown",
		label: `Evolution: ${record.topic ?? "general"}`,
		topic: record.topic,
		content: record.report,
		secondaryContent: record.policy,
		createdAt: record.createdAt,
		metadata: { bestScore: record.bestScore, trace: record.trace },
	}));
	collectSessionSeeds(seeds, data.promptEvolutions, sessionId, (record) => ({
		store: "prompt-evolutions",
		id: record.id,
		kind: "prompt-evolution" as const,
		format: "markdown",
		label: `Prompt evolution: ${record.promptName}`,
		topic: record.promptName,
		content: record.bestPrompt,
		secondaryContent: record.report,
		createdAt: record.createdAt,
		metadata: { bestScore: record.bestScore },
	}));
	collectSessionSeeds(seeds, data.decks, sessionId, (record) => ({
		store: "decks",
		id: record.id,
		kind: "deck" as const,
		format: "json",
		label: `Deck: ${record.title}`,
		topic: record.topic,
		content: JSON.stringify(record, null, 2),
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		metadata: { cardCount: record.cards.length },
	}));
	return seeds;
}

async function snapshotFromSeed(
	seed: ArtifactSeed,
	reviewId: string,
	sessionId: string,
	capturedAt: number,
): Promise<ReviewArtifactSnapshot> {
	const mediaAssetHash = seed.media ? await imageAssetHash(seed.media) : undefined;
	const contentHash = await artifactContentHash(
		seed.kind,
		seed.format,
		seed.content,
		seed.secondaryContent,
		seed.media?.dataUrl,
	);
	const artifact: ArtifactVersionReference = {
		source: seed.source ?? {
			source: "indexeddb",
			store: seed.store ?? "unknown",
			id: seed.id,
		},
		artifactType: seed.kind,
		format: seed.format,
		versionId: `${seed.id}:${seed.updatedAt ?? seed.createdAt}`,
		contentHash,
		frozen: true,
	};
	return {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id: artifactVersionKey(artifact),
		reviewId,
		sessionId,
		artifact,
		label: seed.label,
		topic: seed.topic,
		content: seed.content,
		secondaryContent: seed.secondaryContent,
		media: seed.media && mediaAssetHash ? { ...seed.media, assetHash: mediaAssetHash } : undefined,
		metadata: seed.metadata,
		createdAt: seed.createdAt,
		capturedAt,
	};
}

export async function captureSessionArtifactVersions(
	storage: Pick<KeatingStorage, "exportPortableData">,
	reviewId: string,
	sessionId: string,
	capturedAt = Date.now(),
	messages: readonly AgentMessage[] = [],
): Promise<ReviewArtifactSnapshot[]> {
	const data = await storage.exportPortableData();
	const imageSeeds = await imageSeedsForSession(messages, sessionId);
	const seeds = [...seedsForSession(data, sessionId), ...imageSeeds];
	const snapshots: ReviewArtifactSnapshot[] = [];
	for (const seed of seeds) snapshots.push(await snapshotFromSeed(seed, reviewId, sessionId, capturedAt));
	return snapshots.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
}

async function artifactContentHash(
	artifactType: ArtifactReviewKind,
	format: string,
	content: string,
	secondaryContent?: string,
	mediaDataUrl?: string,
): Promise<string> {
	return sha256ContentHash(
		JSON.stringify([
			ARTIFACT_HASH_FRAME,
			artifactType,
			format,
			content,
			secondaryContent ?? null,
			mediaDataUrl ?? null,
		]),
	);
}

async function imageAssetHash(
	media: Pick<NonNullable<ReviewArtifactSnapshot["media"]>, "dataUrl" | "mimeType">,
): Promise<string> {
	return sha256ContentHash(JSON.stringify([IMAGE_HASH_FRAME, media.mimeType, media.dataUrl]));
}

const ARTIFACT_REVIEW_KINDS = new Set<ArtifactReviewKind>([
	"plan",
	"map",
	"animation",
	"verification",
	"quiz",
	"deck",
	"benchmark",
	"evolution",
	"prompt-evolution",
	"image",
	"video",
	"audio",
	"document",
	"openui",
	"other",
]);

function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function validArtifactSource(value: unknown): value is ArtifactSourceReference {
	const source = recordValue(value);
	if (!source || typeof source.source !== "string") return false;
	switch (source.source) {
		case "indexeddb":
			return (
				typeof source.store === "string" &&
				source.store.length > 0 &&
				typeof source.id === "string" &&
				source.id.length > 0
			);
		case "course":
			return (
				typeof source.courseId === "string" &&
				source.courseId.length > 0 &&
				typeof source.id === "string" &&
				source.id.length > 0 &&
				(source.sourceId === undefined || typeof source.sourceId === "string") &&
				(source.sourceSessionId === undefined || typeof source.sourceSessionId === "string")
			);
		case "openui":
			return (
				typeof source.sessionId === "string" &&
				source.sessionId.length > 0 &&
				typeof source.documentId === "string" &&
				source.documentId.length > 0 &&
				Number.isSafeInteger(source.revision) &&
				(source.revision as number) >= 0 &&
				(source.nodeId === undefined || typeof source.nodeId === "string") &&
				(source.resourceId === undefined || typeof source.resourceId === "string")
			);
		case "filesystem":
			return typeof source.path === "string" && source.path.length > 0;
		case "session":
			return (
				typeof source.sessionId === "string" &&
				source.sessionId.length > 0 &&
				typeof source.id === "string" &&
				source.id.length > 0 &&
				(source.messageId === undefined || typeof source.messageId === "string")
			);
		default:
			return false;
	}
}

function validArtifactReference(value: unknown): value is ArtifactVersionReference {
	const artifact = recordValue(value);
	return Boolean(
		artifact &&
			validArtifactSource(artifact.source) &&
			typeof artifact.artifactType === "string" &&
			ARTIFACT_REVIEW_KINDS.has(artifact.artifactType as ArtifactReviewKind) &&
			typeof artifact.format === "string" &&
			artifact.format.length > 0 &&
			typeof artifact.versionId === "string" &&
			artifact.versionId.length > 0 &&
			typeof artifact.contentHash === "string" &&
			SHA256_HASH.test(artifact.contentHash) &&
			artifact.frozen === true &&
			(artifact.parentVersionId === undefined || typeof artifact.parentVersionId === "string"),
	);
}

/**
 * Revalidates the durable IndexedDB boundary before a snapshot is rendered or
 * reused. Unsupported media, non-canonical data URLs, and hash mismatches are
 * omitted instead of being trusted through a TypeScript cast.
 */
export async function validatePersistedArtifactSnapshot(value: unknown): Promise<ReviewArtifactSnapshot | null> {
	const snapshot = recordValue(value);
	if (
		!snapshot ||
		snapshot.schemaVersion !== TRAJECTORY_REVIEW_SCHEMA_VERSION ||
		typeof snapshot.id !== "string" ||
		typeof snapshot.reviewId !== "string" ||
		snapshot.reviewId.length === 0 ||
		typeof snapshot.sessionId !== "string" ||
		snapshot.sessionId.length === 0 ||
		!validArtifactReference(snapshot.artifact) ||
		typeof snapshot.label !== "string" ||
		typeof snapshot.content !== "string" ||
		(snapshot.topic !== undefined && typeof snapshot.topic !== "string") ||
		(snapshot.secondaryContent !== undefined && typeof snapshot.secondaryContent !== "string") ||
		(snapshot.metadata !== undefined && !recordValue(snapshot.metadata)) ||
		typeof snapshot.createdAt !== "number" ||
		!Number.isFinite(snapshot.createdAt) ||
		typeof snapshot.capturedAt !== "number" ||
		!Number.isFinite(snapshot.capturedAt)
	)
		return null;

	const artifact = snapshot.artifact;
	if (artifact.source.source === "session" && artifact.source.sessionId !== snapshot.sessionId) return null;
	if (
		artifact.parentVersionId !== undefined &&
		(artifact.source.source !== "session" || snapshot.secondaryContent !== undefined || snapshot.media !== undefined)
	)
		return null;

	const mediaValue = snapshot.media;
	if (mediaValue === undefined) {
		if (artifact.artifactType === "image") return null;
	} else {
		const media = recordValue(mediaValue);
		if (
			!media ||
			artifact.artifactType !== "image" ||
			media.kind !== "image" ||
			typeof media.dataUrl !== "string" ||
			typeof media.alt !== "string" ||
			typeof media.mimeType !== "string" ||
			typeof media.assetHash !== "string" ||
			!SHA256_HASH.test(media.assetHash) ||
			!Number.isSafeInteger(media.naturalWidth) ||
			!Number.isSafeInteger(media.naturalHeight)
		)
			return null;
		const budget = imageCaptureBudget();
		const maximumRawLength = Math.ceil(TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxDecodedBytesPerImage / 3) * 4 + 64;
		if (!reserveRawImageCandidate(budget, media.dataUrl.length, maximumRawLength)) return null;
		const raster = await localRaster(media.dataUrl, budget);
		if (
			!raster ||
			raster.dataUrl !== media.dataUrl ||
			raster.mimeType !== media.mimeType ||
			raster.width !== media.naturalWidth ||
			raster.height !== media.naturalHeight ||
			artifact.format !== media.mimeType ||
			(await imageAssetHash({
				dataUrl: media.dataUrl,
				mimeType: media.mimeType,
			})) !== media.assetHash
		)
			return null;
	}

	const expectedContentHash =
		artifact.parentVersionId === undefined
			? await artifactContentHash(
					artifact.artifactType,
					artifact.format,
					snapshot.content,
					snapshot.secondaryContent as string | undefined,
					recordValue(mediaValue)?.dataUrl as string | undefined,
				)
			: await sha256ContentHash(snapshot.content);
	if (expectedContentHash !== artifact.contentHash || artifactVersionKey(artifact) !== snapshot.id) return null;
	return snapshot as unknown as ReviewArtifactSnapshot;
}

export function createArtifactRevisionSnapshot(
	original: ReviewArtifactSnapshot,
	content: string,
	contentHash: string,
	candidateId: string,
	capturedAt = Date.now(),
): ReviewArtifactSnapshot {
	if (
		original.artifact.artifactType === "image" ||
		original.artifact.artifactType === "video" ||
		original.artifact.artifactType === "audio"
	) {
		throw new Error("Media artifact revisions require a validated frozen replacement asset.");
	}
	if (!SHA256_HASH.test(contentHash)) throw new Error("Artifact revisions require a SHA-256 content hash.");
	const artifact: ArtifactVersionReference = {
		...original.artifact,
		source: {
			source: "session",
			sessionId: original.sessionId,
			id: candidateId,
		},
		versionId: candidateId,
		contentHash,
		frozen: true,
		parentVersionId: original.artifact.versionId,
	};
	return {
		...original,
		id: artifactVersionKey(artifact),
		artifact,
		label: `${original.label} · review revision`,
		content,
		secondaryContent: undefined,
		media: undefined,
		metadata: { ...original.metadata, reviewCandidateId: candidateId },
		createdAt: capturedAt,
		capturedAt,
	};
}
