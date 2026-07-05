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
import { css, cx } from "../../styled-system/css";
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
		badgeClass: css({
			borderColor: "color-mix(in srgb, var(--destructive) 60%, transparent)",
			background: "color-mix(in srgb, var(--destructive) 15%, transparent)",
			color: "var(--destructive)",
		}),
		exitClass: "flashcard-exit-left",
	},
	1: {
		label: "Hard",
		badgeClass: css({
			borderColor: "rgba(245, 158, 11, 0.6)",
			background: "rgba(245, 158, 11, 0.15)",
			color: "#b45309",
			".dark &": { color: "#fcd34d" },
		}),
		exitClass: "flashcard-exit-down",
	},
	2: {
		label: "Good",
		badgeClass: css({
			borderColor: "rgba(16, 185, 129, 0.6)",
			background: "rgba(16, 185, 129, 0.15)",
			color: "#047857",
			".dark &": { color: "#6ee7b7" },
		}),
		exitClass: "flashcard-exit-right",
	},
	3: {
		label: "Easy",
		badgeClass: css({
			borderColor: "rgba(14, 165, 233, 0.6)",
			background: "rgba(14, 165, 233, 0.15)",
			color: "#0369a1",
			".dark &": { color: "#7dd3fc" },
		}),
		exitClass: "flashcard-exit-up",
	},
};

