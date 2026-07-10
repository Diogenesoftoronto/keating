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
import { css, cx } from "../../styled-system/css";

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
	type?: "choice" | "text" | "blanks" | "classification" | "matching";
	choices?: string[];
	/** Rows to classify or match when type is "classification" or "matching". */
	items?: string[];
	/** Allow selecting more than one choice. */
	multiSelect?: boolean;
	/** Show a free-text input in addition to (or instead of) choices. */
	allowText?: boolean;
	/** Blanks definition for fill-in-the-blank questions. */
	blanks?: BlankField[];
	/** Require a short justification per classification row. Defaults to true. */
	requireReasons?: boolean;
	/** Column label for classification rows. */
	itemLabel?: string;
	/** Column label for classification choices. */
	choiceLabel?: string;
	/** Column label for classification justifications. */
	reasonLabel?: string;
	/** Require every matching choice to be used at most once. Defaults to true. */
	uniqueMatches?: boolean;
	/** Correct answer-bank entry per item, in item order. Enables red/green feedback after submission. */
	correctMatches?: string[];
	hint?: string;
}

/** Normalized multi-field form payload. */
export interface QuestionFormData {
	intro?: string;
	/** Topic attribution lets answers become durable learning evidence. */
	topic?: string;
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
	/** Present only when the form has an objective answer key. */
	score?: number;
	grading: "auto" | "pending";
}

interface QuestionRendererProps {
	data: QuestionFormData;
	onSubmit?: (answers: AnsweredQuestion[]) => void;
}

const sm = "@media (min-width: 640px)";

