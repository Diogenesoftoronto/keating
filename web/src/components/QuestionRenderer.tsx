import { useCallback, useMemo, useState, useRef } from "react";
import {
	ArrowRight,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	MessageSquare,
} from "lucide-react";

/** A single blank within a fill-in-the-blank question. */
export interface BlankField {
	/** Placeholder text for the blank input */
	placeholder?: string;
	/** Hint shown next to the blank */
	hint?: string;
}

/** A single question within an ask_user_question form. */
export interface QuestionField {
	/** Short chip/label shown above the question (e.g. "Goal", "Approach"). */
	header?: string;
	/** The question text. For blanks type, use ___ as placeholders. */
	question: string;
	/** Question type. Defaults to choice/text hybrid. */
	type?: "choice" | "text" | "blanks";
	choices?: string[];
	/** Allow selecting more than one choice. */
	multiSelect?: boolean;
	/** Show a free-text input in addition to (or instead of) choices. */
	allowText?: boolean;
	/** Blanks definition for fill-in-the-blank questions. */
	blanks?: BlankField[];
	hint?: string;
}

/** Normalized multi-field form payload. */
export interface QuestionFormData {
	intro?: string;
	questions: QuestionField[];
}

/** Legacy single-question payload (kept for backward compatibility). */
export interface QuestionData {
	question: string;
	choices?: string[];
	allow_text?: boolean;
	hint?: string;
}

export interface AnsweredQuestion {
	header?: string;
	question: string;
	answer: string;
}

interface QuestionRendererProps {
	data: QuestionFormData;
	onSubmit?: (answers: AnsweredQuestion[]) => void;
}

/**
 * Accepts either the new multi-field shape `{ questions: [...] }` or the legacy
 * single-question shape `{ question, choices, allow_text, hint }` and returns a
 * normalized QuestionFormData. Returns null when nothing renderable is present.
 */
export function normalizeQuestionForm(raw: unknown): QuestionFormData | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;

	const coerceField = (value: unknown): QuestionField | null => {
		if (!value || typeof value !== "object") return null;
		const q = value as Record<string, unknown>;
		const question = typeof q.question === "string" ? q.question : "";
		if (!question) return null;
		const choices = Array.isArray(q.choices)
			? q.choices.filter((c): c is string => typeof c === "string")
			: undefined;
		const multiSelect =
			typeof q.multiSelect === "boolean"
				? q.multiSelect
				: typeof q.multi_select === "boolean"
					? q.multi_select
					: false;
		const allowText =
			typeof q.allowText === "boolean"
				? q.allowText
				: typeof q.allow_text === "boolean"
					? q.allow_text
					: !choices || choices.length === 0;
		// Detect blanks type
		const blanks = Array.isArray(q.blanks)
			? q.blanks.filter((b): b is BlankField => b !== null && typeof b === "object")
			: undefined;
		const type: QuestionField["type"] = blanks && blanks.length > 0
			? "blanks"
			: typeof q.type === "string" && ["choice", "text", "blanks"].includes(q.type)
				? (q.type as QuestionField["type"])
					: undefined;
		return {
			header: typeof q.header === "string" ? q.header : undefined,
			question,
			type,
			choices: choices && choices.length > 0 ? choices : undefined,
			multiSelect,
			allowText,
			blanks,
			hint: typeof q.hint === "string" ? q.hint : undefined,
		};
	};

	if (Array.isArray(obj.questions)) {
		const questions = obj.questions
			.map(coerceField)
			.filter((q): q is QuestionField => q !== null);
		if (questions.length === 0) return null;
		return {
			intro: typeof obj.intro === "string" ? obj.intro : undefined,
			questions,
		};
	}

	const single = coerceField(obj);
	if (!single) return null;
	return { intro: typeof obj.intro === "string" ? obj.intro : undefined, questions: [single] };
}

interface BlankState {
	values: string[];
	selected: string[];
	text: string;
}

