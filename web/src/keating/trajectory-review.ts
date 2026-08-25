import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai/compat";

export const TRAJECTORY_REVIEW_SCHEMA_VERSION = 1 as const;

export const PEDAGOGY_RUBRIC_KEYS = [
	"diagnosis",
	"accuracy",
	"scaffolding",
	"adaptation",
	"learner-agency",
	"verification",
] as const;

export type PedagogyRubricKey = (typeof PEDAGOGY_RUBRIC_KEYS)[number];
export type ReviewRating = 1 | 2 | 3 | 4 | 5;
export type ReviewSeverity = 1 | 2 | 3 | 4;
export type ReviewVerdict = "undecided" | "accepted" | "review" | "rejected";
export type ReviewStatus = "draft" | "final";
export type AnnotationKind = "problem" | "strength" | "suggestion";

/**
 * Who actually produced a piece of annotation prose.
 *
 * This cannot be reconstructed after the fact, and it is the difference between
 * training on a teacher's judgement and training on our own output that a teacher
 * happened not to delete. Absent on records written before provenance tracking.
 */
export type AnnotationAuthorship = "human" | "pass-drafted" | "pass-edited";
export type AuthoredAnnotationField = "note" | "pedagogicalImpact" | "suggestedAlternative";
export type ArtifactReviewKind =
	| "plan"
	| "map"
	| "animation"
	| "verification"
	| "quiz"
	| "deck"
	| "benchmark"
	| "evolution"
	| "prompt-evolution"
	| "image"
	| "video"
	| "audio"
	| "document"
	| "openui"
	| "other";
export type ReviewGenerationTask = "response" | `artifact:${ArtifactReviewKind}`;

export type ArtifactSourceReference =
	| { source: "indexeddb"; store: string; id: string }
	| {
			source: "course";
			courseId: string;
			id: string;
			sourceId?: string;
			sourceSessionId?: string;
	  }
	| {
			source: "openui";
			sessionId: string;
			documentId: string;
			revision: number;
			nodeId?: string;
			resourceId?: string;
	  }
	| { source: "filesystem"; path: string }
	| { source: "session"; sessionId: string; id: string; messageId?: string };

export interface ArtifactVersionReference {
	source: ArtifactSourceReference;
	artifactType: ArtifactReviewKind;
	format: string;
	versionId: string;
	contentHash: string;
	frozen: boolean;
	parentVersionId?: string;
}

export interface TextAnchor {
	start: number;
	end: number;
	quote: string;
	prefix: string;
	suffix: string;
	contentFingerprint: string;
}

export type TrajectoryReviewTarget =
	| { kind: "session" }
	| {
			kind: "message";
			messageId: string;
			role: string;
			messageTimestamp?: number;
			contentFingerprint: string;
	  }
	| {
			kind: "message-span";
			messageId: string;
			role: string;
			messageTimestamp?: number;
			anchor: TextAnchor;
	  }
	| { kind: "event"; eventId: string; sequence: number; runId?: string }
	| {
			kind: "artifact";
			artifact: ArtifactVersionReference;
	  }
	| {
			kind: "artifact-span";
			artifact: ArtifactVersionReference;
			blockId?: string;
			anchor: TextAnchor;
	  }
	| {
			kind: "artifact-region";
			artifact: ArtifactVersionReference;
			assetHash: string;
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
			artifact: ArtifactVersionReference;
			mediaHash: string;
			timeBasis: "media-time" | "normalized-progress";
			startMs: number;
			endMs: number;
			durationMs?: number;
	  };

/**
 * A span rewrite recorded against the original rather than over it. The "before"
 * side of the contrast pair lives here; the "after" side is `suggestedAlternative`.
 */
export interface AnnotationRevision {
	/** Exact text this revision replaces, captured when the edit was committed. */
	original: string;
	/** Set once the revision has been accepted into a session, not merely proposed. */
	appliedAt?: number;
}

