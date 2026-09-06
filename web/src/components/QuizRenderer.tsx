import { Select } from "./Select";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePostHog } from "@posthog/react";
import {
	AlertTriangle,
	Bookmark,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Clock,
	GraduationCap,
	Lightbulb,
	RotateCcw,
	Send,
	Sparkles,
	TrendingUp,
	Volume2,
	X,
	XCircle,
} from "lucide-react";
import type { Quiz, QuizQuestion } from "../keating/core";
import { KeatingStorage } from "../keating/storage";
import { css, cx } from "../../styled-system/css";
import { FlashcardShaderField } from "./flashcards/FlashcardShaderField";
import type { FlashcardShaderPreset } from "./flashcards/game";
import { parseQuestionTemplate } from "./question-template";
import {
	QUIZ_SHADER_OPTIONS,
	QUIZ_SHADER_STORAGE_KEY,
	formatQuizDuration,
	isQuickQuizAnswer,
	quizTimerState,
	resolveQuizShaderPreset,
	uniqueQuizQuestions,
} from "./quiz/game";
import { AnswerTile, CompletionMark, RoundProgress } from "./quiz/ActivityGame";

const quizStorage = new KeatingStorage();

export interface QuizTiming {
	/** Total wall-clock time the learner spent on the quiz, in ms. */
	totalMs: number;
	/** Time spent per question id, in ms. */
	perQuestionMs: Record<string, number>;
}

export interface QuizResult {
	resultId: string;
	answers: Record<string, string>;
	score: number;
	partialCreditPoints: number;
	timing: QuizTiming;
	partialCredits: Record<string, number>;
	flagged: string[];
	/** Authored countdowns that expired during this run. */
	timedOutQuestionIds?: string[];
	examTimedOut?: boolean;
}

export function createQuizResultId(slug: string): string {
	const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);
	return `${slug || "quiz"}-${Date.now()}-${suffix}`;
}

export interface TopicStats {
	count: number;
	avgScore: number;
	avgPartialCreditPoints: number;
	topQuartile: number;
}

export interface QuizRendererProps {
	quiz: Quiz;
	onSubmit?: (result: QuizResult) => void;
	topicStats?: TopicStats | null;
	/** Initial visual atmosphere. A saved learner choice takes precedence. */
	defaultShaderPreset?: FlashcardShaderPreset;
}

type AnswerState = Record<string, string>;

const BOOKMARK_KEY = "keating:quiz-bookmarks";

function loadBookmarkIds(): string[] {
	try {
		const raw = localStorage.getItem(BOOKMARK_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
	} catch {
		return [];
	}
}

function saveBookmarkIds(ids: string[]) {
	try {
		localStorage.setItem(BOOKMARK_KEY, JSON.stringify(ids));
	} catch {
		/* ignore */
	}
}

function loadQuizShaderPreset(
	seed: string,
	fallback?: FlashcardShaderPreset,
): FlashcardShaderPreset {
	if (fallback) return resolveQuizShaderPreset(fallback, seed);
	try {
		return resolveQuizShaderPreset(localStorage.getItem(QUIZ_SHADER_STORAGE_KEY), seed);
	} catch {
		return resolveQuizShaderPreset(undefined, seed);
	}
}

function saveQuizShaderPreset(preset: FlashcardShaderPreset) {
	try {
		localStorage.setItem(QUIZ_SHADER_STORAGE_KEY, preset);
	} catch {
		/* visual preference only */
	}
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatCountdown(totalSeconds: number): string {
	const s = Math.max(0, Math.ceil(totalSeconds));
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return `${m}:${sec.toString().padStart(2, "0")}`;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9 ]/g, "")
		.split(/\s+/)
		.filter(Boolean);
}

function ngrams(tokens: string[], n: number): string[] {
	if (tokens.length < n) return [];
	const grams: string[] = [];
	for (let i = 0; i <= tokens.length - n; i++) {
		grams.push(tokens.slice(i, i + n).join(" "));
	}
	return grams;
}

// Fraction of the reference's n-grams that appear in the answer. Bigrams reward
// phrasing/word-order overlap, which single-token overlap misses.
function ngramRecall(answerTokens: string[], referenceTokens: string[], n: number): number {
	const reference = ngrams(referenceTokens, n);
	if (reference.length === 0) return 0;
	const answer = new Set(ngrams(answerTokens, n));
	const matched = reference.filter((g) => answer.has(g)).length;
	return matched / reference.length;
}

function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	const prev = Array.from({ length: n + 1 }, (_, i) => i);
	const curr = new Array(n + 1);
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		const ac = a[i - 1];
		for (let j = 1; j <= n; j++) {
			curr[j] =
				ac === b[j - 1]
					? prev[j - 1]
					: 1 + Math.min(prev[j - 1], curr[j - 1], prev[j]);
		}
		for (let j = 0; j <= n; j++) prev[j] = curr[j];
	}
	return prev[n];
}

export function questionCredit(q: QuizQuestion, rawAnswer: string): number {
	if (!rawAnswer.trim()) return 0;
	if (q.type === "slider") {
		const ans = parseFloat(rawAnswer);
		const correct = parseFloat(q.correctAnswer);
		if (Number.isNaN(ans) || Number.isNaN(correct)) return 0;
		const range = (q.max ?? 100) - (q.min ?? 0);
		const tolerance = Math.max((q.step ?? 1) / 2, range * 0.05);
		const diff = Math.abs(ans - correct);
		return diff <= tolerance ? 1 : Math.max(0, 1 - diff / (range || 1));
	}
	if (q.type === "multi_select" && q.correctAnswers) {
		const selected = rawAnswer.split(",").map((s) => s.trim()).filter(Boolean);
		const correctSet = new Set(q.correctAnswers);
		let selectedCorrect = 0;
		let selectedWrong = 0;
		for (const s of selected) {
			if (correctSet.has(s)) selectedCorrect++;
			else selectedWrong++;
		}
		const score = selectedCorrect / correctSet.size - selectedWrong / (q.options?.length || 1);
		return Math.max(0, score);
	}
	if (q.type === "fill_in" && q.blanks && q.blanks.length > 0) {
		// Multi-blank fill_in: answers are pipe-separated, correctAnswers array expected
		const userAnswers = rawAnswer.split("|").map((s) => s.trim());
		const correctAnswers = q.correctAnswers ?? [q.correctAnswer];
		let correct = 0;
		for (let i = 0; i < Math.min(userAnswers.length, correctAnswers.length); i++) {
			if (userAnswers[i].toLowerCase() === correctAnswers[i].trim().toLowerCase()) correct++;
		}
		return correct / correctAnswers.length;
	}
	if (q.type === "true_false" || q.type === "multiple_choice" || q.type === "dropdown") {
		return rawAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase() ? 1 : 0;
	}
	// Open-ended: partial credit via Levenshtein + keyword/n-gram overlap. There's
	// no single correct string here, so we take the most generous of several
	// signals; the model gives the authoritative judgment in chat.
	const a = rawAnswer.trim().toLowerCase();
	const c = q.correctAnswer.trim().toLowerCase();
	if (a === c) return 1;
	const dist = levenshtein(a, c);
	const len = Math.max(a.length, c.length);
	const editScore = Math.max(0, 1 - dist / (len || 1));
	const aTokens = tokenize(a);
	const cTokens = tokenize(c);
	const aTokenSet = new Set(aTokens);
	const overlap = cTokens.filter((t) => aTokenSet.has(t)).length;
	const keywordScore = cTokens.length ? overlap / cTokens.length : 0;
	// Phrase overlap: matching consecutive word pairs is a stronger signal that
	// the learner expressed the same idea, not just reused isolated words.
	const bigramScore = ngramRecall(aTokens, cTokens, 2);
	return Math.max(editScore, keywordScore * 0.9, bigramScore);
}

// Open-ended answers can't be graded by string equality — there's no single
// "correct" string. The model does the authoritative grading in chat; locally
// we accept anything close enough on the partial-credit heuristic so the
// displayed score isn't misleadingly strict.
const OPEN_ENDED_CREDIT_THRESHOLD = 0.6;
const sm = "@media (min-width: 640px)";
const dark = ".dark &";

