import { Link } from "@tanstack/react-router";
import { css, cx } from "../../../styled-system/css";
import { eyebrow, marginNote, reviewCard } from "../../../styled-system/recipes";
import { useReviewPasses } from "../../hooks/use-review-passes";
import type { DigestSessionInput } from "../../keating/trajectory-passes";
import type { ReviewModelPool } from "../../keating/trajectory-review";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import { RUBRIC_LABELS } from "./review-vocabulary";
import { compactButtonClass, metaTextClass } from "./styles";

export interface PatternDigestPanelProps {
	sessions: DigestSessionInput[];
	pools: ReviewModelPool[];
	/** Resolves a session id to a human title for the citation chips. */
	titleForSession?: (sessionId: string) => string | undefined;
	className?: string;
}

/**
 * Cross-session pattern digest.
 *
 * A single review tells a teacher what happened once. This reads every review
 * they have finished and names the habits that keep recurring — which is the
 * only thing on this page that could not be worked out by opening a session
 * and looking. It stays collapsed and silent until asked.
 */
export function PatternDigestPanel({ sessions, pools, titleForSession, className }: PatternDigestPanelProps) {
	const passes = useReviewPasses("keating:pattern-digest", [], []);
	const pool = pools[0];
	const ready = sessions.length >= 2 && Boolean(pool);
	const running = passes.running === "pattern-digest";

	return (
		<section
			aria-labelledby="pattern-digest-heading"
			className={cx(
				css({
					border: "1.5px solid var(--ink)",
					borderRadius: "{radii.keating}",
					background: "var(--card)",
					boxShadow: "3px 3px 0 var(--ink)",
					padding: "1rem",
				}),
				className,
			)}
		>
			<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" })}>
				<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.6rem", minWidth: 0 })}>
					<KeatingIcon icon={reviewIcon.digest} size={20} className={css({ marginTop: "0.1rem", color: "var(--accent-dim)" })} />
					<div className={css({ minWidth: 0 })}>
						<h2 id="pattern-digest-heading" className={css({ fontFamily: "var(--mono-display)", fontSize: "0.95rem", fontWeight: 700, color: "var(--ink)" })}>
							Across your reviews
						</h2>
						<p className={cx(metaTextClass, css({ marginTop: "0.2rem", maxWidth: "44rem" }))}>
							{sessions.length < 2
								? "Finish two reviews and Keating can start naming the habits that recur across them."
								: `Reads all ${sessions.length} finished reviews and names the teaching habits that keep coming back.`}
						</p>
					</div>
				</div>

				<button
					type="button"
					className={compactButtonClass}
					disabled={!ready || running}
					title={!pool ? "Configure a model pool first." : sessions.length < 2 ? "Two finished reviews are needed." : undefined}
					onClick={() => (running ? passes.cancel() : pool && void passes.runPatternDigest(pool, sessions))}
				>
					<KeatingIcon icon={running ? reviewIcon.retry : reviewIcon.digest} size={13} active={running} />
					{running ? "Reading…" : passes.digest ? "Read again" : "Find patterns"}
				</button>
			</div>

			{passes.error ? (
				<p role="alert" className={css({ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--destructive)" })}>{passes.error}</p>
			) : null}

			{passes.digest && passes.digest.entries.length > 0 ? (
				<div className={css({ marginTop: "0.9rem" })}>
					<ul className={css({ display: "grid", gap: "0.5rem" })}>
						{passes.digest.entries.map((entry) => (
							<li key={entry.id} className={marginNote({ state: "proposed" })}>
								<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" })}>
									<strong className={css({ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink)" })}>{entry.pattern}</strong>
									<span className={cx(eyebrow(), css({ fontSize: "10px" }))}>
										{entry.rubricKey ? `${RUBRIC_LABELS[entry.rubricKey]} · ` : ""}
										{entry.occurrences} session{entry.occurrences === 1 ? "" : "s"}
									</span>
								</div>
								<p className={css({ marginTop: "0.25rem", fontSize: "0.75rem", lineHeight: 1.5, color: "var(--ink-soft)" })}>{entry.detail}</p>

								{entry.sessionIds.length > 0 ? (
									<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.4rem" })}>
										{entry.sessionIds.map((sessionId) => (
											<Link
												key={sessionId}
												to="/review/sessions/$sessionId"
												params={{ sessionId }}
												className={css({
													display: "inline-flex",
													alignItems: "center",
													gap: "0.25rem",
													borderRadius: "9999px",
													border: "1px solid var(--line)",
													paddingInline: "0.45rem",
													paddingBlock: "0.1rem",
													fontSize: "0.65rem",
													color: "var(--ink-soft)",
													maxWidth: "16rem",
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
													transitionProperty: "background-color, color, border-color",
													transitionDuration: "{durations.base}",
													_hover: { background: "var(--accent)", color: "var(--accent-foreground)", borderColor: "var(--accent-dim)" },
													_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
												})}
											>
												<KeatingIcon icon={reviewIcon.page} size={10} />
												{titleForSession?.(sessionId) ?? sessionId}
											</Link>
										))}
									</div>
								) : null}
							</li>
						))}
					</ul>

					{passes.digest.throughLine ? (
						<p className={cx(reviewCard({ flat: true }), css({ marginTop: "0.6rem", fontSize: "0.8rem", lineHeight: 1.55, color: "var(--ink)" }))}>
							<span className={cx(eyebrow(), css({ display: "block", fontSize: "10px", marginBottom: "0.2rem" }))}>Work on this next</span>
							{passes.digest.throughLine}
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}