export interface TrajectoryAnnotation {
	schemaVersion: typeof TRAJECTORY_REVIEW_SCHEMA_VERSION;
	id: string;
	reviewId: string;
	sessionId: string;
	target: TrajectoryReviewTarget;
	targetKey: string;
	kind: AnnotationKind;
	category: string;
	severity?: ReviewSeverity;
	note: string;
	pedagogicalImpact?: string;
	suggestedAlternative?: string;
	/** Overall provenance. Absent means the record predates provenance tracking. */
	authorship?: AnnotationAuthorship;
	/** Per-field provenance, for notes where a pass filled in only part of the prose. */
	fieldAuthorship?: Partial<Record<AuthoredAnnotationField, AnnotationAuthorship>>;
	revision?: AnnotationRevision;
	status: ReviewStatus;
	createdAt: number;
	updatedAt: number;
}

export interface TrajectoryReview {
	schemaVersion: typeof TRAJECTORY_REVIEW_SCHEMA_VERSION;
	id: string;
	sessionId: string;
	status: ReviewStatus;
	verdict: ReviewVerdict;
	ratings: Partial<Record<PedagogyRubricKey, ReviewRating>>;
	overallRating?: ReviewRating;
	summary?: string;
	selectedCandidateIds: Record<string, string>;
	createdAt: number;
	updatedAt: number;
}

export interface ReviewArtifactSnapshot {
	schemaVersion: typeof TRAJECTORY_REVIEW_SCHEMA_VERSION;
	id: string;
	reviewId: string;
	sessionId: string;
	artifact: ArtifactVersionReference;
	label: string;
	topic?: string;
	content: string;
	secondaryContent?: string;
	media?: {
		kind: "image";
		dataUrl: string;
		alt: string;
		mimeType: string;
		assetHash: string;
		naturalWidth: number;
		naturalHeight: number;
	};
	metadata?: Record<string, unknown>;
	createdAt: number;
	capturedAt: number;
}

export interface StoredModelReference {
	provider: string;
	id: string;
	name: string;
	api: string;
	baseUrl: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
}

export interface ReviewModelPool {
	schemaVersion: typeof TRAJECTORY_REVIEW_SCHEMA_VERSION;
	id: string;
	name: string;
	tasks: ReviewGenerationTask[];
	models: StoredModelReference[];
	candidateCount: number;
	temperature: number;
	maxTokens: number;
	createdAt: number;
	updatedAt: number;
}

export type ReviewGenerationCostProvenance = "stream-usage" | "catalog-rates" | "local-zero" | "unknown";

/**
 * Generation-time copy of a pool. This must never be resolved by looking up the
 * mutable pool record again: pools can be edited or deleted after a candidate
 * has been produced.
 */
export interface ReviewGenerationPoolSnapshot {
	readonly schemaVersion: typeof TRAJECTORY_REVIEW_SCHEMA_VERSION;
	readonly id: string;
	readonly name: string;
	readonly tasks: readonly ReviewGenerationTask[];
	readonly models: readonly StoredModelReference[];
	readonly candidateCount: number;
	readonly temperature: number;
	readonly maxTokens: number;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface ReviewGenerationRunSnapshot {
	readonly id: string;
	readonly task: ReviewGenerationTask;
	/** Zero-based position in this generation run. */
	readonly candidateIndex: number;
	readonly requestedAt: number;
	readonly pool: ReviewGenerationPoolSnapshot;
	readonly requestedModel: StoredModelReference;
	readonly effectiveMaxTokens: number;
	readonly hostedWebSearch: false;
	readonly toolsEnabled: false;
}

export interface ReviewGenerationProvenance {
	/** Immutable request configuration captured before inference begins. */
	run: ReviewGenerationRunSnapshot;
	latencyMs: number;
	usageSource: "stream" | "unavailable";
	cost: {
		known: boolean;
		usd?: number;
		provenance: ReviewGenerationCostProvenance;
	};
	response?: {
		provider: string;
		model: string;
		responseModel?: string;
		responseId?: string;
		stopReason: string;
	};
}

export type ReviewCandidateTarget =
	| {
			kind: "response";
			messageId: string;
			messageTimestamp?: number;
			originalContent: string;
	  }
	| {
			kind: "artifact";
			artifact: ArtifactVersionReference;
			topic: string;
			originalContent: string;
	  };

export interface ReviewGenerationCandidate {
	schemaVersion: typeof TRAJECTORY_REVIEW_SCHEMA_VERSION;
	id: string;
	reviewId: string;
	sessionId: string;
	target: ReviewCandidateTarget;
	targetKey: string;
	poolId: string;
	model: StoredModelReference;
	prompt: string;
	annotationIds: string[];
	state: "queued" | "running" | "completed" | "failed" | "cancelled";
	content?: string;
	error?: string;
	preferred: boolean;
	insertedSessionId?: string;
	materializedArtifactId?: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
		costUsd?: number;
		latencyMs?: number;
	};
	/** Durable generation-time accounting and request/response provenance. */
	generation?: ReviewGenerationProvenance;
	createdAt: number;
	updatedAt: number;
}

