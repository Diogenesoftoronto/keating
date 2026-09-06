import { Select } from "./Select";
import { useCallback, useMemo, useReducer, useRef, useTransition } from "react";
import {
	ArrowRight,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	MessageSquare,
} from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { parseQuestionTemplate } from "./question-template";
import { AnswerTile, CompletionMark, RoundProgress } from "./quiz/ActivityGame";

/** A single blank within a fill-in-the-blank question. */
export interface BlankField {
	/** Placeholder text for the blank input */
	placeholder?: string;
	/** Hint shown next to the blank */
	hint?: string;
}

/** A single question within an OpenUI or legacy imported form. */
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
		marginBlock: "0.375rem",
		width: "100%",
		maxWidth: "100%",
		overflowX: "hidden",
		border: "1px solid var(--border)",
		borderRadius: "1rem",
		background: "transparent",
		padding: "1rem",
		[sm]: { marginBlock: "0.75rem", padding: "1.25rem" },
	}),
	submittedShell: css({
		marginBlock: "0.375rem",
		width: "100%",
		maxWidth: "100%",
		overflowX: "hidden",
		border: "1px solid var(--border)",
		borderRadius: "1rem",
		background: "transparent",
		padding: "1rem",
		[sm]: { marginBlock: "0.75rem", padding: "1.25rem" },
	}),
	iconBox: css({
		display: "flex",
		height: "1.25rem",
		width: "1.25rem",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
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
		height: "3rem",
		width: "100%",
		borderRadius: "0.375rem",
		border: "1px solid var(--border)",
		background: "var(--background)",
		paddingInline: "0.5rem",
		fontSize: "0.875rem",
		outline: "none",
		_focus: { borderColor: "var(--primary)" },
		"&::placeholder": { color: "var(--muted-foreground)" },
	}),
	buttonSecondary: css({
		display: "inline-flex",
		alignItems: "center",
		gap: "0.25rem",
		borderRadius: "0.5rem",
		borderWidth: "1px",
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
		borderWidth: "1px",
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

type QuestionInteractionState = {
	answers: BlankState[];
	submitted: boolean;
	current: number;
	collapsed: boolean;
	draggingMatch: string | null;
	dragOverRow: number | null;
};

type QuestionInteractionAction =
	| { type: "update-answers"; update: (answers: BlankState[]) => BlankState[] }
	| { type: "submit" }
	| { type: "navigate"; current: number }
	| { type: "toggle-collapsed" }
	| { type: "drag-start"; value: string }
	| { type: "drag-over"; row: number | null }
	| { type: "drag-end" };

function blankCount(template: string): number {
	const matches = template.match(/_{3,}|\{\{blank\}\}/g);
	return matches ? matches.length : 0;
}

function createQuestionInteractionState(questions: QuestionField[]): QuestionInteractionState {
	return {
		answers: questions.map((question) => ({
			values: Array(question.blanks?.length ?? blankCount(question.question)).fill(""),
			selected: [],
			text: "",
			classifications: (question.items ?? []).map((item) => ({ item, choice: "", reason: "" })),
		})),
		submitted: false,
		current: 0,
		collapsed: false,
		draggingMatch: null,
		dragOverRow: null,
	};
}

function questionInteractionReducer(
	state: QuestionInteractionState,
	action: QuestionInteractionAction,
): QuestionInteractionState {
	switch (action.type) {
		case "update-answers":
			return { ...state, answers: action.update(state.answers) };
		case "submit":
			return { ...state, submitted: true };
		case "navigate":
			return { ...state, current: action.current };
		case "toggle-collapsed":
			return { ...state, collapsed: !state.collapsed };
		case "drag-start":
			return { ...state, draggingMatch: action.value };
		case "drag-over":
			return { ...state, dragOverRow: action.row };
		case "drag-end":
			return { ...state, draggingMatch: null, dragOverRow: null };
	}
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

	const [interaction, dispatch] = useReducer(
		questionInteractionReducer,
		questions,
		createQuestionInteractionState,
	);
	const [isQuestionPending, startQuestionTransition] = useTransition();
	const {
		answers: states,
		submitted,
		current,
		collapsed,
		draggingMatch,
		dragOverRow,
	} = interaction;

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
		dispatch({ type: "update-answers", update: (current) =>
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
		});
	};

	const setText = (index: number, value: string) => {
		if (submitted) return;
		dispatch({ type: "update-answers", update: (current) =>
			current.map((state, i) => (i === index ? { ...state, text: value } : state)),
		});
	};

	const setClassificationValue = (
		index: number,
		rowIndex: number,
		field: "choice" | "reason",
		value: string,
	) => {
		if (submitted) return;
		dispatch({ type: "update-answers", update: (current) =>
			current.map((state, i) => {
				if (i !== index) return state;
				return {
					...state,
					classifications: state.classifications.map((row, r) =>
						r === rowIndex ? { ...row, [field]: value } : row,
					),
				};
			}),
		});
	};

	const setMatchingChoice = (index: number, rowIndex: number, value: string, unique: boolean) => {
		if (submitted) return;
		dispatch({ type: "update-answers", update: (current) =>
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
		});
	};

	const handleMatchingDrop = (rowIndex: number, value: string) => {
		setMatchingChoice(current, rowIndex, value, q.uniqueMatches !== false);
		dispatch({ type: "drag-end" });
	};

	const setBlankValue = (index: number, blankIdx: number, value: string) => {
		if (submitted) return;
		dispatch({ type: "update-answers", update: (current) =>
			current.map((state, i) => {
				if (i !== index) return state;
				const values = [...state.values];
				values[blankIdx] = value;
				return { ...state, values };
			}),
		});
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
		dispatch({ type: "submit" });
		onSubmit?.(answers);
	}, [submitted, allAnswered, questions, answerFor, onSubmit, states]);

	const goNext = useCallback(() => {
		if (current < total - 1) {
			startQuestionTransition(() => dispatch({ type: "navigate", current: current + 1 }));
		}
	}, [current, total]);

	const goPrev = useCallback(() => {
		if (current > 0) {
			startQuestionTransition(() => dispatch({ type: "navigate", current: current - 1 }));
		}
	}, [current]);

	if (submitted) {
		return (
			<div className={cx(questionStyles.submittedShell, "activity-game")}>
				<CompletionMark detail="Your answers are ready for review.">Round complete</CompletionMark>
				<details className="activity-review">
					<summary>Review answers</summary>
					<div className={questionStyles.rowStart}>
					<div className={cx(questionStyles.minFlex, questionStyles.stack2)}>

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
				</details>
			</div>
		);
	}

	const q = questions[current];
	if (!q) return null;
	const state = states[current] ?? { values: [], selected: [], text: "", classifications: [] };
	const isLast = current === total - 1;
	const isBlanks = q.type === "blanks" || (q.blanks && q.blanks.length > 0);
	const isClassification = isClassificationQuestion(q);
	const isMatching = isMatchingQuestion(q);
	const selectedMatches = new Set(state.classifications.map((row) => row.choice).filter(Boolean));

	return (
			<div className={cx(questionStyles.shell, "activity-game")} aria-busy={isQuestionPending} style={{ opacity: isQuestionPending ? 0.72 : 1, transition: "opacity 120ms ease-out" }}>
				<div className={css({ display: "flex", alignItems: "flex-start" })}>
				<div className={css({ minWidth: 0, flex: 1, display: "grid", gap: "0.5rem", [sm]: { gap: "1rem" } })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.75rem" })}>
						<div className={css({ flex: 1, minWidth: 0 })}><RoundProgress current={current} total={total} label="Question progress" /></div>
						<button type="button" onClick={() => dispatch({ type: "toggle-collapsed" })} aria-expanded={!collapsed} aria-label={collapsed ? "Show questions" : "Hide questions"} className="activity-back-action">
							{collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
						</button>
					</div>
					{collapsed ? (
						<p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", overflowWrap: "anywhere" })}>{q.question}</p>
					) : (
						<>

					{/* Current question card */}
					<div key={current} className={cx("activity-stage", css({ display: "grid", gap: "1rem", maxWidth: "100%" }))}>
						{q.header && (
							<span className={css({ fontSize: "0.8125rem", fontWeight: 550, color: "var(--muted-foreground)" })}>
								{q.header}
							</span>
						)}

						{isMatching ? (
							<div className={css({ display: "grid", gap: "0.75rem", maxWidth: "100%" })}>
								<p className="activity-prompt">{q.question}</p>
								{/* Frameless: the choices are already outlined, so a wrapper border
								    would just be a box around boxes. */}
								<div>
									<div className={css({ marginBottom: "0.5rem", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" })}>
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
													dispatch({ type: "drag-start", value: choice });
														}}
														onDragEnd={() => {
													dispatch({ type: "drag-end" });
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
											dispatch({ type: "drag-over", row: rowIndex });
											}}
										onDragLeave={() => {
											if (dragOverRow === rowIndex) dispatch({ type: "drag-over", row: null });
										}}
											onDrop={(event) => {
												event.preventDefault();
												const value = event.dataTransfer.getData("text/plain") || draggingMatch;
												if (value) handleMatchingDrop(rowIndex, value);
											}}
											className={cx(
												// Rows are separated by a hairline rather than boxed: the answer
												// chip inside already has its own outline.
												css({
													display: "grid",
													gap: "0.75rem",
													borderRadius: "0.375rem",
													padding: "0.625rem 0.5rem",
													transition: "color 150ms, background-color 150ms",
													"&:not(:last-child)": { borderBottom: "1px solid var(--border)" },
													[sm]: { gridTemplateColumns: "2rem minmax(0,1fr) minmax(13rem,0.38fr)", alignItems: "center" },
												}),
												dragOverRow === rowIndex &&
													css({ background: "color-mix(in srgb, var(--primary) 10%, transparent)" }),
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
													<Select
														value={row.choice}
														disabled={submitted}
														onValueChange={(value) => setMatchingChoice(current, rowIndex, value, q.uniqueMatches !== false)}
														aria-label={`Match for ${row.item}`} className={css({ height: "3rem", width: "100%", borderRadius: "0.375rem", border: "1px dashed var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", paddingInline: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)", outline: "none", _focus: { borderColor: "var(--primary)" }, [sm]: { fontSize: "0.875rem" } })}
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
													</Select>
												)}
											</div>
										</div>
									))}
								</div>
							</div>
						) : isClassification ? (
							<div className={css({ display: "grid", gap: "0.75rem", maxWidth: "100%" })}>
								<p className="activity-prompt">{q.question}</p>
								<div className={css({ display: "none", gap: "0.5rem", paddingInline: "0.5rem", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)", [sm]: { display: "grid", gridTemplateColumns: "minmax(0,0.9fr) minmax(0,0.9fr) minmax(0,1.4fr)" } })}>
									<span>{q.itemLabel ?? "Item"}</span>
									<span>{q.choiceLabel ?? "Choice"}</span>
									<span>{q.reasonLabel ?? "Justification"}</span>
								</div>
								{/* Rows read as a table, not as stacked boxes: hairlines only, and the
								    select/input inside each row carries the visible edge. */}
								<div className={css({ display: "grid" })}>
									{state.classifications.map((row, rowIndex) => (
										<div
											key={`${row.item}-${rowIndex}`}
											className={css({ display: "grid", gap: "0.5rem", padding: "0.625rem 0.5rem", "&:not(:last-child)": { borderBottom: "1px solid var(--border)" }, [sm]: { gridTemplateColumns: "minmax(0,0.9fr) minmax(0,0.9fr) minmax(0,1.4fr)", alignItems: "center" } })}
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
												<Select
													value={row.choice}
													disabled={submitted}
													onValueChange={(value) => setClassificationValue(current, rowIndex, "choice", value)}
													className={questionStyles.field}
												>
													<option value="">Select...</option>
													{q.choices?.map((choice) => (
														<option key={choice} value={choice}>
															{choice}
														</option>
													))}
												</Select>
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
									{parseQuestionTemplate(q.question).map((part, idx) => {
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
								<p className="activity-prompt">{q.question}</p>

								{q.choices && q.choices.length > 0 && (
									<div className="activity-answer-grid" role="group" aria-label={q.multiSelect ? "Choose all that apply" : "Choose an answer"}>
										{q.choices.map((choice, choiceIndex) => <AnswerTile key={choice} label={choice} index={choiceIndex} selected={state.selected.includes(choice)} multiple={q.multiSelect} disabled={submitted} onClick={() => toggleChoice(current, choice, q.multiSelect ?? false)} />)}
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
											aria-label="Your answer" className={cx(questionStyles.field, "activity-field", css({ paddingInline: "0.75rem" }))}
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

						{data.intro && <details className="activity-hint"><summary>About this round</summary><p>{data.intro}</p></details>}
						{q.hint && !submitted && (
							<details className="activity-hint"><summary>Need a hint?</summary><p>{q.hint}</p></details>
						)}
					</div>

					{/* Navigation */}
					<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
						<button
							type="button"
							onClick={goPrev}
							disabled={isQuestionPending || current === 0}
							className={cx(questionStyles.buttonSecondary, "activity-back-action")}
						>
							<ChevronLeft size={14} />
							Back
						</button>

						{!isLast ? (
							<button
								type="button"
								onClick={goNext}
								disabled={isQuestionPending}
								className={cx(questionStyles.buttonPrimary, "activity-main-action")}
							>
								{currentAnswered ? "Lock in & next" : "Skip for now"}
								<ChevronRight size={14} />
							</button>
						) : (
							<button
								type="button"
								disabled={!allAnswered}
								className={cx(questionStyles.buttonPrimary, "activity-main-action", css({ gap: "0.375rem", [sm]: { gap: "0.5rem" } }))}
								onClick={handleSubmit}
							>
								<ArrowRight size={16} />
								{total === 1 ? "Lock in answer" : "Finish round"}
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
