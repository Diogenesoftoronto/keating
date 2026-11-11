import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { css, cx } from "../../styled-system/css";
import { eyebrow } from "../../styled-system/recipes";
import { useSessions } from "../hooks/use-sessions";
import { KeatingIcon } from "../components/KeatingIcon";
import { PatternDigestPanel } from "../components/trajectory/PatternDigestPanel";
import { reviewIcon } from "../components/trajectory/review-icons";
import { trajectoryReviewStore } from "../keating/trajectory-store";
import type { DigestSessionInput } from "../keating/trajectory-passes";
import type { ReviewModelPool, TrajectoryAnnotation, TrajectoryReview } from "../keating/trajectory-review";
import {
	REVIEW_FILTERS,
	REVIEW_FILTER_LABELS,
	REVIEW_SORTS,
	REVIEW_SORT_LABELS,
	buildReviewQueue,
	filterReviewQueue,
	loadReviewIndexPrefs,
	nextSessionToReview,
	reviewStateLabel,
	saveReviewIndexPrefs,
	sortReviewQueue,
	summarizeReviewQueue,
	type ReviewFilter,
	type ReviewSort,
} from "../keating/review-index";

const page = css({
	minHeight: "100dvh",
	background: "var(--paper)",
	color: "var(--ink)",
	paddingInline: { base: "1rem", md: "2rem" },
	paddingBlock: { base: "1rem", md: "1.5rem" },
});

