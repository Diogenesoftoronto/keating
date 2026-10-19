/**
 * Multi-question form renderer (choice, text, blanks, classification, matching).
 * Owns interaction state (reducer) and layout; answer serialization/validation
 * lives in ./question/question-answers and the post-submit review in
 * ./question/QuestionCompletionReview.
 */
import { useCallback, useMemo, useReducer, useRef, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { RoundProgress } from "./quiz/ActivityGame";
import {
	type BlankState,
	buildAnsweredQuestion,
	enterKeyAction,
	isBlanksQuestion,
	isClassificationQuestion,
	isMatchingQuestion,
	isQuestionAnswered,
	nextQuestionIndex,
	prevQuestionIndex,
	questionSubmitLabel,
	setBlankAnswer,
	setClassificationAnswer,
	setMatchingAnswer,
	setTextAnswer,
	toggleChoiceAnswer,
} from "./question/question-answers";
import { BlanksQuestionBody } from "./question/BlanksQuestionBody";
import { ChoiceQuestionBody } from "./question/ChoiceQuestionBody";
import { ClassificationQuestionBody } from "./question/ClassificationQuestionBody";
import { MatchingQuestionBody } from "./question/MatchingQuestionBody";
import { QuestionCompletionReview } from "./question/QuestionCompletionReview";
import { QuestionNavigation } from "./question/QuestionNavigation";
import {
	createQuestionInteractionState,
	questionInteractionReducer,
} from "./question/question-state";
import { questionStyles, sm } from "./question/question-styles";

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
	submitLabel?: string;
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

export function QuestionRenderer({ data, onSubmit, submitLabel }: QuestionRendererProps) {
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

	const allAnswered = useMemo(
		() => questions.every((q, index) => isQuestionAnswered(q, states[index])),
		[questions, states],
	);

	const currentAnswered = useMemo(
		() => isQuestionAnswered(questions[current], states[current]),
		[questions, states, current],
	);

	const updateAnswers = (update: (answers: BlankState[]) => BlankState[]) => {
		if (submitted) return;
		dispatch({ type: "update-answers", update });
	};
	const toggleChoice = (index: number, choice: string, multiSelect: boolean) =>
		updateAnswers((answers) => toggleChoiceAnswer(answers, index, choice, multiSelect));
	const setText = (index: number, value: string) =>
		updateAnswers((answers) => setTextAnswer(answers, index, value));
	const setClassificationValue = (index: number, rowIndex: number, field: "choice" | "reason", value: string) =>
		updateAnswers((answers) => setClassificationAnswer(answers, index, rowIndex, field, value));
	const setMatchingChoice = (index: number, rowIndex: number, value: string, unique: boolean) =>
		updateAnswers((answers) => setMatchingAnswer(answers, index, rowIndex, value, unique));
	const setBlankValue = (index: number, blankIdx: number, value: string) =>
		updateAnswers((answers) => setBlankAnswer(answers, index, blankIdx, value));

	const handleSubmit = useCallback(() => {
		if (submitted || !allAnswered) return;
		const answers: AnsweredQuestion[] = questions.map((q, index) => buildAnsweredQuestion(q, states[index]));
		dispatch({ type: "submit" });
		onSubmit?.(answers);
	}, [submitted, allAnswered, questions, onSubmit, states]);

	const goNext = useCallback(() => {
		const next = nextQuestionIndex(current, total);
		if (next !== null) startQuestionTransition(() => dispatch({ type: "navigate", current: next }));
	}, [current, total]);

	const goPrev = useCallback(() => {
		const prev = prevQuestionIndex(current);
		if (prev !== null) startQuestionTransition(() => dispatch({ type: "navigate", current: prev }));
	}, [current]);

	if (submitted) return <QuestionCompletionReview questions={questions} answers={states} />;

	const q = questions[current];
	if (!q) return null;
	const state = states[current] ?? { values: [], selected: [], text: "", classifications: [] };
	const isLast = current === total - 1;
	const isBlanks = isBlanksQuestion(q);
	const isClassification = isClassificationQuestion(q);
	const isMatching = isMatchingQuestion(q);
	const onEnter = () => {
		const action = enterKeyAction({ currentAnswered, isLast, allAnswered });
		if (action === "next") goNext();
		else if (action === "submit") handleSubmit();
	};

	return (
		<div className={cx(questionStyles.shell, "activity-game")} aria-busy={isQuestionPending} style={{ opacity: isQuestionPending ? 0.72 : 1, transition: "opacity 120ms ease-out" }}>
			<div className={css({ display: "flex", alignItems: "flex-start" })}>
				<div className={css({ minWidth: 0, flex: 1, display: "grid", gap: "0.5rem", [sm]: { gap: "1rem" } })}>
					<div data-question-progress className={css({ display: "flex", alignItems: "center", gap: "0.75rem" })}>
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
									<MatchingQuestionBody
										q={q}
										state={state}
										submitted={submitted}
										draggingMatch={draggingMatch}
										dragOverRow={dragOverRow}
										dispatch={dispatch}
										onSetChoice={(rowIndex, value, unique) => setMatchingChoice(current, rowIndex, value, unique)}
									/>
								) : isClassification ? (
									<ClassificationQuestionBody
										q={q}
										state={state}
										submitted={submitted}
										onSetValue={(rowIndex, field, value) => setClassificationValue(current, rowIndex, field, value)}
										onEnter={onEnter}
									/>
								) : isBlanks ? (
									<BlanksQuestionBody
										q={q}
										state={state}
										submitted={submitted}
										blankRefs={blankRefs}
										onSetValue={(blankIdx, value) => setBlankValue(current, blankIdx, value)}
										onEnter={onEnter}
									/>
								) : (
									<ChoiceQuestionBody
										q={q}
										state={state}
										submitted={submitted}
										onToggleChoice={(choice, multiSelect) => toggleChoice(current, choice, multiSelect)}
										onSetText={(value) => setText(current, value)}
										onEnter={onEnter}
									/>
								)}

								{data.intro && <details className="activity-hint"><summary>About this round</summary><p>{data.intro}</p></details>}
								{q.hint && !submitted && (
									<details className="activity-hint"><summary>Need a hint?</summary><p>{q.hint}</p></details>
								)}
							</div>

							<QuestionNavigation
								isFirst={current === 0}
								isLast={isLast}
								isPending={isQuestionPending}
								currentAnswered={currentAnswered}
								allAnswered={allAnswered}
								submitLabel={questionSubmitLabel(submitLabel, total)}
								onPrev={goPrev}
								onNext={goNext}
								onSubmit={handleSubmit}
							/>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