const shared = {
	stack1: css({ display: "grid", gap: "0.25rem" }),
	stack2: css({ display: "grid", gap: "0.5rem" }),
	stack3: css({ display: "grid", gap: "0.75rem" }),
	rowCenter2: css({ display: "flex", alignItems: "center", gap: "0.5rem" }),
	rowStart2: css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" }),
	rowStart3: css({ display: "flex", alignItems: "flex-start", gap: "0.75rem" }),
	minFlex: css({ minWidth: 0, flex: 1 }),
	mutedText: css({ color: "var(--muted-foreground)" }),
	breakWords: css({ overflowWrap: "break-word" }),
};

const quizStyles = {
	optionBase: css({
		position: "relative",
		display: "flex",
		minHeight: "2.75rem",
		width: "100%",
		alignItems: "center",
		gap: "0.75rem",
		border: 0,
		borderBottom: "1px solid var(--border)",
		borderRadius: "0.25rem",
		background: "transparent",
		padding: "0.625rem 0.75rem",
		fontSize: "0.875rem",
		textAlign: "left",
		cursor: "pointer",
		transition: "background-color 150ms, color 150ms, transform 120ms",
		_hover: { background: "color-mix(in srgb, var(--accent) 72%, transparent)" },
		_active: { transform: "translateY(1px)" },
		_focusVisible: {
			outline: "3px solid var(--accent-green, var(--ring))",
			outlineOffset: "2px",
		},
	}),
	optionCorrect: css({
		background: "color-mix(in srgb, var(--accent-green) 13%, transparent)",
		color: "#047857",
		[dark]: { color: "#6ee7b7" },
	}),
	optionWrong: css({
		background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
		color: "var(--destructive)",
	}),
	optionSelected: css({
		background: "color-mix(in srgb, var(--arena-accent, var(--primary)) 14%, transparent)",
		color: "color-mix(in srgb, var(--arena-accent, var(--primary)) 70%, var(--foreground))",
	}),
	optionNeutral: css({}),
	disabled: css({ cursor: "not-allowed", opacity: 0.7 }),
	checkboxBase: css({
		display: "flex",
		height: "1rem",
		width: "1rem",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: "0.25rem",
		borderWidth: "2px",
	}),
	checkboxSelected: css({
		borderColor: "var(--primary)",
		background: "var(--primary)",
		color: "var(--primary-foreground)",
	}),
	checkboxNeutral: css({ borderColor: "var(--border)" }),
	iconButton: css({
		display: "inline-flex",
		height: "2.75rem",
		width: "2.75rem",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: "0.25rem",
		color: "var(--muted-foreground)",
		transition: "color 150ms, background-color 150ms",
		_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
		_focusVisible: {
			outline: "3px solid var(--accent-green, var(--ring))",
			outlineOffset: "2px",
		},
	}),
	// The quiz shell already draws a frame; question bodies are spacing only so
	// options don't read as boxes nested inside a box.
	card: css({
		display: "grid",
		gap: "1rem",
	}),
	// Frameless result sections, separated by a rule rather than another border.
	section: css({
		display: "grid",
		gap: "0.75rem",
		borderTop: "1px solid var(--border)",
		paddingTop: "1.25rem",
	}),
	sectionTitle: css({
		display: "flex",
		alignItems: "center",
		gap: "0.5rem",
		fontSize: "0.75rem",
		fontWeight: 600,
		letterSpacing: "0.04em",
		textTransform: "uppercase",
		color: "var(--muted-foreground)",
	}),
	fieldBase: css({
		width: "100%",
		borderRadius: "0.375rem",
		border: "1px solid",
		background: "var(--background)",
		padding: "0.5rem 0.75rem",
		fontSize: "0.875rem",
		outline: "none",
		_focus: { borderColor: "var(--primary)" },
		"&::placeholder": { color: "var(--muted-foreground)" },
	}),
	inputNeutral: css({ borderColor: "var(--border)" }),
	inputCorrect: css({
		borderColor: "rgba(16, 185, 129, 0.6)",
		background: "rgba(16, 185, 129, 0.05)",
	}),
	inputWrong: css({
		borderColor: "color-mix(in srgb, var(--destructive) 60%, transparent)",
		background: "color-mix(in srgb, var(--destructive) 5%, transparent)",
	}),
	buttonSecondary: css({
		display: "inline-flex",
		minHeight: "2.75rem",
		alignItems: "center",
		gap: "0.25rem",
		borderRadius: "0.5rem",
		borderWidth: "1px",
		borderColor: "var(--border)",
		background: "var(--background)",
		padding: "0.5rem 0.75rem",
		fontSize: "0.875rem",
		fontWeight: 500,
		transition: "background-color 150ms",
		_hover: { background: "var(--accent)" },
		_focusVisible: {
			outline: "3px solid var(--accent-green, var(--ring))",
			outlineOffset: "2px",
		},
		_disabled: { opacity: 0.4, pointerEvents: "none" },
	}),
	buttonPrimary: css({
		display: "inline-flex",
		minHeight: "2.75rem",
		alignItems: "center",
		gap: "0.25rem",
		borderRadius: "0.5rem",
		borderWidth: "1px",
		borderColor: "var(--primary)",
		background: "var(--primary)",
		padding: "0.5rem 1rem",
		fontSize: "0.875rem",
		fontWeight: 500,
		color: "var(--primary-foreground)",
		transition: "background-color 150ms",
		_hover: { background: "color-mix(in srgb, var(--primary) 90%, transparent)" },
		_focusVisible: {
			outline: "3px solid var(--accent-green, var(--ring))",
			outlineOffset: "2px",
		},
		_disabled: { opacity: 0.4, pointerEvents: "none" },
	}),
	shell: css({
		position: "relative",
		isolation: "isolate",
		display: "grid",
		gap: "1rem",
		marginBlock: "0.5rem",
		paddingBlock: "0.75rem",
		color: "var(--foreground)",
		[sm]: { marginBlock: "0.75rem", gap: "1.25rem", paddingBlock: "1rem" },
	}),
	effectHeader: css({
		position: "relative",
		display: "grid",
		minHeight: "7.25rem",
		alignContent: "space-between",
		gap: "0.875rem",
		overflow: "hidden",
		borderRadius: "0.625rem",
		background: "var(--crt)",
		padding: { base: "0.875rem", sm: "1rem 1.125rem" },
		color: "var(--phosphor)",
	}),
	effectHeaderContent: css({
		position: "relative",
		zIndex: 1,
		display: "flex",
		flexWrap: "wrap",
		alignItems: "flex-start",
		justifyContent: "space-between",
		gap: "0.75rem",
	}),
	topic: css({
		minWidth: 0,
		maxWidth: "62ch",
		overflowWrap: "anywhere",
		fontFamily: "var(--mono-display, var(--font-mono))",
		fontSize: "1rem",
		fontWeight: 700,
		lineHeight: 1.35,
	}),
	headerMeta: css({
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "flex-end",
		gap: "0.5rem",
		fontFamily: "var(--mono-body, var(--font-mono))",
		fontSize: "0.6875rem",
		fontVariantNumeric: "tabular-nums",
		color: "var(--phosphor-dim)",
	}),
	headerInstruments: css({
		display: "grid",
		justifyItems: "end",
		gap: "0.375rem",
	}),
	timer: css({
		"--timer-color": "var(--arena-accent, var(--phosphor))",
		display: "grid",
		minWidth: { base: "7.25rem", sm: "8.75rem" },
		justifyItems: "end",
		gap: "0.25rem",
		color: "var(--timer-color)",
		"&[data-urgency=warning]": {
			"--timer-color": "var(--amber, #e8a33d)",
		},
		"&[data-urgency=critical]": {
			"--timer-color": "var(--red, #d95f4f)",
		},
	}),
	timerDigits: css({
		display: "inline-flex",
		alignItems: "center",
		gap: "0.4rem",
		fontFamily: "var(--mono-display, var(--font-mono))",
		fontSize: { base: "1.75rem", sm: "2.125rem" },
		fontWeight: 700,
		fontVariantNumeric: "tabular-nums",
		fontFeatureSettings: "\"tnum\" 1",
		letterSpacing: "-0.03em",
		lineHeight: 1,
		textShadow: "0 0 16px color-mix(in srgb, var(--timer-color) 55%, transparent)",
	}),
	timerTrack: css({
		width: "100%",
		height: "0.3125rem",
		overflow: "hidden",
		borderRadius: "9999px",
		background: "color-mix(in srgb, var(--timer-color) 19%, transparent)",
	}),
	timerFill: css({
		height: "100%",
		borderRadius: "inherit",
		background: "var(--timer-color)",
		boxShadow: "0 0 10px color-mix(in srgb, var(--timer-color) 72%, transparent)",
		transformOrigin: "left center",
		transition: "transform 900ms linear, background-color 150ms",
	}),
	effectSelectLabel: css({
		display: "inline-flex",
		alignItems: "center",
		gap: "0.25rem",
	}),
	effectSelect: css({
		maxWidth: "7.25rem",
		border: 0,
		borderBottom: "1px solid color-mix(in srgb, var(--phosphor) 52%, transparent)",
		borderRadius: 0,
		background: "transparent",
		padding: "0.125rem 1.15rem 0.125rem 0.125rem",
		font: "inherit",
		color: "var(--phosphor)",
		outline: "none",
		_focusVisible: {
			outline: "2px solid var(--phosphor)",
			outlineOffset: "2px",
		},
		"& option": {
			background: "var(--crt)",
			color: "var(--phosphor)",
		},
	}),
	progressRow: css({
		position: "relative",
		zIndex: 1,
		display: "flex",
		alignItems: "center",
		gap: "0.625rem",
	}),
	progressTrack: css({
		height: "0.375rem",
		flex: 1,
		overflow: "hidden",
		borderRadius: "9999px",
		background: "color-mix(in srgb, var(--phosphor) 18%, transparent)",
	}),
	progressFill: css({
		height: "100%",
		borderRadius: "inherit",
		background: "var(--arena-accent, var(--phosphor))",
		boxShadow: "0 0 12px color-mix(in srgb, var(--arena-accent, var(--phosphor)) 65%, transparent)",
		transformOrigin: "left center",
		transition: "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
	}),
	questionStage: css({
		position: "relative",
		minWidth: 0,
		paddingInline: { base: "0.125rem", sm: "0.5rem" },
	}),
	nav: css({
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.5rem",
		paddingInline: { base: "0.125rem", sm: "0.5rem" },
	}),
	resultIntro: css({
		display: "grid",
		gap: "0.25rem",
	}),
	resultSignal: css({
		fontFamily: "var(--mono-display, var(--font-mono))",
		fontSize: "1.25rem",
		fontWeight: 700,
	}),
	resultMeta: css({
		display: "flex",
		flexWrap: "wrap",
		gap: "0.5rem 0.875rem",
		fontSize: "0.75rem",
		color: "var(--muted-foreground)",
	}),
	empty: css({
		display: "grid",
		minHeight: "8rem",
		placeItems: "center",
		borderBlock: "1px solid var(--border)",
		padding: "1rem",
		textAlign: "center",
		color: "var(--muted-foreground)",
	}),
	visuallyHidden: css({
		position: "absolute",
		width: "1px",
		height: "1px",
		overflow: "hidden",
		clip: "rect(0 0 0 0)",
		whiteSpace: "nowrap",
	}),
};

