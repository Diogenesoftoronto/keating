import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionData, SessionMetadata } from "../types/session";
import { createSessionId, sessionModelMetadata, sessionPreview, sessionSearchText, sessionTitle, sessionUsage } from "../hooks/session-metadata";
import { keatingStorage, sessions } from "../hooks/keating-storage";
import { DEFAULT_MODEL } from "../hooks/keating-stream";
import { getSelectableModels } from "../lib/provider-models";
import {
	captureSessionArtifactVersions,
	validatePersistedArtifactSnapshot,
} from "./trajectory-artifacts";
import {
	artifactVersionKey,
	contentFingerprint,
	messageReviewAnchor,
	type ArtifactReviewKind,
	type ReviewArtifactSnapshot,
	type TrajectoryAnnotation,
	type TrajectoryReviewTarget,
} from "./trajectory-review";
import {
	trajectoryReviewStore,
	type TrajectoryReviewSnapshot,
} from "./trajectory-store";
import { redactString } from "./security/redaction";
import { loadKeatingUiSettings, shareModeExposesDataPublicly, type ShareLinkMode } from "./ui-settings";
import {
	decodeSharedSessionPayload,
	encodeSharedSession,
	minifySharedSession,
} from "./share-codec";
import { SHARE_MAX_BYTES } from "./share-contract";

const SHARE_INDEX_KEY = "keating_shared_sessions";
const SHARE_KEY_PREFIX = "keating_shared_session:";
const SHARE_HASH_PARAM = "session";

export interface SharedModelInfo {
	provider: string;
	id: string;
	name?: string;
	/** Legacy v2 load-only fields. V3 wire projection always removes them. */
	api?: string;
	baseUrl?: string;
}

export type SharedTrajectoryArtifactOmission = "unsafe-content" | "content-budget";
export type SharedTrajectoryPreviewOmission = "unavailable" | "unsafe-preview" | "preview-too-large" | "media-budget";

export interface SharedTrajectoryTurn {
	id: string;
	ordinal: number;
	role: "user" | "assistant";
	text: string;
	contentFingerprint: string;
}

export interface SharedTrajectoryArtifact {
	id: string;
	artifactType: ArtifactReviewKind;
	format: string;
	parentArtifactId?: string;
	label: string;
	topic?: string;
	content?: string;
	contentTruncated?: boolean;
	contentOmitted?: SharedTrajectoryArtifactOmission;
	secondaryContent?: string;
	secondaryContentTruncated?: boolean;
	secondaryContentOmitted?: SharedTrajectoryArtifactOmission;
	preview?: {
		kind: "image";
		dataUrl: string;
		alt: string;
		mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
		naturalWidth: number;
		naturalHeight: number;
	};
	previewOmitted?: SharedTrajectoryPreviewOmission;
	createdAt: number;
	capturedAt: number;
}

export type SharedTrajectoryAnnotationTarget =
	| { kind: "session" }
	| { kind: "message"; turnId: string }
	| { kind: "message-span"; turnId: string; quote: string; prefix: string; suffix: string }
	| { kind: "artifact"; artifactId: string }
	| { kind: "artifact-span"; artifactId: string; blockId?: string; quote: string; prefix: string; suffix: string }
	| {
		kind: "artifact-region";
		artifactId: string;
		coordinateSpace: "normalized-intrinsic";
		x: number;
		y: number;
		width: number;
		height: number;
		naturalWidth: number;
		naturalHeight: number;
	}
	| {
		kind: "artifact-time-range";
		artifactId: string;
		timeBasis: "media-time" | "normalized-progress";
		startMs: number;
		endMs: number;
		durationMs?: number;
	};

export interface SharedTrajectoryAnnotation {
	id: string;
	target: SharedTrajectoryAnnotationTarget;
	targetKey: string;
	kind: TrajectoryAnnotation["kind"];
	category: string;
	severity?: TrajectoryAnnotation["severity"];
	note: string;
	pedagogicalImpact?: string;
	suggestedAlternative?: string;
	status: "final";
	createdAt: number;
	updatedAt: number;
}

export interface SharedTrajectoryReview {
	status: "final";
	verdict: TrajectoryReviewSnapshot["review"]["verdict"];
	ratings: TrajectoryReviewSnapshot["review"]["ratings"];
	overallRating?: TrajectoryReviewSnapshot["review"]["overallRating"];
	summary?: string;
	createdAt: number;
	updatedAt: number;
}