const questionStyles = {
	shell: css({
		marginBlock: "0.5rem",
		width: "100%",
		maxWidth: "100%",
		overflowX: "hidden",
		borderRadius: "0.5rem",
		border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)",
		background: "color-mix(in srgb, var(--primary) 5%, transparent)",
		padding: "0.5rem",
		boxShadow: "var(--shadow-sm)",
		[sm]: { marginBlock: "0.75rem", borderRadius: "0.75rem", padding: "1rem" },
	}),
	submittedShell: css({
		marginBlock: "0.5rem",
		width: "100%",
		maxWidth: "100%",
		overflowX: "hidden",
		borderRadius: "0.5rem",
		border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)",
		background: "color-mix(in srgb, var(--primary) 5%, transparent)",
		padding: "0.625rem",
		boxShadow: "var(--shadow-sm)",
		[sm]: { marginBlock: "0.75rem", borderRadius: "0.75rem", padding: "1rem" },
	}),
	iconBox: css({
		display: "flex",
		height: "2rem",
		width: "2rem",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: "0.5rem",
		background: "color-mix(in srgb, var(--primary) 10%, transparent)",
	}),
	rowStart: css({ display: "flex", alignItems: "flex-start", gap: "0.5rem", [sm]: { gap: "0.75rem" } }),
	rowCenter: css({ display: "flex", alignItems: "center", gap: "0.5rem" }),
	minFlex: css({ minWidth: 0, flex: 1 }),
	stack1: css({ display: "grid", gap: "0.25rem" }),
	stack15: css({ display: "grid", gap: "0.375rem" }),
	stack2: css({ display: "grid", gap: "0.5rem" }),
	stack3: css({ display: "grid", gap: "0.75rem" }),
	primaryText: css({ color: "var(--primary)" }),
	mutedText: css({ color: "var(--muted-foreground)" }),
	breakWords: css({ overflowWrap: "break-word" }),
	field: css({
		height: "2.25rem",
		width: "100%",
		borderRadius: "0.375rem",
		border: "1px solid var(--border)",
		background: "var(--background)",
		paddingInline: "0.5rem",
		fontSize: "0.875rem",
		outline: "none",
		_focus: { borderColor: "var(--primary)" },
		"&::placeholder": { color: "color-mix(in srgb, var(--muted-foreground) 70%, transparent)" },
	}),
	buttonSecondary: css({
		display: "inline-flex",
		alignItems: "center",
		gap: "0.25rem",
		borderRadius: "0.5rem",
		borderWidth: "2px",
		borderColor: "var(--border)",
		background: "var(--background)",
		padding: "0.375rem 0.625rem",
		fontSize: "0.75rem",
		fontWeight: 500,
		transition: "background-color 150ms",
		_hover: { background: "var(--accent)" },
		_disabled: { opacity: 0.4, pointerEvents: "none" },
		[sm]: { padding: "0.5rem 0.75rem", fontSize: "0.875rem" },
	}),
	buttonPrimary: css({
		display: "inline-flex",
		alignItems: "center",
		gap: "0.25rem",
		borderRadius: "0.5rem",
		borderWidth: "2px",
		borderColor: "var(--primary)",
		background: "var(--primary)",
		padding: "0.375rem 0.75rem",
		fontSize: "0.75rem",
		fontWeight: 500,
		color: "var(--primary-foreground)",
		transition: "background-color 150ms",
		_hover: { background: "color-mix(in srgb, var(--primary) 90%, transparent)" },
		_disabled: { opacity: 0.4, pointerEvents: "none" },
		[sm]: { padding: "0.5rem 1rem", fontSize: "0.875rem" },
	}),
};

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
		const items = Array.isArray(q.items)
			? q.items.filter((item): item is string => typeof item === "string")
			: undefined;
		const correctMatches =
			Array.isArray(q.correctMatches)
				? q.correctMatches.filter((item): item is string => typeof item === "string")
				: Array.isArray(q.correct_matches)
					? q.correct_matches.filter((item): item is string => typeof item === "string")
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
			: typeof q.type === "string" && ["choice", "text", "blanks", "classification", "matching"].includes(q.type)
				? (q.type as QuestionField["type"])
					: undefined;
		const requireReasons =
			typeof q.requireReasons === "boolean"
				? q.requireReasons
				: typeof q.require_reasons === "boolean"
					? q.require_reasons
					: true;
		return {
			header: typeof q.header === "string" ? q.header : undefined,
			question,
			type,
			choices: choices && choices.length > 0 ? choices : undefined,
			items: items && items.length > 0 ? items : undefined,
			multiSelect,
			allowText,
			blanks,
			requireReasons,
			itemLabel: typeof q.itemLabel === "string" ? q.itemLabel : typeof q.item_label === "string" ? q.item_label : undefined,
			choiceLabel: typeof q.choiceLabel === "string" ? q.choiceLabel : typeof q.choice_label === "string" ? q.choice_label : undefined,
			reasonLabel: typeof q.reasonLabel === "string" ? q.reasonLabel : typeof q.reason_label === "string" ? q.reason_label : undefined,
			uniqueMatches:
				typeof q.uniqueMatches === "boolean"
					? q.uniqueMatches
					: typeof q.unique_matches === "boolean"
						? q.unique_matches
						: true,
			correctMatches: correctMatches && correctMatches.length > 0 ? correctMatches : undefined,
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
			topic: typeof obj.topic === "string" ? obj.topic : undefined,
			questions,
		};
	}

	const single = coerceField(obj);
	if (!single) return null;
	return {
		intro: typeof obj.intro === "string" ? obj.intro : undefined,
		topic: typeof obj.topic === "string" ? obj.topic : undefined,
		questions: [single],
	};
}

interface BlankState {
	values: string[];
	selected: string[];
	text: string;
	classifications: ClassificationAnswer[];
}

interface ClassificationAnswer {
	item: string;
	choice: string;
	reason: string;
}

function isClassificationQuestion(question: QuestionField): boolean {
	return question.type === "classification" && !!question.items?.length && !!question.choices?.length;
}

function isMatchingQuestion(question: QuestionField): boolean {
	return question.type === "matching" && !!question.items?.length && !!question.choices?.length;
}