export function isOpenEnded(q: QuizQuestion): boolean {
	if (q.type === "short_answer" || q.type === "transfer") return true;
	// Single-blank fill_in is free text; multi-blank fill_in is graded per blank.
	if (q.type === "fill_in" && !(q.blanks && q.blanks.length > 0)) return true;
	return false;
}

function isCorrect(q: QuizQuestion, rawAnswer: string): boolean {
	if (q.type === "multi_select" && q.correctAnswers) {
		const selected = new Set(rawAnswer.split(",").map((s) => s.trim()).filter(Boolean));
		return (
			q.correctAnswers.length === selected.size &&
			q.correctAnswers.every((c) => selected.has(c))
		);
	}
	if (q.type === "fill_in" && q.blanks && q.blanks.length > 0) {
		const userAnswers = rawAnswer.split("|").map((s) => s.trim());
		const correctAnswers = q.correctAnswers ?? [q.correctAnswer];
		if (userAnswers.length !== correctAnswers.length) return false;
		return userAnswers.every((a, i) => a.toLowerCase() === correctAnswers[i].trim().toLowerCase());
	}
	if (isOpenEnded(q)) {
		return questionCredit(q, rawAnswer) >= OPEN_ENDED_CREDIT_THRESHOLD;
	}
	return rawAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
}

function QuizOption({ label, index, selected, onClick, disabled, status, checkbox }: {
	label: string;
	index?: number;
	selected: boolean;
	onClick: () => void;
	disabled?: boolean;
	status?: "correct" | "wrong" | "neutral";
	checkbox?: boolean;
}) {
	return <AnswerTile label={label} index={index} selected={selected} onClick={onClick} disabled={disabled} status={status} multiple={checkbox} />;
}

