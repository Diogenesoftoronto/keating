/** Unique id for one quiz run, stable across the run and regenerated on retake. */
export function createQuizResultId(slug: string): string {
	const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);
	return `${slug || "quiz"}-${Date.now()}-${suffix}`;
}
