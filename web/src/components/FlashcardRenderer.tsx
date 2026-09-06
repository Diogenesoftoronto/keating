import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Bookmark,
	ChevronLeft,
	ChevronRight,
	CircleDot,
	Flame,
	Lightbulb,
	Pause,
	ScanLine,
	Sparkles,
	Star,
	Sun,
	Volume2,
	VolumeX,
	Zap,
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
import { FlashcardShaderField } from "./flashcards/FlashcardShaderField";
import {
	DEFAULT_FLASHCARD_SHADER_PRESET,
	FLASHCARD_SHADER_OPTIONS,
	normalizeFlashcardShaderPreset,
	reviewPoints,
	type FlashcardShaderPreset,
} from "./flashcards/game";
import { useCardGestures } from "./flashcards/useCardGestures";
import { FlashcardTimer } from "./flashcards/FlashcardTimer";
import { useFlashcardAutoReveal } from "./flashcards/useFlashcardAutoReveal";
import { css, cx } from "../../styled-system/css";
import { CompletionMark, RoundProgress } from "./quiz/ActivityGame";
import "./flashcards/recall-game.css";
import {
	isStreakMilestone,
	nextStreak,
	playReviewSound,
	prefersReducedMotion,
	ratingSound,
} from "./flashcards/review-feedback";

const storage = new KeatingStorage();

const BOOKMARK_KEY = "keating:card-bookmarks";
const SHADER_PRESET_KEY = "keating:flashcard-shader-preset";

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

function loadShaderPreset(fallback?: FlashcardShaderPreset): FlashcardShaderPreset {
	if (fallback) return normalizeFlashcardShaderPreset(fallback);
	try {
		return normalizeFlashcardShaderPreset(localStorage.getItem(SHADER_PRESET_KEY));
	} catch {
		return DEFAULT_FLASHCARD_SHADER_PRESET;
	}
}

function saveShaderPreset(preset: FlashcardShaderPreset) {
	try {
		localStorage.setItem(SHADER_PRESET_KEY, preset);
	} catch {
		/* visual preference only */
	}
}

