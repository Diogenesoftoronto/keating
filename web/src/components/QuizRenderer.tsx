import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePostHog } from "@posthog/react";
import {
	AlertTriangle,
	Bookmark,
	Check,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Circle,
	Clock,
	GraduationCap,
	Lightbulb,
	RotateCcw,
	Send,
	TrendingUp,
	Volume2,
	X,
	XCircle,
} from "lucide-react";
import type { Quiz, QuizQuestion } from "../keating/core";
import { KeatingStorage } from "../keating/storage";

const quizStorage = new KeatingStorage();

export interface QuizTiming {
	/** Total wall-clock time the learner spent on the quiz, in ms. */
	totalMs: number;
	/** Time spent per question id, in ms. */
	perQuestionMs: Record<string, number>;
}

export interface QuizResult {
	answers: Record<string, string>;
	score: number;
	weightedScore: number;
	timing: QuizTiming;
	confidence: Record<string, number>;
	partialCredits: Record<string, number>;
	flagged: string[];
}

export interface TopicStats {
	count: number;
	avgScore: number;
	avgWeightedScore: number;
	topQuartile: number;
}

interface QuizRendererProps {
	quiz: Quiz;
	onSubmit?: (result: QuizResult) => void;
	topicStats?: TopicStats | null;
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

function questionCredit(q: QuizQuestion, rawAnswer: string): number {
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
	// Open-ended: partial credit via Levenshtein + keyword overlap
	const a = rawAnswer.trim().toLowerCase();
	const c = q.correctAnswer.trim().toLowerCase();
	if (a === c) return 1;
	const dist = levenshtein(a, c);
	const len = Math.max(a.length, c.length);
	const editScore = Math.max(0, 1 - dist / (len || 1));
	const aTokens = new Set(tokenize(a));
	const cTokens = tokenize(c);
	const overlap = cTokens.filter((t) => aTokens.has(t)).length;
	const keywordScore = cTokens.length ? overlap / cTokens.length : 0;
	return Math.max(editScore, keywordScore * 0.9);
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
	return rawAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
}

function QuizOption({
	label,
	selected,
	onClick,
	disabled,
	status,
	checkbox,
}: {
	label: string;
	selected: boolean;
	onClick: () => void;
	disabled?: boolean;
	status?: "correct" | "wrong" | "neutral";
	checkbox?: boolean;
}) {
	const base =
		"flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-sm transition-all cursor-pointer";
	const state =
		status === "correct"
			? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
			: status === "wrong"
				? "border-destructive/60 bg-destructive/10 text-destructive"
				: selected
					? "border-primary bg-primary/10 text-primary"
					: "border-border bg-background hover:border-primary/50";
	return (
		<label
			className={`${base} ${state} ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
			onClick={() => !disabled && onClick()}
		>
			{checkbox ? (
				<span
					className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
						selected
							? "border-primary bg-primary text-primary-foreground"
							: "border-border"
					}`}
				>
					{selected ? <Check size={12} /> : null}
				</span>
			) : status === "correct" ? (
				<CheckCircle2 size={16} />
			) : status === "wrong" ? (
				<XCircle size={16} />
			) : selected ? (
				<CheckCircle2 size={16} />
			) : (
				<Circle size={16} />
			)}
			<span className="flex-1">{label}</span>
		</label>
	);
}

function QuestionTimer({
	seconds,
	warningAt = 5,
}: {
	seconds: number;
	warningAt?: number;
}) {
	const display = formatCountdown(seconds);
	const urgent = seconds <= warningAt;
	return (
		<span
			className={`inline-flex items-center gap-1 font-terminal text-sm tabular-nums ${urgent ? "text-destructive animate-pulse" : "text-muted-foreground"}`}
		>
			<Clock size={14} />
			{display}
		</span>
	);
}