export interface SharedTrajectory {
	schemaVersion: 1;
	turnCount: number;
	turns: SharedTrajectoryTurn[];
	artifactCount: number;
	artifacts: SharedTrajectoryArtifact[];
	review?: SharedTrajectoryReview;
	annotationCount: number;
	annotations: SharedTrajectoryAnnotation[];
	omitted: {
		turns: number;
		artifacts: number;
		invalidArtifacts: number;
		internalArtifacts: number;
		privateArtifacts: number;
		uninspectedArtifacts: number;
		annotations: number;
		artifactContents: number;
		artifactPreviews: number;
	};
}

export interface SharedSession {
	id: string;
	schemaVersion?: 2 | 3;
	title: string;
	createdAt: string;
	sharedAt: string;
	messageCount: number;
	model?: SharedModelInfo;
	thinkingLevel?: SessionMetadata["thinkingLevel"];
	messages: AgentMessage[];
	trajectory?: SharedTrajectory;
}

export interface SaveSharedSessionOptions {
	model?: Model<any>;
	thinkingLevel?: SessionMetadata["thinkingLevel"];
	trajectory?: SharedTrajectory;
}

export interface SharedSessionUrlResult {
	url: string;
	mode: ShareLinkMode;
	fallback: boolean;
	includesTrajectory: boolean;
}

export type SharedSessionLoadResult =
	| { ok: true; session: SharedSession; source: "hash" | "cache" | "server" }
	| { ok: false; reason: "not-found" | "invalid-link" | "mismatch" | "server-error" | "network"; message: string; status?: number };

// Whether the caller should warn the user that a share exposes the transcript
// publicly before creating the link. Returns false once the user has
// acknowledged the warning (so it is a one-time prompt, not a nag) and for
// modes that keep the data on-device (`local-short`).
export function shouldWarnBeforePublicShare(
	mode: ShareLinkMode = loadKeatingUiSettings().shareLinkMode,
	acknowledged: boolean = loadKeatingUiSettings().trajectoryShareWarningAcknowledged,
): boolean {
	return shareModeExposesDataPublicly(mode) && !acknowledged;
}

function serializeModel(model: Model<any> | undefined): SharedModelInfo {
	const fallback = model ?? DEFAULT_MODEL;
	return {
		provider: fallback.provider,
		id: fallback.id,
		name: fallback.name,
	};
}

function normalizeSharedSession(parsed: Partial<SharedSession> | null): SharedSession | null {
	if (!parsed?.id || !Array.isArray(parsed.messages)) return null;
	const messages = sanitizeMessagesForShare(parsed.messages);
	if (messages.length === 0) return null;
	const candidate: SharedSession = {
		id: parsed.id,
		schemaVersion: parsed.schemaVersion === 3 ? 3 : 2,
		title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : sessionTitle(messages),
		createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
		sharedAt: typeof parsed.sharedAt === "string" ? parsed.sharedAt : new Date().toISOString(),
		messageCount: messages.length,
		...(parsed.model?.provider && parsed.model?.id ? { model: { provider: parsed.model.provider, id: parsed.model.id, ...(parsed.model.name ? { name: parsed.model.name } : {}) } } : {}),
		thinkingLevel: parsed.thinkingLevel ?? "medium",
		messages,
		...(parsed.schemaVersion === 3 && parsed.trajectory ? { trajectory: parsed.trajectory } : {}),
	};
	try {
		return minifySharedSession(candidate) as unknown as SharedSession;
	} catch {
		return null;
	}
}

function decodeSharedSession(value: string): SharedSession | null {
	return normalizeSharedSession(decodeSharedSessionPayload(value));
}