function RatingButton({
	rating,
	label,
	subLabel,
	intervalDays,
	colorClass,
	disabled,
	onClick,
}: {
	rating: SrsRating;
	label: string;
	subLabel: string;
	intervalDays: number;
	colorClass: string;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			data-rating={rating}
			className={cx(
				"dialog-compact-button",
				css({
					display: "flex",
					flex: 1,
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: "0.125rem",
					borderRadius: "0.5rem",
					border: "2px solid",
					padding: "0.5rem 0.75rem",
					fontSize: "0.75rem",
					fontWeight: 500,
					transition: "color 150ms, background-color 150ms, filter 150ms",
					_hover: disabled ? undefined : { filter: "brightness(1.1)" },
					_disabled: { cursor: "not-allowed", opacity: 0.5 },
				}),
				colorClass,
			)}
		>
			<span className={css({ fontSize: "0.875rem", fontWeight: 700 })}>{label}</span>
			<span className={cx("font-terminal", css({ fontSize: "0.625rem", opacity: 0.8 }))}>{subLabel}</span>
			<span className={cx("font-terminal", css({ fontSize: "0.625rem", opacity: 0.8 }))}>{formatInterval(intervalDays)}</span>
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
			<div className={css({
				marginBlock: "0.75rem",
				borderRadius: "0.75rem",
				border: "2px solid var(--border)",
				background: "var(--background)",
				padding: "1.25rem",
				textAlign: "center",
				boxShadow: "var(--shadow-sm)",
				"& > * + *": { marginTop: "0.75rem" },
			})}>
				<div className={css({ marginInline: "auto", display: "flex", height: "3rem", width: "3rem", alignItems: "center", justifyContent: "center", borderRadius: "9999px", background: "rgba(16, 185, 129, 0.15)", color: "#059669", ".dark &": { color: "#34d399" } })}>
					<Check size={22} />
				</div>
				<h3 className={css({ fontSize: "1rem", fontWeight: 700 })}>Session complete</h3>
				<p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
					{reviewedCount} card{reviewedCount === 1 ? "" : "s"} reviewed
					{lapseCount > 0 ? `, ${lapseCount} lapse${lapseCount === 1 ? "" : "s"}` : ""}.
				</p>
				{streak >= 2 && (
					<p className={css({ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.25rem", fontSize: "0.75rem", fontWeight: 500, color: "#d97706", ".dark &": { color: "#fbbf24" } })}>
						<Flame size={14} />
						Finished on a {streak}-card streak
					</p>
				)}
				<div className={css({ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
					<Sparkles size={14} className={css({ color: "#f59e0b" })} />
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
			className={css({
				marginBlock: "0.75rem",
				borderRadius: "0.75rem",
				border: "2px solid var(--border)",
				background: "var(--background)",
				padding: { base: "1rem", sm: "1.25rem" },
				boxShadow: "var(--shadow-sm)",
				_focus: { outline: "none" },
				_focusVisible: { boxShadow: "0 0 0 2px var(--primary)" },
				"& > * + *": { marginTop: "1rem" },
			})}
		>
			{showMeta && (
				<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
					<div className={css({ minWidth: 0 })}>
						<h3 className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 700, color: "var(--foreground)" })}>{deck.title}</h3>
						<p className={cx("font-terminal", css({ fontSize: "0.6875rem" }))}>
							{deck.cards.length} CARDS // {stats.dueNow} DUE NOW // avg ease {averageEase(deck).toFixed(2)}
						</p>
					</div>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
						{streak >= 2 && (
							<span
								key={streakPopKey}
								className={cx(
									"flashcard-streak-pop",
									isStreakMilestone(streak) ? "flashcard-milestone-pulse" : "",
									"font-terminal",
									css({
										display: "inline-flex",
										alignItems: "center",
										gap: "0.25rem",
										borderRadius: "9999px",
										border: "1px solid rgba(245, 158, 11, 0.5)",
										background: "rgba(245, 158, 11, 0.1)",
										padding: "0.125rem 0.5rem",
										fontSize: "0.6875rem",
										fontWeight: 700,
										color: "#d97706",
										".dark &": { color: "#fbbf24" },
									}),
								)}
								title={`${streak} consecutive Good/Easy recalls`}
							>
								<Flame size={11} />
								{streak}
							</span>
						)}
						<button
							type="button"
							onClick={() => updateSettings({ flashcardSoundEnabled: !soundOn })}
							className={cx("dialog-icon-button", css({
								display: "inline-flex",
								height: "1.75rem",
								width: "1.75rem",
								alignItems: "center",
								justifyContent: "center",
								borderRadius: "0.25rem",
								color: "var(--muted-foreground)",
								transition: "color 150ms, background-color 150ms",
								_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
							}))}
							aria-label={soundOn ? "Mute flashcard sounds" : "Enable flashcard sounds"}
							title={soundOn ? "Sounds on" : "Sounds off"}
						>
							{soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
						</button>
						<span className={cx("font-terminal", css({ fontSize: "0.6875rem", fontVariantNumeric: "tabular-nums" }))}>
							{index + 1}/{cards.length}
						</span>
					</div>
				</div>
			)}

			<div className={cx("flashcard-stage", css({ position: "relative" }))}>
				<div
					key={current.id}
					{...gestureHandlers}
					style={dragStyle}
					className={cx(
						"flashcard-3d",
						revealed ? "flashcard-flipped" : "",
						drag.dragging ? "flashcard-dragging" : "",
						exitClass || "flashcard-enter",
						css({ cursor: "pointer", userSelect: "none" }),
					)}
					onAnimationEnd={(e) => {
						if (exiting && e.animationName.startsWith("flashcard-exit")) {
							void commitRate(exiting.rating);
						}
					}}
				>
					<div className={cx("flashcard-face", css({ position: "relative", width: "100%", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "1.25rem", textAlign: "left" }))}>
						<div className={cx("font-terminal", css({ fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }))}>
							Front
						</div>
						<div className={css({ marginTop: "0.5rem", minHeight: "88px", fontSize: "1rem", fontWeight: 500, lineHeight: 1.625 })}>
							{current.front}
						</div>
						<div className={cx("font-terminal", css({ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" }))}>
							<Lightbulb size={12} className={css({ color: "var(--accent)" })} />
							<span>Think of the answer, then tap or press Space to flip</span>
						</div>
					</div>
					<div className={cx("flashcard-face", "flashcard-face-back", css({ overflowY: "auto", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 30%, transparent)", padding: "1.25rem", textAlign: "left" }))}>
						<div className={cx("font-terminal", css({ fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }))}>
							Back
						</div>
						<div className={css({ marginTop: "0.5rem", minHeight: "88px", fontSize: "1rem", fontWeight: 500, lineHeight: 1.625 })}>
							{current.back}
						</div>
					</div>
				</div>

				{previewMeta && (
					<div
						className={css({ pointerEvents: "none", position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" })}
						style={{ opacity: Math.min(1, drag.progress * 1.2) }}
					>
						<span
							className={cx(previewMeta.badgeClass, css({ borderRadius: "0.5rem", border: "2px solid", padding: "0.5rem 1rem", fontSize: "1.125rem", fontWeight: 700, boxShadow: "var(--shadow-sm)", backdropFilter: "blur(4px)" }))}
						>
							{previewMeta.label}
						</span>
					</div>
				)}
			</div>

			<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
				<div className={cx("font-terminal", css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" }))}>
					<span>Reps {current.srs.reps}</span>
					<span aria-hidden>·</span>
					<span>Ease {current.srs.ease.toFixed(2)}</span>
					{current.srs.lapses > 0 && (
						<>
							<span aria-hidden>·</span>
							<span className={css({ color: "var(--destructive)" })}>Lapses {current.srs.lapses}</span>
						</>
					)}
					{current.srs.dueAt > 0 && current.srs.reps > 0 && (
						<>
							<span aria-hidden>·</span>
							<span>Next {formatDueIn(current.srs.dueAt)}</span>
						</>
					)}
				</div>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
					<button
						type="button"
						onClick={() => toggleBookmark(current.id)}
						className={cx("dialog-icon-button", css({
							display: "inline-flex",
							height: "1.75rem",
							width: "1.75rem",
							alignItems: "center",
							justifyContent: "center",
							borderRadius: "0.25rem",
							color: bookmarkIds.has(current.id) ? "#f59e0b" : "var(--muted-foreground)",
							transition: "color 150ms, background-color 150ms",
							_hover: bookmarkIds.has(current.id) ? undefined : { background: "var(--accent)", color: "var(--accent-foreground)" },
						}))}
						aria-label={bookmarkIds.has(current.id) ? "Remove bookmark" : "Bookmark card"}
						title={bookmarkIds.has(current.id) ? "Bookmarked" : "Bookmark for review"}
					>
						<Bookmark size={14} fill={bookmarkIds.has(current.id) ? "currentColor" : "none"} />
					</button>
				</div>
			</div>

			{!revealed ? (
				<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
					<button
						type="button"
						onClick={() => goTo(-1)}
						disabled={index === 0}
						className={cx("dialog-compact-button", css({
							display: "inline-flex",
							alignItems: "center",
							gap: "0.25rem",
							borderRadius: "0.5rem",
							border: "2px solid var(--border)",
							background: "var(--background)",
							padding: "0.5rem 0.75rem",
							fontSize: "0.875rem",
							fontWeight: 500,
							transition: "color 150ms, background-color 150ms",
							_hover: { background: "var(--accent)" },
							_disabled: { pointerEvents: "none", opacity: 0.4 },
						}))}
					>
						<ChevronLeft size={14} />
						Back
					</button>
					<button
						type="button"
						onClick={toggleReveal}
						className={cx("dialog-compact-button", css({
							display: "inline-flex",
							alignItems: "center",
							gap: "0.5rem",
							borderRadius: "0.5rem",
							border: "2px solid var(--primary)",
							background: "var(--primary)",
							padding: "0.5rem 1rem",
							fontSize: "0.875rem",
							fontWeight: 500,
							color: "var(--primary-foreground)",
							transition: "color 150ms, background-color 150ms",
							_hover: { background: "color-mix(in srgb, var(--primary) 90%, black)" },
						}))}
					>
						<Lightbulb size={14} />
						Reveal
					</button>
					<button
						type="button"
						onClick={() => goTo(1)}
						disabled={index >= cards.length - 1}
						className={cx("dialog-compact-button", css({
							display: "inline-flex",
							alignItems: "center",
							gap: "0.25rem",
							borderRadius: "0.5rem",
							border: "2px solid var(--border)",
							background: "var(--background)",
							padding: "0.5rem 0.75rem",
							fontSize: "0.875rem",
							fontWeight: 500,
							transition: "color 150ms, background-color 150ms",
							_hover: { background: "var(--accent)" },
							_disabled: { pointerEvents: "none", opacity: 0.4 },
						}))}
					>
						Skip
						<ChevronRight size={14} />
					</button>
				</div>
			) : (
				<div className={css({ "& > * + *": { marginTop: "0.5rem" } })}>
					<div className={cx("font-terminal", css({ textAlign: "center", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }))}>
						How well did you recall? Swipe the card or grade below.
					</div>
					<div className={css({ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.5rem" })}>
						<RatingButton
							rating={0}
							label="Again"
							subLabel="<10m"
							intervalDays={nextIntervals.again}
							colorClass={css({
								borderColor: "color-mix(in srgb, var(--destructive) 50%, transparent)",
								background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
								color: "var(--destructive)",
								_hover: { background: "color-mix(in srgb, var(--destructive) 20%, transparent)" },
							})}
							onClick={() => handleRate(0)}
						/>
						<RatingButton
							rating={1}
							label="Hard"
							subLabel="Recalled w/ struggle"
							intervalDays={nextIntervals.hard}
							colorClass={css({
								borderColor: "rgba(245, 158, 11, 0.5)",
								background: "rgba(245, 158, 11, 0.1)",
								color: "#b45309",
								_hover: { background: "rgba(245, 158, 11, 0.2)" },
								".dark &": { color: "#fcd34d" },
							})}
							onClick={() => handleRate(1)}
						/>
						<RatingButton
							rating={2}
							label="Good"
							subLabel="Some effort"
							intervalDays={nextIntervals.good}
							colorClass={css({
								borderColor: "rgba(16, 185, 129, 0.5)",
								background: "rgba(16, 185, 129, 0.1)",
								color: "#047857",
								_hover: { background: "rgba(16, 185, 129, 0.2)" },
								".dark &": { color: "#6ee7b7" },
							})}
							onClick={() => handleRate(2)}
						/>
						<RatingButton
							rating={3}
							label="Easy"
							subLabel="Instant"
							intervalDays={nextIntervals.easy}
							colorClass={css({
								borderColor: "rgba(14, 165, 233, 0.5)",
								background: "rgba(14, 165, 233, 0.1)",
								color: "#0369a1",
								_hover: { background: "rgba(14, 165, 233, 0.2)" },
								".dark &": { color: "#7dd3fc" },
							})}
							onClick={() => handleRate(3)}
						/>
					</div>
				</div>
			)}

			{keyboardHint && (
				<div className={cx("font-terminal", css({ textAlign: "center", fontSize: "0.625rem", color: "var(--muted-foreground)" }))}>
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
		<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem" })}>
			<div className={css({ minWidth: 0 })}>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
					<Star size={14} className={css({ flexShrink: 0, color: "#f59e0b" })} />
					<p className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 500 })}>{deck.title}</p>
				</div>
				<p className={cx("font-terminal", css({ marginTop: "0.125rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" }))}>
					{stats.total} cards // {stats.dueNow} due // {stats.mature} mature
				</p>
			</div>
			<button
				type="button"
				onClick={() => onStart?.(deck)}
				disabled={stats.dueNow === 0}
				className={css({
					display: "inline-flex",
					flexShrink: 0,
					alignItems: "center",
					gap: "0.25rem",
					borderRadius: "0.375rem",
					border: "2px solid var(--primary)",
					background: "var(--primary)",
					padding: "0.375rem 0.75rem",
					fontSize: "0.75rem",
					fontWeight: 500,
					color: "var(--primary-foreground)",
					transition: "color 150ms, background-color 150ms",
					_hover: { background: "color-mix(in srgb, var(--primary) 90%, black)" },
					_disabled: { pointerEvents: "none", opacity: 0.4 },
				})}
			>
				{stats.dueNow === 0 ? "All caught up" : `Review ${stats.dueNow}`}
			</button>
		</div>
	);
}

DeckSummary.displayName = "DeckSummary";

// Re-export the SRS initials so callers don't have to import twice.
export { initialSrsState };