const gameStyles = {
	shell: css({
		position: "relative",
		isolation: "isolate",
		overflow: "hidden",
		marginBlock: "0.75rem",
		border: "2px solid var(--ink, var(--border))",
		borderRadius: "0.75rem",
		background: "var(--card, var(--background))",
		color: "var(--ink, var(--foreground))",
		boxShadow: "4px 4px 0 color-mix(in srgb, var(--ink, var(--foreground)) 18%, transparent)",
		_focus: { outline: "none" },
		_focusVisible: {
			outline: "3px solid var(--accent-green, var(--ring))",
			outlineOffset: "3px",
		},
	}),
	inner: css({
		position: "relative",
		zIndex: 1,
		display: "grid",
		gap: "0.875rem",
		padding: { base: "0.75rem", sm: "1rem" },
	}),
	header: css({
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.75rem",
	}),
	titleGroup: css({ minWidth: 0, flex: "1 1 12rem" }),
	title: css({
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontFamily: "var(--mono-display, var(--font-mono))",
		fontSize: "0.9375rem",
		fontWeight: 700,
	}),
	deckLine: css({
		marginTop: "0.125rem",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.6875rem",
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	headerActions: css({ display: "flex", alignItems: "center", gap: "0.375rem" }),
	iconButton: css({
		display: "inline-flex",
		width: "2.75rem",
		height: "2.75rem",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: "0.375rem",
		color: "var(--ink-soft, var(--muted-foreground))",
		transition: "background-color 150ms, color 150ms, transform 120ms",
		_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
		_active: { transform: "translateY(1px)" },
		_focusVisible: {
			outline: "3px solid var(--accent-green, var(--ring))",
			outlineOffset: "2px",
		},
	}),
	atmosphere: css({
		display: "grid",
		gap: "0.375rem",
		borderTop: "1px solid color-mix(in srgb, var(--ink, var(--foreground)) 18%, transparent)",
		paddingTop: "0.75rem",
		sm: {
			gridTemplateColumns: "auto minmax(0, 1fr)",
			alignItems: "center",
			gap: "0.75rem",
		},
	}),
	atmosphereLabel: css({
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.625rem",
		fontWeight: 700,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	presetGroup: css({
		display: "grid",
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		gap: "0.375rem",
		sm: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" },
	}),
	presetButton: css({
		display: "inline-flex",
		minWidth: 0,
		minHeight: "2.75rem",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.375rem",
		border: "1px solid var(--ink, var(--border))",
		borderRadius: "0.375rem",
		background: "var(--background)",
		paddingInline: "0.5rem",
		fontSize: "0.6875rem",
		fontWeight: 650,
		color: "var(--ink-soft, var(--muted-foreground))",
		transition: "background-color 150ms, color 150ms, transform 120ms",
		_hover: { color: "var(--foreground)" },
		_active: { transform: "translateY(1px)" },
		_focusVisible: {
			outline: "3px solid var(--accent-green, var(--ring))",
			outlineOffset: "2px",
		},
		"&[aria-pressed=true]": {
			background: "var(--ink, var(--foreground))",
			color: "var(--paper, var(--background))",
		},
	}),
	hud: css({
		display: "grid",
		gridTemplateColumns: "minmax(0, 1.6fr) minmax(4.5rem, 0.7fr) minmax(4.5rem, 0.7fr)",
		overflow: "hidden",
		border: "1px solid var(--ink, var(--border))",
		borderRadius: "0.5rem",
		background: "var(--paper, var(--background))",
	}),
	hudCell: css({
		minWidth: 0,
		padding: "0.625rem 0.75rem",
		"& + &": {
			borderInlineStart: "1px solid color-mix(in srgb, var(--ink, var(--foreground)) 22%, transparent)",
		},
	}),
	hudLabel: css({
		display: "block",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.5625rem",
		fontWeight: 700,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	hudValue: css({
		display: "block",
		marginTop: "0.125rem",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontFamily: "var(--mono-display, var(--font-mono))",
		fontSize: "0.875rem",
		fontWeight: 700,
		fontVariantNumeric: "tabular-nums",
	}),
	progressTrack: css({
		height: "0.375rem",
		marginTop: "0.375rem",
		overflow: "hidden",
		borderRadius: "9999px",
		background: "color-mix(in srgb, var(--ink, var(--foreground)) 13%, transparent)",
	}),
	progressFill: css({
		height: "100%",
		borderRadius: "inherit",
		background: "var(--accent-green, var(--primary))",
		transition: "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
		transformOrigin: "left center",
	}),
	arena: css({
		position: "relative",
		display: "grid",
		minHeight: { base: "20rem", sm: "23rem" },
		placeItems: "center",
		overflow: "hidden",
		border: "2px solid var(--ink, var(--border))",
		borderRadius: "0.625rem",
		padding: { base: "3.25rem 1rem 3.5rem", sm: "3.5rem 3.75rem" },
	}),
	cardStack: css({
		position: "relative",
		zIndex: 2,
		width: "min(100%, 34rem)",
		"&::before, &::after": {
			content: "\"\"",
			position: "absolute",
			inset: "0.4rem 0.5rem -0.4rem",
			zIndex: -1,
			border: "1px solid color-mix(in srgb, var(--arena-accent, var(--phosphor, #4be388)) 58%, transparent)",
			borderRadius: "0.5rem",
			background: "color-mix(in srgb, var(--crt, #07100b) 82%, var(--arena-accent, var(--accent-green, #4be388)))",
		},
		"&::after": {
			inset: "0.75rem 0.9rem -0.75rem",
			zIndex: -2,
			opacity: 0.52,
		},
	}),
	face: css({
		position: "relative",
		display: "flex",
		width: "100%",
		minHeight: { base: "13.5rem", sm: "15rem" },
		maxHeight: "24rem",
		flexDirection: "column",
		justifyContent: "space-between",
		gap: "1rem",
		overflowY: "auto",
		border: "2px solid var(--ink, var(--border))",
		borderRadius: "0.5rem",
		background: "var(--paper, var(--background))",
		padding: { base: "1.25rem", sm: "1.75rem" },
		color: "var(--ink, var(--foreground))",
		boxShadow: "6px 6px 0 color-mix(in srgb, var(--arena-accent, var(--phosphor, #4be388)) 34%, var(--ink, #1c211b))",
		textAlign: "left",
	}),
	backFace: css({
		background: "color-mix(in srgb, var(--green-wash, var(--muted)) 72%, var(--paper, var(--background)))",
	}),
	faceLabel: css({
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.75rem",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.625rem",
		fontWeight: 700,
		letterSpacing: "0.07em",
		textTransform: "uppercase",
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	cardCopy: css({
		position: "relative",
		zIndex: 1,
		fontSize: { base: "1rem", sm: "1.125rem" },
		fontWeight: 600,
		lineHeight: 1.6,
		overflowWrap: "anywhere",
	}),
	tags: css({ display: "flex", flexWrap: "wrap", gap: "0.375rem" }),
	tag: css({
		borderRadius: "9999px",
		background: "color-mix(in srgb, var(--ink, var(--foreground)) 8%, transparent)",
		padding: "0.2rem 0.45rem",
		fontSize: "0.625rem",
		fontWeight: 650,
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	faceHint: css({
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.625rem",
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	cue: css({
		position: "absolute",
		zIndex: 1,
		display: "inline-flex",
		alignItems: "center",
		gap: "0.25rem",
		borderRadius: "9999px",
		border: "1px solid color-mix(in srgb, var(--phosphor, #4be388) 38%, transparent)",
		background: "color-mix(in srgb, var(--crt, #07100b) 84%, transparent)",
		padding: "0.25rem 0.5rem",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.5625rem",
		fontWeight: 700,
		letterSpacing: "0.04em",
		textTransform: "uppercase",
		color: "var(--phosphor-dim, #9bd8ad)",
		opacity: 0,
		transform: "scale(0.94)",
		transition: "opacity 160ms, transform 160ms, color 160ms, border-color 160ms",
		pointerEvents: "none",
		"&[data-visible=true]": { opacity: 0.82, transform: "scale(1)" },
		"&[data-active=true]": {
			borderColor: "var(--cue-color)",
			color: "var(--cue-color)",
			opacity: 1,
			transform: "scale(1.06)",
		},
	}),
	cueTop: css({ top: "0.75rem", left: "50%", transform: "translateX(-50%) scale(0.94)", "&[data-visible=true]": { transform: "translateX(-50%) scale(1)" }, "&[data-active=true]": { transform: "translateX(-50%) scale(1.06)" } }),
	cueBottom: css({ bottom: "0.75rem", left: "50%", transform: "translateX(-50%) scale(0.94)", "&[data-visible=true]": { transform: "translateX(-50%) scale(1)" }, "&[data-active=true]": { transform: "translateX(-50%) scale(1.06)" } }),
	cueLeft: css({ left: "0.625rem", top: "50%", transform: "translateY(-50%) scale(0.94)", "&[data-visible=true]": { transform: "translateY(-50%) scale(1)" }, "&[data-active=true]": { transform: "translateY(-50%) scale(1.06)" } }),
	cueRight: css({ right: "0.625rem", top: "50%", transform: "translateY(-50%) scale(0.94)", "&[data-visible=true]": { transform: "translateY(-50%) scale(1)" }, "&[data-active=true]": { transform: "translateY(-50%) scale(1.06)" } }),
	impact: css({
		position: "absolute",
		inset: 0,
		zIndex: 4,
		display: "grid",
		placeItems: "center",
		pointerEvents: "none",
		"&::before": {
			content: "\"\"",
			width: "8rem",
			height: "8rem",
			border: "2px solid var(--impact-color)",
			borderRadius: "9999px",
			boxShadow: "0 0 24px color-mix(in srgb, var(--impact-color) 62%, transparent)",
		},
	}),
	impactLabel: css({
		position: "absolute",
		display: "grid",
		justifyItems: "center",
		gap: "0.125rem",
		border: "2px solid var(--impact-color)",
		borderRadius: "0.375rem",
		background: "var(--crt, #07100b)",
		padding: "0.5rem 0.75rem",
		fontFamily: "var(--mono-display, var(--font-mono))",
		color: "var(--impact-color)",
		boxShadow: "4px 4px 0 color-mix(in srgb, var(--impact-color) 36%, transparent)",
	}),
	reviewMeta: css({
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.5rem",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.6875rem",
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	metaBits: css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" }),
	controls: css({
		display: "grid",
		gridTemplateColumns: "minmax(0, 1fr) minmax(7rem, 1.5fr) minmax(0, 1fr)",
		gap: "0.5rem",
	}),
	controlButton: css({
		display: "inline-flex",
		minWidth: 0,
		minHeight: "2.75rem",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.375rem",
		border: "2px solid var(--ink, var(--border))",
		borderRadius: "0.5rem",
		background: "var(--background)",
		padding: "0.5rem 0.625rem",
		fontSize: "0.8125rem",
		fontWeight: 650,
		color: "var(--foreground)",
		transition: "background-color 150ms, color 150ms, transform 120ms, box-shadow 120ms",
		_hover: { background: "var(--accent)" },
		_active: { transform: "translateY(1px)", boxShadow: "none" },
		_focusVisible: {
			outline: "3px solid var(--accent-green, var(--ring))",
			outlineOffset: "2px",
		},
		_disabled: { pointerEvents: "none", opacity: 0.38 },
	}),
	revealButton: css({
		background: "var(--ink, var(--primary))",
		color: "var(--paper, var(--primary-foreground))",
		boxShadow: "3px 3px 0 color-mix(in srgb, var(--accent-green, var(--primary)) 72%, transparent)",
		_hover: { background: "var(--accent-dim, var(--primary))", color: "white" },
	}),
	ratingPanel: css({ display: "grid", gap: "0.5rem" }),
	ratingPrompt: css({
		textAlign: "center",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.625rem",
		fontWeight: 650,
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	ratingGrid: css({
		display: "grid",
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
		gap: "0.5rem",
		sm: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" },
	}),
	keyboardHint: css({
		textAlign: "center",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.625rem",
		lineHeight: 1.5,
		color: "var(--ink-soft, var(--muted-foreground))",
	}),
	completion: css({
		position: "relative",
		display: "grid",
		minHeight: "23rem",
		placeItems: "center",
		overflow: "hidden",
		borderRadius: "0.625rem",
		background: "var(--crt, #07100b)",
		padding: { base: "1rem", sm: "2rem" },
		textAlign: "center",
	}),
	completionCard: css({
		position: "relative",
		zIndex: 1,
		display: "grid",
		width: "min(100%, 32rem)",
		justifyItems: "center",
		gap: "0.875rem",
		border: "2px solid var(--phosphor, #4be388)",
		borderRadius: "0.75rem",
		background: "color-mix(in srgb, var(--crt, #07100b) 88%, var(--accent-green, #4be388))",
		padding: { base: "1.25rem", sm: "1.75rem" },
		color: "var(--phosphor, #4be388)",
		boxShadow: "8px 8px 0 color-mix(in srgb, var(--phosphor, #4be388) 25%, transparent)",
	}),
	completionIcon: css({
		display: "grid",
		width: "3.5rem",
		height: "3.5rem",
		placeItems: "center",
		border: "2px solid currentColor",
		borderRadius: "9999px",
	}),
	completionTitle: css({
		fontFamily: "var(--mono-display, var(--font-mono))",
		fontSize: "1.25rem",
		fontWeight: 700,
	}),
	completionStats: css({
		display: "grid",
		width: "100%",
		gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
		borderBlock: "1px solid color-mix(in srgb, currentColor 38%, transparent)",
		paddingBlock: "0.75rem",
	}),
	completionStat: css({
		display: "grid",
		gap: "0.125rem",
		fontVariantNumeric: "tabular-nums",
		"& + &": { borderInlineStart: "1px solid color-mix(in srgb, currentColor 28%, transparent)" },
	}),
} as const;

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
	/** Initial visual atmosphere for this review surface. */
	defaultShaderPreset?: FlashcardShaderPreset;
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

const RATING_META: Record<SrsRating, {
	label: string;
	gesture: string;
	accent: string;
	badgeClass: string;
	exitClass: string;
}> = {
	0: {
		label: "Again",
		gesture: "Swipe left",
		accent: "var(--red, #d95f4f)",
		badgeClass: css({
			borderColor: "color-mix(in srgb, var(--destructive) 60%, transparent)",
			background: "color-mix(in srgb, var(--destructive) 15%, transparent)",
			color: "var(--destructive)",
		}),
		exitClass: "flashcard-exit-left",
	},
	1: {
		label: "Hard",
		gesture: "Swipe down",
		accent: "var(--amber, #e8a33d)",
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
		gesture: "Swipe right",
		accent: "var(--accent-green, #4be388)",
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
		gesture: "Swipe up",
		accent: "#67d7e8",
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
			aria-label={`${label}: ${subLabel}. Review ${formatInterval(intervalDays)}.`}
			className={cx(
				"recall-rating",
				css({
					display: "flex",
					flex: 1,
					minHeight: "4.5rem",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: "0.125rem",
					borderRadius: "0.5rem",
					border: "2px solid",
					padding: "0.5rem 0.75rem",
					fontSize: "0.75rem",
					fontWeight: 500,
					transition: "color 150ms, background-color 150ms, filter 150ms, transform 120ms",
					_hover: disabled ? undefined : { filter: "brightness(1.08)", transform: "translateY(-1px)" },
					_active: disabled ? undefined : { transform: "translateY(1px)" },
					_focusVisible: {
						outline: "3px solid var(--accent-green, var(--ring))",
						outlineOffset: "2px",
					},
					_disabled: { cursor: "not-allowed", opacity: 0.5 },
				}),
				colorClass,
			)}
		>
			<span className={css({ fontSize: "0.875rem", fontWeight: 700 })}>{label}</span>

			<span className={cx("font-terminal", css({ fontSize: "0.625rem", opacity: 0.8 }))}>{formatInterval(intervalDays)}</span>
		</button>
	);
}

function ShaderPresetIcon({ preset }: { preset: FlashcardShaderPreset }) {
	if (preset === "solar") return <Sun size={13} aria-hidden="true" />;
	if (preset === "orbit") return <CircleDot size={13} aria-hidden="true" />;
	if (preset === "prism") return <Sparkles size={13} aria-hidden="true" />;
	if (preset === "current") return <Zap size={13} aria-hidden="true" />;
	if (preset === "contour") return <Star size={13} aria-hidden="true" />;
	if (preset === "still") return <Pause size={13} aria-hidden="true" />;
	return <ScanLine size={13} aria-hidden="true" />;
}

function ShaderPresetPicker({
	value,
	onChange,
}: {
	value: FlashcardShaderPreset;
	onChange: (preset: FlashcardShaderPreset) => void;
}) {
	return (
		<div className={gameStyles.atmosphere}>
			<span className={gameStyles.atmosphereLabel}>Arena signal</span>
			<div className={gameStyles.presetGroup} role="group" aria-label="Flashcard arena shader">
				{FLASHCARD_SHADER_OPTIONS.map((option) => (
					<button
						key={option.id}
						type="button"
						aria-pressed={value === option.id}
						className={gameStyles.presetButton}
						title={option.description}
						onClick={() => onChange(option.id)}
					>
						<ShaderPresetIcon preset={option.id} />
						<span>{option.label}</span>
					</button>
				))}
			</div>
		</div>
	);
}

function SwipeCue({
	rating,
	positionClass,
	visible,
	active,
}: {
	rating: SrsRating;
	positionClass: string;
	visible: boolean;
	active: boolean;
}) {
	const meta = RATING_META[rating];
	const arrow = rating === 0 ? "←" : rating === 1 ? "↓" : rating === 2 ? "→" : "↑";
	return (
		<span
			aria-hidden="true"
			data-visible={visible}
			data-active={active}
			className={cx(gameStyles.cue, positionClass)}
			style={{ "--cue-color": meta.accent } as React.CSSProperties}
			title={meta.gesture}
		>
			{arrow} {meta.label}
		</span>
	);
}

function shaderAccent(preset: FlashcardShaderPreset): string {
	if (preset === "solar" || preset === "contour") return "var(--amber, #e8a33d)";
	if (preset === "prism") return "var(--red, #d95f4f)";
	if (preset === "current" || preset === "orbit") return "#67d7e8";
	if (preset === "still") return "var(--ink-soft, #6f766c)";
	return "var(--phosphor, #4be388)";
}

function shaderEntryClass(preset: FlashcardShaderPreset): string {
	return preset === "still" ? "flashcard-enter" : `flashcard-enter-${preset}`;
}

function stableShaderSeed(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 0xffffffff * 97;
}

export function FlashcardRenderer({
	deck,
	restrictToCardIds,
	onReview,
	onComplete,
	showMeta = true,
	autoFocusKeyboard = false,
	defaultShaderPreset,
}: FlashcardRendererProps) {
	const [revealed, setRevealed] = useState(false);
	const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(() => loadBookmarkIds());
	const [reviewedCount, setReviewedCount] = useState(0);
	const [lapseCount, setLapseCount] = useState(0);
	const [streak, setStreak] = useState(0);
	const [bestStreak, setBestStreak] = useState(0);
	const [score, setScore] = useState(0);
	const [streakPopKey, setStreakPopKey] = useState(0);
	const [exiting, setExiting] = useState<{ rating: SrsRating; viaSwipe: boolean } | null>(null);
	const [keyboardHint, setKeyboardHint] = useState(false);
	const [shaderPreset, setShaderPreset] = useState<FlashcardShaderPreset>(() => loadShaderPreset(defaultShaderPreset));
	const completeDispatchedRef = useRef(false);
	const ratingLockRef = useRef(false);
	const commitStartedRef = useRef(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const [settings, updateSettings] = useKeatingUiSettings();
	const soundOn = settings.flashcardSoundEnabled;

	const queue = useMemo(() => {
		const ids = restrictToCardIds ? new Set(restrictToCardIds) : null;
		return deck.cards
			.filter((card) => (ids ? ids.has(card.id) : true))
			.map((card) => ({ ...card, srs: { ...card.srs } }));
	}, [deck.cards, restrictToCardIds]);

	const [cards, setCards] = useState<Flashcard[]>(queue);
	const [index, setIndex] = useState(0);

	// A new deck is a new run. The atmosphere is a learner preference and stays put.
	useEffect(() => {
		setCards(queue);
		setIndex(0);
		setRevealed(false);
		setReviewedCount(0);
		setLapseCount(0);
		setStreak(0);
		setBestStreak(0);
		setScore(0);
		setExiting(null);
		ratingLockRef.current = false;
		commitStartedRef.current = false;
		completeDispatchedRef.current = false;
	}, [queue]);

	useEffect(() => {
		if (!defaultShaderPreset) return;
		setShaderPreset(normalizeFlashcardShaderPreset(defaultShaderPreset));
	}, [defaultShaderPreset]);

	useEffect(() => {
		if (autoFocusKeyboard) containerRef.current?.focus({ preventScroll: true });
	}, [autoFocusKeyboard]);

	const current = cards[index];
	const finished = !current;
	const autoReveal = useFlashcardAutoReveal({
		cardKey: `${deck.id}:${current?.id ?? "complete"}:${index}`,
		revealed,
		disabled: finished || Boolean(exiting),
		onReveal: () => {
			if (!current || ratingLockRef.current) return;
			playReviewSound("flip", soundOn);
			setRevealed(true);
		},
	});
	const stats = useMemo(
		() => getDeckStats({ ...deck, cards }, Date.now()),
		[cards, deck],
	);
	const shaderEnergy = Math.min(1, streak / 6 + reviewedCount / Math.max(24, cards.length));
	const shaderSeed = stableShaderSeed(`${deck.id}:${current?.id ?? "complete"}:${index}`);

	const changeShaderPreset = useCallback((preset: FlashcardShaderPreset) => {
		const normalized = normalizeFlashcardShaderPreset(preset);
		setShaderPreset(normalized);
		saveShaderPreset(normalized);
	}, []);

	const toggleBookmark = useCallback((cardId: string) => {
		setBookmarkIds((previous) => {
			const next = new Set(previous);
			if (next.has(cardId)) next.delete(cardId);
			else next.add(cardId);
			saveBookmarkIds(next);
			return next;
		});
	}, []);

	const toggleReveal = useCallback(() => {
		setRevealed((wasRevealed) => {
			if (!wasRevealed) playReviewSound("flip", soundOn);
			return !wasRevealed;
		});
	}, [soundOn]);

	/** Persist the review and advance. Runs after the grade animation. */
	const commitRate = useCallback(
		async (rating: SrsRating) => {
			if (!current || commitStartedRef.current) return;
			commitStartedRef.current = true;
			const outcome = applyReview(current.srs, rating, Date.now());
			const nextSrs: FlashcardSrsState = {
				...current.srs,
				...outcome.next,
			};
			const nextCombo = nextStreak(streak, rating);
			const points = reviewPoints(rating, nextCombo);

			setCards((previous) => previous.map((card, cardIndex) => (
				cardIndex === index ? { ...card, srs: nextSrs } : card
			)));
			setReviewedCount((count) => count + 1);
			if (outcome.isLapse) setLapseCount((count) => count + 1);
			setStreak(nextCombo);
			setBestStreak((best) => Math.max(best, nextCombo));
			setScore((total) => total + points);
			if (nextCombo > streak) setStreakPopKey((key) => key + 1);

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
					previousIntervalDays: current.srs.intervalDays,
					isLapse: outcome.isLapse,
				});
			} catch {
				/* storage failure should not block the review flow */
			}

			setRevealed(false);
			setExiting(null);
			setIndex((cardIndex) => cardIndex + 1);
			ratingLockRef.current = false;
			commitStartedRef.current = false;
			containerRef.current?.focus({ preventScroll: true });
		},
		[current, deck.id, deck.slug, deck.topic, index, onReview, streak],
	);

	/** Start a grade immediately, then let motion or the fallback timer commit it. */
	const handleRate = useCallback(
		(rating: SrsRating, viaSwipe = false) => {
			if (!current || ratingLockRef.current) return;
			ratingLockRef.current = true;
			playReviewSound(ratingSound(rating), soundOn);
			if (prefersReducedMotion()) {
				void commitRate(rating);
				return;
			}
			setExiting({ rating, viaSwipe });
		},
		[commitRate, current, soundOn],
	);

	const { drag, handlers: gestureHandlers } = useCardGestures({
		enabled: revealed && !exiting,
		onGrade: (rating) => handleRate(rating, true),
		onTap: toggleReveal,
	});

	// CSS animation events are primary. The timer protects review progress if a
	// browser drops an animation event while a tab is backgrounded.
	useEffect(() => {
		if (!exiting) return;
		const fallback = window.setTimeout(() => {
			void commitRate(exiting.rating);
		}, 360);
		return () => window.clearTimeout(fallback);
	}, [commitRate, exiting]);

	useEffect(() => {
		if (finished && !completeDispatchedRef.current) {
			completeDispatchedRef.current = true;
			if (reviewedCount > 0) {
				playReviewSound("complete", soundOn);
			}
			onComplete?.({ reviewed: reviewedCount, lapses: lapseCount });
		}
	}, [finished, lapseCount, onComplete, reviewedCount, soundOn]);

	const goTo = useCallback(
		(delta: number) => {
			if (ratingLockRef.current) return;
			setIndex((cardIndex) => Math.max(0, Math.min(cards.length, cardIndex + delta)));
			setRevealed(false);
		},
		[cards.length],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const target = event.target as HTMLElement;
			if (target.closest("button, input, select, textarea, a")) return;
			if (!current || ratingLockRef.current) return;
			if (event.key === " " || event.key === "Enter") {
				event.preventDefault();
				toggleReveal();
				return;
			}
			if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
				event.preventDefault();
				handleRate((Number(event.key) - 1) as SrsRating);
				return;
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				goTo(-1);
				return;
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				goTo(1);
			}
		},
		[current, goTo, handleRate, revealed, toggleReveal],
	);

	if (finished) {
		return (
			<div className={cx(gameStyles.shell, "activity-game recall-game")}>
				<div className={cx(gameStyles.inner, "recall-inner")}>
					<RoundProgress current={cards.length} total={cards.length} complete label="Flashcard run progress" />
					<CompletionMark detail={reviewedCount > 0 ? `${reviewedCount} reviewed${lapseCount ? ` · ${lapseCount} to revisit` : " · all recalled"}` : "No cards in this round."}>{reviewedCount > 0 && lapseCount === 0 ? "Clean sweep" : "Round complete"}</CompletionMark>
					{reviewedCount > 0 ? <div className="recall-finish-stats"><span><Zap size={16} aria-hidden="true" />{score.toLocaleString()} points</span><span><Flame size={16} aria-hidden="true" />{bestStreak} best combo</span></div> : null}
					{reviewedCount > 0 ? <p className={css({ fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>Your next review is scheduled.</p> : null}
				</div>
			</div>
		);
	}

	const nextIntervals = computeNextIntervals(current.srs);
	const previewGrade = drag.previewGrade;
	const exitClass = exiting
		? exiting.viaSwipe
			? RATING_META[exiting.rating].exitClass
			: "flashcard-exit-fade"
		: "";
	const impactMeta = exiting ? RATING_META[exiting.rating] : null;
	const impactPoints = exiting
		? reviewPoints(exiting.rating, nextStreak(streak, exiting.rating))
		: 0;
	const cardStyle: React.CSSProperties = {
		...(drag.dragging ? {
			transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx * 0.04}deg)${revealed ? " rotateY(180deg)" : ""}`,
		} : {}),
		touchAction: revealed ? "none" : "pan-y",
	};
	const arenaStyle = {
		"--arena-accent": shaderAccent(shaderPreset),
	} as React.CSSProperties;

	return (
		<div
			ref={containerRef}
			tabIndex={0}
			role="group"
			aria-label={`Flashcard recall run: ${deck.title}`}
			onKeyDown={handleKeyDown}
			onFocus={() => setKeyboardHint(true)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) setKeyboardHint(false);
			}}
			className={cx(gameStyles.shell, "activity-game recall-game")}
		>
			<div className={cx(gameStyles.inner, "recall-inner")}>
				{showMeta ? (
					<>
						<header className={gameStyles.header}>
							<div className={gameStyles.titleGroup}>
								<h3 className={cx(gameStyles.title, "recall-title")}>{deck.title}</h3>
								<p className={gameStyles.deckLine}>
									{stats.dueNow > 0 ? `${stats.dueNow} ready to recall` : "Recall round"}
								</p>
							</div>
							<div className={gameStyles.headerActions}>
								{streak >= 2 ? (
									<span
										key={streakPopKey}
										className={cx(
											"flashcard-streak-pop",
											isStreakMilestone(streak) ? "flashcard-milestone-pulse" : "",
											css({
												display: "inline-flex",
												minHeight: "2.25rem",
												alignItems: "center",
												gap: "0.3rem",
												border: "1px solid color-mix(in srgb, var(--amber) 62%, transparent)",
												borderRadius: "9999px",
												background: "color-mix(in srgb, var(--amber) 12%, var(--background))",
												paddingInline: "0.625rem",
												fontSize: "0.6875rem",
												fontWeight: 700,
												color: "color-mix(in srgb, var(--amber) 72%, var(--ink))",
											}),
										)}
										title={`${streak} consecutive Good or Easy recalls`}
									>
										<Flame size={13} /> {streak} combo
									</span>
								) : null}
								<button
									type="button"
									onClick={() => updateSettings({ flashcardSoundEnabled: !soundOn })}
									className={gameStyles.iconButton}
									aria-label={soundOn ? "Mute flashcard sounds" : "Enable flashcard sounds"}
									title={soundOn ? "Sounds on" : "Sounds off"}
								>
									{soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
								</button>
							</div>
						</header>

					</>
				) : null}

				<div className="recall-progress">
					<RoundProgress current={index} total={cards.length} label="Flashcard run progress" />
					{score > 0 ? <span className="recall-score" key={score} aria-live="polite"><Zap size={14} aria-hidden="true" />{score.toLocaleString()} points</span> : null}
				</div>
				<FlashcardTimer timer={autoReveal} disabled={Boolean(exiting)} />
				<span className="activity-sr-only" role="status" aria-live="polite" aria-atomic="true">{revealed ? `Answer: ${current.back}` : ""}</span>

				<div
					className={cx(gameStyles.arena, "flashcard-arena recall-arena")}
					data-shader-preset={shaderPreset}
					data-streak-tier={streak >= 5 ? "high" : streak >= 2 ? "warm" : "idle"}
					style={arenaStyle}
				>
					<FlashcardShaderField
						key={`${shaderPreset}:${current.id}`}
						preset={shaderPreset}
						energy={shaderEnergy}
						seed={shaderSeed}
					/>
					<SwipeCue rating={3} positionClass={gameStyles.cueTop} visible={revealed && !exiting && drag.dragging} active={previewGrade === 3} />
					<SwipeCue rating={1} positionClass={gameStyles.cueBottom} visible={revealed && !exiting && drag.dragging} active={previewGrade === 1} />
					<SwipeCue rating={0} positionClass={gameStyles.cueLeft} visible={revealed && !exiting && drag.dragging} active={previewGrade === 0} />
					<SwipeCue rating={2} positionClass={gameStyles.cueRight} visible={revealed && !exiting && drag.dragging} active={previewGrade === 2} />

					<div className={cx(gameStyles.cardStack, "recall-stack")} style={arenaStyle}>
						<div
							key={current.id}
							{...gestureHandlers}
							role="button"
							tabIndex={0}
							aria-label={revealed ? `Answer: ${current.back}. Show prompt` : `Recall: ${current.front}. Reveal answer`}
							aria-pressed={revealed}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									event.stopPropagation();
									toggleReveal();
								}
							}}
							style={cardStyle}
							className={cx(
								"flashcard-3d",
								revealed ? "flashcard-flipped" : "",
								drag.dragging ? "flashcard-dragging" : "",
								exitClass || shaderEntryClass(shaderPreset),
								css({ cursor: "pointer", userSelect: "none" }),
							)}
							onAnimationEnd={(event) => {
								if (exiting && event.animationName.startsWith("flashcard-exit")) {
									void commitRate(exiting.rating);
								}
							}}
						>
							<div aria-hidden={revealed} className={cx("flashcard-face", gameStyles.face, "recall-face")}>
								<div className={cx(gameStyles.faceLabel, "recall-face-label")}>
									<span>Recall</span>
									<span>{index + 1}/{cards.length}</span>
								</div>
								<div className={cx(gameStyles.cardCopy, "recall-copy")}>{current.front}</div>
								<div>
									{current.tags?.length ? (
										<div className={gameStyles.tags}>
											{current.tags.slice(0, 4).map((tag) => <span key={tag} className={gameStyles.tag}>{tag}</span>)}
										</div>
									) : null}
									<p className={cx(gameStyles.faceHint, "recall-face-hint")}>Tap to reveal</p>
								</div>
							</div>
							<div aria-hidden={!revealed} className={cx("flashcard-face", "flashcard-face-back", gameStyles.face, gameStyles.backFace, "recall-face")}>
								<div className={cx(gameStyles.faceLabel, "recall-face-label")}>
									<span>Answer</span>
									<span>How did you do?</span>
								</div>
								<div className={cx(gameStyles.cardCopy, "recall-copy")}>{current.back}</div>
								<div>
									{current.tags?.length ? (
										<div className={gameStyles.tags}>
											{current.tags.slice(0, 4).map((tag) => <span key={tag} className={gameStyles.tag}>{tag}</span>)}
										</div>
									) : null}
									<p className={cx(gameStyles.faceHint, "recall-face-hint")}>Swipe or choose your recall below</p>
								</div>
							</div>
						</div>
					</div>

					{impactMeta ? (
						<div
							className={cx(gameStyles.impact, "flashcard-grade-impact")}
							style={{ "--impact-color": impactMeta.accent } as React.CSSProperties}
						>
							<span className={cx(gameStyles.impactLabel, "flashcard-grade-impact-label")}>
								<strong>{impactMeta.label}</strong>
								<small>{impactPoints > 0 ? `+${impactPoints}` : "We’ll revisit it"}</small>
							</span>
						</div>
					) : null}
				</div>



				{!revealed ? (
					<div className={gameStyles.controls}>
						<button type="button" onClick={() => goTo(-1)} disabled={index === 0} className={cx(gameStyles.controlButton, "activity-back-action")}>
							<ChevronLeft size={15} /> Back
						</button>
						<button type="button" onClick={toggleReveal} className={cx(gameStyles.controlButton, gameStyles.revealButton, "activity-main-action recall-reveal")}>
							<Lightbulb size={16} /> Reveal answer
						</button>
						<button type="button" onClick={() => goTo(1)} disabled={index >= cards.length - 1} className={cx(gameStyles.controlButton, "activity-back-action")}>
							Skip <ChevronRight size={15} />
						</button>
					</div>
				) : (
					<div className={gameStyles.ratingPanel}>
						<p className={gameStyles.ratingPrompt}>How well did you remember?</p>
						<div className={cx(gameStyles.ratingGrid, "recall-rating-grid")}>
							<RatingButton rating={0} label="Again" subLabel="Missed" intervalDays={nextIntervals.again} disabled={Boolean(exiting)} colorClass={css({ borderColor: "color-mix(in srgb, var(--destructive) 52%, transparent)", background: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: "var(--destructive)", _hover: { background: "color-mix(in srgb, var(--destructive) 18%, transparent)" } })} onClick={() => handleRate(0)} />
							<RatingButton rating={1} label="Hard" subLabel="Strained" intervalDays={nextIntervals.hard} disabled={Boolean(exiting)} colorClass={css({ borderColor: "color-mix(in srgb, var(--amber) 55%, transparent)", background: "color-mix(in srgb, var(--amber) 10%, transparent)", color: "color-mix(in srgb, var(--amber) 72%, var(--ink))", _hover: { background: "color-mix(in srgb, var(--amber) 18%, transparent)" } })} onClick={() => handleRate(1)} />
							<RatingButton rating={2} label="Good" subLabel="Recalled" intervalDays={nextIntervals.good} disabled={Boolean(exiting)} colorClass={css({ borderColor: "color-mix(in srgb, var(--accent-green) 52%, transparent)", background: "color-mix(in srgb, var(--accent-green) 10%, transparent)", color: "var(--accent-dim)", _hover: { background: "color-mix(in srgb, var(--accent-green) 18%, transparent)" } })} onClick={() => handleRate(2)} />
							<RatingButton rating={3} label="Easy" subLabel="Instant" intervalDays={nextIntervals.easy} disabled={Boolean(exiting)} colorClass={css({ borderColor: "color-mix(in srgb, #67d7e8 58%, transparent)", background: "color-mix(in srgb, #67d7e8 10%, transparent)", color: "color-mix(in srgb, #67d7e8 64%, var(--ink))", _hover: { background: "color-mix(in srgb, #67d7e8 18%, transparent)" } })} onClick={() => handleRate(3)} />
						</div>
					</div>
				)}

				<details className="activity-review recall-details"><summary>Card details & appearance</summary>
				<div className={gameStyles.reviewMeta}>
					<div className={gameStyles.metaBits}>
						<span>Reps {current.srs.reps}</span>
						<span aria-hidden>·</span>
						<span>Ease {current.srs.ease.toFixed(2)}</span>
						{current.srs.lapses > 0 ? (
							<><span aria-hidden>·</span><span className={css({ color: "var(--destructive)" })}>Lapses {current.srs.lapses}</span></>
						) : null}
						{current.srs.dueAt > 0 && current.srs.reps > 0 ? (
							<><span aria-hidden>·</span><span>Next {formatDueIn(current.srs.dueAt)}</span></>
						) : null}
					</div>
					<button
						type="button"
						onClick={() => toggleBookmark(current.id)}
						className={gameStyles.iconButton}
						aria-label={bookmarkIds.has(current.id) ? "Remove bookmark" : "Bookmark card"}
						title={bookmarkIds.has(current.id) ? "Bookmarked" : "Bookmark for review"}
					>
						<Bookmark size={16} fill={bookmarkIds.has(current.id) ? "currentColor" : "none"} />
					</button>
				</div>
					<ShaderPresetPicker value={shaderPreset} onChange={changeShaderPreset} />
				</details>
				{keyboardHint ? (
					<p className={gameStyles.keyboardHint}>
						Space to flip · 1–4 to rate · ← → to navigate
					</p>
				) : null}
			</div>
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