function isShareableRole(role: unknown) {
	return role === "user" || role === "user-with-attachments" || role === "assistant";
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

export function sanitizeMessagesForShare(messages: AgentMessage[]): AgentMessage[] {
	return messages.flatMap((message) => {
		const role = (message as any).role;
		if (!isShareableRole(role)) return [];

		const text = textFromContent((message as any).content).trim();
		if (!text) return [];

		return [{
			role,
			content: [{ type: "text", text }],
		} as AgentMessage];
	});
}

const SHARED_TRAJECTORY_LIMITS = {
	turns: 512,
	turnCharacters: 8_192,
	totalTurnCharacters: 96 * 1024,
	artifacts: 64,
	artifactCharacters: 24_000,
	artifactTextCharacters: 128_000,
	annotations: 256,
	annotationCharacters: 8_192,
	previewBytes: 64 * 1024,
	totalPreviewBytes: 128 * 1024,
} as const;

const INTERNAL_ARTIFACT_TYPES = new Set<ArtifactReviewKind>([
	"benchmark",
	"evolution",
	"prompt-evolution",
]);
const SAFE_RASTER_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const UNSAFE_ARTIFACT_CONTENT = /<\s*\/?\s*[a-z][^>]*>|(?:https?:)?\/\/|(?:javascript|data):/i;

export interface BuildSharedTrajectoryDependencies {
	captureArtifacts?: typeof captureSessionArtifactVersions;
	loadFinalReviewSnapshot?: (sessionId: string) => Promise<TrajectoryReviewSnapshot | null>;
	validateStoredArtifact?: typeof validatePersistedArtifactSnapshot;
}

function boundedPublicText(value: unknown, maximum: number): { text: string; truncated: boolean } {
	const redacted = redactString(typeof value === "string" ? value : "")
		.replace(/(?:https?:)?\/\/[^\s<>"')]+/gi, "[remote URL omitted]")
		.trim();
	if (redacted.length <= maximum) return { text: redacted, truncated: false };
	if (maximum <= 31) return { text: redacted.slice(0, Math.max(0, maximum)), truncated: true };
	return { text: `${redacted.slice(0, Math.max(0, maximum - 31))}\n[truncated for public share]`, truncated: true };
}

function safeArtifactText(
	value: unknown,
	format: string,
	remaining: { characters: number },
): { text?: string; truncated?: boolean; omitted?: SharedTrajectoryArtifactOmission } {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) return {};
	const unsafeFormat = /(?:html|svg|openui|animation)/i.test(format);
	if (unsafeFormat || UNSAFE_ARTIFACT_CONTENT.test(raw)) return { omitted: "unsafe-content" };
	if (remaining.characters <= 0) return { omitted: "content-budget" };
	const maximum = Math.min(SHARED_TRAJECTORY_LIMITS.artifactCharacters, remaining.characters);
	const bounded = boundedPublicText(raw, maximum);
	remaining.characters -= bounded.text.length;
	return { text: bounded.text, truncated: bounded.truncated || raw.length > maximum };
}

function decodedBase64Bytes(base64: string): number {
	return Math.max(0, Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0));
}

function safeRasterPreview(
	media: ReviewArtifactSnapshot["media"],
	remaining: { bytes: number },
): { preview?: SharedTrajectoryArtifact["preview"]; omitted?: SharedTrajectoryPreviewOmission } {
	if (!media) return { omitted: "unavailable" };
	const match = SAFE_RASTER_DATA_URL.exec(media.dataUrl);
	if (!match || match[1] !== media.mimeType) return { omitted: "unsafe-preview" };
	const byteLength = decodedBase64Bytes(match[2]);
	if (byteLength > SHARED_TRAJECTORY_LIMITS.previewBytes) return { omitted: "preview-too-large" };
	if (byteLength > remaining.bytes) return { omitted: "media-budget" };
	remaining.bytes -= byteLength;
	return {
		preview: {
			kind: "image",
			dataUrl: media.dataUrl,
			alt: boundedPublicText(media.alt, 512).text,
			mimeType: match[1] as NonNullable<SharedTrajectoryArtifact["preview"]>["mimeType"],
			naturalWidth: media.naturalWidth,
			naturalHeight: media.naturalHeight,
		},
	};
}

function publicAnnotationTarget(
	target: TrajectoryReviewTarget,
	turnIds: ReadonlyMap<string, string>,
	artifactIds: ReadonlyMap<string, string>,
): SharedTrajectoryAnnotationTarget | null {
	switch (target.kind) {
		case "session":
			return { kind: "session" };
		case "message": {
			const turnId = turnIds.get(target.messageId);
			return turnId ? { kind: "message", turnId } : null;
		}
		case "message-span": {
			const turnId = turnIds.get(target.messageId);
			if (!turnId) return null;
			return {
				kind: "message-span",
				turnId,
				quote: boundedPublicText(target.anchor.quote, 2_048).text,
				prefix: boundedPublicText(target.anchor.prefix, 256).text,
				suffix: boundedPublicText(target.anchor.suffix, 256).text,
			};
		}
		case "artifact": {
			const artifactId = artifactIds.get(artifactVersionKey(target.artifact));
			return artifactId ? { kind: "artifact", artifactId } : null;
		}
		case "artifact-span": {
			const artifactId = artifactIds.get(artifactVersionKey(target.artifact));
			if (!artifactId) return null;
			return {
				kind: "artifact-span",
				artifactId,
				...(target.blockId ? { blockId: boundedPublicText(target.blockId, 256).text } : {}),
				quote: boundedPublicText(target.anchor.quote, 2_048).text,
				prefix: boundedPublicText(target.anchor.prefix, 256).text,
				suffix: boundedPublicText(target.anchor.suffix, 256).text,
			};
		}
		case "artifact-region": {
			const artifactId = artifactIds.get(artifactVersionKey(target.artifact));
			return artifactId ? {
				kind: "artifact-region",
				artifactId,
				coordinateSpace: "normalized-intrinsic",
				x: target.x,
				y: target.y,
				width: target.width,
				height: target.height,
				naturalWidth: target.naturalWidth,
				naturalHeight: target.naturalHeight,
			} : null;
		}
		case "artifact-time-range": {
			const artifactId = artifactIds.get(artifactVersionKey(target.artifact));
			return artifactId ? {
				kind: "artifact-time-range",
				artifactId,
				timeBasis: target.timeBasis,
				startMs: target.startMs,
				endMs: target.endMs,
				...(target.durationMs === undefined ? {} : { durationMs: target.durationMs }),
			} : null;
		}
		case "event":
			return null;
	}
}

function publicTargetKey(target: SharedTrajectoryAnnotationTarget): string {
	if (target.kind === "session") return "session";
	if (target.kind === "message" || target.kind === "message-span") return `message:${target.turnId}`;
	return `artifact:${target.artifactId}`;
}

async function defaultFinalReviewSnapshot(sessionId: string): Promise<TrajectoryReviewSnapshot | null> {
	const store = trajectoryReviewStore();
	const review = await store.getReviewForSession(sessionId);
	if (!review || review.status !== "final") return null;
	return await store.exportSnapshot(review.id);
}

/** Build the curated, public trajectory only after the canonical session snapshot is durable. */
export async function buildSharedTrajectory(
	sessionId: string,
	messages: readonly AgentMessage[],
	dependencies: BuildSharedTrajectoryDependencies = {},
): Promise<SharedTrajectory> {
	const loadReview = dependencies.loadFinalReviewSnapshot ?? defaultFinalReviewSnapshot;
	const captureArtifacts = dependencies.captureArtifacts ?? captureSessionArtifactVersions;
	const validateStoredArtifact = dependencies.validateStoredArtifact ?? validatePersistedArtifactSnapshot;
	const loadedReviewSnapshot = await loadReview(sessionId);
	const reviewSnapshot = loadedReviewSnapshot?.review.status === "final" ? loadedReviewSnapshot : null;
	const reviewId = reviewSnapshot?.review.id ?? `review:${sessionId}`;
	const capturedArtifacts = await captureArtifacts(keatingStorage, reviewId, sessionId, Date.now(), messages);

	const rawTurns = messages.flatMap((message, ordinal) => {
		const role = (message as { role?: unknown }).role;
		if (role !== "user" && role !== "user-with-attachments" && role !== "assistant") return [];
		const anchor = messageReviewAnchor(sessionId, message, ordinal);
		const bounded = boundedPublicText(textFromContent((message as { content?: unknown }).content), SHARED_TRAJECTORY_LIMITS.turnCharacters);
		if (!bounded.text) return [];
		return [{ anchor, role: role === "assistant" ? "assistant" as const : "user" as const, text: bounded.text }];
	});
	const turnIds = new Map<string, string>();
	const turnTextBudget = { characters: SHARED_TRAJECTORY_LIMITS.totalTurnCharacters };
	const includedTurns: typeof rawTurns = [];
	for (const turn of rawTurns) {
		if (includedTurns.length >= SHARED_TRAJECTORY_LIMITS.turns || turnTextBudget.characters <= 0) break;
		const bounded = boundedPublicText(turn.text, Math.min(SHARED_TRAJECTORY_LIMITS.turnCharacters, turnTextBudget.characters));
		if (!bounded.text) break;
		includedTurns.push({ ...turn, text: bounded.text });
		turnTextBudget.characters -= bounded.text.length;
	}
	const turns: SharedTrajectoryTurn[] = includedTurns.map(({ anchor, role, text }) => {
		const id = `turn-${anchor.ordinal + 1}`;
		turnIds.set(anchor.id, id);
		return {
			id,
			ordinal: anchor.ordinal,
			role,
			text,
			contentFingerprint: contentFingerprint(text),
		};
	});

	const storedArtifacts = reviewSnapshot?.artifacts ?? [];
	const storedToInspect = storedArtifacts.slice(-SHARED_TRAJECTORY_LIMITS.artifacts);
	const validatedStored: Array<ReviewArtifactSnapshot | null> = [];
	let uninspectedArtifacts = Math.max(0, storedArtifacts.length - storedToInspect.length);
	for (const artifact of storedToInspect) {
		const mediaLength = artifact.media?.dataUrl.length ?? 0;
		if (
			artifact.content.length > SHARED_TRAJECTORY_LIMITS.artifactTextCharacters * 4
			|| (artifact.secondaryContent?.length ?? 0) > SHARED_TRAJECTORY_LIMITS.artifactTextCharacters * 4
			|| mediaLength > Math.ceil(SHARED_TRAJECTORY_LIMITS.previewBytes / 3) * 4 + 128
		) {
			uninspectedArtifacts += 1;
			continue;
		}
		try {
			const validated = await validateStoredArtifact(artifact);
			validatedStored.push(validated?.sessionId === sessionId && validated.reviewId === reviewId ? validated : null);
		} catch {
			validatedStored.push(null);
		}
	}
	const invalidArtifacts = validatedStored.filter((artifact) => !artifact).length;
	const merged = new Map<string, ReviewArtifactSnapshot>();
	for (const artifact of validatedStored) if (artifact) merged.set(artifactVersionKey(artifact.artifact), artifact);
	for (const artifact of capturedArtifacts) {
		if (artifact.sessionId === sessionId && artifact.artifact.frozen) merged.set(artifactVersionKey(artifact.artifact), artifact);
	}
	const mergedArtifacts = [...merged.values()].sort((left, right) => (
		left.createdAt - right.createdAt
		|| left.capturedAt - right.capturedAt
		|| artifactVersionKey(left.artifact).localeCompare(artifactVersionKey(right.artifact))
	));
	let internalArtifacts = 0;
	let privateArtifacts = 0;
	const publicArtifacts = mergedArtifacts.filter((artifact) => {
		if (
			INTERNAL_ARTIFACT_TYPES.has(artifact.artifact.artifactType)
			|| /\b(?:benchmark|evolution|prompt evolution|improvement)\b/i.test(artifact.label)
		) {
			internalArtifacts += 1;
			return false;
		}
		if (artifact.artifact.artifactType === "image") {
			const metadata = artifact.metadata;
			const generatedImage = metadata
				&& typeof metadata.generationPrompt === "string"
				&& metadata.generationPrompt.length > 0
				&& typeof metadata.model === "string"
				&& metadata.model.length > 0;
			if (!generatedImage || (metadata && ("messageRole" in metadata || "partIndex" in metadata))) {
				privateArtifacts += 1;
				return false;
			}
		}
		return true;
	});
	const includedArtifacts = publicArtifacts.slice(0, SHARED_TRAJECTORY_LIMITS.artifacts);
	const artifactIds = new Map<string, string>();
	const versionIds = new Map<string, string>();
	for (const [index, snapshot] of includedArtifacts.entries()) {
		const publicId = `artifact-${index + 1}`;
		artifactIds.set(artifactVersionKey(snapshot.artifact), publicId);
		versionIds.set(snapshot.artifact.versionId, publicId);
	}
	const artifactTextBudget = { characters: SHARED_TRAJECTORY_LIMITS.artifactTextCharacters };
	const mediaBudget = { bytes: SHARED_TRAJECTORY_LIMITS.totalPreviewBytes };
	let artifactContentsOmitted = 0;
	let artifactPreviewsOmitted = 0;
	const artifacts: SharedTrajectoryArtifact[] = includedArtifacts.map((snapshot, index) => {
		const publicContent = snapshot.artifact.artifactType === "image"
			? [snapshot.label, snapshot.media?.alt].filter(Boolean).join("\n\n")
			: snapshot.content;
		const content = safeArtifactText(publicContent, `${snapshot.artifact.artifactType}:${snapshot.artifact.format}`, artifactTextBudget);
		const secondary = safeArtifactText(snapshot.secondaryContent, "text/plain", artifactTextBudget);
		const nativeMedia = snapshot.artifact.artifactType === "image"
			|| snapshot.artifact.artifactType === "video"
			|| snapshot.artifact.artifactType === "audio";
		const preview = nativeMedia ? safeRasterPreview(snapshot.media, mediaBudget) : {};
		if (content.omitted || secondary.omitted) artifactContentsOmitted += 1;
		if (preview.omitted) artifactPreviewsOmitted += 1;
		return {
			id: `artifact-${index + 1}`,
			artifactType: snapshot.artifact.artifactType,
			format: boundedPublicText(snapshot.artifact.format, 128).text,
			...(snapshot.artifact.parentVersionId && versionIds.has(snapshot.artifact.parentVersionId)
				? { parentArtifactId: versionIds.get(snapshot.artifact.parentVersionId) }
				: {}),
			label: boundedPublicText(snapshot.label, 512).text || `Artifact ${index + 1}`,
			...(snapshot.topic ? { topic: boundedPublicText(snapshot.topic, 512).text } : {}),
			...(content.text ? { content: content.text } : {}),
			...(content.truncated ? { contentTruncated: true } : {}),
			...(content.omitted ? { contentOmitted: content.omitted } : {}),
			...(secondary.text ? { secondaryContent: secondary.text } : {}),
			...(secondary.truncated ? { secondaryContentTruncated: true } : {}),
			...(secondary.omitted ? { secondaryContentOmitted: secondary.omitted } : {}),
			...(preview.preview ? { preview: preview.preview } : {}),
			...(preview.omitted ? { previewOmitted: preview.omitted } : {}),
			createdAt: snapshot.createdAt,
			capturedAt: snapshot.capturedAt,
		};
	});

	const finalAnnotations = (reviewSnapshot?.annotations ?? [])
		.filter((annotation) => annotation.status === "final")
		.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
	let unrebasableAnnotations = 0;
	const rebasedAnnotations = finalAnnotations.flatMap((annotation, index) => {
		const target = publicAnnotationTarget(annotation.target, turnIds, artifactIds);
		if (!target) {
			unrebasableAnnotations += 1;
			return [];
		}
		return [{ annotation, target, publicId: `annotation-${index + 1}` }];
	});
	const annotations: SharedTrajectoryAnnotation[] = rebasedAnnotations
		.slice(0, SHARED_TRAJECTORY_LIMITS.annotations)
		.map(({ annotation, target, publicId }) => ({
			id: publicId,
			target,
			targetKey: publicTargetKey(target),
			kind: annotation.kind,
			category: boundedPublicText(annotation.category, 256).text || "pedagogy",
			...(annotation.severity === undefined ? {} : { severity: annotation.severity }),
			note: boundedPublicText(annotation.note, SHARED_TRAJECTORY_LIMITS.annotationCharacters).text,
			...(annotation.pedagogicalImpact ? { pedagogicalImpact: boundedPublicText(annotation.pedagogicalImpact, SHARED_TRAJECTORY_LIMITS.annotationCharacters).text } : {}),
			...(annotation.suggestedAlternative ? { suggestedAlternative: boundedPublicText(annotation.suggestedAlternative, SHARED_TRAJECTORY_LIMITS.annotationCharacters).text } : {}),
			status: "final",
			createdAt: annotation.createdAt,
			updatedAt: annotation.updatedAt,
		}));

	const finalReview = reviewSnapshot?.review.status === "final" ? reviewSnapshot.review : null;
	return {
		schemaVersion: 1,
		turnCount: rawTurns.length,
		turns,
		artifactCount: publicArtifacts.length,
		artifacts,
		...(finalReview ? {
			review: {
				status: "final",
				verdict: finalReview.verdict,
				ratings: { ...finalReview.ratings },
				...(finalReview.overallRating === undefined ? {} : { overallRating: finalReview.overallRating }),
				...(finalReview.summary ? { summary: boundedPublicText(finalReview.summary, 16_384).text } : {}),
				createdAt: finalReview.createdAt,
				updatedAt: finalReview.updatedAt,
			},
		} : {}),
		annotationCount: finalAnnotations.length,
		annotations,
		omitted: {
			turns: Math.max(0, rawTurns.length - turns.length),
			artifacts: Math.max(0, publicArtifacts.length - artifacts.length),
			invalidArtifacts,
			internalArtifacts,
			privateArtifacts,
			uninspectedArtifacts,
			annotations: unrebasableAnnotations + Math.max(0, rebasedAnnotations.length - annotations.length),
			artifactContents: artifactContentsOmitted,
			artifactPreviews: artifactPreviewsOmitted,
		},
	};
}

function readShareIndex(): string[] {
	try {
		const raw = localStorage.getItem(SHARE_INDEX_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function writeShareIndex(ids: string[]) {
	localStorage.setItem(SHARE_INDEX_KEY, JSON.stringify(Array.from(new Set(ids))));
}

function sharedWireBytes(shared: SharedSession): number {
	return new TextEncoder().encode(JSON.stringify(minifySharedSession(shared))).length;
}

function annotationReferencesRemovedSource(annotation: SharedTrajectoryAnnotation, sourceId: string): boolean {
	const target = annotation.target;
	return ("turnId" in target && target.turnId === sourceId)
		|| ("artifactId" in target && target.artifactId === sourceId);
}

function fitSharedSessionToWireBudget(shared: SharedSession): SharedSession {
	if (!shared.trajectory) {
		if (sharedWireBytes(shared) > SHARE_MAX_BYTES) throw new Error("Shared session is too large");
		return shared;
	}
	const trajectory = JSON.parse(JSON.stringify(shared.trajectory)) as SharedTrajectory;
	const fitted: SharedSession = { ...shared, trajectory };
	while (sharedWireBytes(fitted) > SHARE_MAX_BYTES) {
		const previewArtifact = [...trajectory.artifacts].reverse().find((artifact) => artifact.preview);
		if (previewArtifact) {
			delete previewArtifact.preview;
			previewArtifact.previewOmitted = "media-budget";
			trajectory.omitted.artifactPreviews += 1;
			continue;
		}
		const contentArtifact = [...trajectory.artifacts].reverse().find((artifact) => artifact.content || artifact.secondaryContent);
		if (contentArtifact) {
			if (contentArtifact.content) {
				delete contentArtifact.content;
				delete contentArtifact.contentTruncated;
				contentArtifact.contentOmitted = "content-budget";
			}
			if (contentArtifact.secondaryContent) {
				delete contentArtifact.secondaryContent;
				delete contentArtifact.secondaryContentTruncated;
				contentArtifact.secondaryContentOmitted = "content-budget";
			}
			trajectory.omitted.artifactContents += 1;
			continue;
		}
		if (trajectory.annotations.length > 0) {
			trajectory.annotations.pop();
			trajectory.omitted.annotations += 1;
			continue;
		}
		if (trajectory.review?.summary) {
			delete trajectory.review.summary;
			continue;
		}
		if (trajectory.artifacts.length > 0) {
			const removed = trajectory.artifacts.pop()!;
			const retainedAnnotations = trajectory.annotations.filter((annotation) => !annotationReferencesRemovedSource(annotation, removed.id));
			trajectory.omitted.annotations += trajectory.annotations.length - retainedAnnotations.length;
			trajectory.annotations = retainedAnnotations;
			trajectory.omitted.artifacts += 1;
			continue;
		}
		if (trajectory.turns.length > 0) {
			const removed = trajectory.turns.pop()!;
			const retainedAnnotations = trajectory.annotations.filter((annotation) => !annotationReferencesRemovedSource(annotation, removed.id));
			trajectory.omitted.annotations += trajectory.annotations.length - retainedAnnotations.length;
			trajectory.annotations = retainedAnnotations;
			trajectory.omitted.turns += 1;
			continue;
		}
		throw new Error("Shared session transcript exceeds the 512 KiB public-share limit");
	}
	return fitted;
}

export function saveSharedSession(messages: AgentMessage[], createdAt: string, options: SaveSharedSessionOptions = {}): SharedSession {
	const sanitizedMessages = sanitizeMessagesForShare(messages);
	if (sanitizedMessages.length === 0) {
		throw new Error("There is no shareable text in this session yet");
	}

	const id = createSessionId();
	const shared: SharedSession = {
		id,
		schemaVersion: 3,
		title: sessionTitle(sanitizedMessages),
		createdAt,
		sharedAt: new Date().toISOString(),
		messageCount: sanitizedMessages.length,
		model: serializeModel(options.model),
		thinkingLevel: options.thinkingLevel ?? "medium",
		messages: sanitizedMessages,
		...(options.trajectory ? { trajectory: options.trajectory } : {}),
	};
	return fitSharedSessionToWireBudget(shared);
}

function cacheSharedSession(shared: SharedSession, required = false): boolean {
	try {
		const projected = minifySharedSession(shared);
		localStorage.setItem(`${SHARE_KEY_PREFIX}${shared.id}`, JSON.stringify(projected));
		writeShareIndex([shared.id, ...readShareIndex()]);
		return true;
	} catch (cause) {
		if (required) {
			throw new Error(`Could not store this local share: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
		console.warn("Could not cache shared session locally:", cause);
		return false;
	}
}

export function loadSharedSession(id: string): SharedSession | null {
	const raw = localStorage.getItem(`${SHARE_KEY_PREFIX}${id}`);
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as SharedSession;
		if (parsed?.id !== id) return null;
		return normalizeSharedSession(parsed);
	} catch {
		return null;
	}
}

export function listCachedSharedSessions(): SharedSession[] {
	return readShareIndex()
		.map((id) => loadSharedSession(id))
		.filter((session): session is SharedSession => Boolean(session));
}

function sharedSessionPath(id: string, origin: string) {
	const url = new URL(`/s/${encodeURIComponent(id)}`, origin);
	return url.toString();
}

async function publishSharedSession(shared: SharedSession): Promise<SharedSession> {
	// The server assigns its own compact share id and validates any client id
	// against /^[A-Za-z0-9_-]{8,32}$/. `shared.id` is a 36-char UUID from
	// createSessionId(), which fails that check and 400s. Drop it before upload
	// and let the server mint the id it returns.
	const { id: _localId, ...payload } = minifySharedSession(shared);
	const response = await fetch("/api/share", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`Share storage returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
	}
	const result = await response.json() as { id?: unknown };
	if (typeof result.id !== "string" || !result.id) throw new Error("Share storage did not return an id");
	return { ...shared, id: result.id };
}

export async function sharedSessionUrl(
	shared: SharedSession,
	origin: string,
	mode: ShareLinkMode = loadKeatingUiSettings().shareLinkMode,
): Promise<SharedSessionUrlResult> {
	if (mode === "local-short") {
		cacheSharedSession(shared, true);
		return { url: sharedSessionPath(shared.id, origin), mode, fallback: false, includesTrajectory: Boolean(shared.trajectory) };
	}

	if (mode === "compressed-hash") {
		const url = new URL(`/s/${encodeURIComponent(shared.id)}`, origin);
		url.hash = `${SHARE_HASH_PARAM}=${encodeSharedSession(shared)}`;
		cacheSharedSession(shared);
		return { url: url.toString(), mode, fallback: false, includesTrajectory: Boolean(shared.trajectory) };
	}

	try {
		const published = await publishSharedSession(shared);
		cacheSharedSession(published);
		return { url: sharedSessionPath(published.id, origin), mode, fallback: false, includesTrajectory: Boolean(published.trajectory) };
	} catch (error) {
		console.warn("Portable share storage failed:", error);
		throw new Error("Could not save the session to the share server. Try again, or switch Settings → Share Links to Compressed snapshot if you explicitly want a long self-contained link.");
	}
}

async function fetchSharedSessionResult(id: string): Promise<SharedSessionLoadResult> {
	try {
		const response = await fetch(`/api/share/${encodeURIComponent(id)}`);
		if (response.status === 404) {
			return { ok: false, reason: "not-found", status: response.status, message: "Shared session was not found on the share server." };
		}
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			return {
				ok: false,
				reason: "server-error",
				status: response.status,
				message: `Share server returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`,
			};
		}
		const shared = normalizeSharedSession(await response.json() as SharedSession);
		if (!shared) {
			return { ok: false, reason: "invalid-link", message: "Share server returned an invalid shared session payload." };
		}
		if (shared.id !== id) {
			return { ok: false, reason: "mismatch", message: "Share server returned a different session id than the link requested." };
		}
		cacheSharedSession(shared);
		return { ok: true, session: shared, source: "server" };
	} catch (error) {
		return {
			ok: false,
			reason: "network",
			message: error instanceof Error ? error.message : "Could not reach the share server.",
		};
	}
}

export async function loadSharedSessionResultFromUrl(id: string, hash: string): Promise<SharedSessionLoadResult> {
	const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
	const encoded = params.get(SHARE_HASH_PARAM);
	if (!encoded) {
		const cached = loadSharedSession(id);
		if (cached) return { ok: true, session: cached, source: "cache" };
		return await fetchSharedSessionResult(id);
	}

	const shared = decodeSharedSession(encoded);
	if (!shared) {
		const cached = loadSharedSession(id);
		if (cached) return { ok: true, session: cached, source: "cache" };
		return { ok: false, reason: "invalid-link", message: "This share link contains an unreadable session snapshot." };
	}
	if (shared.id !== id) {
		const cached = loadSharedSession(id);
		if (cached) return { ok: true, session: cached, source: "cache" };
		return { ok: false, reason: "mismatch", message: "This share link snapshot does not match the session id in the URL." };
	}
	cacheSharedSession(shared);
	return { ok: true, session: shared, source: "hash" };
}

export async function loadSharedSessionFromUrl(id: string, hash: string): Promise<SharedSession | null> {
	const result = await loadSharedSessionResultFromUrl(id, hash);
	return result.ok ? result.session : null;
}

export async function forkSharedSession(shared: SharedSession): Promise<string> {
	const id = createSessionId();
	const now = new Date().toISOString();
	const title = `${shared.title} (fork)`;
	const messages = sanitizeMessagesForShare(shared.messages);
	let model: Model<any> = DEFAULT_MODEL;
	if (shared.model) {
		try {
			const selectableModels = await getSelectableModels();
			model = selectableModels.find((candidate) => (
				candidate.provider === shared.model?.provider && candidate.id === shared.model.id
			)) ?? DEFAULT_MODEL;
		} catch {
			model = DEFAULT_MODEL;
		}
	}

	const metadata: SessionMetadata = {
		id,
		title,
		createdAt: now,
		lastModified: now,
		messageCount: messages.length,
		usage: sessionUsage(messages),
		thinkingLevel: shared.thinkingLevel ?? "medium",
		...sessionModelMetadata(model),
		preview: sessionPreview(messages),
		searchText: sessionSearchText(messages),
	};
	const data: SessionData = {
		id,
		title,
		model,
		thinkingLevel: shared.thinkingLevel ?? "medium",
		messages,
		createdAt: now,
		lastModified: now,
	};

	await sessions.save(data, metadata);
	return id;
}
