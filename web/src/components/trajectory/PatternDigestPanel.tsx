import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Button, Card, Loading } from "../../design-system/kit";
import { KeatingGlyph } from "../../design-system/glyphs";
import { SOFT, useMotionAllowed } from "../../design-system/motion";
import { useReviewPasses } from "../../hooks/use-review-passes";
import type { DigestSessionInput } from "../../keating/trajectory-passes";
import type { ReviewModelPool } from "../../keating/trajectory-review";
import { RUBRIC_LABELS } from "./review-vocabulary";

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

	const motionAllowed = useMotionAllowed();
	const compact = sessions.length < 2 && !running && !passes.error && !passes.digest;
	const helper = sessions.length < 2
		? "Finish two reviews and Keating can start naming the habits that recur across them."
		: `Reads all ${sessions.length} finished reviews and names the teaching habits that keep coming back.`;

	if (compact) return <aside data-glyph-host aria-label="Across your reviews" className="rv-pattern-hint"><KeatingGlyph name="pattern" />{helper}</aside>;

	return (
		<motion.aside aria-labelledby="pattern-digest-heading" className={["rv-index-digest", className].filter(Boolean).join(" ")}
			initial={motionAllowed ? { y: 8 } : false} animate={{ y: 0 }} transition={motionAllowed ? SOFT : { duration: 0 }}>
			<Card tone="hard">
				<h2 className="k-halftone" data-glyph-host id="pattern-digest-heading"><KeatingGlyph name="pattern" size={18}/>Across your reviews</h2>
				<p className="rv-index-digest-helper">{helper}</p>
				{passes.error && <p role="alert" className="rv-index-error">{passes.error}</p>}
				{passes.digest && passes.digest.entries.length > 0 && <>
					<ul>{passes.digest.entries.map(entry => <li key={entry.id}>
						<strong>{entry.pattern}</strong>
						<small>{entry.rubricKey && RUBRIC_LABELS[entry.rubricKey] + " · "}{entry.occurrences} session{entry.occurrences === 1 ? "" : "s"}</small>
						<p>{entry.detail}</p>
						{entry.sessionIds.length > 0 && <div className="rv-index-citations">{entry.sessionIds.map(sessionId =>
							<Link key={sessionId} to="/review/sessions/$sessionId" params={{sessionId}}><KeatingGlyph name="book" size={12}/>{titleForSession?.(sessionId) ?? sessionId}</Link>)}</div>}
					</li>)}</ul>
					{passes.digest.throughLine && <div className="rv-index-throughline"><strong>Work on this next</strong><p>{passes.digest.throughLine}</p></div>}
				</>}
				<Button size="sm" glyph={passes.digest || running ? "refresh" : "pattern"}
					disabled={!ready && !running} title={!pool && !running ? "Configure a model pool first." : undefined}
					onClick={() => { if (running) passes.cancel(); else if (pool) void passes.runPatternDigest(pool, sessions); }}>
					{running ? <Loading size="inline" label="Reading… Stop" /> : passes.digest ? "Read again" : "Find patterns"}
				</Button>
			</Card>
		</motion.aside>
	);
}
