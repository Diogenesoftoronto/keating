export const SHARE_MAX_BYTES = 512 * 1024;
export const SHARE_ID_BYTES = 9;
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

export const SHARE_FIELD_LIMITS = {
	messages: 4_096,
	messageTextCharacters: 256 * 1024,
	turns: 512,
	turnTextCharacters: 8_192,
	totalTurnTextCharacters: 96 * 1024,
	artifacts: 64,
	artifactTextCharacters: 24_000,
	annotations: 256,
	annotationTextCharacters: 8_192,
	previewBytes: 64 * 1024,
	totalPreviewBytes: 128 * 1024,
} as const;

const SHAREABLE_ROLES = new Set(["user", "user-with-attachments", "assistant"]);
const ARTIFACT_TYPES = new Set([
	"plan",
	"map",
	"animation",
	"verification",
	"quiz",
	"deck",
	"image",
	"video",
	"audio",
	"document",
	"openui",
	"other",
]);
const ANNOTATION_KINDS = new Set(["problem", "strength", "suggestion"]);
const VERDICTS = new Set(["undecided", "accepted", "review", "rejected"]);
const RUBRIC_KEYS = new Set(["diagnosis", "accuracy", "scaffolding", "adaptation", "learner-agency", "verification"]);
const CONTENT_OMISSIONS = new Set(["unsafe-content", "content-budget"]);
const PREVIEW_OMISSIONS = new Set(["unavailable", "unsafe-preview", "preview-too-large", "media-budget"]);
const SAFE_RASTER_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const UNSAFE_ARTIFACT_CONTENT = /<\s*\/?\s*[a-z][^>]*>|(?:https?:)?\/\/|(?:javascript|data):/i;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
	return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function unknownKeys(value: UnknownRecord, allowed: readonly string[]): string[] {
	const allow = new Set(allowed);
	return Object.keys(value).filter((key) => !allow.has(key));
}