export interface MessageReviewAnchor {
	id: string;
	role: string;
	ordinal: number;
	timestamp?: number;
	text: string;
	contentFingerprint: string;
}

export interface ReanchoredText {
	status: "exact" | "moved" | "stale";
	start: number;
	end: number;
}

export function createReviewId(sessionId: string): string {
	return `review:${sessionId}`;
}

export function createReviewRecord(sessionId: string, now = Date.now()): TrajectoryReview {
	return {
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		id: createReviewId(sessionId),
		sessionId,
		status: "draft",
		verdict: "undecided",
		ratings: {},
		selectedCandidateIds: {},
		createdAt: now,
		updatedAt: now,
	};
}

export function createReviewRecordId(prefix: string): string {
	const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `${prefix}:${id}`;
}

export function contentFingerprint(content: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < content.length; index += 1) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${content.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export async function sha256ContentHash(content: string): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw new Error("Cryptographic hashing is unavailable; frozen review artifacts cannot be created safely.");
	}
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `sha256:${hex}`;
}

export function artifactSourceKey(source: ArtifactSourceReference): string {
	switch (source.source) {
		case "indexeddb":
			return `indexeddb:${source.store}:${source.id}`;
		case "course":
			return `course:${source.courseId}:${source.id}`;
		case "openui":
			return `openui:${source.sessionId}:${source.documentId}:${source.revision}:${source.nodeId ?? "-"}:${source.resourceId ?? "-"}`;
		case "filesystem":
			return `filesystem:${source.path}`;
		case "session":
			return `session:${source.sessionId}:${source.id}:${source.messageId ?? "-"}`;
	}
}

export function artifactVersionKey(artifact: ArtifactVersionReference): string {
	return `${artifactSourceKey(artifact.source)}:${artifact.versionId}:${artifact.contentHash}`;
}

