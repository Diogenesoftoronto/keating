import type { TrajectoryAnnotationDraft } from "../components/trajectory/types";
import { overallAuthorship, reconcileFieldAuthorship } from "./annotation-provenance";
import type { StoredModelReference, TrajectoryReview } from "./trajectory-review";

export interface ReviewWorkspaceUiState {
	sessionId?: string;
	activeSource: "message" | "artifact";
	activeTurnId?: string;
	activeArtifactId?: string;
	activeAnnotationId?: string;
	activeCandidateId?: string;
	activeModelPoolId?: string;
	activeTargetKey: string;
	annotationDraft: TrajectoryAnnotationDraft | null;
	reviewDraft: TrajectoryReview | null;
	reviewDraftRevision: number;
	reviewDirty: boolean;
	availableModels: StoredModelReference[];
	localError: string | null;
}

export type ReviewWorkspaceUiAction =
	| { type: "reset"; sessionId: string }
	| { type: "hydrate"; turnId?: string; turnTargetKey?: string; artifactId?: string; poolId?: string }
	| { type: "select-turn"; id: string; targetKey: string }
	| { type: "select-artifact"; id: string; targetKey: string }
	| { type: "open-annotation"; draft: TrajectoryAnnotationDraft; generationTargetKey: string; sourceId?: string; annotationId?: string }
	| { type: "change-annotation"; draft: TrajectoryAnnotationDraft }
	/** A pass filling the draft. Distinct from `change-annotation` so the pass's own
	 * writes are not mistaken for the teacher correcting them. */
	| { type: "expand-annotation"; draft: TrajectoryAnnotationDraft }
	| { type: "close-annotation" }
	| { type: "annotation-saved"; id: string }
	| { type: "annotation-deleted"; id: string }
	| { type: "select-candidate"; id?: string }
	| { type: "select-pool"; id?: string }
	| { type: "sync-review"; review: TrajectoryReview }
	| { type: "change-review"; review: TrajectoryReview }
	| { type: "review-saved"; review: TrajectoryReview; submittedRevision: number }
	| { type: "models-loaded"; models: StoredModelReference[] }
	| { type: "error"; message: string | null };

export const initialReviewWorkspaceUiState: ReviewWorkspaceUiState = {
	activeSource: "message",
	activeTargetKey: "session",
	annotationDraft: null,
	reviewDraft: null,
	reviewDraftRevision: 0,
	reviewDirty: false,
	availableModels: [],
	localError: null,
};

export function reviewWorkspaceUiReducer(
	state: ReviewWorkspaceUiState,
	action: ReviewWorkspaceUiAction,
): ReviewWorkspaceUiState {
	switch (action.type) {
		case "reset":
			return { ...initialReviewWorkspaceUiState, sessionId: action.sessionId };
		case "hydrate":
			return {
				...state,
				activeTurnId: state.activeTurnId ?? action.turnId,
				activeArtifactId: state.activeArtifactId ?? action.artifactId,
				activeModelPoolId: state.activeModelPoolId ?? action.poolId,
				activeTargetKey: state.activeTurnId ? state.activeTargetKey : action.turnTargetKey ?? state.activeTargetKey,
			};
		case "select-turn":
			return { ...state, activeSource: "message", activeTurnId: action.id, activeTargetKey: action.targetKey, activeAnnotationId: undefined, annotationDraft: null };
		case "select-artifact":
			return { ...state, activeSource: "artifact", activeArtifactId: action.id, activeTargetKey: action.targetKey, activeAnnotationId: undefined, annotationDraft: null };
		case "open-annotation": {
			const artifactSource = action.draft.target.kind.startsWith("artifact");
			return {
				...state,
				activeSource: artifactSource ? "artifact" : "message",
				activeTurnId: artifactSource ? state.activeTurnId : action.sourceId,
				activeArtifactId: artifactSource ? action.sourceId : state.activeArtifactId,
				activeTargetKey: action.generationTargetKey,
				activeAnnotationId: action.annotationId,
				annotationDraft: action.draft,
			};
		}
		case "expand-annotation":
			return { ...state, annotationDraft: action.draft };
		case "change-annotation": {
			const previous = state.annotationDraft;
			if (!previous) return { ...state, annotationDraft: action.draft };
			// Prose a pass drafted becomes `pass-edited` the moment the teacher rewrites
			// it. Tracked here rather than at save time, because by then the two states
			// are indistinguishable.
			const fieldAuthorship = reconcileFieldAuthorship(previous, action.draft, action.draft.fieldAuthorship);
			return {
				...state,
				annotationDraft: {
					...action.draft,
					fieldAuthorship,
					authorship: overallAuthorship(fieldAuthorship),
				},
			};
		}
		case "close-annotation":
			return { ...state, annotationDraft: null };
		case "annotation-saved":
			return { ...state, activeAnnotationId: action.id, annotationDraft: null };
		case "annotation-deleted":
			return state.activeAnnotationId === action.id
				? { ...state, activeAnnotationId: undefined, annotationDraft: null }
				: state;
		case "select-candidate":
			return { ...state, activeCandidateId: action.id };
		case "select-pool":
			return { ...state, activeModelPoolId: action.id };
		case "sync-review": {
			if (state.sessionId && state.sessionId !== action.review.sessionId) return state;
			if (!state.reviewDirty || !state.reviewDraft) {
				return { ...state, reviewDraft: action.review, reviewDirty: false };
			}
			return {
				...state,
				reviewDraft: {
					...action.review,
					status: state.reviewDraft.status,
					verdict: state.reviewDraft.verdict,
					ratings: state.reviewDraft.ratings,
					overallRating: state.reviewDraft.overallRating,
					summary: state.reviewDraft.summary,
					updatedAt: state.reviewDraft.updatedAt,
				},
			};
		}
		case "change-review":
			return {
				...state,
				reviewDraft: action.review,
				reviewDraftRevision: state.reviewDraftRevision + 1,
				reviewDirty: true,
			};
		case "review-saved":
			if (state.sessionId && state.sessionId !== action.review.sessionId) return state;
			if (state.reviewDraftRevision !== action.submittedRevision) return state;
			return { ...state, reviewDraft: action.review, reviewDirty: false };
		case "models-loaded":
			return { ...state, availableModels: action.models };
		case "error":
			return { ...state, localError: action.message };
	}
}
