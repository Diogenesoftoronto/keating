/**
 * Shared wording for the review surface.
 *
 * Rubric names, rating words, and target descriptions are read in three
 * places — the desk, the AI proposals, and the shared read-only workspace — so
 * they live here rather than being retyped and drifting apart.
 */
import type {
	AnnotationKind,
	PedagogyRubricKey,
	ReviewRating,
	ReviewSeverity,
	ReviewVerdict,
	TrajectoryReviewTarget,
} from "../../keating/trajectory-review";

export const RUBRIC_LABELS: Record<PedagogyRubricKey, string> = {
	diagnosis: "Diagnosis",
	accuracy: "Accuracy",
	scaffolding: "Scaffolding",
	adaptation: "Adaptation",
	"learner-agency": "Learner agency",
	verification: "Verification",
};

/** One line on what each dimension is actually asking, shown on hover. */
export const RUBRIC_HINTS: Record<PedagogyRubricKey, string> = {
	diagnosis: "Did the tutor find out what the learner believes before correcting it?",
	accuracy: "Is everything asserted true, with uncertainty named?",
	scaffolding: "Is the difficulty sequenced so the learner can climb it?",
	adaptation: "Does the tutor change course when the learner stumbles or leaps ahead?",
	"learner-agency": "Does the learner do the thinking, or is the answer handed over?",
	verification: "Is understanding checked rather than assumed?",
};

export function ratingLabel(rating: ReviewRating): string {
	return rating === 1 ? "Poor" : rating === 2 ? "Weak" : rating === 3 ? "Adequate" : rating === 4 ? "Strong" : "Excellent";
}

export function severityLabel(severity: ReviewSeverity): string {
	return severity === 1 ? "Minor" : severity === 2 ? "Notable" : severity === 3 ? "Serious" : "Critical";
}

export function verdictLabel(verdict: ReviewVerdict): string {
	return verdict === "accepted" ? "Accepted" : verdict === "rejected" ? "Rejected" : verdict === "review" ? "Needs work" : "Undecided";
}

export function annotationKindLabel(kind: AnnotationKind): string {
	return kind === "problem" ? "Problem" : kind === "strength" ? "Strength" : "Suggestion";
}

/** Which margin-note colour a note carries. */
export function annotationKindTone(kind: AnnotationKind): "problem" | "strength" | "suggestion" {
	return kind;
}

/**
 * The theme token a kind paints with. Marks, gutter dots, spine dots, and hovercards
 * all key off this, so a note reads as the same colour wherever it surfaces.
 */
export function annotationKindColor(kind: AnnotationKind): string {
	return kind === "problem" ? "var(--destructive)" : kind === "strength" ? "var(--accent-green)" : "var(--amber)";
}

export function reviewTargetLabel(target: TrajectoryReviewTarget, mode: "compact" | "editor" = "compact"): string {
	if (target.kind === "session") return "Whole session";
	if (target.kind === "message") return mode === "editor" ? "Whole turn" : "Turn";
	if (target.kind === "message-span") return mode === "editor" ? "Selected turn text" : `“${target.anchor.quote}”`;
	if (target.kind === "event") return `Event ${target.sequence}`;
	if (target.kind === "artifact") return mode === "editor" ? `Whole ${target.artifact.artifactType}` : target.artifact.artifactType;
	if (target.kind === "artifact-span") return mode === "editor" ? `Selected ${target.artifact.artifactType} text` : `“${target.anchor.quote}”`;
	if (target.kind === "artifact-region") {
		return mode === "editor"
			? `${target.artifact.artifactType} region · ${Math.round(target.x * 100)}%, ${Math.round(target.y * 100)}%`
			: `${target.artifact.artifactType} region`;
	}
	return mode === "editor"
		? `${target.artifact.artifactType} · ${(target.startMs / 1_000).toFixed(1)}s to ${(target.endMs / 1_000).toFixed(1)}s`
		: `${target.artifact.artifactType} time range`;
}