export function QuestionRenderer({ data, onSubmit }: QuestionRendererProps) {
	const questions = data.questions;
	const total = questions.length;
	const blankRefs = useRef<(HTMLInputElement | null)[]>([]);

	const countBlanks = (template: string): number => {
		const matches = template.match(/_{3,}|\{\{blank\}\}/g);
		return matches ? matches.length : 0;
	};

	const [states, setStates] = useState<BlankState[]>(() =>
		questions.map((q) => {
			const blankCount = q.blanks?.length ?? countBlanks(q.question);
			return { values: Array(blankCount).fill(""), selected: [], text: "" };
		}),
	);
	const [submitted, setSubmitted] = useState(false);
	const [current, setCurrent] = useState(0);
	const [collapsed, setCollapsed] = useState(false);

	const answerFor = useCallback(
		(index: number): string => {
			const state = states[index];
			if (!state) return "";
			const q = questions[index];
			if (q.type === "blanks" || (q.blanks && q.blanks.length > 0)) {
				return state.values.filter(Boolean).join(" | ");
			}
			const parts = [...state.selected];
			const text = state.text.trim();
			if (text) parts.push(text);
			return parts.join(", ");
		},
		[states, questions],
	);

	const allAnswered = useMemo(
		() => questions.every((q, index) => {
			const state = states[index];
			if (!state) return false;
			if (q.type === "blanks" || (q.blanks && q.blanks.length > 0)) {
				return state.values.every((v) => v.trim().length > 0);
			}
			return answerFor(index).length > 0;
		}),
		[questions, states, answerFor],
	);

	const currentAnswered = useMemo(
		() => {
			const q = questions[current];
			if (!q) return false;
			const state = states[current];
			if (!state) return false;
			if (q.type === "blanks" || (q.blanks && q.blanks.length > 0)) {
				return state.values.every((v) => v.trim().length > 0);
			}
			return answerFor(current).length > 0;
		},
		[questions, states, current, answerFor],
	);

	const toggleChoice = (index: number, choice: string, multiSelect: boolean) => {
		if (submitted) return;
		setStates((current) =>
			current.map((state, i) => {
				if (i !== index) return state;
				if (multiSelect) {
					const selected = state.selected.includes(choice)
						? state.selected.filter((c) => c !== choice)
						: [...state.selected, choice];
					return { ...state, selected };
				}
				return { ...state, selected: state.selected[0] === choice ? [] : [choice] };
			}),
		);
	};

	const setText = (index: number, value: string) => {
		if (submitted) return;
		setStates((current) =>
			current.map((state, i) => (i === index ? { ...state, text: value } : state)),
		);
	};

	const setBlankValue = (index: number, blankIdx: number, value: string) => {
		if (submitted) return;
		setStates((current) =>
			current.map((state, i) => {
				if (i !== index) return state;
				const values = [...state.values];
				values[blankIdx] = value;
				return { ...state, values };
			}),
		);
	};

	/** Split a template into text parts and blank positions */
	const parseTemplate = (template: string): { text: string; isBlank: boolean; index: number }[] => {
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
	};

	const handleSubmit = useCallback(() => {
		if (submitted || !allAnswered) return;
		const answers: AnsweredQuestion[] = questions.map((q, index) => ({
			header: q.header,
			question: q.question,
			answer: answerFor(index),
		}));
		setSubmitted(true);
		onSubmit?.(answers);
	}, [submitted, allAnswered, questions, answerFor, onSubmit]);

	const goNext = useCallback(() => {
		if (current < total - 1) setCurrent((c) => c + 1);
	}, [current, total]);

	const goPrev = useCallback(() => {
		if (current > 0) setCurrent((c) => c - 1);
	}, [current]);

	if (submitted) {
		return (
			<div className="my-2 sm:my-3 rounded-lg sm:rounded-xl border border-primary/30 bg-primary/5 p-2.5 sm:p-4 shadow-sm w-full max-w-full overflow-x-hidden">
				<div className="flex items-start gap-2 sm:gap-3">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
						<CheckCircle2 size={18} className="text-primary" />
					</div>
					<div className="min-w-0 flex-1 space-y-2">
						<p className="text-sm font-medium text-primary">Submitted</p>
						<div className="space-y-1 text-sm text-primary">
							{questions.map((q, index) => (
								<div key={index} className="flex items-start gap-2">
									<MessageSquare size={14} className="mt-1 shrink-0" />
									<span className="min-w-0 break-words">
										{q.header ? `${q.header}: ` : ""}
										<strong>{answerFor(index)}</strong>
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		);
	}

	const q = questions[current];
	if (!q) return null;
	const state = states[current] ?? { values: [], selected: [], text: "" };
	const isLast = current === total - 1;
	const progress = total > 1 ? ((current + 1) / total) * 100 : 100;
	const isBlanks = q.type === "blanks" || (q.blanks && q.blanks.length > 0);

	return (
			<div className="my-2 sm:my-3 rounded-lg sm:rounded-xl border border-primary/30 bg-primary/5 p-2 sm:p-4 shadow-sm w-full max-w-full overflow-x-hidden">
				<div className="flex items-start gap-1.5 sm:gap-3">
					<div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
						<CheckCircle2 size={18} className="text-primary" />
					</div>
				<div className="min-w-0 flex-1 space-y-2 sm:space-y-4">
					<div className="flex items-center justify-between gap-2 sm:gap-3">
						<div className="min-w-0">
							<p className="text-xs sm:text-sm font-medium text-primary">Question</p>
							{collapsed && (
								<p className="line-clamp-2 text-xs leading-5 text-muted-foreground break-words">
									{data.intro || q.question}
								</p>
							)}
						</div>
						<button
							type="button"
							onClick={() => setCollapsed((value) => !value)}
							aria-expanded={!collapsed}
							aria-label={collapsed ? "Show" : "Hide"}
							title={collapsed ? "Show" : "Hide"}
							className="inline-flex h-6 sm:h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 sm:px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
						>
							{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
							<span className="hidden sm:inline">{collapsed ? "Show" : "Hide"}</span>
						</button>
					</div>
					{collapsed ? (
						<div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-3">
							<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-primary transition-all"
									style={{ width: `${progress}%` }}
								/>
							</div>
							<span className="font-terminal text-[11px] text-muted-foreground tabular-nums">
								{current + 1}/{total}
							</span>
						</div>
					) : (
						<>
					{data.intro && (
						<p className="text-xs leading-snug sm:text-sm sm:leading-6 text-muted-foreground break-words">{data.intro}</p>
					)}

					{/* Progress bar */}
					<div className="flex items-center gap-2">
						<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-primary transition-all"
								style={{ width: `${progress}%` }}
							/>
						</div>
						<span className="font-terminal text-[11px] text-muted-foreground tabular-nums">
							{current + 1}/{total}
						</span>
					</div>

					{/* Current question card */}
					<div className="space-y-2 sm:space-y-3 rounded-none sm:rounded-lg border-0 sm:border border-border/60 bg-transparent sm:bg-background/40 p-0 sm:p-3 max-w-full">
						{q.header && (
							<span className="inline-flex rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
								{q.header}
							</span>
						)}

						{/* Fill-in-the-blank rendering */}
						{isBlanks ? (
							<div className="space-y-3 max-w-full">
								<div className="text-sm font-medium leading-relaxed break-words">
									{parseTemplate(q.question).map((part, idx) => {
										if (!part.isBlank) {
											return <span key={idx} className="break-words">{part.text}</span>;
										}
										const blankIdx = part.index;
										const blankDef = q.blanks?.[blankIdx];
										return (
											<span key={idx} className="inline-flex items-center gap-1 mx-0.5 sm:mx-1">
												<input
													ref={(el) => { blankRefs.current[blankIdx] = el; }}
													type="text"
													disabled={submitted}
													className="inline-block w-16 sm:w-20 h-7 rounded border border-border bg-background px-1.5 sm:px-2 text-sm text-center outline-none focus:border-primary placeholder:text-muted-foreground/50"
													placeholder={blankDef?.placeholder ?? "___"}
													value={state.values[blankIdx] ?? ""}
													onChange={(e) => setBlankValue(current, blankIdx, e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter") {
															const nextBlank = blankRefs.current[blankIdx + 1];
															if (nextBlank) nextBlank.focus();
															else if (currentAnswered) {
																if (!isLast) goNext();
																else if (allAnswered) handleSubmit();
															}
														}
													}}
												/>
												{blankDef?.hint && (
													<span className="text-[10px] text-muted-foreground hidden sm:inline">{blankDef.hint}</span>
												)}
											</span>
										);
									})}
								</div>
							</div>
						) : (
							<>
								<p className="text-xs sm:text-sm font-medium leading-snug sm:leading-6 break-words">{q.question}</p>

								{q.choices && q.choices.length > 0 && (
									<div className="space-y-1.5 sm:space-y-2">
										{q.choices.map((choice) => {
											const isSelected = state.selected.includes(choice);
											return (
												<button
													key={choice}
													type="button"
													disabled={submitted}
													aria-pressed={isSelected}
													className={`flex w-full items-center gap-2 sm:gap-3 rounded-lg border sm:border-2 px-2 py-1.5 sm:px-4 sm:py-3 text-left text-xs sm:text-sm leading-snug transition-all ${
														isSelected
															? "border-primary bg-primary/10 text-primary"
															: "border-border bg-background hover:border-primary/50"
													} ${submitted ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
													onClick={() => toggleChoice(current, choice, q.multiSelect ?? false)}
												>
													{q.multiSelect ? (
														<span
															className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
																isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
															}`}
														>
															{isSelected ? <Check size={12} /> : null}
														</span>
													) : isSelected ? (
														<CheckCircle2 size={16} className="shrink-0" />
													) : (
														<div className="h-4 w-4 shrink-0 rounded-full border-2 border-border" />
													)}
													<span className="flex-1 min-w-0 break-words">{choice}</span>
												</button>
											);
										})}
									</div>
								)}

								{q.allowText && (
									<div className="space-y-2">
										{q.choices && q.choices.length > 0 && (
											<div className="flex items-center gap-2 text-xs text-muted-foreground">
												<div className="h-px flex-1 bg-border" />
												<span>or type your own</span>
												<div className="h-px flex-1 bg-border" />
											</div>
										)}
										<input
											type="text"
											className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
											placeholder="Your answer..."
											value={state.text}
											disabled={submitted}
											onChange={(e) => setText(current, e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && currentAnswered) {
													if (!isLast) goNext();
													else if (allAnswered) handleSubmit();
												}
											}}
										/>
									</div>
								)}
							</>
						)}

						{q.hint && !submitted && (
							<p className="text-xs italic text-muted-foreground break-words">💡 {q.hint}</p>
						)}
					</div>

					{/* Navigation */}
					<div className="flex items-center justify-between gap-2">
						<button
							type="button"
							onClick={goPrev}
							disabled={current === 0}
							className="inline-flex items-center gap-1 rounded-lg border-2 border-border bg-background px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
						>
							<ChevronLeft size={14} />
							Back
						</button>

						{!isLast ? (
							<button
								type="button"
								onClick={goNext}
								className="inline-flex items-center gap-1 rounded-lg border-2 border-primary bg-primary px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
							>
								Next
								<ChevronRight size={14} />
							</button>
						) : (
							<button
								type="button"
								disabled={!allAnswered}
								className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border-2 border-primary bg-primary px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none transition-colors"
								onClick={handleSubmit}
							>
								<ArrowRight size={16} />
								{total === 1 ? "Answer" : "Submit answers"}
							</button>
						)}
					</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