export function TrajectoryReviewIndex() {
	const sessions = useSessions({ flatLimit: 100 });
	const [reviews, setReviews] = useState<TrajectoryReview[]>([]);
	const [annotationsByReview, setAnnotationsByReview] = useState<Map<string, TrajectoryAnnotation[]>>(new Map());
	const [pools, setPools] = useState<ReviewModelPool[]>([]);
	const [prefs, setPrefs] = useState(loadReviewIndexPrefs);
	const [reviewsError, setReviewsError] = useState(false);
	const choose = (next: Partial<{ filter: ReviewFilter; sort: ReviewSort }>) => setPrefs((current) => {
		const merged = { ...current, ...next };
		saveReviewIndexPrefs(merged);
		return merged;
	});

	useEffect(() => {
		let cancelled = false;
		const reload = async () => {
			const store = trajectoryReviewStore();
			// A failed read must not look like "nothing reviewed yet".
			const next = await store.listReviews().catch(() => { if (!cancelled) setReviewsError(true); return [] as TrajectoryReview[]; });
			if (cancelled) return;
			setReviews(next);

			// The digest reasons over notes, not just verdicts, so pull each
			// review's marginalia alongside it.
			const entries = await Promise.all(next.map(async (review) => [
				review.id,
				await store.listAnnotations(review.id).catch(() => [] as TrajectoryAnnotation[]),
			] as const));
			if (!cancelled) setAnnotationsByReview(new Map(entries));
		};
		void reload();
		void trajectoryReviewStore().listModelPools().then((next) => {
			if (!cancelled) setPools(next);
		}).catch(() => undefined);

		window.addEventListener("keating:trajectory-review-changed", reload);
		return () => {
			cancelled = true;
			window.removeEventListener("keating:trajectory-review-changed", reload);
		};
	}, []);

	const visibleSessions = sessions.flatResults ?? sessions.items;
	// Counts describe every local session; the list below narrows by search, filter and sort.
	const allRows = useMemo(() => buildReviewQueue(sessions.items, reviews, annotationsByReview), [sessions.items, reviews, annotationsByReview]);
	const summary = useMemo(() => summarizeReviewQueue(allRows), [allRows]);
	const next = useMemo(() => nextSessionToReview(allRows), [allRows]);
	const searchedRows = useMemo(() => buildReviewQueue(visibleSessions, reviews, annotationsByReview), [visibleSessions, reviews, annotationsByReview]);
	const rows = useMemo(() => sortReviewQueue(filterReviewQueue(searchedRows, prefs.filter), prefs.sort), [searchedRows, prefs]);
	const filterCounts: Record<ReviewFilter, number> = { all: summary.sessions, unreviewed: summary.unreviewed, draft: summary.draft, final: summary.final };

	const titleBySession = useMemo(
		() => new Map(sessions.items.map((session) => [session.id, session.title || "Untitled session"])),
		[sessions.items],
	);

	/** Only reviews with something recorded are worth reading for patterns. */
	const digestSessions = useMemo<DigestSessionInput[]>(
		() => reviews
			.filter((review) => {
				const notes = annotationsByReview.get(review.id) ?? [];
				return notes.length > 0 || review.overallRating !== undefined || Boolean(review.summary?.trim());
			})
			.map((review) => ({
				review,
				annotations: annotationsByReview.get(review.id) ?? [],
				title: titleBySession.get(review.sessionId),
			})),
		[annotationsByReview, reviews, titleBySession],
	);

	return (
		<main className={page}>
			<div className={css({ maxWidth: "72rem", marginInline: "auto" })}>
				<header className={css({ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", paddingBottom: "1.5rem", borderBottom: "1px solid var(--line)" })}>
					<div>
						<Link
							to="/chat"
							className={css({
								display: "inline-flex",
								alignItems: "center",
								gap: "0.4rem",
								minHeight: "2.25rem",
								color: "var(--ink-soft)",
								fontSize: "0.8125rem",
								transitionProperty: "color",
								transitionDuration: "{durations.base}",
								_hover: { color: "var(--ink)", "& .keating-duo-icon": { transform: "translateX(-3px)" } },
								_focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" },
							})}
						>
							<KeatingIcon icon={reviewIcon.back} size={15} /> Back to teaching
						</Link>
						<div className={css({ display: "flex", alignItems: "center", gap: "0.65rem", marginTop: "0.35rem" })}>
							<KeatingIcon icon={reviewIcon.annotate} size={24} className={css({ color: "var(--accent-dim)" })} />
							<h1 className={css({ fontFamily: "var(--mono-display)", fontSize: { base: "1.65rem", md: "2rem" }, fontWeight: 700, letterSpacing: "-0.02em" })}>
								Session reviews
							</h1>
						</div>
						<p className={css({ maxWidth: "42rem", marginTop: "0.5rem", color: "var(--ink-soft)", fontSize: "0.9rem", lineHeight: 1.6 })}>
							Read back how a lesson actually went, mark the exact line that earned praise or blame, and turn what you learn into training examples.
						</p>
					</div>
					<div className={css({ display: "inline-flex", maxWidth: "25rem", alignItems: "center", gap: "0.45rem", color: "var(--ink-soft)", fontSize: "0.75rem", lineHeight: 1.45, paddingTop: "0.5rem" })}>
						<KeatingIcon icon={reviewIcon.locked} size={14} />
						Reviews stay local; remote passes send redacted context to the selected provider.
					</div>
				</header>

				<section aria-labelledby="progress-heading" className={css({ marginTop: "1.5rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}", background: "var(--card)", padding: "1rem" })}>
					<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem" })}>
						<div className={css({ minWidth: 0 })}>
							<h2 id="progress-heading" className={cx(eyebrow(), css({ fontSize: "11px" }))}>Review progress</h2>
							<p className={css({ marginTop: "0.35rem", fontSize: "0.9rem", lineHeight: 1.55 })}>
								{summary.sessions === 0
									? "No sessions to review yet."
									: `${summary.final + summary.draft} of ${summary.sessions} sessions reviewed: ${summary.final} final, ${summary.draft} in progress.`}
							</p>
							{summary.sessions > 0 && (
								<p className={css({ marginTop: "0.25rem", color: "var(--ink-soft)", fontSize: "0.8125rem", lineHeight: 1.5 })}>
									{summary.notes.problem} problems, {summary.notes.strength} strengths and {summary.notes.suggestion} suggestions noted
									{summary.averageRating !== undefined ? ` · average rating ${summary.averageRating} of 5` : ""}.
								</p>
							)}
						</div>
						{next && (
							<Link
								to="/review/sessions/$sessionId"
								params={{ sessionId: next.session.id }}
								className={css({ display: "inline-flex", alignItems: "center", minHeight: "2.75rem", maxWidth: "100%", paddingInline: "1rem", border: "1.5px solid var(--ink)", borderRadius: "{radii.keating}", background: "var(--ink)", color: "var(--paper)", fontSize: "0.875rem", fontWeight: 650, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } })}
							>
								<span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
									{next.state === "draft" ? "Continue: " : "Review next: "}{next.session.title || "Untitled session"}
								</span>
							</Link>
						)}
					</div>
					{summary.sessions > 0 && (
						<div
							role="img"
							aria-label={`${summary.final} final, ${summary.draft} in progress, ${summary.unreviewed} not reviewed`}
							className={css({ display: "flex", height: "0.5rem", marginTop: "0.85rem", border: "1px solid var(--line)", borderRadius: "999px", overflow: "hidden", background: "var(--paper)" })}
						>
							<span style={{ width: `${(summary.final / summary.sessions) * 100}%` }} className={css({ background: "var(--ink)" })} />
							<span style={{ width: `${(summary.draft / summary.sessions) * 100}%` }} className={css({ background: "repeating-linear-gradient(45deg, var(--ink) 0 2px, transparent 2px 5px)" })} />
						</div>
					)}
				</section>

				<PatternDigestPanel
					sessions={digestSessions}
					pools={pools}
					titleForSession={(sessionId) => titleBySession.get(sessionId)}
					className={css({ marginTop: "1.5rem" })}
				/>

				<section aria-labelledby="sessions-heading" className={css({ paddingTop: "1.5rem" })}>
					<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.85rem", marginBottom: "0.9rem" })}>
						<div>
							<h2 id="sessions-heading" className={cx(eyebrow(), css({ fontSize: "11px" }))}>Choose a session</h2>
							<p className={css({ color: "var(--ink-soft)", fontSize: "0.75rem", marginTop: "0.25rem" })}>
								{summary.sessions} sessions on this device · {summary.final} final · {summary.draft} in progress · {summary.unreviewed} not reviewed
							</p>
						</div>
						<label className={css({ display: "flex", alignItems: "center", gap: "0.5rem", width: { base: "100%", sm: "18rem" }, height: "2.5rem", borderBottom: "1.5px solid var(--line)", transitionProperty: "border-color", transitionDuration: "{durations.base}", _focusWithin: { borderColor: "var(--accent-dim)" } })}>
							<KeatingIcon icon={reviewIcon.search} size={15} className={css({ color: "var(--ink-soft)" })} />
							<span className={css({ srOnly: true })}>Search sessions</span>
							<input
								value={sessions.query}
								onChange={(event) => sessions.setQuery(event.target.value)}
								placeholder="Search transcript or title"
								className={css({ flex: 1, minWidth: 0, background: "transparent", outline: "none", fontSize: "0.8125rem", color: "var(--ink)" })}
							/>
						</label>
					</div>

					<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.9rem" })}>
						<div role="group" aria-label="Filter by review status" className={css({ display: "flex", flexWrap: "wrap", gap: "0.4rem" })}>
							{REVIEW_FILTERS.map((filter) => (
								<button
									key={filter}
									type="button"
									aria-pressed={prefs.filter === filter}
									onClick={() => choose({ filter })}
									className={css({
										minHeight: "2.5rem", paddingInline: "0.8rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}",
										background: "var(--card)", color: "var(--ink)", fontSize: "0.8125rem", cursor: "pointer",
										"&[aria-pressed=true]": { background: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)", fontWeight: 650 },
										_focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" },
									})}
								>
									{REVIEW_FILTER_LABELS[filter]} <span className={css({ opacity: 0.75 })}>{filterCounts[filter]}</span>
								</button>
							))}
						</div>
						<label className={css({ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem", color: "var(--ink-soft)" })}>
							Sort
							<select
								value={prefs.sort}
								onChange={(event) => choose({ sort: event.target.value as ReviewSort })}
								className={css({ minHeight: "2.5rem", paddingInline: "0.6rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}", background: "var(--card)", color: "var(--ink)", fontSize: "0.8125rem", _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } })}
							>
								{REVIEW_SORTS.map((sort) => <option key={sort} value={sort}>{REVIEW_SORT_LABELS[sort]}</option>)}
							</select>
						</label>
					</div>

					{reviewsError && (
						<p role="alert" className={css({ marginBottom: "0.9rem", border: "1.5px solid var(--destructive)", borderRadius: "{radii.keating}", padding: "0.75rem 0.85rem", fontSize: "0.8125rem", lineHeight: 1.5 })}>
							Saved reviews could not be read on this device, so every session shows as not reviewed. Your reviews are not deleted; reload the page to try again.
						</p>
					)}

					{sessions.loading ? (
						<p role="status" className={css({ paddingBlock: "3rem", color: "var(--ink-soft)", fontSize: "0.875rem" })}>Loading sessions…</p>
					) : sessions.error ? (
						<p role="alert" className={css({ paddingBlock: "3rem", color: "var(--destructive)", fontSize: "0.875rem" })}>{sessions.error}</p>
					) : summary.sessions === 0 ? (
						<p className={css({ paddingBlock: "3rem", color: "var(--ink-soft)", fontSize: "0.875rem", lineHeight: 1.6 })}>
							There are no saved sessions on this device yet. <Link to="/chat" className={css({ textDecoration: "underline" })}>Teach a lesson</Link>, then come back to review it.
						</p>
					) : rows.length === 0 ? (
						<div className={css({ paddingBlock: "3rem", color: "var(--ink-soft)", fontSize: "0.875rem", lineHeight: 1.6 })}>
							<p role="status">
								{sessions.query.trim()
									? `No ${prefs.filter === "all" ? "" : `${REVIEW_FILTER_LABELS[prefs.filter].toLowerCase()} `}sessions match “${sessions.query.trim()}”.`
									: `No sessions are ${REVIEW_FILTER_LABELS[prefs.filter].toLowerCase()}.`}
							</p>
							<button
								type="button"
								onClick={() => { choose({ filter: "all" }); sessions.setQuery(""); }}
								className={css({ marginTop: "0.6rem", minHeight: "2.5rem", paddingInline: "0.8rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}", background: "var(--card)", color: "var(--ink)", cursor: "pointer", _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } })}
							>
								Show all sessions
							</button>
						</div>
					) : (
						<ul className={css({ listStyle: "none", display: "grid", gap: "0.4rem" })}>
							{rows.map((row) => {
								const { session } = row;
								const isFinal = row.state === "final";
								const reviewed = row.reviewedAt && row.state !== "unreviewed"
									? new Date(row.reviewedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
									: null;
								const detail = [
									`${session.messageCount} turns`,
									session.modelName ?? session.modelId ?? "Unknown model",
									...(row.noteCount ? [`${row.notes.problem} problems, ${row.notes.strength} strengths, ${row.notes.suggestion} suggestions`] : []),
									...(row.rating !== undefined ? [`rated ${row.rating} of 5`] : []),
									...(reviewed ? [`reviewed ${reviewed}`] : []),
								].join(" · ");
								return (
									<li key={session.id}>
										<Link
											to="/review/sessions/$sessionId"
											params={{ sessionId: session.id }}
											className={css({
												display: "grid",
												gridTemplateColumns: "minmax(0, 1fr) auto",
												alignItems: "center",
												gap: { base: "0.5rem", md: "1rem" },
												minHeight: "4.5rem",
												border: "1.5px solid var(--line)",
												borderRadius: "{radii.keating}",
												background: "var(--card)",
												paddingBlock: "0.75rem",
												paddingInline: "0.85rem",
												transitionProperty: "transform, box-shadow, border-color",
												transitionDuration: "{durations.base}",
												transitionTimingFunction: "{easings.standard}",
												_hover: {
													transform: "translate(-2px, -2px)",
													boxShadow: "4px 4px 0 var(--ink)",
													borderColor: "var(--ink)",
													"& .keating-duo-icon": { transform: "rotate(-6deg) scale(1.12)" },
												},
												_focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" },
											})}
										>
											<div className={css({ minWidth: 0 })}>
												<h3 className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 650, color: "var(--ink)" })}>
													{session.title || "Untitled session"}
												</h3>
												<p className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "0.3rem", color: "var(--ink-soft)", fontSize: "0.75rem" })}>
													{session.preview || "No transcript preview"}
												</p>
												<p className={css({ marginTop: "0.3rem", color: "var(--ink-soft)", fontSize: "0.75rem", lineHeight: 1.45 })}>{detail}</p>
											</div>
											<span className={css({ display: "inline-flex", alignItems: "center", justifySelf: "end", gap: "0.35rem", color: isFinal ? "var(--accent-dim)" : "var(--ink-soft)", fontSize: "0.75rem", fontWeight: 650, whiteSpace: "nowrap" })}>
												<KeatingIcon icon={isFinal ? reviewIcon.verdict : reviewIcon.annotate} size={14} active={isFinal} />
												{reviewStateLabel(row)}
											</span>
										</Link>
									</li>
								);
							})}
						</ul>
					)}
				</section>
			</div>
		</main>
	);
}