function ReframeToggle({
	modes,
	active,
	onChange,
}: {
	modes: string[];
	active: string | null;
	onChange: (mode: string | null) => void;
}) {
	if (modes.length === 0) return null;
	return (
		<label className={css({ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
			<span>View</span>
			<Select
				aria-label="Question wording"
				value={active ?? ""}
				onValueChange={(value) => onChange(value || null)}
				className={css({
					border: 0,
					borderBottom: "1px solid var(--border)",
					borderRadius: 0,
					background: "transparent",
					padding: "0.2rem 1.25rem 0.2rem 0.125rem",
					fontSize: "0.6875rem",
					color: "var(--foreground)",
					_focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" },
				})}
			>
				<option value="">Default</option>
				{modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
			</Select>
		</label>
	);
}

function quizShaderAccent(preset: FlashcardShaderPreset): string {
	if (preset === "solar" || preset === "contour") return "var(--amber, #e8a33d)";
	if (preset === "prism") return "var(--red, #d95f4f)";
	if (preset === "current" || preset === "orbit") return "#67d7e8";
	if (preset === "still") return "var(--phosphor-dim, #9bd8ad)";
	return "var(--phosphor, #4be388)";
}

function quizQuestionEntryClass(preset: FlashcardShaderPreset): string {
	return preset === "still" ? "quiz-question-enter" : `quiz-question-enter-${preset}`;
}

function stableQuizSeed(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 0xffffffff * 131;
}

function showsBinaryResult(q: QuizQuestion): boolean {
	return q.type !== "short_answer" && q.type !== "transfer" && q.type !== "fill_in";
}

function QuizResultBadge({ correct }: { correct: boolean }) {
	return (
		<span
			className={cx(
				css({
					display: "inline-flex",
					alignItems: "center",
					gap: "0.25rem",
					borderRadius: "9999px",
					border: "1px solid",
					padding: "0.125rem 0.5rem",
					fontSize: "0.6875rem",
					fontWeight: 500,
				}),
				correct
					? css({
						borderColor: "rgba(16, 185, 129, 0.5)",
						background: "rgba(16, 185, 129, 0.1)",
						color: "#047857",
						[dark]: { color: "#6ee7b7" },
					})
					: css({
						borderColor: "color-mix(in srgb, var(--destructive) 50%, transparent)",
						background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
						color: "var(--destructive)",
					}),
			)}
		>
			{correct ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
			{correct ? "Correct" : "Incorrect"}
		</span>
	);
}

function MultiBlankFillIn({
	question,
	blanks,
	answer,
	onChange,
	revealed,
	correctAnswers,
}: {
	question: string;
	blanks: { placeholder?: string; hint?: string }[];
	answer: string;
	onChange: (val: string) => void;
	revealed: boolean;
	correctAnswers: string[];
}) {
	const values = useMemo(() => answer.split("|").map((s) => s.trim()), [answer]);
	const parts = useMemo(() => parseQuestionTemplate(question), [question]);
	const blankRefs = useRef<(HTMLInputElement | null)[]>([]);

	const setValue = (idx: number, val: string) => {
		const next = [...values];
		next[idx] = val;
		onChange(next.join("|"));
	};

	let blankCounter = 0;
	return (
		<div className={css({ minWidth: 0 })}>
			<div className={css({ fontSize: "0.875rem", fontWeight: 500, lineHeight: "1.75rem", overflowWrap: "break-word" })}>
				{parts.map((part, idx) => {
					if (!part.isBlank) {
						return <span key={idx} className={css({ whiteSpace: "pre-wrap", overflowWrap: "break-word" })}>{part.text}</span>;
					}
					const bIdx = blankCounter++;
					const blankDef = blanks[bIdx];
					const isCorrect = revealed && values[bIdx]?.trim().toLowerCase() === correctAnswers[bIdx]?.trim().toLowerCase();
					const isWrong = revealed && values[bIdx]?.trim() && !isCorrect;
					return (
						<span key={idx} className={css({ display: "inline-flex", maxWidth: "100%", alignItems: "baseline", gap: "0.25rem", marginInline: "0.25rem", verticalAlign: "baseline" })}>
							<input
								ref={(el) => { blankRefs.current[bIdx] = el; }}
								type="text"
								disabled={revealed}
								aria-label={blankDef?.hint ? `${blankDef.hint} blank` : `Blank ${bIdx + 1}`}
								title={blankDef?.hint}
								className={cx(
									quizStyles.fieldBase, "activity-field",
									css({ display: "inline-block", height: "1.75rem", width: "7rem", paddingInline: "0.5rem", textAlign: "center", [sm]: { width: "10rem" }, "&::placeholder": { color: "color-mix(in srgb, var(--muted-foreground) 50%, transparent)" } }),
									isCorrect ? quizStyles.inputCorrect : isWrong ? quizStyles.inputWrong : quizStyles.inputNeutral,
								)}
								placeholder={blankDef?.placeholder ?? "___"}
								value={values[bIdx] ?? ""}
								onChange={(e) => setValue(bIdx, e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										const nextBlank = blankRefs.current[bIdx + 1];
										if (nextBlank) nextBlank.focus();
									}
								}}
							/>
							{revealed && (
								<span className={css({ fontSize: "0.625rem", color: isCorrect ? "#059669" : "var(--destructive)" })}>
									{isCorrect ? "✓" : `✗ ${correctAnswers[bIdx] ?? ""}`}
								</span>
							)}
						</span>
					);
				})}
			</div>
		</div>
	);
}

function QuestionCard({
	q,
	index,
	answer,
	onChange,
	revealed,
	timeMs,
	timedOut = false,
	bookmarked,
	onToggleBookmark,
	onSpeak,
	reframeMode,
	onReframe,
}: {
	q: QuizQuestion;
	index: number;
	answer: string;
	onChange: (val: string) => void;
	revealed: boolean;
	timeMs?: number;
	timedOut?: boolean;
	bookmarked: boolean;
	onToggleBookmark: () => void;
	onSpeak: () => void;
	reframeMode?: string | null;
	onReframe?: (mode: string | null) => void;
}) {
	const credit = questionCredit(q, answer);
	const correct = isCorrect(q, answer);
	const wrong = revealed && answer.trim() && !correct;
	const binaryCorrect = credit >= 1;
	const isMultiBlankFillIn = q.type === "fill_in" && !!q.blanks?.length;

	const displayQuestion = useMemo(() => {
		if (reframeMode && q.reframes?.[reframeMode]) {
			return q.reframes[reframeMode];
		}
		return q.question;
	}, [q, reframeMode]);

	const reframeModes = useMemo(() => {
		if (!q.reframes) return [];
		return Object.keys(q.reframes);
	}, [q.reframes]);

	const selectedMulti = useMemo(() => {
		if (q.type !== "multi_select") return [];
		return answer.split(",").map((s) => s.trim()).filter(Boolean);
	}, [answer, q.type]);

	const toggleMulti = (opt: string) => {
		const set = new Set(selectedMulti);
		if (set.has(opt)) set.delete(opt);
		else set.add(opt);
		onChange(Array.from(set).join(","));
	};

	return (
		<div className={quizStyles.card}>
			<div className={css({ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "0.5rem", [sm]: { flexDirection: "row", alignItems: "flex-start" } })}>
					<div className={cx(shared.minFlex, shared.stack2)}>
						{revealed ? (
							<span className={cx("font-terminal", css({ fontSize: "0.6875rem", color: "var(--muted-foreground)" }))}>
								{index + 1} · {q.level}
							</span>
						) : null}
						<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "0.5rem" })}>
						{isMultiBlankFillIn ? (
							<div className={shared.minFlex}>
								<MultiBlankFillIn
									question={displayQuestion}
									blanks={q.blanks ?? []}
									answer={answer}
									onChange={onChange}
									revealed={revealed}
									correctAnswers={q.correctAnswers ?? [q.correctAnswer]}
								/>
							</div>
							) : (
								<p className="activity-prompt">{displayQuestion}</p>
							)}
						{revealed && showsBinaryResult(q) && <QuizResultBadge correct={binaryCorrect} />}
					</div>
					{reframeModes.length > 0 && !revealed && onReframe && (
						<ReframeToggle
							modes={reframeModes}
							active={reframeMode ?? null}
							onChange={(mode) => {
								onReframe(mode);
								// If the selected mode has no pre-generated reframe, request one from the agent
								if (mode && !q.reframes?.[mode]) {
									window.dispatchEvent(
										new CustomEvent("keating:quiz-reframe-requested", {
											detail: { questionId: q.id, mode, topic: q.question },
										})
									);
								}
							}}
						/>
					)}
				</div>
				<div className={css({ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "flex-end", gap: "0.25rem" })}>
					<button
						type="button"
						onClick={onSpeak}
						className={quizStyles.iconButton}
						aria-label="Read question aloud"
						title="Read aloud"
					>
						<Volume2 size={14} />
					</button>
					<button
						type="button"
						onClick={onToggleBookmark}
						className={cx(
							quizStyles.iconButton,
							bookmarked && css({ color: "#f59e0b", _hover: { color: "#f59e0b" } }),
						)}
						aria-label={bookmarked ? "Remove bookmark" : "Bookmark question"}
						title={bookmarked ? "Bookmarked" : "Bookmark for review"}
					>
						<Bookmark size={14} fill={bookmarked ? "currentColor" : "none"} />
					</button>
					{revealed && timedOut ? <span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Timed out</span> : null}
					{revealed && isQuickQuizAnswer({ timeMs, timeLimitSeconds: q.timeLimit, answered: Boolean(answer.trim()), timedOut }) ? <span title="Answered within the first quarter of the time budget. Timing does not indicate correctness." className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Quick answer</span> : null}
					{revealed && typeof timeMs === "number" && (
						<span className={cx("font-terminal", css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.625rem", color: "var(--muted-foreground)" }))}>
							<Clock size={11} aria-hidden="true" />
							<span aria-label={`Time on question: ${timeMs} milliseconds`}>{formatQuizDuration(timeMs)}</span>
						</span>
					)}
				</div>
			</div>

			{q.type === "multiple_choice" && q.options && (
				<div className="activity-answer-grid">
					{q.options.map((opt, optionIndex) => {
						const chosen = answer === opt;
						let status: "correct" | "wrong" | "neutral" | undefined;
						if (revealed) {
							if (opt === q.correctAnswer) status = "correct";
							else if (chosen) status = "wrong";
						}
						return (
							<QuizOption
								key={opt}
								label={opt}
								index={optionIndex}
								selected={chosen}
								onClick={() => onChange(opt)}
								disabled={revealed}
								status={status}
							/>
						);
					})}
				</div>
			)}

			{q.type === "multi_select" && q.options && (
				<div className="activity-answer-grid">
					{q.options.map((opt, optionIndex) => {
						const chosen = selectedMulti.includes(opt);
						let status: "correct" | "wrong" | "neutral" | undefined;
						if (revealed) {
							const isCorrectOpt = q.correctAnswers?.includes(opt) ?? false;
							if (isCorrectOpt) status = "correct";
							else if (chosen) status = "wrong";
						}
						return (
							<QuizOption
								key={opt}
								label={opt}
								index={optionIndex}
								selected={chosen}
								onClick={() => toggleMulti(opt)}
								disabled={revealed}
								status={status}
								checkbox
							/>
						);
					})}
				</div>
			)}

			{(q.type === "short_answer" || q.type === "fill_in" || q.type === "transfer") && !isMultiBlankFillIn && (
				<div className={shared.stack2}>
					<textarea
						className={cx(
							quizStyles.fieldBase, "activity-field",
							css({ minHeight: "80px", resize: "none" }),
							revealed && q.type === "fill_in"
								? wrong
									? quizStyles.inputWrong
									: correct
										? quizStyles.inputCorrect
										: quizStyles.inputNeutral
								: quizStyles.inputNeutral,
						)}
						aria-label="Your answer"
						placeholder={q.type === "fill_in" ? "Fill in the blank..." : "Type your answer..."}
						value={answer}
						onChange={(e) => onChange(e.target.value)}
						disabled={revealed}
					/>
						{revealed && !(q.type === "fill_in" && q.blanks && q.blanks.length > 0) && (
							<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.625rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
								<Lightbulb size={14} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--accent)" })} />
								<div className={shared.stack1}>
									<p>
										<span className={css({ fontWeight: 600, color: "var(--foreground)" })}>{q.correctAnswer}</span>
									</p>
									{isOpenEnded(q) && (
										<p className={css({ fontSize: "0.625rem" })}>
											Teacher review pending{credit > 0 ? ` · ${credit >= 0.6 ? "close match" : "partial match"}` : ""}.
										</p>
									)}
									{q.explanation && <p>{q.explanation}</p>}
									{q.rubric && <p className={css({ fontSize: "0.625rem" })}>{q.rubric}</p>}
								</div>
						</div>
					)}
				</div>
			)}

			{q.type === "true_false" && (
				<div className={css({ display: "flex", gap: "0.75rem" })}>
					{["True", "False"].map((opt, optionIndex) => {
						const chosen = answer === opt;
						let status: "correct" | "wrong" | "neutral" | undefined;
						if (revealed) {
							if (opt === q.correctAnswer) status = "correct";
							else if (chosen) status = "wrong";
						}
						return (
							<QuizOption
								key={opt}
								label={opt}
								index={optionIndex}
								selected={chosen}
								onClick={() => onChange(opt)}
								disabled={revealed}
								status={status}
							/>
						);
					})}
				</div>
			)}

			{q.type === "slider" && (
				<div className={shared.stack3}>
					<div className={shared.rowCenter2}>
						<span className={cx("font-terminal", css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }))}>{q.min ?? 0}</span>
						<input
							type="range"
							aria-label={displayQuestion}
							min={q.min ?? 0}
							max={q.max ?? 100}
							step={q.step ?? 1}
							value={answer ? parseFloat(answer) : (q.min ?? 0)}
							onChange={(e) => onChange(e.target.value)}
							disabled={revealed}
							className={css({ flex: 1, accentColor: "var(--primary)" })}
						/>
						<span className={cx("font-terminal", css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }))}>{q.max ?? 100}</span>
					</div>
					<div className={css({ textAlign: "center", fontSize: "0.875rem", fontWeight: 500 })}>
						{answer || (q.min ?? 0).toString()}
					</div>
						{revealed && (
							<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.625rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
								<Lightbulb size={14} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--accent)" })} />
								<div className={shared.stack1}>
									<p>
										<span className={css({ fontWeight: 600, color: "var(--foreground)" })}>{q.correctAnswer}</span>
									</p>
								{q.explanation && <p>{q.explanation}</p>}
							</div>
						</div>
					)}
				</div>
			)}

			{q.type === "dropdown" && q.options && (
				<div className={shared.stack2}>
					<Select
						aria-label={displayQuestion}
						value={answer}
						onValueChange={(value) => onChange(value)}
						disabled={revealed}
						className={cx(
							quizStyles.fieldBase, "activity-field",
							revealed ? (correct ? quizStyles.inputCorrect : quizStyles.inputWrong) : quizStyles.inputNeutral,
						)}
					>
						<option value="" disabled>
							Select an answer...
						</option>
						{q.options.map((opt) => (
							<option key={opt} value={opt}>
								{opt}
							</option>
						))}
					</Select>
						{revealed && (
							<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.625rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
								<Lightbulb size={14} className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--accent)" })} />
								<div className={shared.stack1}>
									<p>
										<span className={css({ fontWeight: 600, color: "var(--foreground)" })}>{q.correctAnswer}</span>
									</p>
								{q.explanation && <p>{q.explanation}</p>}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Partial credit badge */}
			{revealed && credit < 1 && credit > 0 && (
				<div className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "9999px", background: "rgba(245, 158, 11, 0.1)", padding: "0.25rem 0.625rem", fontSize: "0.6875rem", fontWeight: 500, color: "#d97706", [dark]: { color: "#f59e0b" } })}>
					<AlertTriangle size={12} />
					Partial credit: {Math.round(credit * 100)}%
				</div>
			)}
		</div>
	);
}