function requiredString(value: unknown, maximum = Number.POSITIVE_INFINITY): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function optionalString(value: unknown, maximum = Number.POSITIVE_INFINITY): boolean {
	return value === undefined || (typeof value === "string" && value.length <= maximum);
}

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function nonnegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Mirrors trajectory-review's public contentFingerprint without pulling review storage into the wire boundary. */
function publicContentFingerprint(content: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < content.length; index += 1) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${content.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function decodedBase64Bytes(value: string): number {
	return Math.max(0, Math.floor(value.length * 3 / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0));
}

function validRasterMagic(mimeType: string, base64: string): boolean {
	try {
		const binary = atob(base64.slice(0, 32).padEnd(Math.ceil(Math.min(32, base64.length) / 4) * 4, "="));
		const bytes = Array.from(binary, (character) => character.charCodeAt(0));
		if (mimeType === "image/png") return bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
		if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		if (mimeType === "image/gif") return binary.startsWith("GIF87a") || binary.startsWith("GIF89a");
		if (mimeType === "image/webp") return binary.startsWith("RIFF") && binary.slice(8, 12) === "WEBP";
		return false;
	} catch {
		return false;
	}
}

function messageText(message: UnknownRecord): string | null {
	if (!Array.isArray(message.content) || message.content.length === 0 || message.content.length > 128) return null;
	const texts: string[] = [];
	for (const rawPart of message.content) {
		const part = record(rawPart);
		if (!part || unknownKeys(part, ["type", "text"]).length > 0 || part.type !== "text" || typeof part.text !== "string") return null;
		texts.push(part.text);
	}
	const text = texts.join("\n");
	return text.length <= SHARE_FIELD_LIMITS.messageTextCharacters ? text : null;
}

function validMessage(messageValue: unknown, schemaVersion: 2 | 3): boolean {
	const message = record(messageValue);
	if (!message || !SHAREABLE_ROLES.has(String(message.role)) || messageText(message) === null) return false;
	const v3Fields = ["role", "content"];
	const legacyFields = [
		...v3Fields,
		"timestamp",
		"api",
		"provider",
		"model",
		"responseId",
		"usage",
		"stopReason",
		"errorMessage",
	];
	if (unknownKeys(message, schemaVersion === 3 ? v3Fields : legacyFields).length > 0) return false;
	if (message.timestamp !== undefined && !finiteNumber(message.timestamp)) return false;
	return true;
}

function validModel(modelValue: unknown, schemaVersion: 2 | 3): boolean {
	if (modelValue === undefined) return true;
	const model = record(modelValue);
	if (!model || !requiredString(model.provider, 128) || !requiredString(model.id, 256)) return false;
	const allowed = schemaVersion === 3
		? ["provider", "id", "name"]
		: ["provider", "id", "name", "api", "baseUrl"];
	return unknownKeys(model, allowed).length === 0
		&& optionalString(model.name, 256)
		&& optionalString(model.api, 128)
		&& optionalString(model.baseUrl, 2_048);
}

function validPreview(previewValue: unknown): { valid: boolean; bytes: number } {
	const preview = record(previewValue);
	if (!preview || unknownKeys(preview, ["kind", "dataUrl", "alt", "mimeType", "naturalWidth", "naturalHeight"]).length > 0) {
		return { valid: false, bytes: 0 };
	}
	if (preview.kind !== "image" || !requiredString(preview.dataUrl) || typeof preview.mimeType !== "string") {
		return { valid: false, bytes: 0 };
	}
	const match = SAFE_RASTER_DATA_URL.exec(preview.dataUrl);
	if (!match || match[1] !== preview.mimeType || !validRasterMagic(preview.mimeType, match[2]) || !optionalString(preview.alt, 512)) return { valid: false, bytes: 0 };
	if (!nonnegativeInteger(preview.naturalWidth) || !nonnegativeInteger(preview.naturalHeight)
		|| preview.naturalWidth < 1 || preview.naturalWidth > 8_192
		|| preview.naturalHeight < 1 || preview.naturalHeight > 8_192) return { valid: false, bytes: 0 };
	const bytes = decodedBase64Bytes(match[2]);
	return { valid: bytes <= SHARE_FIELD_LIMITS.previewBytes, bytes };
}

function validArtifact(artifactValue: unknown): { valid: boolean; previewBytes: number } {
	const artifact = record(artifactValue);
	if (!artifact || unknownKeys(artifact, [
		"id",
		"artifactType",
		"format",
		"parentArtifactId",
		"label",
		"topic",
		"content",
		"contentTruncated",
		"contentOmitted",
		"secondaryContent",
		"secondaryContentTruncated",
		"secondaryContentOmitted",
		"preview",
		"previewOmitted",
		"createdAt",
		"capturedAt",
	]).length > 0) return { valid: false, previewBytes: 0 };
	if (!requiredString(artifact.id, 64) || !ARTIFACT_TYPES.has(String(artifact.artifactType))) return { valid: false, previewBytes: 0 };
	if (!requiredString(artifact.format, 128) || !requiredString(artifact.label, 512) || !optionalString(artifact.topic, 512)) return { valid: false, previewBytes: 0 };
	if (!optionalString(artifact.parentArtifactId, 64) || !finiteNumber(artifact.createdAt) || !finiteNumber(artifact.capturedAt)) return { valid: false, previewBytes: 0 };
	for (const field of ["content", "secondaryContent"] as const) {
		const value = artifact[field];
		if (value !== undefined && (
			typeof value !== "string"
			|| value.length > SHARE_FIELD_LIMITS.artifactTextCharacters
			|| UNSAFE_ARTIFACT_CONTENT.test(value)
		)) return { valid: false, previewBytes: 0 };
	}
	if (artifact.contentTruncated !== undefined && artifact.contentTruncated !== true) return { valid: false, previewBytes: 0 };
	if (artifact.secondaryContentTruncated !== undefined && artifact.secondaryContentTruncated !== true) return { valid: false, previewBytes: 0 };
	if (artifact.contentOmitted !== undefined && !CONTENT_OMISSIONS.has(String(artifact.contentOmitted))) return { valid: false, previewBytes: 0 };
	if (artifact.secondaryContentOmitted !== undefined && !CONTENT_OMISSIONS.has(String(artifact.secondaryContentOmitted))) return { valid: false, previewBytes: 0 };
	if (artifact.previewOmitted !== undefined && !PREVIEW_OMISSIONS.has(String(artifact.previewOmitted))) return { valid: false, previewBytes: 0 };
	if (artifact.preview === undefined) return { valid: true, previewBytes: 0 };
	const preview = validPreview(artifact.preview);
	return { valid: preview.valid, previewBytes: preview.bytes };
}

function validAnnotationTarget(targetValue: unknown): boolean {
	const target = record(targetValue);
	if (!target || typeof target.kind !== "string") return false;
	switch (target.kind) {
		case "session":
			return unknownKeys(target, ["kind"]).length === 0;
		case "message":
			return unknownKeys(target, ["kind", "turnId"]).length === 0 && requiredString(target.turnId, 64);
		case "message-span":
			return unknownKeys(target, ["kind", "turnId", "quote", "prefix", "suffix"]).length === 0
				&& requiredString(target.turnId, 64)
				&& requiredString(target.quote, 2_048)
				&& typeof target.prefix === "string" && target.prefix.length <= 256
				&& typeof target.suffix === "string" && target.suffix.length <= 256;
		case "artifact":
			return unknownKeys(target, ["kind", "artifactId"]).length === 0 && requiredString(target.artifactId, 64);
		case "artifact-span":
			return unknownKeys(target, ["kind", "artifactId", "blockId", "quote", "prefix", "suffix"]).length === 0
				&& requiredString(target.artifactId, 64)
				&& optionalString(target.blockId, 256)
				&& requiredString(target.quote, 2_048)
				&& typeof target.prefix === "string" && target.prefix.length <= 256
				&& typeof target.suffix === "string" && target.suffix.length <= 256;
		case "artifact-region":
			const { x, y, width, height } = target;
			return unknownKeys(target, ["kind", "artifactId", "coordinateSpace", "x", "y", "width", "height", "naturalWidth", "naturalHeight"]).length === 0
				&& requiredString(target.artifactId, 64)
				&& target.coordinateSpace === "normalized-intrinsic"
				&& finiteNumber(x)
				&& finiteNumber(y)
				&& finiteNumber(width)
				&& finiteNumber(height)
				&& nonnegativeInteger(target.naturalWidth)
				&& nonnegativeInteger(target.naturalHeight)
				&& x >= 0
				&& y >= 0
				&& width > 0
				&& height > 0
				&& x + width <= 1
				&& y + height <= 1
				&& target.naturalWidth > 0
				&& target.naturalHeight > 0;
		case "artifact-time-range":
			if (unknownKeys(target, ["kind", "artifactId", "timeBasis", "startMs", "endMs", "durationMs"]).length > 0
				|| !requiredString(target.artifactId, 64)
				|| (target.timeBasis !== "media-time" && target.timeBasis !== "normalized-progress")
				|| !finiteNumber(target.startMs)
				|| !finiteNumber(target.endMs)
				|| target.startMs < 0
				|| target.endMs <= target.startMs
				|| (target.durationMs !== undefined && (!finiteNumber(target.durationMs) || target.durationMs <= 0))) return false;
			return target.timeBasis === "normalized-progress"
				? target.endMs <= 1
				: target.durationMs === undefined || target.endMs <= target.durationMs;
		default:
			return false;
	}
}

function validAnnotation(annotationValue: unknown): boolean {
	const annotation = record(annotationValue);
	if (!annotation || unknownKeys(annotation, [
		"id",
		"target",
		"targetKey",
		"kind",
		"category",
		"severity",
		"note",
		"pedagogicalImpact",
		"suggestedAlternative",
		"status",
		"createdAt",
		"updatedAt",
	]).length > 0) return false;
	return requiredString(annotation.id, 64)
		&& validAnnotationTarget(annotation.target)
		&& requiredString(annotation.targetKey, 128)
		&& ANNOTATION_KINDS.has(String(annotation.kind))
		&& requiredString(annotation.category, 256)
		&& (annotation.severity === undefined || (nonnegativeInteger(annotation.severity) && annotation.severity >= 1 && annotation.severity <= 4))
		&& requiredString(annotation.note, SHARE_FIELD_LIMITS.annotationTextCharacters)
		&& optionalString(annotation.pedagogicalImpact, SHARE_FIELD_LIMITS.annotationTextCharacters)
		&& optionalString(annotation.suggestedAlternative, SHARE_FIELD_LIMITS.annotationTextCharacters)
		&& annotation.status === "final"
		&& finiteNumber(annotation.createdAt)
		&& finiteNumber(annotation.updatedAt);
}

function annotationReferenceExists(
	targetValue: unknown,
	turnIds: ReadonlySet<string>,
	artifactsById: ReadonlyMap<string, UnknownRecord>,
): boolean {
	const target = record(targetValue);
	if (!target) return false;
	switch (target.kind) {
		case "session":
			return true;
		case "message":
		case "message-span":
			return typeof target.turnId === "string" && turnIds.has(target.turnId);
		case "artifact":
		case "artifact-span":
			return typeof target.artifactId === "string" && artifactsById.has(target.artifactId);
		case "artifact-region": {
			const artifact = typeof target.artifactId === "string" ? artifactsById.get(target.artifactId) : undefined;
			const preview = artifact ? record(artifact.preview) : null;
			return artifact?.artifactType === "image"
				&& (preview !== null
					? target.naturalWidth === preview.naturalWidth
						&& target.naturalHeight === preview.naturalHeight
					: PREVIEW_OMISSIONS.has(String(artifact.previewOmitted)));
		}
		case "artifact-time-range": {
			const artifact = typeof target.artifactId === "string" ? artifactsById.get(target.artifactId) : undefined;
			return artifact?.artifactType === "video" || artifact?.artifactType === "audio" || artifact?.artifactType === "animation";
		}
		default:
			return false;
	}
}

function publicTargetKey(targetValue: unknown): string | null {
	const target = record(targetValue);
	if (!target) return null;
	if (target.kind === "session") return "session";
	if ((target.kind === "message" || target.kind === "message-span") && typeof target.turnId === "string") {
		return `message:${target.turnId}`;
	}
	if (typeof target.kind === "string" && target.kind.startsWith("artifact-") && typeof target.artifactId === "string") {
		return `artifact:${target.artifactId}`;
	}
	if (target.kind === "artifact" && typeof target.artifactId === "string") return `artifact:${target.artifactId}`;
	return null;
}

function artifactParentsAreAcyclic(artifactsById: ReadonlyMap<string, UnknownRecord>): boolean {
	const resolved = new Set<string>();
	for (const artifactId of artifactsById.keys()) {
		const path = new Set<string>();
		let cursor: string | undefined = artifactId;
		while (cursor !== undefined && !resolved.has(cursor)) {
			if (path.has(cursor)) return false;
			path.add(cursor);
			const parentArtifactId: unknown = artifactsById.get(cursor)?.parentArtifactId;
			cursor = typeof parentArtifactId === "string" ? parentArtifactId : undefined;
		}
		for (const visited of path) resolved.add(visited);
	}
	return true;
}

function validReview(reviewValue: unknown): boolean {
	if (reviewValue === undefined) return true;
	const review = record(reviewValue);
	if (!review || unknownKeys(review, ["status", "verdict", "ratings", "overallRating", "summary", "createdAt", "updatedAt"]).length > 0) return false;
	const ratings = record(review.ratings);
	if (!ratings || Object.keys(ratings).some((key) => !RUBRIC_KEYS.has(key) || !nonnegativeInteger(ratings[key]) || (ratings[key] as number) < 1 || (ratings[key] as number) > 5)) return false;
	return review.status === "final"
		&& VERDICTS.has(String(review.verdict))
		&& (review.overallRating === undefined || (nonnegativeInteger(review.overallRating) && review.overallRating >= 1 && review.overallRating <= 5))
		&& optionalString(review.summary, 16_384)
		&& finiteNumber(review.createdAt)
		&& finiteNumber(review.updatedAt);
}

function validTrajectory(trajectoryValue: unknown, repairTurnFingerprints = false): boolean {
	const trajectory = record(trajectoryValue);
	if (!trajectory || unknownKeys(trajectory, ["schemaVersion", "turnCount", "turns", "artifactCount", "artifacts", "review", "annotationCount", "annotations", "omitted"]).length > 0) return false;
	if (trajectory.schemaVersion !== 1 || !nonnegativeInteger(trajectory.turnCount) || !nonnegativeInteger(trajectory.artifactCount) || !nonnegativeInteger(trajectory.annotationCount)) return false;
	if (!Array.isArray(trajectory.turns) || trajectory.turns.length > SHARE_FIELD_LIMITS.turns || trajectory.turnCount < trajectory.turns.length) return false;
	let totalTurnTextCharacters = 0;
	const turnIds = new Set<string>();
	for (const turnValue of trajectory.turns) {
		const turn = record(turnValue);
		if (!turn || unknownKeys(turn, ["id", "ordinal", "role", "text", "contentFingerprint"]).length > 0) return false;
		if (!requiredString(turn.id, 64) || !nonnegativeInteger(turn.ordinal) || (turn.role !== "user" && turn.role !== "assistant")) return false;
		if (turnIds.has(turn.id)) return false;
		turnIds.add(turn.id);
		if (typeof turn.text !== "string" || turn.text.length > SHARE_FIELD_LIMITS.turnTextCharacters) return false;
		if (!repairTurnFingerprints && turn.contentFingerprint !== publicContentFingerprint(turn.text)) return false;
		totalTurnTextCharacters += turn.text.length;
	}
	if (totalTurnTextCharacters > SHARE_FIELD_LIMITS.totalTurnTextCharacters) return false;
	if (!Array.isArray(trajectory.artifacts) || trajectory.artifacts.length > SHARE_FIELD_LIMITS.artifacts || trajectory.artifactCount < trajectory.artifacts.length) return false;
	let totalPreviewBytes = 0;
	const artifactsById = new Map<string, UnknownRecord>();
	for (const artifactValue of trajectory.artifacts) {
		const result = validArtifact(artifactValue);
		if (!result.valid) return false;
		const artifact = record(artifactValue)!;
		if (artifactsById.has(artifact.id as string)) return false;
		artifactsById.set(artifact.id as string, artifact);
		totalPreviewBytes += result.previewBytes;
	}
	for (const artifactValue of trajectory.artifacts) {
		const artifact = record(artifactValue)!;
		if (typeof artifact.parentArtifactId === "string" && !artifactsById.has(artifact.parentArtifactId)) return false;
	}
	if (!artifactParentsAreAcyclic(artifactsById)) return false;
	if (totalPreviewBytes > SHARE_FIELD_LIMITS.totalPreviewBytes || !validReview(trajectory.review)) return false;
	if (!Array.isArray(trajectory.annotations) || trajectory.annotations.length > SHARE_FIELD_LIMITS.annotations || trajectory.annotationCount < trajectory.annotations.length) return false;
	const annotationIds = new Set<string>();
	for (const annotationValue of trajectory.annotations) {
		if (!validAnnotation(annotationValue)) return false;
		const annotation = record(annotationValue)!;
		if (annotationIds.has(annotation.id as string)) return false;
		annotationIds.add(annotation.id as string);
		if (!annotationReferenceExists(annotation.target, turnIds, artifactsById)) return false;
		if (annotation.targetKey !== publicTargetKey(annotation.target)) return false;
	}
	const omitted = record(trajectory.omitted);
	if (!omitted || unknownKeys(omitted, ["turns", "artifacts", "invalidArtifacts", "internalArtifacts", "privateArtifacts", "uninspectedArtifacts", "annotations", "artifactContents", "artifactPreviews"]).length > 0) return false;
	return ["turns", "artifacts", "invalidArtifacts", "internalArtifacts", "privateArtifacts", "uninspectedArtifacts", "annotations", "artifactContents", "artifactPreviews"]
		.every((key) => nonnegativeInteger(omitted[key]));
}

export function isValidShareId(value: unknown): value is string {
	return typeof value === "string" && SHARE_ID_PATTERN.test(value);
}

export function compactShareIdFromBytes(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function validateSharedSessionPayload(value: unknown): string | null {
	const session = record(value);
	if (!session) return "Expected shared session object";
	const schemaVersion = session.schemaVersion === 3 ? 3 : 2;
	if (session.schemaVersion !== undefined && session.schemaVersion !== 2 && session.schemaVersion !== 3) return "Unsupported shared session schema version";
	const allowed = ["id", "schemaVersion", "title", "createdAt", "sharedAt", "messageCount", "model", "thinkingLevel", "messages", ...(schemaVersion === 3 ? ["trajectory"] : [])];
	if (unknownKeys(session, allowed).length > 0) return "Unexpected shared session field";
	if (!requiredString(session.title, 512)) return "Missing shared session title";
	if (!optionalString(session.createdAt, 64) || !optionalString(session.sharedAt, 64)) return "Invalid shared session timestamp";
	if (!Array.isArray(session.messages) || session.messages.length === 0) return "Missing shared session messages";
	if (session.messages.length > SHARE_FIELD_LIMITS.messages) return "Too many shared session messages";
	if (session.id !== undefined && !isValidShareId(session.id)) return "Invalid shared session id";
	if (session.messageCount !== undefined && (!nonnegativeInteger(session.messageCount) || session.messageCount !== session.messages.length)) return "Invalid shared session message count";
	if (!validModel(session.model, schemaVersion)) return "Invalid shared session model";
	if (session.thinkingLevel !== undefined && typeof session.thinkingLevel !== "string") return "Invalid shared session thinking level";
	if (session.messages.some((message) => !validMessage(message, schemaVersion))) return "Invalid shared session message";
	if (schemaVersion === 2 && session.trajectory !== undefined) return "Trajectory requires shared session schema v3";
	if (schemaVersion === 3 && session.trajectory !== undefined && !validTrajectory(session.trajectory)) return "Invalid shared session trajectory";
	return null;
}

function projectTarget(target: UnknownRecord): UnknownRecord {
	switch (target.kind) {
		case "session": return { kind: "session" };
		case "message": return { kind: "message", turnId: target.turnId };
		case "message-span": return { kind: "message-span", turnId: target.turnId, quote: target.quote, prefix: target.prefix, suffix: target.suffix };
		case "artifact": return { kind: "artifact", artifactId: target.artifactId };
		case "artifact-span": return { kind: "artifact-span", artifactId: target.artifactId, ...(target.blockId === undefined ? {} : { blockId: target.blockId }), quote: target.quote, prefix: target.prefix, suffix: target.suffix };
		case "artifact-region": return { kind: "artifact-region", artifactId: target.artifactId, coordinateSpace: target.coordinateSpace, x: target.x, y: target.y, width: target.width, height: target.height, naturalWidth: target.naturalWidth, naturalHeight: target.naturalHeight };
		default: return { kind: "artifact-time-range", artifactId: target.artifactId, timeBasis: target.timeBasis, startMs: target.startMs, endMs: target.endMs, ...(target.durationMs === undefined ? {} : { durationMs: target.durationMs }) };
	}
}

function projectTrajectory(value: UnknownRecord): UnknownRecord {
	const review = record(value.review);
	const omitted = record(value.omitted)!;
	return {
		schemaVersion: 1,
		turnCount: value.turnCount,
		turns: (value.turns as unknown[]).map((item) => {
			const turn = record(item)!;
			return { id: turn.id, ordinal: turn.ordinal, role: turn.role, text: turn.text, contentFingerprint: publicContentFingerprint(turn.text as string) };
		}),
		artifactCount: value.artifactCount,
		artifacts: (value.artifacts as unknown[]).map((item) => {
			const artifact = record(item)!;
			const preview = record(artifact.preview);
			return {
				id: artifact.id,
				artifactType: artifact.artifactType,
				format: artifact.format,
				...(artifact.parentArtifactId === undefined ? {} : { parentArtifactId: artifact.parentArtifactId }),
				label: artifact.label,
				...(artifact.topic === undefined ? {} : { topic: artifact.topic }),
				...(artifact.content === undefined ? {} : { content: artifact.content }),
				...(artifact.contentTruncated === undefined ? {} : { contentTruncated: true }),
				...(artifact.contentOmitted === undefined ? {} : { contentOmitted: artifact.contentOmitted }),
				...(artifact.secondaryContent === undefined ? {} : { secondaryContent: artifact.secondaryContent }),
				...(artifact.secondaryContentTruncated === undefined ? {} : { secondaryContentTruncated: true }),
				...(artifact.secondaryContentOmitted === undefined ? {} : { secondaryContentOmitted: artifact.secondaryContentOmitted }),
				...(preview ? { preview: { kind: "image", dataUrl: preview.dataUrl, alt: preview.alt, mimeType: preview.mimeType, naturalWidth: preview.naturalWidth, naturalHeight: preview.naturalHeight } } : {}),
				...(artifact.previewOmitted === undefined ? {} : { previewOmitted: artifact.previewOmitted }),
				createdAt: artifact.createdAt,
				capturedAt: artifact.capturedAt,
			};
		}),
		...(review ? { review: { status: "final", verdict: review.verdict, ratings: { ...record(review.ratings) }, ...(review.overallRating === undefined ? {} : { overallRating: review.overallRating }), ...(review.summary === undefined ? {} : { summary: review.summary }), createdAt: review.createdAt, updatedAt: review.updatedAt } } : {}),
		annotationCount: value.annotationCount,
		annotations: (value.annotations as unknown[]).map((item) => {
			const annotation = record(item)!;
			return { id: annotation.id, target: projectTarget(record(annotation.target)!), targetKey: annotation.targetKey, kind: annotation.kind, category: annotation.category, ...(annotation.severity === undefined ? {} : { severity: annotation.severity }), note: annotation.note, ...(annotation.pedagogicalImpact === undefined ? {} : { pedagogicalImpact: annotation.pedagogicalImpact }), ...(annotation.suggestedAlternative === undefined ? {} : { suggestedAlternative: annotation.suggestedAlternative }), status: "final", createdAt: annotation.createdAt, updatedAt: annotation.updatedAt };
		}),
		omitted: { turns: omitted.turns, artifacts: omitted.artifacts, invalidArtifacts: omitted.invalidArtifacts, internalArtifacts: omitted.internalArtifacts, privateArtifacts: omitted.privateArtifacts, uninspectedArtifacts: omitted.uninspectedArtifacts, annotations: omitted.annotations, artifactContents: omitted.artifactContents, artifactPreviews: omitted.artifactPreviews },
	};
}

/** Strict public wire projection shared by cache, hash, browser upload, and server storage. */
export function projectSharedSessionPayload(value: unknown): UnknownRecord | null {
	const session = record(value);
	if (!session || !Array.isArray(session.messages) || session.messages.length === 0) return null;
	if (session.messages.length > SHARE_FIELD_LIMITS.messages) return null;
	if (session.schemaVersion !== undefined && session.schemaVersion !== 2 && session.schemaVersion !== 3) return null;
	if (session.title !== undefined && !requiredString(session.title, 512)) return null;
	const schemaVersion = session.schemaVersion === 3 ? 3 : 2;
	const messages = session.messages.flatMap((item) => {
		const message = record(item);
		if (!message || !SHAREABLE_ROLES.has(String(message.role))) return [];
		const text = messageText(message);
		return text === null ? [] : [{ role: message.role, content: [{ type: "text", text }] }];
	});
	if (messages.length === 0 || messages.length > SHARE_FIELD_LIMITS.messages) return null;
	const model = record(session.model);
	const trajectory = record(session.trajectory);
	if (session.trajectory !== undefined && !trajectory) return null;
	// The local projector can deterministically repair a stale fingerprint; the public validator remains fail-closed.
	if (trajectory && !validTrajectory(trajectory, true)) return null;
	return {
		...(typeof session.id === "string" ? { id: session.id } : {}),
		schemaVersion,
		title: typeof session.title === "string" ? session.title : "Shared session",
		createdAt: typeof session.createdAt === "string" ? session.createdAt : new Date(0).toISOString(),
		sharedAt: typeof session.sharedAt === "string" ? session.sharedAt : new Date(0).toISOString(),
		messageCount: messages.length,
		...(model && requiredString(model.provider, 128) && requiredString(model.id, 256) ? { model: { provider: model.provider, id: model.id, ...(requiredString(model.name, 256) ? { name: model.name } : {}) } } : {}),
		...(requiredString(session.thinkingLevel, 64) ? { thinkingLevel: session.thinkingLevel } : {}),
		messages,
		...(schemaVersion === 3 && trajectory ? { trajectory: projectTrajectory(trajectory) } : {}),
	};
}