function ConfidenceSlider({
	value,
	onChange,
	disabled,
}: {
	value: number;
	onChange: (v: number) => void;
	disabled?: boolean;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span className="font-medium">Confidence</span>
				<span className="font-terminal">{value}%</span>
			</div>
			<input
				type="range"
				min={50}
				max={100}
				step={5}
				value={value}
				onChange={(e) => onChange(parseInt(e.target.value, 10))}
				disabled={disabled}
				className="w-full accent-primary"
			/>
			<div className="flex justify-between text-[10px] text-muted-foreground">
				<span>Guessing</span>
				<span>Certain</span>
			</div>
		</div>
	);
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
		<div className="flex flex-wrap gap-1">
			<button
				type="button"
				onClick={() => onChange(null)}
				className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
					active === null
						? "bg-primary text-primary-foreground"
						: "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
				}`}
			>
				Default
			</button>
			{modes.map((mode) => (
				<button
					key={mode}
					type="button"
					onClick={() => onChange(mode)}
					className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
						active === mode
							? "bg-primary text-primary-foreground"
							: "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
					}`}
				>
					{mode}
				</button>
			))}
		</div>
	);
}

/**
 * Parse a fill-in-the-blank template into text parts and blank positions.
 * Supports ___ and {{blank}} as placeholders.
 */
