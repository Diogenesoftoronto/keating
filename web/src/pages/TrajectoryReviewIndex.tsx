import { StackBar } from "../design-system/charts";
import { animate } from "motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { AppBar, Button, Chip, EmptyState, Loading, SearchField } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { Select } from "../components/Select";
import { EASE, useMotionAllowed } from "../design-system/motion";
import "../components/trajectory/review.css";
import { useSessions } from "../hooks/use-sessions";
import { PatternDigestPanel } from "../components/trajectory/PatternDigestPanel";
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

const privacy = "Reviews stay local; remote passes send redacted context to the selected provider.";

function localReviewDate(date: Date) {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	const day = date.toDateString();
	if (day === today.toDateString() || day === yesterday.toDateString()) {
		return (day === today.toDateString() ? "Today" : "Yesterday") + ", " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
	}
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ReviewedTotal({ value }: { value: number }) {
	const number = useRef<HTMLSpanElement>(null);
	const allowed = useMotionAllowed();
	useEffect(() => {
		const node = number.current;
		if (!allowed || !node || !value) return;
		const controls = animate(0, value, { duration: .46, ease: EASE, onUpdate: n => { node.textContent = String(Math.round(n)); } });
		return () => { controls.stop(); node.textContent = String(value); };
	}, [value, allowed]);
	return <span ref={number}>{value}</span>;
}

function NoteTally({ notes, compact = false }: { notes: Record<TrajectoryAnnotation["kind"], number>; compact?: boolean }) {
	return <span className="rv-index-tally">
		{(["problem", "strength", "suggestion"] as const).map(kind => {
			const label = `${kind}${notes[kind] === 1 ? "" : "s"}`;
			return <span key={kind} title={`${notes[kind]} ${label}`}>
				<i aria-hidden="true" className={`rv-index-kind rv-index-${kind}`} />
				{notes[kind]}<span className={compact ? "k-sr" : undefined}> {label}</span>
			</span>;
		})}
	</span>;
}

export function TrajectoryReviewIndex() {
	const motionAllowed = useMotionAllowed();
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
		<main className="rv-index">
			<AppBar className="rv-index-header k-halftone" back={{ to: "/chat", label: "Back to teaching" }} menu={false}
				title={<span data-glyph-host role="heading" aria-level={1}><KeatingGlyph name="pen" size={21} /> Session reviews</span>}>
				<Chip data-glyph-host title={privacy} aria-description={privacy}><KeatingGlyph name="lock" size={12}/> Reviews stay on this device</Chip>
			</AppBar>
			<p className="rv-index-intro">Read back how a lesson actually went, mark the exact line that earned praise or blame, and turn what you learn into training examples.</p>
			<section aria-label="Review progress" className="rv-index-progress">
				{summary.sessions === 0 ? <p>No sessions to review yet.</p> : <>
					<div><strong><ReviewedTotal value={summary.final + summary.draft}/> of {summary.sessions}</strong><small>sessions reviewed</small></div>
					<div>
						<StackBar label={`${summary.final} final, ${summary.draft} in progress, ${summary.unreviewed} not reviewed`}
							data={[{ label: "Final", value: summary.final, tone: "ink" }, { label: "In progress", value: summary.draft, tone: "ink", pattern: true }, { label: "Not reviewed", value: summary.unreviewed, tone: "rest" }]} />
					</div>
					<div><NoteTally notes={summary.notes} />{summary.averageRating !== undefined && <small>average rating {summary.averageRating} of 5</small>}</div>
					{next && <Link className="rv-index-next k-lift" to="/review/sessions/$sessionId" params={{ sessionId: next.session.id }}>
						{next.state === "draft" ? "Continue: " : "Review next: "}{next.session.title || "Untitled session"}
					</Link>}
				</>}
			</section>
			<div className="rv-index-body" data-side={digestSessions.length >= 2}>
				<section aria-label="Choose a session" className="rv-index-queue">
					<div className="rv-index-filters">
						<div role="group" aria-label="Filter by review status">
							{REVIEW_FILTERS.map(filter => <Chip as="button" key={filter} selected={filter === prefs.filter}
								count={filterCounts[filter]} onClick={() => choose({ filter })}>{REVIEW_FILTER_LABELS[filter]}</Chip>)}
						</div>
						<SearchField data-glyph-host className="rv-index-find" value={sessions.query} onChange={sessions.setQuery} label="Search sessions" placeholder="Search transcript or title" />
						<Select className="rv-index-sort" aria-label="Sort" value={prefs.sort} onValueChange={sort => choose({ sort: sort as ReviewSort })}>
							{REVIEW_SORTS.map(sort => <option key={sort} value={sort}>{REVIEW_SORT_LABELS[sort]}</option>)}
						</Select>
					</div>
					{reviewsError && <p role="alert" className="rv-index-error">Saved reviews could not be read on this device, so every session shows as not reviewed. Your reviews are not deleted; reload the page to try again.</p>}
					{sessions.loading ? <Loading label="Loading sessions…" />
						: sessions.error ? <p role="alert" className="rv-index-error">{sessions.error}</p>
						: summary.sessions === 0 ? <EmptyState className="rv-index-state" glyph="book" heading="There are no saved sessions on this device yet."><Link to="/chat">Teach a lesson</Link>, then come back to review it.</EmptyState>
						: rows.length === 0 ? <EmptyState heading={<span role="status">{sessions.query.trim()
								? `No ${prefs.filter === "all" ? "" : `${REVIEW_FILTER_LABELS[prefs.filter].toLowerCase()} `}sessions match “${sessions.query.trim()}”.`
								: `No sessions are ${REVIEW_FILTER_LABELS[prefs.filter].toLowerCase()}.`}</span>} actions={<Button size="sm" onClick={() => { choose({ filter: "all" }); sessions.setQuery(""); }}>Show all sessions</Button>} />
						: <ul className="rv-index-list">{rows.map((row, index) => {
							const { session } = row;
							const reviewed = row.state !== "unreviewed" && row.reviewedAt !== undefined;
							const timestamp = reviewed ? row.reviewedAt : row.sessionAt;
							const date = timestamp ? new Date(timestamp) : null;
							return <motion.li key={session.id} initial={motionAllowed ? { y: 7 } : false}
								animate={{ y: 0 }} transition={{ duration: motionAllowed ? .32 : 0, ease: EASE, delay: motionAllowed ? Math.min(index, 8) * .045 : 0 }}>
								<Link to="/review/sessions/$sessionId" params={{ sessionId: session.id }} className="rv-index-row" data-next={next?.session.id === session.id}>
									<i aria-hidden="true" className="rv-index-status" data-state={row.state} />
									<div className="rv-index-title"><h3>{session.title || "Untitled session"}</h3><p>{session.preview || "No transcript preview"}</p></div>
									<div className="rv-index-meta"><span>{session.messageCount} turns · {session.modelName ?? session.modelId ?? "Unknown model"}</span>
										{date && <time dateTime={date.toISOString()}>{reviewed ? "Reviewed " : ""}{localReviewDate(date)}</time>}</div>
									<div className="rv-index-notes">{row.noteCount ? <NoteTally compact notes={row.notes} /> : "no notes"}</div>
									<span className="rv-index-stateword">{reviewStateLabel(row)}{row.rating !== undefined && <small>rated {row.rating} of 5</small>}</span>
								</Link>
							</motion.li>;
						})}</ul>}
				</section>
				<PatternDigestPanel sessions={digestSessions} pools={pools} titleForSession={sessionId => titleBySession.get(sessionId)} />
			</div>
		</main>
	);
}
