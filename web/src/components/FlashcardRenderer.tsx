import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Bookmark,
	Check,
	ChevronLeft,
	ChevronRight,
	Flame,
	Lightbulb,
	Sparkles,
	Star,
	Volume2,
	VolumeX,
} from "lucide-react";
import {
	applyReview,
	formatInterval,
	formatDueIn,
	getDeckStats,
	initialSrsState,
	type Flashcard,
	type FlashcardDeck,
	type SrsRating,
} from "../keating/srs";
import type { FlashcardSrsState } from "../keating/storage";
import { KeatingStorage } from "../keating/storage";
import { useKeatingUiSettings } from "../hooks/use-ui-settings";
import { useCardGestures } from "./flashcards/useCardGestures";
import {
	fireCompletionConfetti,
	isStreakMilestone,
	nextStreak,
	playReviewSound,
	prefersReducedMotion,
	ratingSound,
} from "./flashcards/review-feedback";

const storage = new KeatingStorage();

const BOOKMARK_KEY = "keating:card-bookmarks";

function loadBookmarkIds(): Set<string> {
	try {
		const raw = localStorage.getItem(BOOKMARK_KEY);
		if (!raw) return new Set();
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((s): s is string => typeof s === "string"));
	} catch {
		return new Set();
	}
}

function saveBookmarkIds(ids: Set<string>) {
	try {
		localStorage.setItem(BOOKMARK_KEY, JSON.stringify([...ids]));
	} catch {
		/* ignore */
	}
}

export interface FlashcardReviewResult {
	cardId: string;
	rating: SrsRating;
	appliedIntervalDays: number;
	easeAfter: number;
}

export interface FlashcardRendererProps {
	deck: FlashcardDeck;
	/** Restrict review to a specific subset of card ids (e.g. only the due cards). */
	restrictToCardIds?: string[];
	/** Called whenever a card is reviewed. */
	onReview?: (result: FlashcardReviewResult) => void;
	/** Called when the learner finishes the queue (or runs out of cards). */
	onComplete?: (summary: { reviewed: number; lapses: number }) => void;
	/** Show card bookmark toggle and stats header. */
	showMeta?: boolean;
	/**
	 * Focus the card on mount so keyboard review works immediately. Enable in
	 * dedicated surfaces (artifact viewer); leave off inline in chat where
	 * stealing focus would scroll-jack the conversation.
	 */
	autoFocusKeyboard?: boolean;
}

interface ReviewEventDetail {
	deckId: string;
	cardId: string;
	rating: SrsRating;
	appliedIntervalDays: number;
	easeAfter: number;
}

function dispatchCardReviewed(detail: ReviewEventDetail) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent("keating:card-reviewed", { detail }));
}

const RATING_META: Record<SrsRating, { label: string; badgeClass: string; exitClass: string }> = {
	0: {
		label: "Again",
		badgeClass: "border-destructive/60 bg-destructive/15 text-destructive",
		exitClass: "flashcard-exit-left",
	},
	1: {
		label: "Hard",
		badgeClass: "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300",
		exitClass: "flashcard-exit-down",
	},
	2: {
		label: "Good",
		badgeClass: "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
		exitClass: "flashcard-exit-right",
	},
	3: {
		label: "Easy",
		badgeClass: "border-sky-500/60 bg-sky-500/15 text-sky-700 dark:text-sky-300",
		exitClass: "flashcard-exit-up",
	},
};

function RatingButton({
	rating,
	label,
	subLabel,
	intervalDays,
	color,
	disabled,
	onClick,
}: {
	rating: SrsRating;
	label: string;
	subLabel: string;
	intervalDays: number;
	color: string;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			data-rating={rating}
			className={`dialog-compact-button flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-3 py-2 text-xs font-medium transition-colors ${color} ${disabled ? "cursor-not-allowed opacity-50" : "hover:brightness-110"}`}
		>
			<span className="text-sm font-bold">{label}</span>
			<span className="font-terminal text-[10px] opacity-80">{subLabel}</span>
			<span className="font-terminal text-[10px] opacity-80">{formatInterval(intervalDays)}</span>
		</button>
	);
}