function parseBlanks(template: string): { text: string; isBlank: boolean; index: number }[] {
	const parts: { text: string; isBlank: boolean; index: number }[] = [];
	const regex = /_{3,}|\{\{blank\}\}/g;
	let lastIndex = 0;
	let blankIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(template)) !== null) {
		if (match.index > lastIndex) {
			parts.push({ text: template.slice(lastIndex, match.index), isBlank: false, index: -1 });
		}
		parts.push({ text: match[0], isBlank: true, index: blankIndex++ });
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < template.length) {
		parts.push({ text: template.slice(lastIndex), isBlank: false, index: -1 });
	}
	return parts;
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
	const parts = useMemo(() => parseBlanks(question), [question]);
	const blankRefs = useRef<(HTMLInputElement | null)[]>([]);

	const setValue = (idx: number, val: string) => {
		const next = [...values];
		next[idx] = val;
		onChange(next.join("|"));
	};

	let blankCounter = 0;
	return (
		<div className="space-y-3">
			<div className="text-sm font-medium leading-relaxed">
				{parts.map((part, idx) => {
					if (!part.isBlank) {
						return <span key={idx}>{part.text}</span>;
					}
					const bIdx = blankCounter++;
					const blankDef = blanks[bIdx];
					const isCorrect = revealed && values[bIdx]?.trim().toLowerCase() === correctAnswers[bIdx]?.trim().toLowerCase();
					const isWrong = revealed && values[bIdx]?.trim() && !isCorrect;
					return (
						<span key={idx} className="inline-flex items-center gap-1 mx-1">
							<input
								ref={(el) => { blankRefs.current[bIdx] = el; }}
								type="text"
								disabled={revealed}
								className={`inline-block w-20 h-7 rounded border bg-background px-2 text-sm text-center outline-none focus:border-primary placeholder:text-muted-foreground/50 ${
									isCorrect ? "border-emerald-500/60 bg-emerald-500/5" : isWrong ? "border-destructive/60 bg-destructive/5" : "border-border"
								}`}
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
							{blankDef?.hint && !revealed && (
								<span className="text-[10px] text-muted-foreground">{blankDef.hint}</span>
							)}
							{revealed && (
								<span className={`text-[10px] ${isCorrect ? "text-emerald-600" : "text-destructive"}`}>
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
	confidence,
	onConfidenceChange,
	revealed,
	timeMs,
	timeRemaining,
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
	confidence: number;
	onConfidenceChange: (v: number) => void;
	revealed: boolean;
	timeMs?: number;
	timeRemaining?: number;
	bookmarked: boolean;
	onToggleBookmark: () => void;
	onSpeak: () => void;
	reframeMode?: string | null;
	onReframe?: (mode: string | null) => void;
}) {
	const credit = questionCredit(q, answer);
	const correct = isCorrect(q, answer);
	const wrong = revealed && answer.trim() && !correct;

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
		<div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
			<div className="flex items-start gap-2">
				<span className="font-terminal text-xs text-accent shrink-0 mt-1">
					[{index + 1}/{q.level.toUpperCase()}]
				</span>
				<div className="flex-1 space-y-1">
					<p className="text-sm font-medium leading-6">{displayQuestion}</p>
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
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={onSpeak}
						className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						aria-label="Read question aloud"
						title="Read aloud"
					>
						<Volume2 size={14} />
					</button>
					<button
						type="button"
						onClick={onToggleBookmark}
						className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${bookmarked ? "text-amber-500" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
						aria-label={bookmarked ? "Remove bookmark" : "Bookmark question"}
						title={bookmarked ? "Bookmarked" : "Bookmark for review"}
					>
						<Bookmark size={14} fill={bookmarked ? "currentColor" : "none"} />
					</button>
					{typeof timeRemaining === "number" && !revealed && (
						<QuestionTimer seconds={timeRemaining} />
					)}
					{revealed && typeof timeMs === "number" && (
						<span className="inline-flex items-center gap-1 font-terminal text-[10px] text-muted-foreground">
							<Clock size={11} />
							{formatDuration(timeMs)}
						</span>
					)}
				</div>
			</div>

			{q.type === "multiple_choice" && q.options && (
				<div className="space-y-2">
					{q.options.map((opt) => {
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
				<div className="space-y-2">
					{q.options.map((opt) => {
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

			{(q.type === "short_answer" || q.type === "fill_in" || q.type === "transfer") && (
				<div className="space-y-2">
					{q.type === "fill_in" && q.blanks && q.blanks.length > 0 ? (
						<MultiBlankFillIn
							question={displayQuestion}
							blanks={q.blanks}
							answer={answer}
							onChange={onChange}
							revealed={revealed}
							correctAnswers={q.correctAnswers ?? [q.correctAnswer]}
						/>
					) : (
						<textarea
							className={`w-full rounded-md border bg-background px-3 py-2 text-sm outline-none resize-none min-h-[80px] placeholder:text-muted-foreground ${
								wrong
									? "border-destructive/60 bg-destructive/5"
									: correct
										? "border-emerald-500/60 bg-emerald-500/5"
										: "border-border"
							}`}
							placeholder={q.type === "fill_in" ? "Fill in the blank..." : "Type your answer..."}
							value={answer}
							onChange={(e) => onChange(e.target.value)}
							disabled={revealed}
						/>
					)}
					{revealed && !(q.type === "fill_in" && q.blanks && q.blanks.length > 0) && (
						<div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
							<Lightbulb size={14} className="shrink-0 mt-0.5 text-accent" />
							<div className="space-y-1">
								<p>
									<span className="font-medium">Correct:</span> {q.correctAnswer}
								</p>
								{q.explanation && <p>{q.explanation}</p>}
								{q.rubric && <p className="text-[10px] opacity-70">{q.rubric}</p>}
							</div>
						</div>
					)}
				</div>
			)}

			{q.type === "true_false" && (
				<div className="flex gap-3">
					{["True", "False"].map((opt) => {
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
				<div className="space-y-3">
					<div className="flex items-center gap-3">
						<span className="font-terminal text-xs text-muted-foreground">{q.min ?? 0}</span>
						<input
							type="range"
							min={q.min ?? 0}
							max={q.max ?? 100}
							step={q.step ?? 1}
							value={answer ? parseFloat(answer) : (q.min ?? 0)}
							onChange={(e) => onChange(e.target.value)}
							disabled={revealed}
							className="flex-1 accent-primary"
						/>
						<span className="font-terminal text-xs text-muted-foreground">{q.max ?? 100}</span>
					</div>
					<div className="text-center text-sm font-medium">
						{answer || (q.min ?? 0).toString()}
					</div>
					{revealed && (
						<div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
							<Lightbulb size={14} className="shrink-0 mt-0.5 text-accent" />
							<div className="space-y-1">
								<p>
									<span className="font-medium">Correct:</span> {q.correctAnswer}
								</p>
								{q.explanation && <p>{q.explanation}</p>}
							</div>
						</div>
					)}
				</div>
			)}

			{q.type === "dropdown" && q.options && (
				<div className="space-y-2">
					<select
						value={answer}
						onChange={(e) => onChange(e.target.value)}
						disabled={revealed}
						className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
					>
						<option value="" disabled>
							Select an answer...
						</option>
						{q.options.map((opt) => (
							<option key={opt} value={opt}>
								{opt}
							</option>
						))}
					</select>
					{revealed && (
						<div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
							<Lightbulb size={14} className="shrink-0 mt-0.5 text-accent" />
							<div className="space-y-1">
								<p>
									<span className="font-medium">Correct:</span> {q.correctAnswer}
								</p>
								{q.explanation && <p>{q.explanation}</p>}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Confidence slider - always show when answered, hide on revealed */}
			{!revealed && (
				<ConfidenceSlider
					value={confidence}
					onChange={onConfidenceChange}
					disabled={revealed}
				/>
			)}

			{/* Partial credit badge */}
			{revealed && credit < 1 && credit > 0 && (
				<div className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
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

	const hasMissed = Object.values(stats).some((s) => s.missed > 0);
	if (!hasMissed) return null;

	return (
		<div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
			<div className="flex items-center gap-2 text-sm font-medium">
				<GraduationCap size={16} className="text-primary" />
				<span>Remediation Dashboard</span>
			</div>
			<div className="space-y-2">
				{levels.map((level) => {
					const s = stats[level];
					if (!s || s.missed === 0) return null;
					const pct = s.total > 0 ? s.missed / s.total : 0;
					return (
						<div key={level} className="space-y-1">
							<div className="flex items-center justify-between text-xs">
								<span className="capitalize font-medium">{level}</span>
								<span className="text-muted-foreground">{s.missed}/{s.total} missed</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-destructive"
										style={{ width: `${pct * 100}%` }}
									/>
								</div>
								<button
									type="button"
									onClick={() => onRequestRemediation?.(level)}
									className="shrink-0 text-[10px] font-medium text-primary hover:underline"
								>
									Review
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
	weightedScore,
	total,
	stats,
}: {
	score: number;
	weightedScore: number;
	total: number;
	stats: TopicStats | null | undefined;
}) {
	if (!stats || stats.count < 5) return null;
	const pct = (score / total) * 100;
	const avgPct = (stats.avgScore / total) * 100;
	const qPct = (stats.topQuartile / total) * 100;
	const maxBar = Math.max(pct, avgPct, qPct, 1);

	return (
		<div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
			<div className="flex items-center gap-2 text-sm font-medium">
				<TrendingUp size={16} className="text-primary" />
				<span>Benchmark Comparison ({stats.count} sessions)</span>
			</div>
			<div className="space-y-2">
				{[
					{ label: "Your score", value: pct, color: "bg-primary" },
					{ label: "Session avg", value: avgPct, color: "bg-muted-foreground" },
					{ label: "Top quartile", value: qPct, color: "bg-emerald-500" },
				].map((row) => (
					<div key={row.label} className="space-y-1">
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">{row.label}</span>
							<span className="font-terminal tabular-nums">
								{Math.round(row.value)}%
							</span>
						</div>
						<div className="h-2 overflow-hidden rounded-full bg-muted">
							<div
								className={`h-full rounded-full ${row.color} transition-all`}
								style={{ width: `${(row.value / maxBar) * 100}%` }}
							/>
						</div>
					</div>
				))}
			</div>
			{typeof weightedScore === "number" && stats.avgWeightedScore > 0 && (
				<div className="text-xs text-muted-foreground">
					Weighted: {weightedScore.toFixed(2)} vs avg {stats.avgWeightedScore.toFixed(2)}
				</div>
			)}
		</div>
	);
}

QuizRenderer.displayName = "QuizRenderer";

export function QuizRenderer({ quiz, onSubmit, topicStats }: QuizRendererProps) {
	const posthog = usePostHog();
	const [answers, setAnswers] = useState<AnswerState>({});
	const [confidence, setConfidence] = useState<Record<string, number>>({});
	const [revealed, setRevealed] = useState(false);
	const [current, setCurrent] = useState(0);
	const [elapsed, setElapsed] = useState(0);
	const [bookmarkIds, setBookmarkIds] = useState<string[]>(() => loadBookmarkIds());
	const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
	const [reframeModes, setReframeModes] = useState<Record<string, string | null>>({});
	const [fetchedStats, setFetchedStats] = useState<TopicStats | null | undefined>(topicStats);

	// Timing: total wall-clock plus accrued time per question while stepping.
	const startRef = useRef<number>(Date.now());
	const questionEnteredRef = useRef<number>(Date.now());
	const perQuestionRef = useRef<Record<string, number>>({});
	const finalTimingRef = useRef<QuizTiming | null>(null);

	// Build visible question queue (non-skipped questions)
	const visibleQuestions = useMemo(() => {
		return quiz.questions.filter((q) => !skippedIds.has(q.id));
	}, [quiz.questions, skippedIds]);

	const totalVisible = visibleQuestions.length;
	const scorableQuestions = visibleQuestions;
	const totalScored = scorableQuestions.length;
	const currentQuestion = visibleQuestions[current];
	const timeLimit = currentQuestion?.timeLimit;
	const [timeRemaining, setTimeRemaining] = useState<number | undefined>(timeLimit);

	useEffect(() => {
		setTimeRemaining(timeLimit);
	}, [current, timeLimit]);

	useEffect(() => {
		if (revealed || typeof timeRemaining !== "number") return;
		if (timeRemaining <= 0) return;
		const id = window.setInterval(() => {
			setTimeRemaining((prev) => {
				if (typeof prev !== "number" || prev <= 1) {
					window.clearInterval(id);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
		return () => window.clearInterval(id);
	}, [revealed, timeLimit, current]);

	// Auto-advance or auto-submit when timer expires.
	useEffect(() => {
		if (revealed || typeof timeRemaining !== "number") return;
		if (timeRemaining > 0) return;
		const isLast = current === totalVisible - 1;
		const id = window.setTimeout(() => {
			if (isLast) {
				accrueCurrent();
				doSubmit();
			} else {
				goTo(current + 1);
			}
		}, 200);
		return () => window.clearTimeout(id);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [timeRemaining, revealed, current, totalVisible]);

	// Fetch topic stats from storage on mount if storage is provided and no stats prop
	useEffect(() => {
		if (topicStats !== undefined) return;
		quizStorage.getTopicQuizStats(quiz.slug).then((s: TopicStats | null) => setFetchedStats(s));
	}, [quiz.slug, topicStats]);

	// Live count-up timer until the quiz is submitted.
	useEffect(() => {
		if (revealed) return;
		const id = window.setInterval(() => setElapsed(Date.now() - startRef.current), 250);
		return () => window.clearInterval(id);
	}, [revealed]);

	// Adaptive branching: after answering, skip upcoming fallbacks if threshold met
	useEffect(() => {
		if (!quiz.adaptiveRules || !currentQuestion) return;
		if (revealed) return;
		const answer = answers[currentQuestion.id];
		if (!answer?.trim()) return;
		const credit = questionCredit(currentQuestion, answer);
		const rule = quiz.adaptiveRules.find((r) => r.level === currentQuestion.level);
		const threshold = rule?.threshold ?? 0.5;
		if (credit < threshold) return;
		// Skip all consecutive fallbacks for this level that appear after current question
		const currentIdxInAll = quiz.questions.findIndex((q) => q.id === currentQuestion.id);
		const toSkip = new Set<string>();
		for (let i = currentIdxInAll + 1; i < quiz.questions.length; i++) {
			const q = quiz.questions[i];
			if (q.fallbackFor === currentQuestion.level) {
				toSkip.add(q.id);
			} else if (!q.fallbackFor) {
				break;
			}
		}
		if (toSkip.size > 0) {
			setSkippedIds((prev) => new Set([...prev, ...toSkip]));
		}
	}, [answers, currentQuestion, quiz.adaptiveRules, quiz.questions, revealed]);

	const accrueCurrent = useCallback(() => {
		const qid = visibleQuestions[current]?.id;
		if (!qid) return;
		const now = Date.now();
		perQuestionRef.current[qid] = (perQuestionRef.current[qid] ?? 0) + (now - questionEnteredRef.current);
		questionEnteredRef.current = now;
	}, [visibleQuestions, current]);

	const setAnswer = useCallback((qid: string, val: string) => {
		setAnswers((prev) => ({ ...prev, [qid]: val }));
	}, []);

	const setConfidenceValue = useCallback((qid: string, val: number) => {
		setConfidence((prev) => ({ ...prev, [qid]: val }));
	}, []);

	const toggleBookmark = useCallback((qid: string) => {
		setBookmarkIds((prev) => {
			const next = prev.includes(qid) ? prev.filter((id) => id !== qid) : [...prev, qid];
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

	const goTo = useCallback(
		(index: number) => {
			if (index < 0 || index >= totalVisible) return;
			accrueCurrent();
			setCurrent(index);
			questionEnteredRef.current = Date.now();
		},
		[accrueCurrent, totalVisible],
	);

	const partialCredits = useMemo(() => {
		const map: Record<string, number> = {};
		for (const q of scorableQuestions) {
			map[q.id] = questionCredit(q, answers[q.id] || "");
		}
		return map;
	}, [answers, scorableQuestions]);

	const rawScore = useMemo(() => {
		let correct = 0;
		for (const q of scorableQuestions) {
			if (isCorrect(q, answers[q.id] || "")) correct++;
		}
		return correct;
	}, [answers, scorableQuestions]);

	const weightedScore = useMemo(() => {
		let sum = 0;
		for (const q of scorableQuestions) {
			const c = partialCredits[q.id] ?? 0;
			const conf = (confidence[q.id] ?? 50) / 100;
			sum += c * conf;
		}
		return sum;
	}, [scorableQuestions, partialCredits, confidence]);

	const percent = totalScored > 0 ? Math.round((rawScore / totalScored) * 100) : 0;
	const answeredCount = visibleQuestions.filter((q) => (answers[q.id] || "").trim().length > 0).length;
	const allAnswered = answeredCount === totalVisible;

	const doSubmit = useCallback(() => {
		accrueCurrent();
		const timing: QuizTiming = {
			totalMs: Date.now() - startRef.current,
			perQuestionMs: { ...perQuestionRef.current },
		};
		finalTimingRef.current = timing;
		setElapsed(timing.totalMs);
		setRevealed(true);
		posthog.capture('quiz_completed', {
			topic: quiz.slug ?? quiz.topic,
			question_count: quiz.questions.length,
			score: rawScore,
			weighted_score: weightedScore,
			duration_ms: timing.totalMs,
		});
		onSubmit?.({
			answers,
			score: rawScore,
			weightedScore,
			timing,
			confidence,
			partialCredits,
			flagged: bookmarkIds,
		});
		// Save quiz result to storage
		quizStorage.saveQuizResult(rawScore, weightedScore, totalScored, quiz.slug).catch(() => {});
		window.speechSynthesis?.cancel();
	}, [accrueCurrent, answers, rawScore, weightedScore, onSubmit, confidence, partialCredits, bookmarkIds, totalScored, quiz.slug]);

	const handleReset = useCallback(() => {
		setAnswers({});
		setConfidence({});
		setRevealed(false);
		setCurrent(0);
		setElapsed(0);
		setSkippedIds(new Set());
		setReframeModes({});
		setTimeRemaining(quiz.questions[0]?.timeLimit);
		startRef.current = Date.now();
		questionEnteredRef.current = Date.now();
		perQuestionRef.current = {};
		finalTimingRef.current = null;
		window.speechSynthesis?.cancel();
	}, [quiz.questions]);

	const handleRequestRemediation = useCallback((level: string) => {
		window.dispatchEvent(
			new CustomEvent("keating:quiz-remediation-requested", {
				detail: { level, topic: quiz.topic, slug: quiz.slug },
			})
		);
	}, [quiz.topic, quiz.slug]);

	const cq = currentQuestion;
	const isLast = current === totalVisible - 1;
	const hasTimeLimit = typeof timeRemaining === "number";

	return (
		<div className="rounded-xl border-2 border-border bg-background p-4 sm:p-5 space-y-4 my-3 shadow-sm">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<h3 className="text-base font-bold truncate">{quiz.topic}</h3>
					<p className="text-xs text-muted-foreground font-terminal">
						{totalVisible} QUESTIONS // {quiz.totalPoints} POINTS
						{skippedIds.size > 0 && (
							<span className="ml-2 text-emerald-600 dark:text-emerald-400">
								({skippedIds.size} skipped by adaptive rules)
							</span>
						)}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-3">
					<span className="inline-flex items-center gap-1 font-terminal text-sm text-muted-foreground tabular-nums">
						<Clock size={14} />
						{formatDuration(elapsed)}
					</span>
					{revealed && (
						<div className="text-right">
							<div className={`text-2xl font-bold font-terminal ${percent >= 70 ? "text-emerald-600 dark:text-emerald-400" : percent >= 40 ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}>
								{rawScore}/{totalScored}
							</div>
							<div className="text-[10px] text-muted-foreground uppercase">{percent}%</div>
						</div>
					)}
				</div>
			</div>

			{!revealed ? (
				<>
					{/* Progress bar */}
					<div className="flex items-center gap-2">
						<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-primary transition-all"
								style={{ width: `${((current + 1) / totalVisible) * 100}%` }}
							/>
						</div>
						<span className="font-terminal text-[11px] text-muted-foreground tabular-nums">
							{current + 1}/{totalVisible}
						</span>
					</div>

					{/* Timer warning */}
					{hasTimeLimit && timeRemaining !== undefined && timeRemaining <= 5 && (
						<div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
							<AlertTriangle size={14} />
							<span>Time is running out for this question.</span>
						</div>
					)}

					{cq && (
						<QuestionCard
							key={cq.id}
							q={cq}
							index={current}
							answer={answers[cq.id] || ""}
							onChange={(val) => setAnswer(cq.id, val)}
							confidence={confidence[cq.id] ?? 75}
							onConfidenceChange={(v) => setConfidenceValue(cq.id, v)}
							revealed={false}
							timeRemaining={timeRemaining}
							bookmarked={bookmarkIds.includes(cq.id)}
							onToggleBookmark={() => toggleBookmark(cq.id)}
							onSpeak={() => speakQuestion(cq.question)}
							reframeMode={reframeModes[cq.id] ?? null}
							onReframe={(mode) => {
								setReframeModes((prev) => ({ ...prev, [cq.id]: mode }));
							}}
						/>
					)}

					<div className="flex items-center justify-between gap-2">
						<button
							onClick={() => goTo(current - 1)}
							disabled={current === 0}
							className="inline-flex items-center gap-1 rounded-lg border-2 border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
						>
							<ChevronLeft size={14} />
							Back
						</button>

						{!isLast ? (
							<button
								onClick={() => goTo(current + 1)}
								className="inline-flex items-center gap-1 rounded-lg border-2 border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
							>
								Next
								<ChevronRight size={14} />
							</button>
						) : (
							<button
								onClick={doSubmit}
								disabled={!allAnswered}
								title={allAnswered ? undefined : `${totalVisible - answeredCount} unanswered`}
								className="inline-flex items-center gap-2 rounded-lg border-2 border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
							>
								<Send size={14} />
								{allAnswered ? "Submit Quiz" : `${totalVisible - answeredCount} left`}
							</button>
						)}
					</div>
				</>
			) : (
				<>
					{/* Summary */}
					<div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
						<div className="flex items-center justify-between text-sm">
							<span className="font-medium">Raw score</span>
							<span className="font-terminal">{rawScore}/{totalScored}</span>
						</div>
						<div className="flex items-center justify-between text-sm">
							<span className="font-medium">Weighted score</span>
							<span className="font-terminal">{weightedScore.toFixed(2)}</span>
						</div>
						{bookmarkIds.length > 0 && (
							<div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
								<Bookmark size={12} fill="currentColor" />
								{bookmarkIds.length} question{bookmarkIds.length > 1 ? "s" : ""} bookmarked for review
							</div>
						)}
					</div>

					<RemediationDashboard
						quiz={quiz}
						answers={answers}
						onRequestRemediation={handleRequestRemediation}
					/>

					<BenchmarkComparison
						score={rawScore}
						weightedScore={weightedScore}
						total={totalScored}
						stats={fetchedStats}
					/>

					<div className="space-y-3">
						{visibleQuestions.map((q, i) => (
							<QuestionCard
								key={q.id}
								q={q}
								index={i}
								answer={answers[q.id] || ""}
								onChange={(val) => setAnswer(q.id, val)}
								confidence={confidence[q.id] ?? 75}
								onConfidenceChange={(v) => setConfidenceValue(q.id, v)}
								revealed
								timeMs={finalTimingRef.current?.perQuestionMs[q.id]}
								bookmarked={bookmarkIds.includes(q.id)}
								onToggleBookmark={() => toggleBookmark(q.id)}
								onSpeak={() => speakQuestion(q.question)}
								reframeMode={reframeModes[q.id] ?? null}
							/>
						))}
					</div>
					<button
						onClick={handleReset}
						className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
					>
						<RotateCcw size={14} />
						Retake
					</button>
				</>
			)}
		</div>
	);
}
