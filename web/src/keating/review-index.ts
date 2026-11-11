/**
 * The session-review queue: which sessions have been reviewed, how far along
 * each review is, and what to open next. Pure, so the ordering and counts the
 * page shows can be tested without a browser.
 */
import type { SessionMetadata } from "../types/session";
import type { AnnotationKind, ReviewRating, ReviewVerdict, TrajectoryAnnotation, TrajectoryReview } from "./trajectory-review";

export const REVIEW_FILTERS = ["all", "unreviewed", "draft", "final"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];
export const REVIEW_FILTER_LABELS: Record<ReviewFilter, string> = {
	all: "All",
	unreviewed: "Not reviewed",
	draft: "In progress",
	final: "Final",
};

export const REVIEW_SORTS = ["recent", "reviewed", "notes", "rating"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];
export const REVIEW_SORT_LABELS: Record<ReviewSort, string> = {
	recent: "Newest session",
	reviewed: "Recently reviewed",
	notes: "Most notes",
	rating: "Lowest rated first",
};

export type ReviewState = "unreviewed" | "draft" | "final";

export interface ReviewQueueRow {
	session: SessionMetadata;
	state: ReviewState;
	review?: TrajectoryReview;
	notes: Record<AnnotationKind, number>;
	noteCount: number;
	rating?: ReviewRating;
	verdict?: ReviewVerdict;
	reviewedAt?: number;
	sessionAt: number;
}

export interface ReviewQueueSummary {
	sessions: number;
	unreviewed: number;
	draft: number;
	final: number;
	notes: Record<AnnotationKind, number>;
	/** Mean overall rating across reviews that have one. */
	averageRating?: number;
}

const emptyNotes = (): Record<AnnotationKind, number> => ({ problem: 0, strength: 0, suggestion: 0 });

/** A review that records nothing yet is an opened page, not work in progress. */
function hasContent(review: TrajectoryReview, noteCount: number): boolean {
	return noteCount > 0 || review.overallRating !== undefined || Boolean(review.summary?.trim())
		|| review.verdict !== "undecided" || Object.keys(review.ratings ?? {}).length > 0;
}

export function buildReviewQueue(
	sessions: readonly SessionMetadata[],
	reviews: readonly TrajectoryReview[],
	annotationsByReview: ReadonlyMap<string, readonly TrajectoryAnnotation[]>,
): ReviewQueueRow[] {
	// A session can end up with more than one stored review; show the one touched last.
	const latest = new Map<string, TrajectoryReview>();
	for (const review of reviews) {
		const current = latest.get(review.sessionId);
		if (!current || review.updatedAt > current.updatedAt) latest.set(review.sessionId, review);
	}
	return sessions.map((session) => {
		const review = latest.get(session.id);
		const notes = emptyNotes();
		for (const annotation of review ? annotationsByReview.get(review.id) ?? [] : []) {
			if (annotation.kind in notes) notes[annotation.kind] += 1;
		}
		const noteCount = notes.problem + notes.strength + notes.suggestion;
		const state: ReviewState = !review ? "unreviewed"
			: review.status === "final" ? "final"
			: hasContent(review, noteCount) ? "draft" : "unreviewed";
		const parsed = Date.parse(session.lastModified);
		return {
			session, state, notes, noteCount,
			...(review ? { review, reviewedAt: review.updatedAt, verdict: review.verdict } : {}),
			...(review?.overallRating !== undefined ? { rating: review.overallRating } : {}),
			sessionAt: Number.isFinite(parsed) ? parsed : 0,
		};
	});
}

export function summarizeReviewQueue(rows: readonly ReviewQueueRow[]): ReviewQueueSummary {
	const notes = emptyNotes();
	let unreviewed = 0, draft = 0, final = 0, ratingTotal = 0, rated = 0;
	for (const row of rows) {
		if (row.state === "unreviewed") unreviewed += 1;
		else if (row.state === "draft") draft += 1;
		else final += 1;
		notes.problem += row.notes.problem; notes.strength += row.notes.strength; notes.suggestion += row.notes.suggestion;
		if (row.rating !== undefined) { ratingTotal += row.rating; rated += 1; }
	}
	return {
		sessions: rows.length, unreviewed, draft, final, notes,
		...(rated ? { averageRating: Math.round((ratingTotal / rated) * 10) / 10 } : {}),
	};
}

export function filterReviewQueue(rows: readonly ReviewQueueRow[], filter: ReviewFilter): ReviewQueueRow[] {
	return filter === "all" ? [...rows] : rows.filter((row) => row.state === filter);
}

export function sortReviewQueue(rows: readonly ReviewQueueRow[], sort: ReviewSort): ReviewQueueRow[] {
	const byRecent = (a: ReviewQueueRow, b: ReviewQueueRow) => b.sessionAt - a.sessionAt || a.session.id.localeCompare(b.session.id);
	const sorted = [...rows];
	switch (sort) {
		case "recent": return sorted.sort(byRecent);
		// Sessions never reviewed have no review date; they follow the reviewed ones.
		case "reviewed": return sorted.sort((a, b) => (b.reviewedAt ?? -1) - (a.reviewedAt ?? -1) || byRecent(a, b));
		case "notes": return sorted.sort((a, b) => b.noteCount - a.noteCount || byRecent(a, b));
		// Unrated sessions sort last: "lowest rated" should surface judged lessons, not unjudged ones.
		case "rating": return sorted.sort((a, b) => (a.rating ?? 99) - (b.rating ?? 99) || byRecent(a, b));
	}
}

/**
 * What to open next: finish the review touched most recently, otherwise start
 * the newest session that has a real exchange and no review.
 */
export function nextSessionToReview(rows: readonly ReviewQueueRow[]): ReviewQueueRow | undefined {
	const drafts = rows.filter((row) => row.state === "draft").sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0));
	if (drafts[0]) return drafts[0];
	return rows.filter((row) => row.state === "unreviewed" && row.session.messageCount >= 2).sort((a, b) => b.sessionAt - a.sessionAt)[0];
}

export function reviewStateLabel(row: ReviewQueueRow): string {
	return row.state === "final" ? "Final" : row.state === "draft" ? "In progress" : "Not reviewed";
}

const PREFS_KEY = "keating:review-index:v1";
type PrefsStorage = Pick<Storage, "getItem" | "setItem">;
function deviceStorage(): PrefsStorage | null {
	try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function loadReviewIndexPrefs(storage: PrefsStorage | null = deviceStorage()): { filter: ReviewFilter; sort: ReviewSort } {
	try {
		const raw = JSON.parse(storage?.getItem(PREFS_KEY) ?? "{}") as { filter?: unknown; sort?: unknown };
		return {
			filter: REVIEW_FILTERS.find((name) => name === raw.filter) ?? "all",
			sort: REVIEW_SORTS.find((name) => name === raw.sort) ?? "recent",
		};
	} catch {
		return { filter: "all", sort: "recent" };
	}
}

export function saveReviewIndexPrefs(prefs: { filter: ReviewFilter; sort: ReviewSort }, storage: PrefsStorage | null = deviceStorage()): void {
	try { storage?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* A remembered filter is a convenience only. */ }
}