export function FlashcardRenderer({
	deck,
	restrictToCardIds,
	onReview,
	onComplete,
	showMeta = true,
	autoFocusKeyboard = false,
}: FlashcardRendererProps) {
	const [revealed, setRevealed] = useState(false);
	const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(() => loadBookmarkIds());
	const [reviewedCount, setReviewedCount] = useState(0);
	const [lapseCount, setLapseCount] = useState(0);
	const [bump, setBump] = useState(0);
	const [streak, setStreak] = useState(0);
	const [streakPopKey, setStreakPopKey] = useState(0);
	const [exiting, setExiting] = useState<{ rating: SrsRating; viaSwipe: boolean } | null>(null);
	const [keyboardHint, setKeyboardHint] = useState(false);
	const completeDispatchedRef = useRef(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const [settings, updateSettings] = useKeatingUiSettings();
	const soundOn = settings.flashcardSoundEnabled;

	const queue = useMemo(() => {
		const ids = restrictToCardIds ? new Set(restrictToCardIds) : null;
		return deck.cards
			.filter((c) => (ids ? ids.has(c.id) : true))
			.map((c) => ({ ...c, srs: { ...c.srs } }));
	}, [deck.cards, restrictToCardIds]);

	const [cards, setCards] = useState<Flashcard[]>(queue);
	const [index, setIndex] = useState(0);

	// If the deck changes (e.g. async load), reset the queue.
	useEffect(() => {
		setCards(queue);
		setIndex(0);
		setRevealed(false);
		setReviewedCount(0);
		setLapseCount(0);
		setStreak(0);
		setExiting(null);
		completeDispatchedRef.current = false;
	}, [queue]);

	useEffect(() => {
		if (autoFocusKeyboard) containerRef.current?.focus({ preventScroll: true });
	}, [autoFocusKeyboard]);

	const current = cards[index];
	const stats = useMemo(() => getDeckStats(deck, Date.now()), [deck, bump]);
	const finished = !current;

	const toggleBookmark = useCallback((cardId: string) => {
		setBookmarkIds((prev) => {
			const next = new Set(prev);
			if (next.has(cardId)) next.delete(cardId);
			else next.add(cardId);
			saveBookmarkIds(next);
			return next;
		});
	}, []);

	const toggleReveal = useCallback(() => {
		setRevealed((r) => {
			if (!r) playReviewSound("flip", soundOn);
			return !r;
		});
	}, [soundOn]);

	/** Persist the review and advance. Runs after the exit animation. */
	const commitRate = useCallback(
		async (rating: SrsRating) => {
			if (!current) return;
			const outcome = applyReview(current.srs, rating, Date.now());
			const nextSrs: FlashcardSrsState = {
				...current.srs,
				...outcome.next,
			};
			setCards((prev) => prev.map((c, i) => (i === index ? { ...c, srs: nextSrs } : c)));
			setReviewedCount((c) => c + 1);
			if (outcome.isLapse) setLapseCount((c) => c + 1);
			setBump((b) => b + 1);
			setStreak((s) => {
				const next = nextStreak(s, rating);
				if (next > s) setStreakPopKey((k) => k + 1);
				return next;
			});

			const result: FlashcardReviewResult = {
				cardId: current.id,
				rating,
				appliedIntervalDays: outcome.appliedIntervalDays,
				easeAfter: nextSrs.ease,
			};
			onReview?.(result);
			dispatchCardReviewed({
				deckId: deck.id,
				cardId: current.id,
				rating,
				appliedIntervalDays: outcome.appliedIntervalDays,
				easeAfter: nextSrs.ease,
			});

			// Persist updated card SRS state to storage.
			try {
				await storage.updateDeckCardSrs(deck.id, current.id, nextSrs);
				await storage.recordCardReview({
					deckId: deck.id,
					cardId: current.id,
					topic: deck.topic,
					slug: deck.slug,
					rating,
					appliedIntervalDays: outcome.appliedIntervalDays,
					easeAfter: nextSrs.ease,
				});
			} catch {
				/* storage failure should not block the review flow */
			}

			setRevealed(false);
			setExiting(null);
			setIndex((i) => i + 1);
			// Keep focus on the container so rapid keyboard review flows.
			containerRef.current?.focus({ preventScroll: true });
		},
		[current, index, deck.id, deck.topic, deck.slug, onReview],
	);

	/** Kick off a grade: play feedback, run the exit animation, then commit. */
	const handleRate = useCallback(
		(rating: SrsRating, viaSwipe = false) => {
			if (!current || exiting) return;
			playReviewSound(ratingSound(rating), soundOn);
			if (prefersReducedMotion()) {
				void commitRate(rating);
				return;
			}
			setExiting({ rating, viaSwipe });
		},
		[current, exiting, soundOn, commitRate],
	);

	const { drag, handlers: gestureHandlers } = useCardGestures({
		enabled: revealed && !exiting,
		onGrade: (rating) => handleRate(rating, true),
		onTap: toggleReveal,
	});

	useEffect(() => {
		if (finished && !completeDispatchedRef.current) {
			completeDispatchedRef.current = true;
			if (reviewedCount > 0) {
				playReviewSound("complete", soundOn);
				void fireCompletionConfetti();
			}
			onComplete?.({ reviewed: reviewedCount, lapses: lapseCount });
		}
	}, [finished, reviewedCount, lapseCount, onComplete, soundOn]);

	const goTo = useCallback(
		(delta: number) => {
			setIndex((i) => Math.max(0, Math.min(cards.length, i + delta)));
			setRevealed(false);
		},
		[cards.length],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			// Let buttons keep their native key behavior.
			if ((e.target as HTMLElement).closest("button")) return;
			if (!current || exiting) return;
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				toggleReveal();
				return;
			}
			if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
				e.preventDefault();
				handleRate((Number(e.key) - 1) as SrsRating);
				return;
			}
			if (e.key === "ArrowLeft") {
				e.preventDefault();
				goTo(-1);
				return;
			}
			if (e.key === "ArrowRight") {
				e.preventDefault();
				goTo(1);
			}
		},
		[current, exiting, revealed, toggleReveal, handleRate, goTo],
	);

	if (finished) {
		return (
			<div className="rounded-xl border-2 border-border bg-background p-5 my-3 shadow-sm space-y-3 text-center">
				<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
					<Check size={22} />
				</div>
				<h3 className="text-base font-bold">Session complete</h3>
				<p className="text-xs text-muted-foreground">
					{reviewedCount} card{reviewedCount === 1 ? "" : "s"} reviewed
					{lapseCount > 0 ? `, ${lapseCount} lapse${lapseCount === 1 ? "" : "s"}` : ""}.
				</p>
				{streak >= 2 && (
					<p className="flex items-center justify-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
						<Flame size={14} />
						Finished on a {streak}-card streak
					</p>
				)}
				<div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
					<Sparkles size={14} className="text-amber-500" />
					<span>Next reviews are scheduled automatically.</span>
				</div>
			</div>
		);
	}

	const nextIntervals = computeNextIntervals(current.srs);
	const previewMeta = drag.previewGrade !== null ? RATING_META[drag.previewGrade] : null;
	const exitClass = exiting
		? exiting.viaSwipe
			? RATING_META[exiting.rating].exitClass
			: "flashcard-exit-fade"
		: "";

	// While dragging, the inline transform drives the card; it must retain the
	// flip rotation or the front face pops back into view mid-drag.
	const dragStyle: React.CSSProperties | undefined = drag.dragging
		? {
				transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx * 0.04}deg)${revealed ? " rotateY(180deg)" : ""}`,
			}
		: undefined;

	return (
		<div
			ref={containerRef}
			tabIndex={0}
			role="group"
			aria-label={`Flashcard review: ${deck.title}`}
			onKeyDown={handleKeyDown}
			onFocus={() => setKeyboardHint(true)}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node)) setKeyboardHint(false);
			}}
			className="rounded-xl border-2 border-border bg-background p-4 sm:p-5 my-3 shadow-sm space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
		>
			{showMeta && (
				<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
					<div className="min-w-0">
						<h3 className="text-sm font-bold text-foreground truncate">{deck.title}</h3>
						<p className="font-terminal text-[11px]">
							{deck.cards.length} CARDS // {stats.dueNow} DUE NOW // avg ease {averageEase(deck).toFixed(2)}
						</p>
					</div>
					<div className="flex items-center gap-2">
						{streak >= 2 && (
							<span
								key={streakPopKey}
								className={`flashcard-streak-pop inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 font-terminal text-[11px] font-bold text-amber-600 dark:text-amber-400 ${isStreakMilestone(streak) ? "flashcard-milestone-pulse" : ""}`}
								title={`${streak} consecutive Good/Easy recalls`}
							>
								<Flame size={11} />
								{streak}
							</span>
						)}
						<button
							type="button"
							onClick={() => updateSettings({ flashcardSoundEnabled: !soundOn })}
							className="dialog-icon-button inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							aria-label={soundOn ? "Mute flashcard sounds" : "Enable flashcard sounds"}
							title={soundOn ? "Sounds on" : "Sounds off"}
						>
							{soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
						</button>
						<span className="font-terminal tabular-nums text-[11px]">
							{index + 1}/{cards.length}
						</span>
					</div>
				</div>
			)}

			<div className="flashcard-stage relative">
				<div
					key={current.id}
					{...gestureHandlers}
					style={dragStyle}
					className={`flashcard-3d cursor-pointer select-none ${revealed ? "flashcard-flipped" : ""} ${drag.dragging ? "flashcard-dragging" : ""} ${exitClass || "flashcard-enter"}`}
					onAnimationEnd={(e) => {
						if (exiting && e.animationName.startsWith("flashcard-exit")) {
							void commitRate(exiting.rating);
						}
					}}
				>
					<div className="flashcard-face relative w-full rounded-lg border border-border bg-muted/30 p-5 text-left">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground font-terminal">
							Front
						</div>
						<div className="mt-2 min-h-[88px] text-base font-medium leading-relaxed">
							{current.front}
						</div>
						<div className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground font-terminal">
							<Lightbulb size={12} className="text-accent" />
							<span>Think of the answer, then tap or press Space to flip</span>
						</div>
					</div>
					<div className="flashcard-face flashcard-face-back overflow-y-auto rounded-lg border border-border bg-muted/30 p-5 text-left">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground font-terminal">
							Back
						</div>
						<div className="mt-2 min-h-[88px] text-base font-medium leading-relaxed">
							{current.back}
						</div>
					</div>
				</div>

				{previewMeta && (
					<div
						className="pointer-events-none absolute inset-0 flex items-center justify-center"
						style={{ opacity: Math.min(1, drag.progress * 1.2) }}
					>
						<span
							className={`rounded-lg border-2 px-4 py-2 text-lg font-bold shadow-sm backdrop-blur-sm ${previewMeta.badgeClass}`}
						>
							{previewMeta.label}
						</span>
					</div>
				)}
			</div>

			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1 text-[11px] text-muted-foreground font-terminal">
					<span>Reps {current.srs.reps}</span>
					<span aria-hidden>·</span>
					<span>Ease {current.srs.ease.toFixed(2)}</span>
					{current.srs.lapses > 0 && (
						<>
							<span aria-hidden>·</span>
							<span className="text-destructive">Lapses {current.srs.lapses}</span>
						</>
					)}
					{current.srs.dueAt > 0 && current.srs.reps > 0 && (
						<>
							<span aria-hidden>·</span>
							<span>Next {formatDueIn(current.srs.dueAt)}</span>
						</>
					)}
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => toggleBookmark(current.id)}
						className={`dialog-icon-button inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${bookmarkIds.has(current.id) ? "text-amber-500" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
						aria-label={bookmarkIds.has(current.id) ? "Remove bookmark" : "Bookmark card"}
						title={bookmarkIds.has(current.id) ? "Bookmarked" : "Bookmark for review"}
					>
						<Bookmark size={14} fill={bookmarkIds.has(current.id) ? "currentColor" : "none"} />
					</button>
				</div>
			</div>

			{!revealed ? (
				<div className="flex items-center justify-between gap-2">
					<button
						type="button"
						onClick={() => goTo(-1)}
						disabled={index === 0}
						className="dialog-compact-button inline-flex items-center gap-1 rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
					>
						<ChevronLeft size={14} />
						Back
					</button>
					<button
						type="button"
						onClick={toggleReveal}
						className="dialog-compact-button inline-flex items-center gap-2 rounded-lg border-2 border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
					>
						<Lightbulb size={14} />
						Reveal
					</button>
					<button
						type="button"
						onClick={() => goTo(1)}
						disabled={index >= cards.length - 1}
						className="dialog-compact-button inline-flex items-center gap-1 rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
					>
						Skip
						<ChevronRight size={14} />
					</button>
				</div>
			) : (
				<div className="space-y-2">
					<div className="text-[10px] uppercase tracking-wider text-muted-foreground font-terminal text-center">
						How well did you recall? Swipe the card or grade below.
					</div>
					<div className="grid grid-cols-4 gap-2">
						<RatingButton
							rating={0}
							label="Again"
							subLabel="<10m"
							intervalDays={nextIntervals.again}
							color="border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
							onClick={() => handleRate(0)}
						/>
						<RatingButton
							rating={1}
							label="Hard"
							subLabel="Recalled w/ struggle"
							intervalDays={nextIntervals.hard}
							color="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
							onClick={() => handleRate(1)}
						/>
						<RatingButton
							rating={2}
							label="Good"
							subLabel="Some effort"
							intervalDays={nextIntervals.good}
							color="border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
							onClick={() => handleRate(2)}
						/>
						<RatingButton
							rating={3}
							label="Easy"
							subLabel="Instant"
							intervalDays={nextIntervals.easy}
							color="border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20"
							onClick={() => handleRate(3)}
						/>
					</div>
				</div>
			)}

			{keyboardHint && (
				<div className="text-center font-terminal text-[10px] text-muted-foreground">
					Space flip · 1-4 grade · ←/→ navigate · swipe ←Again ↓Hard →Good ↑Easy
				</div>
			)}
		</div>
	);
}

