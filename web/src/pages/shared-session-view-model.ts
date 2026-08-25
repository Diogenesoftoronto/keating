import type {
	NormalizedTrajectoryArtifact,
	SharedTrajectoryWorkspaceData,
	TrajectorySessionMessage,
} from "../components/trajectory";
import type {
	SharedSession,
	SharedTrajectoryAnnotationTarget,
	SharedTrajectoryArtifact,
} from "../keating/shared-sessions";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	contentFingerprint,
	reviewTargetKey,
	type ArtifactVersionReference,
	type TextAnchor,
	type TrajectoryAnnotation,
	type TrajectoryReviewTarget,
} from "../keating/trajectory-review";

function publicSessionId(session: SharedSession): string {
	return `shared:${session.id}`;
}

function artifactText(artifact: SharedTrajectoryArtifact): string | undefined {
	const parts = [artifact.content, artifact.secondaryContent]
		.filter((part): part is string => typeof part === "string" && part.length > 0);
	return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function artifactSummary(artifact: SharedTrajectoryArtifact): string | undefined {
	const details: string[] = [];
	if (artifact.topic) details.push(`Topic: ${artifact.topic}.`);
	if (artifact.contentTruncated || artifact.secondaryContentTruncated) {
		details.push("Some artifact text was shortened for this link.");
	}
	if (artifact.contentOmitted || artifact.secondaryContentOmitted) {
		details.push("Some artifact text was not included in this link.");
	}
	if (artifact.previewOmitted) {
		details.push("The artifact preview was not included in this link.");
	}
	return details.length > 0 ? details.join(" ") : undefined;
}

function publicArtifactFingerprint(artifact: SharedTrajectoryArtifact): string {
	return contentFingerprint([
		artifact.id,
		artifact.artifactType,
		artifact.format,
		artifact.content ?? "",
		artifact.secondaryContent ?? "",
		artifact.preview?.mimeType ?? "",
		artifact.preview?.dataUrl ?? "",
		artifact.preview?.naturalWidth ?? "",
		artifact.preview?.naturalHeight ?? "",
	].join("\u0000"));
}

function publicAssetHash(artifact: NormalizedTrajectoryArtifact): string {
	return `public-asset:${contentFingerprint(artifact.media?.kind === "image" ? artifact.media.src : artifact.reference.contentHash)}`;
}

function artifactReference(session: SharedSession, artifact: SharedTrajectoryArtifact): ArtifactVersionReference {
	return {
		source: {
			source: "session",
			sessionId: publicSessionId(session),
			id: artifact.id,
		},
		artifactType: artifact.artifactType,
		format: artifact.format,
		versionId: artifact.id,
		contentHash: `public:${publicArtifactFingerprint(artifact)}`,
		frozen: true,
		parentVersionId: artifact.parentArtifactId,
	};
}

function normalizedArtifact(session: SharedSession, artifact: SharedTrajectoryArtifact): NormalizedTrajectoryArtifact {
	const reference = artifactReference(session, artifact);
	const media = artifact.preview
		? {
			kind: "image" as const,
			src: artifact.preview.dataUrl,
			alt: artifact.preview.alt,
			assetHash: "",
			naturalWidth: artifact.preview.naturalWidth,
			naturalHeight: artifact.preview.naturalHeight,
		}
		: undefined;
	if (media) media.assetHash = `public-asset:${contentFingerprint(media.src)}`;
	return {
		id: artifact.id,
		title: artifact.label,
		reference,
		summary: artifactSummary(artifact),
		plainText: artifactText(artifact),
		media,
		createdAt: artifact.createdAt,
		status: "ready",
	};
}

function locateQuote(source: string, quote: string, prefix: string, suffix: string): number {
	if (!quote) return 0;
	let cursor = 0;
	let bestStart = -1;
	let bestScore = -1;
	while (cursor <= source.length - quote.length) {
		const start = source.indexOf(quote, cursor);
		if (start < 0) break;
		const end = start + quote.length;
		const actualPrefix = source.slice(Math.max(0, start - prefix.length), start);
		const actualSuffix = source.slice(end, end + suffix.length);
		const score = Number(actualPrefix.endsWith(prefix)) + Number(actualSuffix.startsWith(suffix));
		if (score > bestScore) {
			bestStart = start;
			bestScore = score;
		}
		cursor = start + Math.max(1, quote.length);
	}
	return bestStart;
}

function textAnchor(source: string, target: { quote: string; prefix: string; suffix: string }): TextAnchor | null {
	const start = locateQuote(source, target.quote, target.prefix, target.suffix);
	if (start < 0 || !target.quote) return null;
	return {
		start,
		end: start + target.quote.length,
		quote: target.quote,
		prefix: target.prefix,
		suffix: target.suffix,
		contentFingerprint: contentFingerprint(source),
	};
}

function validRegionTarget(
	target: Extract<SharedTrajectoryAnnotationTarget, { kind: "artifact-region" }>,
	artifact: NormalizedTrajectoryArtifact,
): boolean {
	const media = artifact.media;
	return media?.kind === "image"
		&& [target.x, target.y, target.width, target.height, target.naturalWidth, target.naturalHeight].every(Number.isFinite)
		&& target.x >= 0
		&& target.y >= 0
		&& target.width > 0
		&& target.height > 0
		&& target.x + target.width <= 1
		&& target.y + target.height <= 1
		&& target.naturalWidth === media.naturalWidth
		&& target.naturalHeight === media.naturalHeight;
}

function validTimeTarget(target: Extract<SharedTrajectoryAnnotationTarget, { kind: "artifact-time-range" }>): boolean {
	return [target.startMs, target.endMs].every(Number.isFinite)
		&& target.startMs >= 0
		&& target.endMs > target.startMs
		&& (target.durationMs === undefined
			|| (Number.isFinite(target.durationMs) && target.durationMs > 0 && target.endMs <= target.durationMs));
}

function annotationTarget(
	target: SharedTrajectoryAnnotationTarget,
	messages: ReadonlyMap<string, TrajectorySessionMessage>,
	artifacts: ReadonlyMap<string, NormalizedTrajectoryArtifact>,
): TrajectoryReviewTarget | null {
	switch (target.kind) {
		case "session":
			return { kind: "session" };
		case "message": {
			const message = messages.get(target.turnId);
			return message
				? {
					kind: "message",
					messageId: message.id,
					role: message.role,
					contentFingerprint: message.contentFingerprint,
				}
				: null;
		}
		case "message-span": {
			const message = messages.get(target.turnId);
			if (!message) return null;
			const anchor = textAnchor(message.text, target);
			return anchor
				? {
					kind: "message-span",
					messageId: message.id,
					role: message.role,
					anchor,
				}
				: {
					kind: "message",
					messageId: message.id,
					role: message.role,
					contentFingerprint: message.contentFingerprint,
				};
		}
		case "artifact": {
			const artifact = artifacts.get(target.artifactId);
			return artifact ? { kind: "artifact", artifact: artifact.reference } : null;
		}
		case "artifact-span": {
			const artifact = artifacts.get(target.artifactId);
			if (!artifact) return null;
			const anchor = textAnchor(artifact.plainText ?? "", target);
			return anchor
				? {
					kind: "artifact-span",
					artifact: artifact.reference,
					blockId: target.blockId,
					anchor,
				}
				: { kind: "artifact", artifact: artifact.reference };
		}
		case "artifact-region": {
			const artifact = artifacts.get(target.artifactId);
			if (!artifact) return null;
			return validRegionTarget(target, artifact)
				? {
					kind: "artifact-region",
					artifact: artifact.reference,
					assetHash: publicAssetHash(artifact),
					coordinateSpace: target.coordinateSpace,
					x: target.x,
					y: target.y,
					width: target.width,
					height: target.height,
					naturalWidth: target.naturalWidth,
					naturalHeight: target.naturalHeight,
				}
				: { kind: "artifact", artifact: artifact.reference };
		}
		case "artifact-time-range": {
			const artifact = artifacts.get(target.artifactId);
			if (!artifact) return null;
			return validTimeTarget(target)
				? {
					kind: "artifact-time-range",
					artifact: artifact.reference,
					mediaHash: `public-media:${artifact.reference.contentHash}`,
					timeBasis: target.timeBasis,
					startMs: target.startMs,
					endMs: target.endMs,
					durationMs: target.durationMs,
				}
				: { kind: "artifact", artifact: artifact.reference };
		}
	}
}

export function sharedSessionWorkspaceData(session: SharedSession): SharedTrajectoryWorkspaceData | null {
	const trajectory = session.trajectory;
	if (!trajectory) return null;
	if (trajectory.turns.length === 0 && trajectory.artifacts.length === 0) return null;
	const sessionId = publicSessionId(session);
	const messages: TrajectorySessionMessage[] = trajectory.turns.map((turn) => ({
		id: turn.id,
		role: turn.role,
		ordinal: turn.ordinal,
		text: turn.text,
		contentFingerprint: contentFingerprint(turn.text),
		label: turn.role === "assistant" ? "Keating" : "Learner",
		status: "complete",
	}));
	const artifacts = trajectory.artifacts.map((artifact) => normalizedArtifact(session, artifact));
	const messageById = new Map(messages.map((message) => [message.id, message]));
	const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
	const annotations: TrajectoryAnnotation[] = trajectory.annotations.flatMap((annotation) => {
		const target = annotationTarget(annotation.target, messageById, artifactById);
		if (!target) return [];
		return [{
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: annotation.id,
			reviewId: `shared-review:${session.id}`,
			sessionId,
			target,
			targetKey: reviewTargetKey(target),
			kind: annotation.kind,
			category: annotation.category,
			severity: annotation.severity,
			note: annotation.note,
			pedagogicalImpact: annotation.pedagogicalImpact,
			suggestedAlternative: annotation.suggestedAlternative,
			status: "final" as const,
			createdAt: annotation.createdAt,
			updatedAt: annotation.updatedAt,
		}];
	});
	const createdAt = Date.parse(session.createdAt);

	return {
		session: {
			id: sessionId,
			title: session.title,
			subtitle: `${messages.length} turn${messages.length === 1 ? "" : "s"} · ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}`,
			startedAt: Number.isFinite(createdAt) ? createdAt : undefined,
			learnerLabel: "Learner",
		},
		messages,
		artifacts,
		annotations,
		review: trajectory.review
			? {
				verdict: trajectory.review.verdict,
				ratings: trajectory.review.ratings,
				overallRating: trajectory.review.overallRating,
				summary: trajectory.review.summary,
			}
			: undefined,
	};
}

export interface SharedSessionOmissionNotice {
	hasOmissions: boolean;
	items: string[];
}

export function sharedSessionOmissionNotice(session: SharedSession): SharedSessionOmissionNotice {
	const omitted = session.trajectory?.omitted;
	if (!omitted) return { hasOmissions: false, items: [] };
	const items = [
		omitted.turns > 0 ? `${omitted.turns} turn${omitted.turns === 1 ? "" : "s"}` : null,
		omitted.artifacts > 0 ? `${omitted.artifacts} artifact${omitted.artifacts === 1 ? "" : "s"}` : null,
		omitted.annotations > 0 ? `${omitted.annotations} review note${omitted.annotations === 1 ? "" : "s"}` : null,
		omitted.artifactContents > 0 ? `${omitted.artifactContents} artifact text section${omitted.artifactContents === 1 ? "" : "s"}` : null,
		omitted.artifactPreviews > 0 ? `${omitted.artifactPreviews} artifact preview${omitted.artifactPreviews === 1 ? "" : "s"}` : null,
	].filter((item): item is string => Boolean(item));
	return { hasOmissions: items.length > 0, items };
}