function RemediationDashboard({
	quiz,
	answers,
	onRequestRemediation,
}: {
	quiz: Quiz;
	answers: Record<string, string>;
	onRequestRemediation?: (level: string) => void;
}) {
	const levels = ["recall", "comprehension", "application", "analysis", "transfer"] as const;
	const stats = useMemo(() => {
		const map: Record<string, { total: number; missed: number }> = {};
		for (const level of levels) {
			const questions = quiz.questions.filter((q) => q.level === level && !q.fallbackFor);
			if (questions.length === 0) continue;
			let missed = 0;
			for (const q of questions) {
				if (!isCorrect(q, answers[q.id] || "")) missed++;
			}
			map[level] = { total: questions.length, missed };
		}
		return map;
	}, [quiz, answers]);

	const [requested, setRequested] = useState<Set<string>>(new Set());

	const hasMissed = Object.values(stats).some((s) => s.missed > 0);
	if (!hasMissed) return null;

	return (
		<div className={quizStyles.section}>
			<div className={quizStyles.sectionTitle}>
				<GraduationCap size={14} className={css({ color: "var(--primary)" })} />
				<span>Review these</span>
			</div>
			<div className={css({ display: "grid", gap: "0.875rem" })}>
				{levels.map((level) => {
					const s = stats[level];
					if (!s || s.missed === 0) return null;
					const pct = s.total > 0 ? s.missed / s.total : 0;
					return (
						<div key={level} className={shared.stack1}>
							<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.75rem" })}>
								<span className={css({ textTransform: "capitalize", fontWeight: 500 })}>{level}</span>
								<span className={shared.mutedText}>{s.missed}/{s.total} missed</span>
							</div>
							<div className={shared.rowCenter2}>
								<div className={css({ height: "0.5rem", flex: 1, overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
									<div
										className={css({ height: "100%", borderRadius: "9999px", background: "var(--destructive)" })}
										style={{ width: `${pct * 100}%` }}
									/>
								</div>
								<button
									type="button"
									disabled={requested.has(level)}
									onClick={() => {
										onRequestRemediation?.(level);
										setRequested((prev) => new Set(prev).add(level));
									}}
									className={css({ flexShrink: 0, fontSize: "0.625rem", fontWeight: 500, color: "var(--primary)", _hover: { textDecoration: "underline" }, _disabled: { color: "var(--muted-foreground)", textDecoration: "none" } })}
								>
									{requested.has(level) ? "Requested ✓" : "Review"}
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function BenchmarkComparison({
	score,
	partialCreditPoints,
	total,
	stats,
}: {
	score: number;
	partialCreditPoints: number;
	total: number;
	stats: TopicStats | null | undefined;
}) {
	if (!stats || stats.count < 5 || total <= 0) return null;
	const pct = (score / total) * 100;
	const avgPct = (stats.avgScore / total) * 100;
	const qPct = (stats.topQuartile / total) * 100;
	const maxBar = Math.max(pct, avgPct, qPct, 1);

	return (
		<div className={quizStyles.section}>
			<div className={quizStyles.sectionTitle}>
				<TrendingUp size={14} className={css({ color: "var(--primary)" })} />
				<span>vs {stats.count} past sessions</span>
			</div>
			<div className={shared.stack2}>
				{[
					{ label: "Your score", value: pct, color: "var(--primary)" },
					{ label: "Session avg", value: avgPct, color: "var(--muted-foreground)" },
					{ label: "Top quartile", value: qPct, color: "#10b981" },
				].map((row) => (
					<div key={row.label} className={shared.stack1}>
						<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.75rem" })}>
							<span className={shared.mutedText}>{row.label}</span>
							<span className={cx("font-terminal", css({ fontVariantNumeric: "tabular-nums" }))}>
								{Math.round(row.value)}%
							</span>
						</div>
						<div className={css({ height: "0.5rem", overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
							<div
								className={css({ height: "100%", borderRadius: "9999px", background: row.color, transition: "all 150ms" })}
								style={{ width: `${(row.value / maxBar) * 100}%` }}
							/>
						</div>
					</div>
				))}
			</div>
			{typeof partialCreditPoints === "number" && stats.avgPartialCreditPoints > 0 && (
				<div className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
					Average partial credit {stats.avgPartialCreditPoints.toFixed(2)}/{total}
				</div>
			)}
		</div>
	);
}

export function QuizRenderer({
	quiz,
	onSubmit,
	topicStats,
	defaultShaderPreset,
}: QuizRendererProps) {
	const posthog = usePostHog();
	const questions = useMemo(() => uniqueQuizQuestions(quiz.questions), [quiz.questions]);
	const normalizedQuiz = useMemo(() => ({ ...quiz, questions }), [questions, quiz]);
	const quizIdentity = `${quiz.slug ?? quiz.topic}:${questions.map((question) => question.id).join("|")}`;
	const [answers, setAnswers] = useState<AnswerState>({});
	const [revealed, setRevealed] = useState(false);
	const [current, setCurrent] = useState(0);
	const [isQuestionPending, startQuestionTransition] = useTransition();
	const [elapsed, setElapsed] = useState(0);
	const [bookmarkIds, setBookmarkIds] = useState<string[]>(() => loadBookmarkIds());
	const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
	const [reframeModes, setReframeModes] = useState<Record<string, string | null>>({});
	const [fetchedStats, setFetchedStats] = useState<TopicStats | null | undefined>(topicStats);
	const [shaderPreset, setShaderPreset] = useState<FlashcardShaderPreset>(() => (
		loadQuizShaderPreset(quizIdentity, defaultShaderPreset)
	));
	const resultIdRef = useRef(createQuizResultId(quiz.slug ?? quiz.topic));
	const submittedRef = useRef(false);
	const previousQuizIdentityRef = useRef(quizIdentity);

	// Timing: total wall-clock plus accrued time per question while stepping.
	const startRef = useRef<number>(Date.now());
	const questionEnteredRef = useRef<number>(startRef.current);
	const perQuestionRef = useRef<Record<string, number>>({});
	const finalTimingRef = useRef<QuizTiming | null>(null);
	const timedOutIdsRef = useRef(new Set<string>());
	const [timedOutIds, setTimedOutIds] = useState<Set<string>>(new Set());
	const deadlineRef = useRef<{ questionId: string; at: number } | undefined>(undefined);

	const visibleQuestions = useMemo(
		() => questions.filter((question) => !skippedIds.has(question.id)),
		[questions, skippedIds],
	);
	const totalVisible = visibleQuestions.length;
	const scorableQuestions = useMemo(
		() => visibleQuestions.filter((question) => !isOpenEnded(question)),
		[visibleQuestions],
	);
	const pendingReviewCount = totalVisible - scorableQuestions.length;
	const totalScored = scorableQuestions.length;
	const currentQuestion = visibleQuestions[current];
	const timeLimit = currentQuestion?.timeLimit;
	const [questionTimer, setQuestionTimer] = useState<{ questionId?: string; remaining?: number }>({ questionId: currentQuestion?.id, remaining: timeLimit });
	const timeRemaining = questionTimer.questionId === currentQuestion?.id ? questionTimer.remaining : timeLimit;

	const accrueCurrent = useCallback((now = Date.now()) => {
		const questionId = visibleQuestions[current]?.id;
		if (!questionId) return;
		const deadline = deadlineRef.current;
		const resolvedAt = deadline?.questionId === questionId ? Math.min(now, deadline.at) : now;
		perQuestionRef.current[questionId] = (perQuestionRef.current[questionId] ?? 0) + Math.max(0, resolvedAt - questionEnteredRef.current);
		questionEnteredRef.current = now;
	}, [current, visibleQuestions]);

	const recordTimeout = useCallback((now: number) => {
		const deadline = deadlineRef.current;
		if (!deadline || deadline.questionId !== currentQuestion?.id || now < deadline.at) return;
		if (!timedOutIdsRef.current.has(deadline.questionId)) {
			timedOutIdsRef.current.add(deadline.questionId);
			setTimedOutIds(new Set(timedOutIdsRef.current));
		}
	}, [currentQuestion?.id]);

	const partialCredits = useMemo(() => {
		const map: Record<string, number> = {};
		for (const question of scorableQuestions) {
			map[question.id] = questionCredit(question, answers[question.id] || "");
		}
		return map;
	}, [answers, scorableQuestions]);

	const rawScore = useMemo(() => {
		let correct = 0;
		for (const question of scorableQuestions) {
			if (isCorrect(question, answers[question.id] || "")) correct++;
		}
		return correct;
	}, [answers, scorableQuestions]);

	const partialCreditPoints = useMemo(
		() => scorableQuestions.reduce((sum, question) => sum + (partialCredits[question.id] ?? 0), 0),
		[partialCredits, scorableQuestions],
	);
	const percent = totalScored > 0 ? Math.round((rawScore / totalScored) * 100) : 0;
	const answeredCount = visibleQuestions.filter((question) => (answers[question.id] || "").trim().length > 0).length;
	const allAnswered = totalVisible > 0 && answeredCount === totalVisible;

	const doSubmit = useCallback(() => {
		if (submittedRef.current || totalVisible === 0) return;
		submittedRef.current = true;
		const now = Date.now();
		recordTimeout(now);
		const deadline = deadlineRef.current;
		const completedAt = deadline?.questionId === currentQuestion?.id ? Math.min(now, deadline.at) : now;
		accrueCurrent(completedAt);
		const timing: QuizTiming = {
			totalMs: Math.max(0, completedAt - startRef.current),
			perQuestionMs: { ...perQuestionRef.current },
		};
		finalTimingRef.current = timing;
		setElapsed(timing.totalMs);
		setRevealed(true);
		posthog.capture("quiz_completed", {
			question_count: questions.length,
			score: rawScore,
			partial_credit_points: partialCreditPoints,
			duration_ms: timing.totalMs,
		});
		onSubmit?.({
			resultId: resultIdRef.current,
			answers,
			score: rawScore,
			partialCreditPoints,
			timing,
			partialCredits,
			flagged: bookmarkIds,
			timedOutQuestionIds: [...timedOutIdsRef.current],
		});
		quizStorage.saveQuizResult(rawScore, partialCreditPoints, totalScored, quiz.slug, {
			resultId: resultIdRef.current,
			answers,
			partialCredits,
			timing,
			flaggedQuestionIds: bookmarkIds,
			timedOutQuestionIds: [...timedOutIdsRef.current],
			pendingGradeQuestionIds: questions.filter(isOpenEnded).map((question) => question.id),
		}).catch(() => {});
		window.speechSynthesis?.cancel();
	}, [accrueCurrent, answers, bookmarkIds, currentQuestion?.id, onSubmit, partialCreditPoints, partialCredits, posthog, questions, quiz.slug, rawScore, recordTimeout, totalScored, totalVisible]);

	const resetRun = useCallback(() => {
		setAnswers({});
		resultIdRef.current = createQuizResultId(quiz.slug ?? quiz.topic);
		setRevealed(false);
		setCurrent(0);
		setElapsed(0);
		setSkippedIds(new Set());
		setReframeModes({});
		setQuestionTimer({ questionId: questions[0]?.id, remaining: questions[0]?.timeLimit });
		startRef.current = Date.now();
		questionEnteredRef.current = startRef.current;
		timedOutIdsRef.current = new Set();
		deadlineRef.current = undefined;
		setTimedOutIds(new Set());
		perQuestionRef.current = {};
		finalTimingRef.current = null;
		submittedRef.current = false;
		window.speechSynthesis?.cancel();
	}, [questions, quiz.slug, quiz.topic]);

	// Reset state if a parent reuses this component instance for another quiz.
	useEffect(() => {
		if (previousQuizIdentityRef.current === quizIdentity) return;
		previousQuizIdentityRef.current = quizIdentity;
		resetRun();
		setShaderPreset(loadQuizShaderPreset(quizIdentity, defaultShaderPreset));
	}, [defaultShaderPreset, quizIdentity, resetRun]);

	useEffect(() => {
		if (!defaultShaderPreset) return;
		setShaderPreset(resolveQuizShaderPreset(defaultShaderPreset, quizIdentity));
	}, [defaultShaderPreset, quizIdentity]);

	useEffect(() => {
		posthog.capture("quiz_started", {
			question_count: questions.length,
			has_stable_slug: Boolean(quiz.slug),
		});
	}, [posthog, questions.length, quiz.slug, quizIdentity]);

	useEffect(() => {
		if (revealed) return;
		deadlineRef.current = currentQuestion && typeof timeLimit === "number" && Number.isFinite(timeLimit)
			? { questionId: currentQuestion.id, at: questionEnteredRef.current + Math.max(0, timeLimit) * 1000 }
			: undefined;
		setQuestionTimer({ questionId: currentQuestion?.id, remaining: timeLimit });
	}, [currentQuestion?.id, revealed, timeLimit]);

	useEffect(() => {
		if (revealed || typeof timeLimit !== "number" || !currentQuestion) return;
		const questionId = currentQuestion.id;
		const id = window.setInterval(() => {
			if (submittedRef.current || deadlineRef.current?.questionId !== questionId) return;
			const remaining = Math.max(0, Math.ceil((deadlineRef.current.at - Date.now()) / 1000));
			setQuestionTimer((previous) => previous.questionId === questionId && previous.remaining === remaining ? previous : { questionId, remaining });
			if (remaining === 0) window.clearInterval(id);
		}, 100);
		return () => window.clearInterval(id);
	}, [currentQuestion?.id, revealed, timeLimit]);

	const goTo = useCallback((nextIndex: number) => {
		if (nextIndex < 0 || nextIndex >= totalVisible) return;
		const now = Date.now();
		recordTimeout(now);
		accrueCurrent(now);
		startQuestionTransition(() => setCurrent(nextIndex));
	}, [accrueCurrent, recordTimeout, totalVisible]);

	useEffect(() => {
		if (revealed || questionTimer.questionId !== currentQuestion?.id || typeof timeRemaining !== "number" || timeRemaining > 0 || totalVisible === 0) return;
		recordTimeout(Date.now());
		const id = window.setTimeout(() => {
			if (current >= totalVisible - 1) doSubmit();
			else goTo(current + 1);
		}, 200);
		return () => window.clearTimeout(id);
	}, [current, currentQuestion, doSubmit, goTo, questionTimer.questionId, recordTimeout, revealed, timeRemaining, totalVisible]);

	useEffect(() => {
		if (topicStats !== undefined) {
			setFetchedStats(topicStats);
			return;
		}
		let cancelled = false;
		quizStorage.getTopicQuizStats(quiz.slug)
			.then((stats: TopicStats | null) => {
				if (!cancelled) setFetchedStats(stats);
			})
			.catch(() => {
				if (!cancelled) setFetchedStats(null);
			});
		return () => { cancelled = true; };
	}, [quiz.slug, topicStats]);

	useEffect(() => {
		if (revealed || totalVisible === 0) return;
		const id = window.setInterval(() => { if (!submittedRef.current) setElapsed(Math.max(0, Date.now() - startRef.current)); }, 250);
		return () => window.clearInterval(id);
	}, [revealed, totalVisible]);

	// Adaptive branching keeps source order and only removes consecutive fallback
	// questions once the source question clears its configured threshold.
	useEffect(() => {
		if (!quiz.adaptiveRules || !currentQuestion || revealed) return;
		const answer = answers[currentQuestion.id];
		if (!answer?.trim()) return;
		const credit = questionCredit(currentQuestion, answer);
		const rule = quiz.adaptiveRules.find((candidate) => candidate.level === currentQuestion.level);
		if (credit < (rule?.threshold ?? 0.5)) return;
		const sourceIndex = questions.findIndex((question) => question.id === currentQuestion.id);
		const toSkip = new Set<string>();
		for (let index = sourceIndex + 1; index < questions.length; index += 1) {
			const candidate = questions[index];
			if (candidate.fallbackFor === currentQuestion.level) toSkip.add(candidate.id);
			else if (!candidate.fallbackFor) break;
		}
		if (toSkip.size > 0) {
			setSkippedIds((previous) => {
				const next = new Set(previous);
				for (const id of toSkip) next.add(id);
				return next;
			});
		}
	}, [answers, currentQuestion, questions, quiz.adaptiveRules, revealed]);

	useEffect(() => {
		if (totalVisible === 0) {
			if (current !== 0) setCurrent(0);
			return;
		}
		if (current >= totalVisible) setCurrent(totalVisible - 1);
	}, [current, totalVisible]);

	useEffect(() => () => window.speechSynthesis?.cancel(), []);

	const setAnswer = useCallback((questionId: string, value: string) => {
		const deadline = deadlineRef.current;
		if (submittedRef.current || (deadline?.questionId === questionId && Date.now() >= deadline.at)) return;
		setAnswers((previous) => ({ ...previous, [questionId]: value }));
	}, []);

	const toggleBookmark = useCallback((questionId: string) => {
		setBookmarkIds((previous) => {
			const next = previous.includes(questionId)
				? previous.filter((id) => id !== questionId)
				: [...previous, questionId];
			saveBookmarkIds(next);
			return next;
		});
	}, []);

	const speakQuestion = useCallback((text: string) => {
		if (typeof window === "undefined" || !window.speechSynthesis) return;
		window.speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.rate = 0.95;
		window.speechSynthesis.speak(utterance);
	}, []);

	const changeShaderPreset = useCallback((preset: FlashcardShaderPreset) => {
		const normalized = resolveQuizShaderPreset(preset, quizIdentity);
		setShaderPreset(normalized);
		saveQuizShaderPreset(normalized);
	}, [quizIdentity]);

	const handleRequestRemediation = useCallback((level: string) => {
		window.dispatchEvent(new CustomEvent("keating:quiz-remediation-requested", {
			detail: { level, topic: quiz.topic, slug: quiz.slug },
		}));
	}, [quiz.slug, quiz.topic]);

	const shaderSeed = stableQuizSeed(`${quizIdentity}:${currentQuestion?.id ?? "result"}`);
	const shaderEnergy = revealed
		? Math.min(1, totalScored > 0 ? rawScore / totalScored + 0.16 : 0.35)
		: Math.min(1, answeredCount / Math.max(1, totalVisible) * 0.65 + current / Math.max(1, totalVisible) * 0.25);
	const accent = quizShaderAccent(shaderPreset);
	const headerStyle = { "--arena-accent": accent } as React.CSSProperties;
	const isLast = current === totalVisible - 1;
	const timer = !revealed && typeof timeRemaining === "number" && typeof timeLimit === "number"
		? { ...quizTimerState(timeRemaining, timeLimit), remaining: timeRemaining }
		: null;

	const effectHeader = (
		<header className={cx(quizStyles.effectHeader, "activity-quiz-header")} style={headerStyle}>
			<FlashcardShaderField
				key={`${shaderPreset}:${currentQuestion?.id ?? "result"}`}
				preset={shaderPreset}
				energy={shaderEnergy}
				seed={shaderSeed}
			/>
			<div className={quizStyles.effectHeaderContent}>
				<div className={quizStyles.resultIntro}>
					<h3 className={cx(quizStyles.topic, "activity-quiz-topic")}>{quiz.topic}</h3>

				</div>
				<div className={quizStyles.headerInstruments}>
					{timer ? (
						<div
							role="timer"
							aria-label={`${timer.urgency === "critical" ? "Critical, " : timer.urgency === "warning" ? "Warning, " : ""}${formatCountdown(timer.remaining)} remaining`}
							aria-live="off"
							data-urgency={timer.urgency}
							className={cx(quizStyles.timer, timer.urgency === "critical" ? "quiz-timer-critical" : "")}
						>
							<strong className={quizStyles.timerDigits}>
								{timer.urgency === "steady" ? <Clock size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
								{formatCountdown(timer.remaining)}
							</strong>
							<div className={quizStyles.timerTrack} aria-hidden="true">
								<div className={quizStyles.timerFill} style={{ transform: `scaleX(${timer.progress})` }} />
							</div>
							{timer.urgency === "critical" ? <span role="status" className={quizStyles.visuallyHidden}>Five seconds or less remaining.</span> : null}
						</div>
					) : null}
					<div className={quizStyles.headerMeta}>
						<span><Clock size={12} aria-hidden="true" /> {revealed && finalTimingRef.current ? formatQuizDuration(finalTimingRef.current.totalMs) : formatDuration(elapsed)}</span>
						{skippedIds.size > 0 ? <span>+{skippedIds.size} adapted</span> : null}
						{revealed ? <strong>{totalScored > 0 ? `${rawScore}/${totalScored}` : "review"}</strong> : null}
						<details className="activity-quiz-effects"><summary aria-label="Quiz appearance"><Sparkles size={16} /></summary><label>Appearance<Select className={quizStyles.effectSelect} aria-label="Quiz visual effect" value={shaderPreset} onValueChange={(value) => changeShaderPreset(value as FlashcardShaderPreset)}>{QUIZ_SHADER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</Select></label></details>
					</div>
				</div>
			</div>
			<RoundProgress current={current} total={totalVisible} resolved={answeredCount} label="Quiz progress" complete={revealed} />
		</header>
	);

	if (questions.length === 0) {
		return (
			<section className={cx(quizStyles.shell, "activity-game activity-quiz")} aria-label={`Quiz: ${quiz.topic}`}>
				{effectHeader}
				<div className={quizStyles.empty} role="status">No quiz questions yet.</div>
			</section>
		);
	}

	return (
		<section className={cx(quizStyles.shell, "activity-game activity-quiz")} aria-label={`Quiz: ${quiz.topic}`}>
			{effectHeader}

			{!revealed ? (
				<>
					{currentQuestion ? (
						<div
							key={`${currentQuestion.id}:${shaderPreset}`}
							aria-busy={isQuestionPending}
							className={cx(quizStyles.questionStage, quizQuestionEntryClass(shaderPreset))}
							style={{ ...headerStyle, opacity: isQuestionPending ? 0.72 : 1 }}
						>
							<QuestionCard
								q={currentQuestion}
								index={current}
								answer={answers[currentQuestion.id] || ""}
								onChange={(value) => setAnswer(currentQuestion.id, value)}
								revealed={false}
								bookmarked={bookmarkIds.includes(currentQuestion.id)}
								onToggleBookmark={() => toggleBookmark(currentQuestion.id)}
								onSpeak={() => speakQuestion(currentQuestion.question)}
								reframeMode={reframeModes[currentQuestion.id] ?? null}
								onReframe={(mode) => setReframeModes((previous) => ({ ...previous, [currentQuestion.id]: mode }))}
							/>
						</div>
					) : null}

					<nav className={quizStyles.nav} aria-label="Quiz questions">
						<button
							type="button"
							onClick={() => goTo(current - 1)}
							disabled={isQuestionPending || current === 0}
							className={cx(quizStyles.buttonSecondary, "activity-back-action", css({ flex: 1, justifyContent: "center", [sm]: { flex: "0 0 auto" } }))}
						>
							<ChevronLeft size={14} /> Back
						</button>
						{!isLast ? (
							<button
								type="button"
								onClick={() => goTo(current + 1)}
								disabled={isQuestionPending}
								className={cx(quizStyles.buttonPrimary, "activity-main-action", css({ flex: 1, justifyContent: "center", [sm]: { flex: "0 0 auto" } }))}
							>
								{currentQuestion && answers[currentQuestion.id]?.trim() ? "Lock in & next" : "Skip for now"} <ChevronRight size={16} />
							</button>
						) : (
							<button
								type="button"
								onClick={doSubmit}
								disabled={!allAnswered || submittedRef.current}
								title={allAnswered ? undefined : `${totalVisible - answeredCount} unanswered`}
								className={cx(quizStyles.buttonPrimary, "activity-main-action", css({ flex: 1, justifyContent: "center", gap: "0.5rem", [sm]: { flex: "0 0 auto" } }))}
							>
								<Send size={14} /> {allAnswered ? "Finish round" : `${totalVisible - answeredCount} left`}
							</button>
						)}
					</nav>
				</>
			) : (
				<>
					<div className={cx(quizStyles.resultIntro, "quiz-result-arrive")}>
						<CompletionMark detail={totalScored > 0 ? `${rawScore} of ${totalScored} correct${pendingReviewCount ? ` · ${pendingReviewCount} awaiting review` : ""}` : "Your teacher will review your answers."}>{totalScored === 0 ? "Ready for review" : rawScore === totalScored ? "Clean sweep" : "Round complete"}</CompletionMark>
						<div className={quizStyles.resultMeta}>
							{finalTimingRef.current ? <span aria-label={`Total quiz time: ${finalTimingRef.current.totalMs} milliseconds`}>{formatQuizDuration(finalTimingRef.current.totalMs)} total</span> : null}
							{timedOutIds.size ? <span>{timedOutIds.size} timed out</span> : null}
							{totalScored > 0 ? <span>{percent}% objective score</span> : null}
							{pendingReviewCount > 0 ? <span>{pendingReviewCount} pending review</span> : null}
							{bookmarkIds.length > 0 ? <span>{bookmarkIds.length} flagged</span> : null}
							{partialCreditPoints !== rawScore ? <span>{partialCreditPoints.toFixed(2)} partial points</span> : null}
						</div>
					</div>

					<details className="activity-review"><summary>Review answers & next steps</summary>
					<RemediationDashboard quiz={normalizedQuiz} answers={answers} onRequestRemediation={handleRequestRemediation} />
					<BenchmarkComparison score={rawScore} partialCreditPoints={partialCreditPoints} total={totalScored} stats={fetchedStats} />

					<div className={css({ display: "grid", gap: "1.5rem", "& > * + *": { borderTop: "1px solid var(--border)", paddingTop: "1.5rem" } })}>
						{visibleQuestions.map((question, index) => (
							<QuestionCard
								key={question.id}
								q={question}
								index={index}
								answer={answers[question.id] || ""}
								onChange={(value) => setAnswer(question.id, value)}
								revealed
								timeMs={finalTimingRef.current?.perQuestionMs[question.id]}
							timedOut={timedOutIds.has(question.id)}
								bookmarked={bookmarkIds.includes(question.id)}
								onToggleBookmark={() => toggleBookmark(question.id)}
								onSpeak={() => speakQuestion(question.question)}
								reframeMode={reframeModes[question.id] ?? null}
							/>
						))}
					</div>
					</details>
					<button type="button" onClick={resetRun} className={cx(quizStyles.buttonSecondary, "activity-back-action", css({ width: "100%", justifyContent: "center", gap: "0.5rem" }))}>
						<RotateCcw size={14} /> Retake
					</button>
				</>
			)}
		</section>
	);
}

QuizRenderer.displayName = "QuizRenderer";
