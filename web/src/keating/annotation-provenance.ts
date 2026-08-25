import type { AnnotationAuthorship, AuthoredAnnotationField, TrajectoryAnnotation } from "./trajectory-review";

/**
 * Provenance bookkeeping for annotation prose.
 *
 * A pass can draft a note's impact and alternative, and a teacher can accept that
 * draft with a single click. For the record that is a much weaker signal than prose
 * the teacher wrote or corrected, and the distinction is unrecoverable once the
 * annotation is saved — so it is tracked at the moment the text changes, not later.
 */

export type AuthoredFields = Partial<Record<AuthoredAnnotationField, string | undefined>>;
export type FieldAuthorship = Partial<Record<AuthoredAnnotationField, AnnotationAuthorship>>;

export const AUTHORED_FIELDS: readonly AuthoredAnnotationField[] = [
	"note",
	"pedagogicalImpact",
	"suggestedAlternative",
];

/** Marks every field the pass actually filled as model-drafted. */
export function markPassDrafted(current: FieldAuthorship | undefined, filled: AuthoredAnnotationField[]): FieldAuthorship {
	const next: FieldAuthorship = { ...current };
	for (const field of filled) next[field] = "pass-drafted";
	return next;
}

/**
 * Promotes a model-drafted field to `pass-edited` once the teacher changes its text.
 * Fields the teacher never touches keep their weaker provenance.
 */
export function reconcileFieldAuthorship(
	previous: AuthoredFields,
	next: AuthoredFields,
	current: FieldAuthorship | undefined,
): FieldAuthorship {
	const result: FieldAuthorship = { ...current };
	for (const field of AUTHORED_FIELDS) {
		const before = previous[field] ?? "";
		const after = next[field] ?? "";
		if (before === after) continue;
		const existing = result[field];
		if (existing === "pass-drafted" || existing === "pass-edited") {
			// The teacher has now rewritten prose a model produced. That correction is
			// the strongest training signal in the set, so it must not read as "human".
			result[field] = after.trim() ? "pass-edited" : undefined;
			continue;
		}
		result[field] = after.trim() ? "human" : undefined;
	}
	return result;
}

/**
 * Overall provenance for a record, derived from its fields. A note is only "human"
 * when no model prose survives in it anywhere.
 */
export function overallAuthorship(fields: FieldAuthorship | undefined): AnnotationAuthorship {
	if (!fields) return "human";
	const values = AUTHORED_FIELDS.map((field) => fields[field]).filter(Boolean);
	if (values.includes("pass-drafted")) return "pass-drafted";
	if (values.includes("pass-edited")) return "pass-edited";
	return "human";
}

/** Human-readable provenance, for the hovercard's corner label. */
export function authorshipLabel(annotation: Pick<TrajectoryAnnotation, "authorship">): string {
	switch (annotation.authorship) {
		case "human":
			return "human";
		case "pass-drafted":
			return "pass · accepted";
		case "pass-edited":
			return "pass · edited";
		default:
			return "unrecorded";
	}
}