function matchingCorrectness(question: QuestionField, rowIndex: number, choice: string): "correct" | "wrong" | null {
	const correct = question.correctMatches?.[rowIndex];
	if (!correct || !choice) return null;
	return choice.trim().toLowerCase() === correct.trim().toLowerCase() ? "correct" : "wrong";
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
			return {
				values: Array(blankCount).fill(""),
				selected: [],
				text: "",
				classifications: (q.items ?? []).map((item) => ({ item, choice: "", reason: "" })),
			};
		}),
	);
	const [submitted, setSubmitted] = useState(false);
	const [current, setCurrent] = useState(0);
	const [collapsed, setCollapsed] = useState(false);
	const [draggingMatch, setDraggingMatch] = useState<string | null>(null);
	const [dragOverRow, setDragOverRow] = useState<number | null>(null);

	const answerFor = useCallback(
		(index: number): string => {
			const state = states[index];
			if (!state) return "";
			const q = questions[index];
			if (isClassificationQuestion(q)) {
				return state.classifications
					.map(({ item, choice, reason }) => {
						const trimmed = reason.trim();
						return `${item}: ${choice}${trimmed ? ` - ${trimmed}` : ""}`;
					})
					.join("\n");
			}
			if (isMatchingQuestion(q)) {
				return state.classifications
					.map(({ item, choice }) => `${item}: ${choice}`)
					.join("\n");
			}
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
			if (isClassificationQuestion(q)) {
				return state.classifications.every(
					(row) => row.choice.trim().length > 0 && (!q.requireReasons || row.reason.trim().length > 0),
				);
			}
			if (isMatchingQuestion(q)) {
				const choices = state.classifications.map((row) => row.choice.trim()).filter(Boolean);
				const allRowsMatched = choices.length === state.classifications.length;
				const unique = new Set(choices).size === choices.length;
				return allRowsMatched && (!q.uniqueMatches || unique);
			}
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
			if (isClassificationQuestion(q)) {
				return state.classifications.every(
					(row) => row.choice.trim().length > 0 && (!q.requireReasons || row.reason.trim().length > 0),
				);
			}
			if (isMatchingQuestion(q)) {
				const choices = state.classifications.map((row) => row.choice.trim()).filter(Boolean);
				const allRowsMatched = choices.length === state.classifications.length;
				const unique = new Set(choices).size === choices.length;
				return allRowsMatched && (!q.uniqueMatches || unique);
			}
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

	const setClassificationValue = (
		index: number,
		rowIndex: number,
		field: "choice" | "reason",
		value: string,
	) => {
		if (submitted) return;
		setStates((current) =>
			current.map((state, i) => {
				if (i !== index) return state;
				return {
					...state,
					classifications: state.classifications.map((row, r) =>
						r === rowIndex ? { ...row, [field]: value } : row,
					),
				};
			}),
		);
	};

	const setMatchingChoice = (index: number, rowIndex: number, value: string, unique: boolean) => {
		if (submitted) return;
		setStates((current) =>
			current.map((state, i) => {
				if (i !== index) return state;
				return {
					...state,
					classifications: state.classifications.map((row, r) => {
						if (r === rowIndex) return { ...row, choice: value };
						if (unique && value && row.choice === value) return { ...row, choice: "" };
						return row;
					}),
				};
			}),
		);
	};

	const handleMatchingDrop = (rowIndex: number, value: string) => {
		setMatchingChoice(current, rowIndex, value, q.uniqueMatches !== false);
		setDraggingMatch(null);
		setDragOverRow(null);
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
		const answers: AnsweredQuestion[] = questions.map((q, index) => {
			const matching = isMatchingQuestion(q) && q.correctMatches?.length
				? states[index]?.classifications ?? []
				: null;
			const score = matching
				? matching.filter((row, rowIndex) => matchingCorrectness(q, rowIndex, row.choice) === "correct").length / matching.length
				: undefined;
			return {
				header: q.header,
				question: q.question,
				answer: answerFor(index),
				score,
				grading: score === undefined ? "pending" : "auto",
			};
		});
		setSubmitted(true);
		onSubmit?.(answers);
	}, [submitted, allAnswered, questions, answerFor, onSubmit, states]);

	const goNext = useCallback(() => {
		if (current < total - 1) setCurrent((c) => c + 1);
	}, [current, total]);

	const goPrev = useCallback(() => {
		if (current > 0) setCurrent((c) => c - 1);
	}, [current]);

	if (submitted) {
		return (
			<div className={questionStyles.submittedShell}>
				<div className={questionStyles.rowStart}>
					<div className={questionStyles.iconBox}>
						<CheckCircle2 size={18} className={questionStyles.primaryText} />
					</div>
					<div className={cx(questionStyles.minFlex, questionStyles.stack2)}>
						<p className={css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--primary)" })}>Submitted</p>
						<div className={css({ display: "grid", gap: "0.5rem", fontSize: "0.875rem", color: "var(--primary)" })}>
							{questions.map((q, index) => {
								const state = states[index];
								if (isMatchingQuestion(q) && q.correctMatches && state) {
									return (
										<div key={index} className={questionStyles.stack2}>
											<div className={questionStyles.rowStart}>
												<MessageSquare size={14} className={css({ marginTop: "0.25rem", flexShrink: 0 })} />
												<span className={cx(questionStyles.minFlex, questionStyles.breakWords)}>
													{q.header ? `${q.header}: ` : ""}
													<strong>{q.question}</strong>
												</span>
											</div>
											<div className={questionStyles.stack15}>
												{state.classifications.map((row, rowIndex) => {
													const status = matchingCorrectness(q, rowIndex, row.choice);
													const correct = q.correctMatches?.[rowIndex];
													return (
														<div
															key={`${row.item}-${rowIndex}`}
															className={cx(
																css({
																	display: "grid",
																	gap: "0.5rem",
																	borderRadius: "0.375rem",
																	border: "1px solid",
																	padding: "0.375rem 0.5rem",
																	[sm]: { gridTemplateColumns: "minmax(0,1fr) minmax(11rem,0.42fr)" },
																}),
																status === "correct"
																	? css({ borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)", color: "var(--primary)" })
																	: status === "wrong"
																		? css({ borderColor: "color-mix(in srgb, var(--destructive) 50%, transparent)", background: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: "var(--destructive)" })
																		: css({ borderColor: "var(--border)", background: "var(--background)", color: "var(--foreground)" }),
															)}
														>
															<div className={cx(questionStyles.minFlex, questionStyles.breakWords)}>{row.item}</div>
															<div className={css({ minWidth: 0 })}>
																<strong className={questionStyles.breakWords}>{row.choice}</strong>
																{status === "wrong" && correct && (
																	<div className={css({ marginTop: "0.125rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
																		Correct: {correct}
																	</div>
																)}
															</div>
														</div>
													);
												})}
											</div>
										</div>
									);
								}
								return (
									<div key={index} className={questionStyles.rowStart}>
										<MessageSquare size={14} className={css({ marginTop: "0.25rem", flexShrink: 0 })} />
										<span className={css({ minWidth: 0, whiteSpace: "pre-line", overflowWrap: "break-word" })}>
											{q.header ? `${q.header}: ` : ""}
											<strong>{answerFor(index)}</strong>
										</span>
									</div>
								);
							})}
						</div>
					</div>
				</div>
			</div>
		);
	}

	const q = questions[current];
	if (!q) return null;
	const state = states[current] ?? { values: [], selected: [], text: "", classifications: [] };
	const isLast = current === total - 1;
	const progress = total > 1 ? ((current + 1) / total) * 100 : 100;
	const isBlanks = q.type === "blanks" || (q.blanks && q.blanks.length > 0);
	const isClassification = isClassificationQuestion(q);
	const isMatching = isMatchingQuestion(q);
	const selectedMatches = new Set(state.classifications.map((row) => row.choice).filter(Boolean));

	return (
			<div className={questionStyles.shell}>
				<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.375rem", [sm]: { gap: "0.75rem" } })}>
					<div className={css({ display: "none", height: "2rem", width: "2rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--primary) 10%, transparent)", [sm]: { display: "flex" } })}>
						<CheckCircle2 size={18} className={questionStyles.primaryText} />
					</div>
				<div className={css({ minWidth: 0, flex: 1, display: "grid", gap: "0.5rem", [sm]: { gap: "1rem" } })}>
					<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", [sm]: { gap: "0.75rem" } })}>
						<div className={css({ minWidth: 0 })}>
							<p className={css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--primary)", [sm]: { fontSize: "0.875rem" } })}>Question</p>
							{collapsed && (
								<p className={css({ lineClamp: 2, fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)", overflowWrap: "break-word" })}>
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
							className={css({
								display: "inline-flex",
								height: "1.5rem",
								flexShrink: 0,
								alignItems: "center",
								gap: "0.25rem",
								borderRadius: "0.375rem",
								border: "1px solid var(--border)",
								background: "var(--background)",
								paddingInline: "0.375rem",
								fontSize: "0.75rem",
								fontWeight: 500,
								color: "var(--muted-foreground)",
								transition: "color 150ms, background-color 150ms, border-color 150ms",
								_hover: {
									borderColor: "color-mix(in srgb, var(--primary) 60%, transparent)",
									background: "color-mix(in srgb, var(--primary) 10%, transparent)",
									color: "var(--primary)",
								},
								[sm]: { height: "2rem", paddingInline: "0.5rem" },
							})}
						>
							{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
							<span className={css({ display: "none", [sm]: { display: "inline" } })}>{collapsed ? "Show" : "Hide"}</span>
						</button>
					</div>
					{collapsed ? (
						<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.5rem", border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)", background: "color-mix(in srgb, var(--background) 40%, transparent)", padding: "0.75rem" })}>
							<div className={css({ height: "0.375rem", flex: 1, overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
								<div
									className={css({ height: "100%", borderRadius: "9999px", background: "var(--primary)", transition: "all 150ms" })}
									style={{ width: `${progress}%` }}
								/>
							</div>
							<span className={cx("font-terminal", css({ fontSize: "0.6875rem", color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }))}>
								{current + 1}/{total}
							</span>
						</div>
					) : (
						<>
					{data.intro && (
						<p className={css({ fontSize: "0.75rem", lineHeight: 1.375, color: "var(--muted-foreground)", overflowWrap: "break-word", [sm]: { fontSize: "0.875rem", lineHeight: "1.5rem" } })}>{data.intro}</p>
					)}

					{/* Progress bar */}
					<div className={questionStyles.rowCenter}>
						<div className={css({ height: "0.375rem", flex: 1, overflow: "hidden", borderRadius: "9999px", background: "var(--muted)" })}>
							<div
								className={css({ height: "100%", borderRadius: "9999px", background: "var(--primary)", transition: "all 150ms" })}
								style={{ width: `${progress}%` }}
							/>
						</div>
						<span className={cx("font-terminal", css({ fontSize: "0.6875rem", color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }))}>
							{current + 1}/{total}
						</span>
					</div>

					{/* Current question card */}
					<div className={css({ display: "grid", gap: "0.5rem", maxWidth: "100%", borderRadius: 0, border: "0 solid transparent", background: "transparent", padding: 0, [sm]: { gap: "0.75rem", borderRadius: "0.5rem", border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)", background: "color-mix(in srgb, var(--background) 40%, transparent)", padding: "0.75rem" } })}>
						{q.header && (
							<span className={css({ display: "inline-flex", borderRadius: "0.25rem", background: "color-mix(in srgb, var(--primary) 10%, transparent)", padding: "0.125rem 0.5rem", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--primary)" })}>
								{q.header}
							</span>
						)}

						{isMatching ? (
							<div className={css({ display: "grid", gap: "0.75rem", maxWidth: "100%" })}>
								<p className={css({ fontSize: "0.75rem", fontWeight: 500, lineHeight: 1.375, overflowWrap: "break-word", [sm]: { fontSize: "0.875rem", lineHeight: "1.5rem" } })}>{q.question}</p>
								<div className={css({ borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.625rem" })}>
									<div className={css({ marginBottom: "0.5rem", fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" })}>
										{q.choiceLabel ?? "Answer bank"}
									</div>
									<ol className={css({ display: "grid", gap: "0.5rem", [sm]: { gridTemplateColumns: "repeat(auto-fit,minmax(11rem,1fr))" } })}>
										{q.choices?.map((choice, choiceIndex) => {
											const used = selectedMatches.has(choice);
											return (
												<li key={choice} className={css({ minWidth: 0 })}>
													<button
														type="button"
														draggable={!submitted && (!used || q.uniqueMatches === false)}
														disabled={submitted || (used && q.uniqueMatches !== false)}
														onDragStart={(event) => {
															event.dataTransfer.setData("text/plain", choice);
															event.dataTransfer.effectAllowed = "move";
															setDraggingMatch(choice);
														}}
														onDragEnd={() => {
															setDraggingMatch(null);
															setDragOverRow(null);
														}}
														className={cx(
															css({
																display: "inline-flex",
																minHeight: "2rem",
																width: "100%",
																maxWidth: "100%",
																alignItems: "center",
																gap: "0.5rem",
																borderRadius: "0.375rem",
																border: "1px solid",
																padding: "0.375rem 0.625rem",
																textAlign: "left",
																fontSize: "0.75rem",
																transition: "color 150ms, background-color 150ms, border-color 150ms",
																[sm]: { fontSize: "0.875rem" },
															}),
															used
																? css({ borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)", color: "var(--primary)", _disabled: { opacity: 0.7 } })
																: css({ borderColor: "var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", _hover: { borderColor: "color-mix(in srgb, var(--primary) 50%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)" } }),
														)}
														title={used && q.uniqueMatches !== false ? "Already matched" : "Drag to a row"}
													>
														<span className={cx("font-terminal", css({ fontSize: "0.6875rem", color: "var(--muted-foreground)" }))}>
															{String.fromCharCode(65 + choiceIndex)}
														</span>
														<span className={cx(questionStyles.minFlex, questionStyles.breakWords)}>{choice}</span>
													</button>
												</li>
											);
										})}
									</ol>
								</div>
								<div className={questionStyles.stack2}>
									{state.classifications.map((row, rowIndex) => (
										<div
											key={`${row.item}-${rowIndex}`}
											onDragOver={(event) => {
												event.preventDefault();
												setDragOverRow(rowIndex);
											}}
											onDragLeave={() => setDragOverRow((current) => current === rowIndex ? null : current)}
											onDrop={(event) => {
												event.preventDefault();
												const value = event.dataTransfer.getData("text/plain") || draggingMatch;
												if (value) handleMatchingDrop(rowIndex, value);
											}}
											className={cx(
												css({
													display: "grid",
													gap: "0.75rem",
													borderRadius: "0.5rem",
													border: "1px solid",
													background: "var(--background)",
													padding: "0.625rem",
													transition: "color 150ms, background-color 150ms, border-color 150ms",
													[sm]: { gridTemplateColumns: "2rem minmax(0,1fr) minmax(13rem,0.38fr)", alignItems: "center" },
												}),
												dragOverRow === rowIndex
													? css({ borderColor: "var(--primary)", background: "color-mix(in srgb, var(--primary) 10%, transparent)" })
													: row.choice
														? css({ borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)" })
														: css({ borderColor: "var(--border)" }),
											)}
										>
											<div className={cx("font-terminal", css({ fontSize: "0.75rem", color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }))}>
												{rowIndex + 1}.
											</div>
											<div className={css({ minWidth: 0, overflowWrap: "break-word", fontSize: "0.875rem", fontWeight: 500 })}>
												{row.item}
											</div>
											<div className={css({ minWidth: 0 })}>
												{row.choice ? (
													<div className={css({ display: "flex", minHeight: "2.25rem", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--primary) 50%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)", padding: "0.375rem 0.5rem", fontSize: "0.875rem", color: "var(--primary)" })}>
														<span className={cx(questionStyles.minFlex, questionStyles.breakWords)}>{row.choice}</span>
														<button
															type="button"
															disabled={submitted}
															onClick={() => setMatchingChoice(current, rowIndex, "", q.uniqueMatches !== false)}
															className={css({ flexShrink: 0, borderRadius: "0.25rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.125rem 0.375rem", fontSize: "0.625rem", color: "var(--muted-foreground)", _hover: { borderColor: "color-mix(in srgb, var(--primary) 60%, transparent)", color: "var(--primary)" } })}
														>
															Clear
														</button>
													</div>
												) : (
													<select
														value={row.choice}
														disabled={submitted}
														onChange={(e) => setMatchingChoice(current, rowIndex, e.target.value, q.uniqueMatches !== false)}
														className={css({ height: "2.25rem", width: "100%", borderRadius: "0.375rem", border: "1px dashed var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", paddingInline: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)", outline: "none", _focus: { borderColor: "var(--primary)" }, [sm]: { fontSize: "0.875rem" } })}
													>
														<option value="">Drop or choose...</option>
														{q.choices?.map((choice, choiceIndex) => {
															const usedElsewhere = q.uniqueMatches !== false && selectedMatches.has(choice) && row.choice !== choice;
															return (
																<option key={choice} value={choice} disabled={usedElsewhere}>
																	{String.fromCharCode(65 + choiceIndex)}. {choice}
																</option>
															);
														})}
													</select>
												)}
											</div>
										</div>
									))}
								</div>
							</div>
						) : isClassification ? (
							<div className={css({ display: "grid", gap: "0.75rem", maxWidth: "100%" })}>
								<p className={css({ fontSize: "0.75rem", fontWeight: 500, lineHeight: 1.375, overflowWrap: "break-word", [sm]: { fontSize: "0.875rem", lineHeight: "1.5rem" } })}>{q.question}</p>
								<div className={css({ display: "none", gap: "0.5rem", fontSize: "0.6875rem", fontWeight: 500, color: "var(--muted-foreground)", [sm]: { display: "grid", gridTemplateColumns: "minmax(7rem,0.9fr) minmax(9rem,0.9fr) minmax(12rem,1.4fr)" } })}>
									<span>{q.itemLabel ?? "Item"}</span>
									<span>{q.choiceLabel ?? "Choice"}</span>
									<span>{q.reasonLabel ?? "Justification"}</span>
								</div>
								<div className={questionStyles.stack2}>
									{state.classifications.map((row, rowIndex) => (
										<div
											key={`${row.item}-${rowIndex}`}
											className={css({ display: "grid", gap: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.5rem", [sm]: { gridTemplateColumns: "minmax(7rem,0.9fr) minmax(9rem,0.9fr) minmax(12rem,1.4fr)", alignItems: "center" } })}
										>
											<div className={css({ minWidth: 0 })}>
												<span className={css({ fontSize: "0.625rem", fontWeight: 500, color: "var(--muted-foreground)", [sm]: { display: "none" } })}>
													{q.itemLabel ?? "Item"}
												</span>
												<div className={css({ overflowWrap: "break-word", fontSize: "0.875rem", fontWeight: 500 })}>{row.item}</div>
											</div>
											<label className={cx(questionStyles.stack1, css({ minWidth: 0 }))}>
												<span className={css({ fontSize: "0.625rem", fontWeight: 500, color: "var(--muted-foreground)", [sm]: { display: "none" } })}>
													{q.choiceLabel ?? "Choice"}
												</span>
												<select
													value={row.choice}
													disabled={submitted}
													onChange={(e) => setClassificationValue(current, rowIndex, "choice", e.target.value)}
													className={questionStyles.field}
												>
													<option value="">Select...</option>
													{q.choices?.map((choice) => (
														<option key={choice} value={choice}>
															{choice}
														</option>
													))}
												</select>
											</label>
											<label className={cx(questionStyles.stack1, css({ minWidth: 0 }))}>
												<span className={css({ fontSize: "0.625rem", fontWeight: 500, color: "var(--muted-foreground)", [sm]: { display: "none" } })}>
													{q.reasonLabel ?? "Justification"}
												</span>
												<input
													type="text"
													value={row.reason}
													disabled={submitted}
													onChange={(e) => setClassificationValue(current, rowIndex, "reason", e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter" && currentAnswered) {
															if (!isLast) goNext();
															else if (allAnswered) handleSubmit();
														}
													}}
													placeholder={q.requireReasons ? "One phrase..." : "Optional..."}
													className={questionStyles.field}
												/>
											</label>
										</div>
									))}
								</div>
							</div>
						) : isBlanks ? (
							<div className={css({ display: "grid", gap: "0.75rem", maxWidth: "100%" })}>
								<div className={css({ fontSize: "0.875rem", fontWeight: 500, lineHeight: 1.625, overflowWrap: "break-word" })}>
									{parseTemplate(q.question).map((part, idx) => {
										if (!part.isBlank) {
											return <span key={idx} className={questionStyles.breakWords}>{part.text}</span>;
										}
										const blankIdx = part.index;
										const blankDef = q.blanks?.[blankIdx];
										return (
											<span key={idx} className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", marginInline: "0.125rem", [sm]: { marginInline: "0.25rem" } })}>
												<input
													ref={(el) => { blankRefs.current[blankIdx] = el; }}
													type="text"
													disabled={submitted}
													className={css({ display: "inline-block", height: "1.75rem", width: "4rem", borderRadius: "0.25rem", border: "1px solid var(--border)", background: "var(--background)", paddingInline: "0.375rem", textAlign: "center", fontSize: "0.875rem", outline: "none", _focus: { borderColor: "var(--primary)" }, "&::placeholder": { color: "color-mix(in srgb, var(--muted-foreground) 50%, transparent)" }, [sm]: { width: "5rem", paddingInline: "0.5rem" } })}
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
													<span className={css({ display: "none", fontSize: "0.625rem", color: "var(--muted-foreground)", [sm]: { display: "inline" } })}>{blankDef.hint}</span>
												)}
											</span>
										);
									})}
								</div>
							</div>
						) : (
							<>
								<p className={css({ fontSize: "0.75rem", fontWeight: 500, lineHeight: 1.375, overflowWrap: "break-word", [sm]: { fontSize: "0.875rem", lineHeight: "1.5rem" } })}>{q.question}</p>

								{q.choices && q.choices.length > 0 && (
									<div className={css({ display: "grid", gap: "0.375rem", [sm]: { gap: "0.5rem" } })}>
										{q.choices.map((choice) => {
											const isSelected = state.selected.includes(choice);
											return (
												<button
													key={choice}
													type="button"
													disabled={submitted}
													aria-pressed={isSelected}
													className={cx(
														css({
															display: "flex",
															width: "100%",
															alignItems: "center",
															gap: "0.5rem",
															borderRadius: "0.5rem",
															border: "1px solid",
															padding: "0.375rem 0.5rem",
															textAlign: "left",
															fontSize: "0.75rem",
															lineHeight: 1.375,
															transition: "all 150ms",
															[sm]: { gap: "0.75rem", borderWidth: "2px", padding: "0.75rem 1rem", fontSize: "0.875rem" },
														}),
														isSelected
															? css({ borderColor: "var(--primary)", background: "color-mix(in srgb, var(--primary) 10%, transparent)", color: "var(--primary)" })
															: css({ borderColor: "var(--border)", background: "var(--background)", _hover: { borderColor: "color-mix(in srgb, var(--primary) 50%, transparent)" } }),
														submitted ? css({ cursor: "not-allowed", opacity: 0.7 }) : css({ cursor: "pointer" }),
													)}
													onClick={() => toggleChoice(current, choice, q.multiSelect ?? false)}
												>
													{q.multiSelect ? (
														<span
															className={cx(
																css({ display: "flex", height: "1rem", width: "1rem", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "0.25rem", borderWidth: "2px" }),
																isSelected
																	? css({ borderColor: "var(--primary)", background: "var(--primary)", color: "var(--primary-foreground)" })
																	: css({ borderColor: "var(--border)" }),
															)}
														>
															{isSelected ? <Check size={12} /> : null}
														</span>
													) : isSelected ? (
														<CheckCircle2 size={16} className={css({ flexShrink: 0 })} />
													) : (
														<div className={css({ height: "1rem", width: "1rem", flexShrink: 0, borderRadius: "9999px", borderWidth: "2px", borderColor: "var(--border)" })} />
													)}
													<span className={cx(questionStyles.minFlex, questionStyles.breakWords)}>{choice}</span>
												</button>
											);
										})}
									</div>
								)}

								{q.allowText && (
									<div className={questionStyles.stack2}>
										{q.choices && q.choices.length > 0 && (
											<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
												<div className={css({ height: "1px", flex: 1, background: "var(--border)" })} />
												<span>or type your own</span>
												<div className={css({ height: "1px", flex: 1, background: "var(--border)" })} />
											</div>
										)}
										<input
											type="text"
											className={cx(questionStyles.field, css({ paddingInline: "0.75rem" }))}
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
							<p className={css({ fontSize: "0.75rem", fontStyle: "italic", color: "var(--muted-foreground)", overflowWrap: "break-word" })}>💡 {q.hint}</p>
						)}
					</div>

					{/* Navigation */}
					<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
						<button
							type="button"
							onClick={goPrev}
							disabled={current === 0}
							className={questionStyles.buttonSecondary}
						>
							<ChevronLeft size={14} />
							Back
						</button>

						{!isLast ? (
							<button
								type="button"
								onClick={goNext}
								className={questionStyles.buttonPrimary}
							>
								Next
								<ChevronRight size={14} />
							</button>
						) : (
							<button
								type="button"
								disabled={!allAnswered}
								className={cx(questionStyles.buttonPrimary, css({ gap: "0.375rem", [sm]: { gap: "0.5rem" } }))}
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