function textFromUnknown(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const candidate = part as {
				type?: unknown;
				text?: unknown;
				content?: unknown;
				name?: unknown;
			};
			if (typeof candidate.text === "string") return candidate.text;
			if (typeof candidate.content === "string") return candidate.content;
			if (candidate.type === "toolCall" && typeof candidate.name === "string") return `[Tool: ${candidate.name}]`;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

export function reviewMessageText(message: AgentMessage): string {
	return textFromUnknown((message as { content?: unknown }).content).trim();
}

export function messageReviewAnchor(sessionId: string, message: AgentMessage, ordinal: number): MessageReviewAnchor {
	const entry = message as { role?: unknown; timestamp?: unknown };
	const role = typeof entry.role === "string" ? entry.role : "unknown";
	const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : undefined;
	const text = reviewMessageText(message);
	const fingerprint = contentFingerprint(text);
	return {
		id: `message:${contentFingerprint(sessionId)}:${role}:${timestamp ?? "untimed"}:${ordinal}:${fingerprint}`,
		role,
		ordinal,
		timestamp,
		text,
		contentFingerprint: fingerprint,
	};
}

export function createTextAnchor(source: string, start: number, end: number, contextLength = 48): TextAnchor {
	const safeStart = Math.max(0, Math.min(source.length, Math.floor(start)));
	const safeEnd = Math.max(safeStart, Math.min(source.length, Math.floor(end)));
	return {
		start: safeStart,
		end: safeEnd,
		quote: source.slice(safeStart, safeEnd),
		prefix: source.slice(Math.max(0, safeStart - contextLength), safeStart),
		suffix: source.slice(safeEnd, Math.min(source.length, safeEnd + contextLength)),
		contentFingerprint: contentFingerprint(source),
	};
}

export function reanchorText(source: string, anchor: TextAnchor): ReanchoredText {
	if (
		contentFingerprint(source) === anchor.contentFingerprint &&
		source.slice(anchor.start, anchor.end) === anchor.quote
	) {
		return { status: "exact", start: anchor.start, end: anchor.end };
	}
	if (!anchor.quote) return { status: "stale", start: anchor.start, end: anchor.end };

	const matches: number[] = [];
	let cursor = 0;
	while (cursor <= source.length - anchor.quote.length) {
		const found = source.indexOf(anchor.quote, cursor);
		if (found < 0) break;
		matches.push(found);
		cursor = found + Math.max(1, anchor.quote.length);
	}
	if (matches.length === 0) return { status: "stale", start: anchor.start, end: anchor.end };

	const ranked = matches
		.map((start) => {
			const end = start + anchor.quote.length;
			const prefix = source.slice(Math.max(0, start - anchor.prefix.length), start);
			const suffix = source.slice(end, end + anchor.suffix.length);
			const contextScore = Number(prefix.endsWith(anchor.prefix)) + Number(suffix.startsWith(anchor.suffix));
			return {
				start,
				end,
				contextScore,
				distance: Math.abs(start - anchor.start),
			};
		})
		.sort((left, right) => right.contextScore - left.contextScore || left.distance - right.distance);
	const best = ranked[0];
	return { status: "moved", start: best.start, end: best.end };
}

/**
 * The shape every review surface reduces to: what was looked at, what was worse,
 * what was better, why, and who decided. Annotations, hand revisions, and chosen
 * candidates are all instances of this — which is what makes the review data
 * usable for learning rather than just for the record.
 */
export interface ContrastRecord {
	id: string;
	sessionId: string;
	targetKey: string;
	source: "annotation" | "revision" | "candidate";
	/** Text the judgement is anchored to. */
	context: string;
	/** The rejected side, when the record carries one. */
	worse?: string;
	/** The preferred side, when the record carries one. */
	better?: string;
	why: string;
	kind: AnnotationKind;
	severity?: ReviewSeverity;
	authorship: AnnotationAuthorship | "unknown";
	createdAt: number;
}

export function annotationAuthorship(annotation: TrajectoryAnnotation): AnnotationAuthorship | "unknown" {
	return annotation.authorship ?? "unknown";
}

/** True when the annotation carries a rewrite of the span it is anchored to. */
export function isRevisionAnnotation(annotation: TrajectoryAnnotation): boolean {
	return Boolean(annotation.revision && annotation.suggestedAlternative);
}

/** Text the annotation is anchored to, for spans that captured a quote. */
export function annotationQuote(annotation: TrajectoryAnnotation): string {
	const target = annotation.target;
	if (target.kind === "message-span" || target.kind === "artifact-span") return target.anchor.quote;
	return "";
}

export function contrastRecordFromAnnotation(annotation: TrajectoryAnnotation): ContrastRecord {
	const quote = annotationQuote(annotation);
	const better = annotation.suggestedAlternative;
	const worse = annotation.revision?.original ?? (better ? quote : undefined);
	return {
		id: annotation.id,
		sessionId: annotation.sessionId,
		targetKey: annotation.targetKey,
		source: annotation.revision ? "revision" : "annotation",
		context: quote,
		worse,
		better,
		why: annotation.note,
		kind: annotation.kind,
		severity: annotation.severity,
		authorship: annotationAuthorship(annotation),
		createdAt: annotation.createdAt,
	};
}

export function reviewTargetKey(target: TrajectoryReviewTarget | ReviewCandidateTarget): string {
	switch (target.kind) {
		case "session":
			return "session";
		case "message":
			return `message:${target.messageId}`;
		case "message-span":
			return `message:${target.messageId}:span:${target.anchor.start}-${target.anchor.end}`;
		case "event":
			return `event:${target.eventId}`;
		case "artifact":
			return `artifact:${artifactVersionKey(target.artifact)}`;
		case "artifact-span":
			return `artifact:${artifactVersionKey(target.artifact)}:span:${target.blockId ?? "-"}:${target.anchor.start}-${target.anchor.end}`;
		case "artifact-region":
			return `artifact:${artifactVersionKey(target.artifact)}:region:${target.assetHash}:${target.x.toFixed(4)}:${target.y.toFixed(4)}:${target.width.toFixed(4)}:${target.height.toFixed(4)}`;
		case "artifact-time-range":
			return `artifact:${artifactVersionKey(target.artifact)}:time:${target.mediaHash}:${target.timeBasis}:${target.startMs}-${target.endMs}`;
		case "response":
			return `message:${target.messageId}`;
	}
}

function credentialFreeBaseUrl(value: string | undefined): string {
	if (!value) return "";
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/$/, value.endsWith("/") ? "/" : "");
	} catch {
		return value.split(/[?#]/, 1)[0].replace(/\/\/[^/@\s]+@/, "//");
	}
}

export function storedModelReference(model: Model<Api>): StoredModelReference {
	return {
		provider: model.provider,
		id: model.id,
		name: model.name,
		api: String(model.api),
		baseUrl: credentialFreeBaseUrl(model.baseUrl),
		reasoning: Boolean(model.reasoning),
		input: (model.input ?? ["text"]).filter(
			(value): value is "text" | "image" => value === "text" || value === "image",
		),
		cost: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			cacheRead: model.cost?.cacheRead ?? 0,
			cacheWrite: model.cost?.cacheWrite ?? 0,
		},
		contextWindow: model.contextWindow ?? 0,
		maxTokens: model.maxTokens ?? 0,
	};
}

