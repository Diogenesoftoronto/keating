import type { ReactNode } from "react";
import type { CritiqueProposal, ReviewPassKind, RubricSweepProposal } from "../../keating/trajectory-passes";
import type {
	ArtifactVersionReference,
	ReviewGenerationCandidate,
	ReviewModelPool,
	StoredModelReference,
	TextAnchor,
	TrajectoryAnnotation,
	TrajectoryReview,
	TrajectoryReviewTarget,
} from "../../keating/trajectory-review";

/** A stable, display-ready message. Callers normalize agent-specific message parts. */
export interface TrajectorySessionMessage {
	id: string;
	role: string;
	ordinal: number;
	text: string;
	/** Markdown source shown in the rendered review view. */
	markdown?: string;
	/** Original message source shown by the Raw toggle when rendered text is normalized. */
	rawSource?: string;
	/** Sanitized structured source for exact inspection. */
	raw?: string;
	tools?: Array<{
		kind: "call" | "result";
		name: string;
		callId?: string;
		status: "pending" | "succeeded" | "failed";
		input?: string;
		output?: string;
		details?: string;
		isError?: boolean;
	}>;
	contentFingerprint: string;
	timestamp?: number;
	label?: string;
	model?: string;
	durationMs?: number;
	status?: "complete" | "running" | "failed";
}

export type NormalizedArtifactMedia =
	| {
			kind: "image";
			src: string;
			alt: string;
			assetHash: string;
			naturalWidth: number;
			naturalHeight: number;
	  }
	| {
			kind: "video";
			src: string;
			title: string;
			mediaHash: string;
			durationMs: number;
			poster?: string;
	  };

/**
 * A safe artifact projection. Native image/video metadata enables intrinsic
 * region and media-time anchors. Arbitrary HTML is never accepted or parsed.
 */
export interface NormalizedTrajectoryArtifact {
	id: string;
	title: string;
	reference: ArtifactVersionReference;
	summary?: string;
	plainText?: string;
	media?: NormalizedArtifactMedia;
	renderContent?: ReactNode;
	createdAt?: number;
	status?: "ready" | "running" | "failed";
}

/**
 * What the selection toolbar decided about a highlighted span. `kind` is preset by
 * the button the teacher pressed, so the note that follows only has to answer why;
 * `intent: "rewrite"` opens the same draft seeded as a revision of the quote.
 */
export interface TrajectorySelectionIntent {
	kind?: TrajectoryAnnotation["kind"];
	intent?: "note" | "rewrite";
}

export type TrajectoryTextSelection =
	| ({
			source: "message";
			messageId: string;
			anchor: TextAnchor;
			target: TrajectoryReviewTarget;
	  } & TrajectorySelectionIntent)
	| ({
			source: "artifact";
			artifact: ArtifactVersionReference;
			blockId?: string;
			anchor: TextAnchor;
			target: TrajectoryReviewTarget;
	  } & TrajectorySelectionIntent);

export interface TrajectoryAnnotationDraft {
	id?: string;
	target: TrajectoryReviewTarget;
	targetKey: string;
	kind: TrajectoryAnnotation["kind"];
	category: string;
	severity?: TrajectoryAnnotation["severity"];
	note: string;
	pedagogicalImpact?: string;
	suggestedAlternative?: string;
	authorship?: TrajectoryAnnotation["authorship"];
	fieldAuthorship?: TrajectoryAnnotation["fieldAuthorship"];
	revision?: TrajectoryAnnotation["revision"];
	status: TrajectoryAnnotation["status"];
}

export interface TrajectorySessionSummary {
	id: string;
	title: string;
	subtitle?: string;
	startedAt?: number;
	learnerLabel?: string;
}

export interface TrajectoryBusyState {
	saving?: boolean;
	exporting?: boolean;
	generating?: boolean;
}

export interface TrajectoryReviewWorkspaceCallbacks {
	onSelectTurn: (messageId: string) => void;
	onSelectArtifact: (artifactId: string) => void;
	onTextSelection: (selection: TrajectoryTextSelection) => void;
	onReviewChange: (review: TrajectoryReview) => void;
	onStartAnnotation: (target: TrajectoryReviewTarget) => void;
	onAnnotationDraftChange: (draft: TrajectoryAnnotationDraft) => void;
	onSaveAnnotation: (draft: TrajectoryAnnotationDraft) => void;
	onCancelAnnotation: () => void;
	onEditAnnotation: (annotation: TrajectoryAnnotation) => void;
	onDeleteAnnotation: (annotationId: string) => void;
	onSelectCandidate: (candidateId: string) => void;
	onChooseCandidate: (candidateId: string) => void;
	onInsertCandidate: (candidateId: string) => void;
	onRegenerateCandidate: (candidateId: string) => void;
	onGenerateCandidates: (poolId: string, targetKey: string) => void;
	onSelectModelPool: (poolId: string) => void;
	onModelPoolChange: (pool: ReviewModelPool) => void;
	onAddModel: (poolId: string, model: StoredModelReference) => void;
	onRemoveModel: (poolId: string, model: StoredModelReference) => void;
	onCreateModelPool: () => void;
	onDeleteModelPool: (poolId: string) => void;
	onSave: () => void;
	onExport: () => void;
}

export interface TrajectoryReviewWorkspaceData {
	session: TrajectorySessionSummary;
	messages: TrajectorySessionMessage[];
	artifacts: NormalizedTrajectoryArtifact[];
	review: TrajectoryReview;
	annotations: TrajectoryAnnotation[];
	annotationDraft: TrajectoryAnnotationDraft | null;
	modelPools: ReviewModelPool[];
	availableModels: StoredModelReference[];
	candidates: ReviewGenerationCandidate[];
	activeTurnId?: string;
	activeArtifactId?: string;
	activeAnnotationId?: string;
	activeCandidateId?: string;
	activeModelPoolId?: string;
	activeTargetKey: string;
	reviewDirty?: boolean;
	busy?: TrajectoryBusyState;
	error?: string;
}

export type ArtifactRenderer = (artifact: NormalizedTrajectoryArtifact) => ReactNode;

/**
 * AI pass state handed to the desk.
 *
 * Optional throughout: the shared read-only workspace renders the same desk
 * without any pass affordances, and a review opened before a model is
 * configured still works as a plain marking-up surface.
 */
export interface TrajectoryPassState {
	running: ReviewPassKind | null;
	error: string | null;
	critique: CritiqueProposal[];
	rubric: RubricSweepProposal | null;
	/** Model and latency of the last completed pass, already formatted. */
	footnote?: string;
}

export interface TrajectoryPassCallbacks {
	onRunPass: (kind: ReviewPassKind) => void;
	onCancelPass: () => void;
	onDismissPassError: () => void;
	onAcceptProposal: (proposal: CritiqueProposal) => void;
	onDismissProposal: (proposalId: string) => void;
	onDismissAllProposals: () => void;
	onApplyRubric: (proposal: RubricSweepProposal) => void;
	onDismissRubric: () => void;
	onRevealProposal?: (proposal: CritiqueProposal) => void;
}
