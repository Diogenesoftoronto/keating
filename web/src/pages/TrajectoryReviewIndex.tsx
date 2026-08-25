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

	useEffect(() => {
		let cancelled = false;
		const reload = async () => {
			const store = trajectoryReviewStore();
			const next = await store.listReviews().catch(() => []);
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

	const reviewBySession = useMemo(
		() => new Map(reviews.map((review) => [review.sessionId, review])),
		[reviews],
	);
	const visibleSessions = sessions.flatResults ?? sessions.items;

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
								_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
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
							<p className={css({ color: "var(--ink-soft)", fontSize: "0.75rem", marginTop: "0.25rem" })}>{sessions.items.length} locally available sessions</p>
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

					{sessions.loading ? (
						<p role="status" className={css({ paddingBlock: "3rem", color: "var(--ink-soft)", fontSize: "0.875rem" })}>Loading sessions…</p>
					) : sessions.error ? (
						<p role="alert" className={css({ paddingBlock: "3rem", color: "var(--destructive)", fontSize: "0.875rem" })}>{sessions.error}</p>
					) : visibleSessions.length === 0 ? (
						<p className={css({ paddingBlock: "3rem", color: "var(--ink-soft)", fontSize: "0.875rem" })}>No matching sessions.</p>
					) : (
						<ul className={css({ listStyle: "none", display: "grid", gap: "0.4rem" })}>
							{visibleSessions.map((session) => {
								const review = reviewBySession.get(session.id);
								const isFinal = review?.status === "final";
								return (
									<li key={session.id}>
										<Link
											to="/review/sessions/$sessionId"
											params={{ sessionId: session.id }}
											className={css({
												display: "grid",
												gridTemplateColumns: { base: "1fr auto", md: "minmax(0, 1fr) 9rem 10rem auto" },
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
												_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
											})}
										>
											<div className={css({ minWidth: 0 })}>
												<h3 className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 650, color: "var(--ink)" })}>
													{session.title || "Untitled session"}
												</h3>
												<p className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "0.3rem", color: "var(--ink-soft)", fontSize: "0.75rem" })}>
													{session.preview || "No transcript preview"}
												</p>
											</div>
											<span className={css({ display: { base: "none", md: "block" }, color: "var(--ink-soft)", fontSize: "0.75rem" })}>{session.messageCount} turns</span>
											<span className={css({ display: { base: "none", md: "block" }, color: "var(--ink-soft)", fontSize: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
												{session.modelName ?? session.modelId ?? "Unknown model"}
											</span>
											<span className={css({ display: "inline-flex", alignItems: "center", justifySelf: "end", gap: "0.35rem", color: isFinal ? "var(--accent-dim)" : "var(--ink-soft)", fontSize: "0.75rem", fontWeight: 650 })}>
												<KeatingIcon icon={isFinal ? reviewIcon.verdict : reviewIcon.annotate} size={14} active={isFinal} />
												{review ? (isFinal ? "Final" : "Draft") : "Review"}
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