export function modelFromStoredReference(reference: StoredModelReference): Model<Api> {
	return {
		provider: reference.provider,
		id: reference.id,
		name: reference.name,
		api: reference.api as Api,
		baseUrl: reference.baseUrl,
		reasoning: reference.reasoning,
		input: reference.input,
		cost: reference.cost,
		contextWindow: reference.contextWindow,
		maxTokens: reference.maxTokens,
	};
}

export function defaultReviewModelPools(model: Model<Api>, now = Date.now()): ReviewModelPool[] {
	const reference = storedModelReference(model);
	const definitions: Array<{
		id: string;
		name: string;
		tasks: ReviewGenerationTask[];
	}> = [
		{ id: "tutor-responses", name: "Tutor responses", tasks: ["response"] },
		{
			id: "lesson-artifacts",
			name: "Lesson artifacts",
			tasks: ["artifact:plan", "artifact:quiz", "artifact:verification"],
		},
		{
			id: "visual-explanations",
			name: "Visual explanations",
			tasks: ["artifact:map", "artifact:animation"],
		},
	];
	return definitions.map((definition) => ({
		schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
		...definition,
		models: [reference],
		candidateCount: 3,
		temperature: 0.7,
		maxTokens: 2_048,
		createdAt: now,
		updatedAt: now,
	}));
}

export function estimatePoolCostUsd(pool: ReviewModelPool, promptCharacters: number): number {
	if (pool.models.length === 0) return 0;
	const inputTokens = Math.ceil(Math.max(0, promptCharacters) / 4);
	let estimate = 0;
	for (let index = 0; index < pool.candidateCount; index += 1) {
		const model = pool.models[index % pool.models.length];
		estimate += (inputTokens * model.cost.input + pool.maxTokens * model.cost.output) / 1_000_000;
	}
	return estimate;
}