FlashcardRenderer.displayName = "FlashcardRenderer";

function computeNextIntervals(state: FlashcardSrsState): {
	again: number;
	hard: number;
	good: number;
	easy: number;
} {
	return {
		again: applyReview(state, 0, Date.now()).appliedIntervalDays,
		hard: applyReview(state, 1, Date.now()).appliedIntervalDays,
		good: applyReview(state, 2, Date.now()).appliedIntervalDays,
		easy: applyReview(state, 3, Date.now()).appliedIntervalDays,
	};
}

function averageEase(deck: FlashcardDeck): number {
	if (deck.cards.length === 0) return initialSrsState().ease;
	const sum = deck.cards.reduce((s, c) => s + c.srs.ease, 0);
	return sum / deck.cards.length;
}

// ---------------------------------------------------------------------------
// Deck browser — list decks in storage and let the learner start a session
// ---------------------------------------------------------------------------

export interface DeckSummaryProps {
	deck: FlashcardDeck;
	now?: number;
	onStart?: (deck: FlashcardDeck) => void;
}

export function DeckSummary({ deck, now = Date.now(), onStart }: DeckSummaryProps) {
	const stats = getDeckStats(deck, now);
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<Star size={14} className="text-amber-500 shrink-0" />
					<p className="text-sm font-medium truncate">{deck.title}</p>
				</div>
				<p className="text-[11px] text-muted-foreground font-terminal mt-0.5">
					{stats.total} cards // {stats.dueNow} due // {stats.mature} mature
				</p>
			</div>
			<button
				type="button"
				onClick={() => onStart?.(deck)}
				disabled={stats.dueNow === 0}
				className="shrink-0 inline-flex items-center gap-1 rounded-md border-2 border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
			>
				{stats.dueNow === 0 ? "All caught up" : `Review ${stats.dueNow}`}
			</button>
		</div>
	);
}

DeckSummary.displayName = "DeckSummary";

// Re-export the SRS initials so callers don't have to import twice.
export { initialSrsState };
