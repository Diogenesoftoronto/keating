import { localRead, localWrite } from "../../submissions/local-store";
import { SubmissionAttachments, AttachmentLinks } from "../../components/SubmissionAttachments";
import { SaveTaskToCourse } from "../../components/courses/SaveTaskToCourse";
import { Select } from "../../components/Select";
import type { UiSubmissionAttachment } from "@keating/learner-contracts";
import type React from "react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock, Flag, GripVertical, Lightbulb, RotateCcw, ThumbsUp, Zap } from "lucide-react";
import { CompletionMark, RoundProgress } from "../../components/quiz/ActivityGame";
import { QuizCountdown } from "../../components/quiz/QuizCountdown";
import { QuizTimingTracker } from "../../components/quiz/timing";
import { formatQuizDuration, isQuickQuizAnswer } from "../../components/quiz/game";
import { FlashcardTimer } from "../../components/flashcards/FlashcardTimer";
import { useFlashcardAutoReveal } from "../../components/flashcards/useFlashcardAutoReveal";
import "./activity.css";
import type { UiActionReceipt, UiDocument, UiDocumentNode, UiQuestion, UiQuestionGroupResponse, UiQuizTiming, UiStudyPlanItem, UiTaskNode } from "@keating/learner-contracts";
import { SimulationRenderer } from "../../components/SimulationRenderer";
import { ExamRenderer } from "../../components/ExamRenderer";
import { CodingChallenge } from "../../components/CodingChallenge";
import { MusicLab } from "../../components/MusicLab";
import { LanguagePractice } from "../../components/LanguagePractice";
import { css, cx } from "../../../styled-system/css";
import { MarkdownBlock } from "../../components/MarkdownBlock";
import { parseQuestionTemplate } from "../../components/question-template";
import { MermaidRenderer } from "../../components/MermaidRenderer";
import { QuizGradesContext } from "../../components/quiz-grades-context";
import { applyReview, initialSrsState } from "../srs";
import { objectiveCredit, type QuizOutcome, quizOutcome, summarizeQuiz } from "./quiz-progress";
import type { SharedUiActionIntent } from "./shared-actions";

export interface SharedUiActionEvent {
	intent: SharedUiActionIntent;
	humanFriendlyMessage: string;
}

const panel = css({ marginBlock: "0.75rem", display: "grid", gap: "0.75rem", border: "1px solid var(--border)", borderRadius: "0.75rem", background: "var(--background)", padding: "1rem" });
const section = css({ display: "grid", gap: "0.625rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", _first: { borderTop: "none", paddingTop: 0 } });
const button = css({ minHeight: "2.5rem", border: "1px solid var(--border)", borderRadius: "0.5rem", paddingInline: "0.75rem", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", _hover: { background: "var(--muted)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });
const input = css({ width: "100%", minHeight: "2.5rem", border: "1px solid var(--border)", borderRadius: "0.5rem", background: "var(--background)", padding: "0.625rem", color: "var(--foreground)" });
const badge = css({ borderRadius: "999px", background: "var(--muted)", paddingInline: "0.5rem", paddingBlock: "0.125rem", fontSize: "0.6875rem", fontWeight: 650, color: "var(--muted-foreground)", whiteSpace: "nowrap" });
const reviewRow = css({ display: "flex", width: "100%", alignItems: "baseline", gap: "0.5rem", border: "1px solid var(--border)", borderRadius: "0.5rem", background: "var(--background)", padding: "0.5rem 0.625rem", fontSize: "0.8125rem", textAlign: "left", cursor: "pointer", _hover: { background: "var(--muted)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });

/** Freeze a failed aggregate delivery so its retry has byte-identical action data. */
export function retryableAggregateAttempt<T>(pending: T | undefined, create: () => T, deliver: (intent: T) => boolean): { intent: T; pending: T | undefined; delivered: boolean } {
	const intent = pending ?? create();
	const delivered = deliver(intent);
	return { intent, pending: delivered ? undefined : intent, delivered };
}

export function SharedUiDocumentRenderer({ document, receipts = [], onAction }: { document: UiDocument; receipts?: UiActionReceipt[]; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const supported = document.supportedSurfaces.includes("web");
	const interactive = document.lifecycle === "ready" && supported;
	const retryable = supported && (document.lifecycle === "failed" || document.lifecycle === "cancelled");
	return <section className={panel} data-shared-openui-document={document.id} data-openui-revision={document.revision}>
		{document.title ? <h3 className={css({ fontSize: "1rem", fontWeight: 700 })}>{document.title}</h3> : null}
		{document.description ? <p className={css({ color: "var(--muted-foreground)", fontSize: "0.8125rem" })}>{document.description}</p> : null}
		{!interactive ? <div role="status" className={css({ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.75rem", color: "var(--muted-foreground)" })}>
			<p>This interaction is {document.lifecycle.replace("_", " ")}. Its content remains available, but controls are disabled.</p>
			{retryable ? <button className={button} type="button" onClick={() => onAction?.({ intent: { type: "retry" }, humanFriendlyMessage: "Retry this interaction" })}>Retry interaction</button> : null}
		</div> : null}
		{document.nodes.map((node) => <SharedNode key={`${document.id}:${node.id}`} documentId={document.id} node={node} receipts={receipts} disabled={!interactive} onAction={onAction} />)}
	</section>;
}

function SharedNode({ documentId, node, receipts, disabled, onAction }: { documentId: string; node: UiDocumentNode; receipts: UiActionReceipt[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	if (node.type === "markdown") return <div className={section}><MarkdownBlock content={node.markdown} /></div>;
	if (node.type === "callout") return <aside className={css({ display: "grid", gap: "0.625rem", borderTop: "1px solid var(--border)", borderLeft: "3px solid var(--primary)", paddingTop: "0.75rem", paddingLeft: "0.75rem" })} data-callout-tone={node.tone}>
		<strong>{node.title ?? node.tone}</strong><MarkdownBlock content={node.markdown} />
	</aside>;
	if (node.type === "question") return <Question node={node} receipt={completedNodeReceipt(receipts, node.id, ["submit-answer", "choose-option"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "question-group") return <QuestionGroup node={node} receipt={completedNodeReceipt(receipts, node.id, ["submit-question-group"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "quiz") return node.mode === "exam"
		? <ExamRenderer documentId={documentId} node={node} receipt={completedNodeReceipt(receipts, node.id, ["complete-quiz"])} disabled={disabled} onAction={onAction} />
		: <Quiz node={node} receipt={completedNodeReceipt(receipts, node.id, ["complete-quiz"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "goal") return <Checklist title={node.title} nodeId={node.id} items={node.steps.map((step) => ({ id: step.id, title: step.title, done: step.status === "done" }))} actionType="complete-goal-step" disabled={disabled} onAction={onAction} />;
	if (node.type === "deck") return <Deck node={node} receipts={receipts.filter((receipt) => receipt.state === "completed" && ((receipt.action.type === "rate-card" || receipt.action.type === "complete-deck") && receipt.action.nodeId === node.id))} disabled={disabled} onAction={onAction} />;
	if (node.type === "study-plan") return node.items ? <Plan nodeId={node.id} title={node.title ?? "Study plan"} overview={node.overview} items={node.items} disabled={disabled} onAction={onAction} /> : <Resource nodeId={node.id} title={node.resource?.title ?? "Study plan"} content={node.resource?.content} uri={node.resource?.uri} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "artifact") return <Resource nodeId={node.id} title={node.resource.title} content={node.resource.content} uri={node.resource.uri} markdown={node.resource.format === "markdown"} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "concept-map") return <div className={section}>{node.title ? <h4 className={css({ fontWeight: 700 })}>{node.title}</h4> : null}<MermaidRenderer content={node.source} /></div>;
	if (node.type === "notes") return <Notes node={node} disabled={disabled} onAction={onAction} />;
	if (node.type === "image") return <RemoteImage node={node} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "simulation") return <SimulationRenderer node={node} />;
	if (node.type === "coding-challenge") return <CodingChallenge node={node} disabled={disabled} />;
	if (node.type === "music-lab") return <MusicLab node={node} disabled={disabled} />;
	if (node.type === "language-practice") return <LanguagePractice node={node} receipt={completedNodeReceipt(receipts, node.id, ["complete-language-practice"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "task") return <Task documentId={documentId} node={node} receipt={completedNodeReceipt(receipts, node.id, ["submit-task"])} receipts={receipts} disabled={disabled} onAction={onAction} />;
	if (node.type === "media") return <Media node={node} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	return <Handoff node={node} receipt={completedNodeReceipt(receipts, node.id, ["open-handoff"])} disabled={disabled} onAction={onAction} />;
}

function completedNodeReceipt(receipts: UiActionReceipt[], nodeId: string, types: UiActionReceipt["action"]["type"][]): UiActionReceipt | undefined {
	for (let index = receipts.length - 1; index >= 0; index -= 1) {
		const receipt = receipts[index];
		if (receipt?.state === "completed" && "nodeId" in receipt.action && receipt.action.nodeId === nodeId && types.includes(receipt.action.type)) return receipt;
	}
	return undefined;
}

function responseForQuestion(node: UiQuestion, answer: string, selected: string[], blankAnswers: string[], rowSelections: string[], rowReasons: string[], order: string[] = []): UiQuestionGroupResponse {
	if (node.kind === "ordering") return { questionId: node.id, type: "order", items: order };
	if (node.kind === "classification" || node.kind === "matching") return {
		questionId: node.id,
		type: "rows",
		rows: (node.items ?? []).map((item, index) => ({ item, optionId: rowSelections[index] ?? "", ...(node.requireReasons ? { reason: rowReasons[index] ?? "" } : {}) })),
	};
	if (node.kind === "blanks" || node.kind === "fill_in") return { questionId: node.id, type: "blanks", answers: blankAnswers };
	if (node.choices) return { questionId: node.id, type: "choice", optionIds: selected, ...(node.allowText ? { text: answer } : {}) };
	return { questionId: node.id, type: "text", answer };
}

function responseReady(node: UiQuestion, answer: string, selected: string[], blankAnswers: string[], rowSelections: string[], rowReasons: string[], order: string[] = []): boolean {
	// An arrangement always holds every item, so it is ready as soon as it
	// exists; the learner committing to the given order is a real answer.
	if (node.kind === "ordering") return order.length === (node.items?.length ?? 0) && order.length > 0;
	if (node.kind === "classification" || node.kind === "matching") return rowSelections.length > 0 && rowSelections.every(Boolean) && (!node.requireReasons || rowReasons.every((reason) => reason.trim().length > 0));
	if (node.kind === "blanks" || node.kind === "fill_in") return blankAnswers.length > 0 && blankAnswers.every((entry) => entry.trim().length > 0);
	if (node.choices) return selected.length > 0 || (node.allowText === true && answer.trim().length > 0);
	return answer.trim().length > 0;
}

export function answerForQuizResponse(response: UiQuestionGroupResponse): string {
	if (response.type === "text") return response.answer;
	if (response.type === "choice") return response.optionIds.join(",") || (response.text ?? "");
	if (response.type === "blanks") return response.answers.join(",");
	if (response.type === "order") return response.items.join(",");
	return response.rows.map((row) => `${row.item}:${row.optionId}${row.reason ? ` (${row.reason})` : ""}`).join("; ");
}

export function quizResponseForAnswer(question: UiQuestion, answer: string): UiQuestionGroupResponse {
	if (question.kind === "ordering") return { questionId: question.id, type: "order", items: answer ? answer.split(",") : [...(question.items ?? [])] };
	if (question.kind === "blanks" || question.kind === "fill_in") return { questionId: question.id, type: "blanks", answers: answer ? answer.split(",") : [] };
	if (question.choices) return { questionId: question.id, type: "choice", optionIds: answer ? answer.split(",") : [] };
	return { questionId: question.id, type: "text", answer };
}

export function Question({ node, receipt, disabled, onAction, groupResponse, hideSubmit = false, completed: completedOverride = false, onResponseChange }: { node: UiQuestion; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean; groupResponse?: UiQuestionGroupResponse; hideSubmit?: boolean; completed?: boolean; onResponseChange?: (response: UiQuestionGroupResponse, ready: boolean) => void }) {
	const savedAction = receipt?.action;
	const savedAnswer = savedAction?.type === "submit-answer" ? savedAction.answer : undefined;
	const initialRows = groupResponse?.type === "rows" ? groupResponse.rows : undefined;
	const initialOrder = groupResponse?.type === "order" ? groupResponse.items : undefined;
	const initialBlanks = groupResponse?.type === "blanks" ? groupResponse.answers : undefined;
	const initialSelected = groupResponse?.type === "choice" ? groupResponse.optionIds : undefined;
	const initialText = groupResponse?.type === "text" ? groupResponse.answer : groupResponse?.type === "choice" ? groupResponse.text : undefined;
	const savedRows = Array.isArray(savedAnswer) && savedAnswer.every((entry) => typeof entry === "object")
		? savedAnswer as Array<{ item: string; optionId: string; reason?: string }>
		: undefined;
	const [answer, setAnswer] = useState(() => initialText ?? (typeof savedAnswer === "string" ? savedAnswer : ""));
	const [selected, setSelected] = useState<string[]>(() => initialSelected ?? (savedAction?.type === "choose-option" ? [...savedAction.optionIds] : []));
	const [rowSelections, setRowSelections] = useState<string[]>(() => node.items?.map((item) => initialRows?.find((row) => row.item === item)?.optionId ?? savedRows?.find((row) => row.item === item)?.optionId ?? "") ?? []);
	const [order, setOrder] = useState<string[]>(() => initialOrder ?? (Array.isArray(savedAnswer) && savedAnswer.every((entry) => typeof entry === "string") ? [...savedAnswer as string[]] : [...(node.items ?? [])]));
	const [rowReasons, setRowReasons] = useState<string[]>(() => node.items?.map((item) => initialRows?.find((row) => row.item === item)?.reason ?? savedRows?.find((row) => row.item === item)?.reason ?? "") ?? []);
	const blankCount = node.blanks?.length ?? (node.prompt.match(/_{3,}|\{\{blank\}\}/g)?.length ?? 0);
	const [blankAnswers, setBlankAnswers] = useState<string[]>(() => initialBlanks ?? (Array.isArray(savedAnswer) && savedAnswer.every((entry) => typeof entry === "string")
		? [...savedAnswer]
		: Array.from({ length: blankCount }, () => "")));
	const multiple = node.multiSelect || node.kind === "multi_select";
	const ordering = node.kind === "ordering";
	const rows = node.kind === "classification" || node.kind === "matching";
	const blanks = node.kind === "blanks" || node.kind === "fill_in";
	const payload = ordering
		? order
		: rows
			? (node.items ?? []).map((item, index) => ({ item, optionId: rowSelections[index] ?? "", ...(node.requireReasons ? { reason: rowReasons[index] ?? "" } : {}) }))
			: blanks ? blankAnswers : node.choices ? selected : answer;
	const ready = responseReady(node, answer, selected, blankAnswers, rowSelections, rowReasons, order);
	const completed = receipt?.state === "completed" || completedOverride;
	const groupValue = responseForQuestion(node, answer, selected, blankAnswers, rowSelections, rowReasons, order);
	useEffect(() => {
		onResponseChange?.(groupValue, ready);
	}, [groupValue, onResponseChange, ready]);
	const submit = () => onAction?.({
		intent: node.choices && !rows && !ordering
			? { type: "choose-option", nodeId: node.id, optionIds: selected }
			: { type: "submit-answer", nodeId: node.id, answer: payload },
		humanFriendlyMessage: `Answered: ${node.prompt}`,
	});
	// A cloze question carries its prompt inside the inline blanks, so repeating
	// it above would show the sentence twice.
	const inlineBlanks = blanks && blankCount > 0 && parseQuestionTemplate(node.prompt).some((part) => part.isBlank);
	return <fieldset className="shared-activity shared-activity__question" data-question-kind={node.kind ?? "text"}>
		<legend>{inlineBlanks ? node.header ?? "Fill in the blanks" : node.prompt}</legend>
		{ordering ? <OrderingList
			node={node}
			order={order}
			disabled={disabled || completed}
			onReorder={setOrder}
		/> : rows ? <RowAssignment
			node={node}
			selections={rowSelections}
			reasons={rowReasons}
			disabled={disabled || completed}
			onAssign={(rowIndex, choiceId) => setRowSelections((current) => {
				const unique = node.kind === "matching" && node.uniqueMatches !== false;
				return current.map((value, index) => {
					if (index === rowIndex) return choiceId;
					// A one-to-one match cannot leave the same choice in two places.
					return unique && choiceId && value === choiceId ? "" : value;
				});
			})}
			onReason={(rowIndex, reason) => setRowReasons((current) => current.map((value, index) => index === rowIndex ? reason : value))}
		/>
			: blanks ? inlineBlanks
				? <InlineBlanks node={node} values={blankAnswers} disabled={disabled || completed} onChange={(index, value) => setBlankAnswers((current) => current.map((entry, entryIndex) => entryIndex === index ? value : entry))} />
				: <div className={css({ display: "grid", gap: "0.375rem" })}>{blankAnswers.map((value, index) => <input disabled={disabled || completed} key={`${node.id}-blank-${index}`} className={input} aria-label={`Blank ${index + 1}`} value={value} onChange={(event) => setBlankAnswers((current) => current.map((entry, entryIndex) => entryIndex === index ? event.currentTarget.value : entry))} placeholder={node.blanks?.[index]?.placeholder ?? `Blank ${index + 1}`} />)}</div>
				: node.choices ? <div className="shared-activity__choices">{multiple ? <small className="shared-activity__meta">Choose all that fit</small> : null}{node.choices.map((choice, choiceIndex) => <label key={choice.id} className="shared-activity__choice"><input disabled={disabled || completed} type={multiple ? "checkbox" : "radio"} name={node.id} checked={selected.includes(choice.id)} onChange={() => setSelected((current) => multiple ? current.includes(choice.id) ? current.filter((id) => id !== choice.id) : [...current, choice.id] : [choice.id])} /><span className="shared-activity__letter" aria-hidden="true">{String.fromCharCode(65 + choiceIndex)}</span><span>{choice.label}</span>{selected.includes(choice.id) ? <Check size={18} aria-hidden="true" /> : null}</label>)}{node.allowText ? <textarea aria-label="Your own answer" disabled={disabled || completed} className={input} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} placeholder="Or explain your own answer" /> : null}</div>
					: node.kind === "slider" ? <div className={css({ display: "grid", gap: "0.375rem" })}><input disabled={disabled || completed} type="range" min={node.min ?? 0} max={node.max ?? 100} step={node.step ?? 1} value={answer || node.min || 0} onChange={(event) => setAnswer(event.currentTarget.value)} /><output>{answer || node.min || 0}</output></div>
						: <textarea aria-label="Your answer" disabled={disabled || completed} className={input} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} placeholder="Type your answer" />}
		{node.hint ? <details className="shared-activity__hint"><summary><Lightbulb size={15} aria-hidden="true" />Hint</summary><p>{node.hint}</p></details> : null}
		{completed ? !hideSubmit ? <p role="status">Answer saved.</p> : null : !hideSubmit ? <button className="shared-activity__primary" type="button" disabled={disabled || !ready} onClick={submit}>Send answer <ArrowRight size={17} aria-hidden="true" /></button> : null}
	</fieldset>;
}

/**
 * Cloze rendering: the inputs sit inside the sentence, where the gap actually
 * is, rather than in a stack underneath it. Enter moves to the next blank so a
 * multi-blank question can be filled without reaching for the mouse.
 */
/**
 * Arrange items into a sequence by dragging, with Up and Down on every row.
 * The buttons are not decoration: a drag-only list is unreachable by keyboard
 * and fiddly on touch, so they are the interaction of record here too.
 */
function OrderingList({ node, order, disabled, onReorder }: { node: UiQuestion; order: string[]; disabled: boolean; onReorder: (next: string[]) => void }) {
	const [dragging, setDragging] = useState<number | undefined>();
	const [over, setOver] = useState<number | undefined>();
	const move = (from: number, to: number) => {
		if (from === to || to < 0 || to >= order.length) return;
		const next = [...order];
		const [moved] = next.splice(from, 1);
		if (moved === undefined) return;
		next.splice(to, 0, moved);
		onReorder(next);
	};
	return <ol className={css({ display: "grid", gap: "0.375rem", margin: 0, paddingLeft: 0, listStyle: "none" })} data-ordering={node.id}>
		{order.map((item, index) => <li
			key={`${node.id}-order-${item}`}
			draggable={!disabled}
			onDragStart={(event) => {
				event.dataTransfer.setData("text/plain", String(index));
				event.dataTransfer.effectAllowed = "move";
				setDragging(index);
			}}
			onDragOver={(event) => {
				if (disabled || dragging === undefined) return;
				event.preventDefault();
				setOver(index);
			}}
			onDragLeave={() => setOver((current) => current === index ? undefined : current)}
			onDrop={(event) => {
				event.preventDefault();
				const raw = event.dataTransfer.getData("text/plain");
				const from = dragging ?? (raw ? Number(raw) : Number.NaN);
				setDragging(undefined);
				setOver(undefined);
				if (Number.isInteger(from)) move(from, index);
			}}
			onDragEnd={() => { setDragging(undefined); setOver(undefined); }}
			className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.5rem 0.625rem", fontSize: "0.8125rem" })}
			style={{
				opacity: dragging === index ? 0.5 : undefined,
				borderColor: over === index && dragging !== index ? "var(--primary)" : undefined,
			}}
		>
			<GripVertical aria-hidden="true" size={13} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
			<span className={css({ width: "1.25rem", flexShrink: 0, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" })}>{index + 1}</span>
			<span className={css({ flex: 1, overflowWrap: "anywhere" })}>{item}</span>
			<button type="button" disabled={disabled || index === 0} className={stepButton} aria-label={`Move ${item} up`} onClick={() => move(index, index - 1)}>↑</button>
			<button type="button" disabled={disabled || index === order.length - 1} className={stepButton} aria-label={`Move ${item} down`} onClick={() => move(index, index + 1)}>↓</button>
		</li>)}
	</ol>;
}

const stepButton = css({ minWidth: "1.75rem", minHeight: "1.75rem", flexShrink: 0, cursor: "pointer", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", _hover: { background: "var(--muted)" }, _disabled: { cursor: "not-allowed", opacity: 0.4 }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });

const chip = css({ display: "inline-flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.375rem 0.5rem", fontSize: "0.8125rem" });

/**
 * Classification and matching, assignable by dragging an item into a bucket.
 *
 * Every chip also carries a labelled select, which is not a fallback bolted on
 * afterwards: pointer dragging is unusable by keyboard and hostile on touch, so
 * the select is the interaction of record and the drag is the shortcut. Both
 * write the same row state.
 */
function RowAssignment({ node, selections, reasons, disabled, onAssign, onReason }: {
	node: UiQuestion;
	selections: string[];
	reasons: string[];
	disabled: boolean;
	onAssign: (rowIndex: number, choiceId: string) => void;
	onReason: (rowIndex: number, reason: string) => void;
}) {
	const [dragging, setDragging] = useState<number | undefined>();
	const [over, setOver] = useState<string | undefined>();
	const items = node.items ?? [];
	const choiceOf = (rowIndex: number) => selections[rowIndex] ?? "";
	const unassigned = items.map((item, index) => ({ item, index })).filter(({ index }) => !choiceOf(index));

	const dropProps = (choiceId: string) => ({
		onDragOver: (event: React.DragEvent) => {
			if (disabled || dragging === undefined) return;
			event.preventDefault();
			setOver(choiceId);
		},
		onDragLeave: () => setOver((current) => current === choiceId ? undefined : current),
		onDrop: (event: React.DragEvent) => {
			event.preventDefault();
			setOver(undefined);
			const raw = event.dataTransfer.getData("text/plain");
			const rowIndex = dragging ?? (raw ? Number(raw) : Number.NaN);
			setDragging(undefined);
			if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= items.length) return;
			onAssign(rowIndex, choiceId);
		},
	});

	const itemChip = (item: string, rowIndex: number) => <div
		key={`${node.id}-item-${rowIndex}`}
		className={chip}
		draggable={!disabled}
		aria-grabbed={dragging === rowIndex}
		style={dragging === rowIndex ? { opacity: 0.5 } : undefined}
		onDragStart={(event) => {
			event.dataTransfer.setData("text/plain", String(rowIndex));
			event.dataTransfer.effectAllowed = "move";
			setDragging(rowIndex);
		}}
		onDragEnd={() => { setDragging(undefined); setOver(undefined); }}
	>
		<GripVertical aria-hidden="true" size={13} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
		<span className={css({ overflowWrap: "anywhere" })}>{item}</span>
		<Select
			disabled={disabled}
			className={css({ minHeight: "1.75rem", borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", fontSize: "0.75rem", color: "var(--foreground)" })}
			aria-label={`${node.choiceLabel ?? "Choice"} for ${item}`}
			value={choiceOf(rowIndex)}
			onValueChange={(value) => onAssign(rowIndex, value)}
		>
			<option value="">Unassigned</option>
			{node.choices?.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
		</Select>
	</div>;

	return <div className={css({ display: "grid", gap: "0.625rem" })} data-row-assignment={node.id}>
		<div
			{...dropProps("")}
			className={css({ display: "flex", flexWrap: "wrap", gap: "0.375rem", minHeight: "3rem", alignItems: "center", borderRadius: "0.5rem", border: "1px dashed var(--border)", padding: "0.5rem" })}
			style={over === "" ? { borderColor: "var(--primary)", background: "color-mix(in srgb, var(--primary) 8%, transparent)" } : undefined}
		>
			{unassigned.length === 0
				? <small className={css({ color: "var(--muted-foreground)" })}>Everything is placed.</small>
				: unassigned.map(({ item, index }) => itemChip(item, index))}
		</div>
		<div className={css({ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" })}>
			{node.choices?.map((choice) => {
				const assigned = items.map((item, index) => ({ item, index })).filter(({ index }) => choiceOf(index) === choice.id);
				return <div
					key={choice.id}
					{...dropProps(choice.id)}
					className={css({ display: "grid", gap: "0.375rem", alignContent: "start", minHeight: "5rem", borderRadius: "0.5rem", border: "1px solid var(--border)", padding: "0.5rem" })}
					style={over === choice.id ? { borderColor: "var(--primary)", background: "color-mix(in srgb, var(--primary) 8%, transparent)" } : undefined}
				>
					<strong className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{choice.label}</strong>
					{assigned.map(({ item, index }) => <div key={`${node.id}-assigned-${index}`} className={css({ display: "grid", gap: "0.25rem" })}>
						{itemChip(item, index)}
						{node.requireReasons ? <input
							disabled={disabled}
							className={input}
							aria-label={`${node.reasonLabel ?? "Reason"} for ${item}`}
							value={reasons[index] ?? ""}
							onChange={(event) => onReason(index, event.currentTarget.value)}
							placeholder={node.reasonLabel ?? "Reason"}
						/> : null}
					</div>)}
				</div>;
			})}
		</div>
	</div>;
}

function InlineBlanks({ node, values, disabled, onChange }: { node: UiQuestion; values: string[]; disabled: boolean; onChange: (index: number, value: string) => void }) {
	const fields = useRef<(HTMLInputElement | null)[]>([]);
	let blankIndex = -1;
	return <p className={css({ lineHeight: "2.25rem", overflowWrap: "anywhere" })}>
		{parseQuestionTemplate(node.prompt).map((part, index) => {
			if (!part.isBlank) return <span key={index} className={css({ whiteSpace: "pre-wrap" })}>{part.text}</span>;
			blankIndex += 1;
			const current = blankIndex;
			const definition = node.blanks?.[current];
			return <input
				key={index}
				ref={(element) => { fields.current[current] = element; }}
				type="text"
				disabled={disabled}
				className={cx(input, css({ display: "inline-block", height: "2rem", width: "8rem", marginInline: "0.25rem", paddingBlock: 0, textAlign: "center", verticalAlign: "baseline" }))}
				aria-label={definition?.hint ? `${definition.hint} blank` : `Blank ${current + 1}`}
				title={definition?.hint}
				placeholder={definition?.placeholder ?? "___"}
				value={values[current] ?? ""}
				onChange={(event) => onChange(current, event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key !== "Enter") return;
					const next = fields.current[current + 1];
					if (!next) return;
					event.preventDefault();
					next.focus();
				}}
			/>;
		})}
	</p>;
}

function QuestionGroup({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "question-group" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const saved = receipt?.action.type === "submit-question-group" ? receipt.action.responses : [];
	const [responses, setResponses] = useState<Record<string, UiQuestionGroupResponse>>(() => Object.fromEntries(saved.map((response) => [response.questionId, response])));
	const [ready, setReady] = useState<Record<string, boolean>>(() => Object.fromEntries(saved.map((response) => [response.questionId, true])));
	const completed = receipt?.state === "completed";
	const update = (response: UiQuestionGroupResponse, isReady: boolean) => {
		setResponses((current) => current[response.questionId] && JSON.stringify(current[response.questionId]) === JSON.stringify(response) ? current : { ...current, [response.questionId]: response });
		setReady((current) => current[response.questionId] === isReady ? current : { ...current, [response.questionId]: isReady });
	};
	const ordered = node.questions.map((question) => responses[question.id]).filter((response): response is UiQuestionGroupResponse => Boolean(response));
	const canSubmit = ordered.length === node.questions.length && node.questions.every((question) => ready[question.id]);
	const [index, setIndex] = useState(0);
	const [delivered, setDelivered] = useState(false);
	const [pendingSubmission, setPendingSubmission] = useState<Extract<SharedUiActionIntent, { type: "submit-question-group" }>>();
	const locked = disabled || Boolean(pendingSubmission);
	const finished = completed || delivered;
	const current = node.questions[index];
	const focusRound = useRef<HTMLDivElement>(null);
	const move = (next: number) => { setIndex(next); requestAnimationFrame(() => focusRound.current?.focus()); };
	return <div className="shared-activity" data-question-group={node.id}>
		<div className="shared-activity__head"><h4>{node.title ?? "Quick check"}</h4></div>
		{node.intro ? <details className="shared-activity__hint"><summary>Before you start</summary><p>{node.intro}</p></details> : null}
		{finished ? <><CompletionMark detail="Answers saved.">Check complete</CompletionMark><details className="shared-activity__review"><summary>Your answers</summary>{node.questions.map((question) => <Question key={question.id} node={question} disabled hideSubmit completed groupResponse={responses[question.id]} />)}</details></> : current ? <>
			<RoundProgress current={index} total={node.questions.length} resolved={Object.values(ready).filter(Boolean).length} label="Question progress" />
			<div className="shared-activity__round" key={current.id} ref={focusRound} tabIndex={-1}><Question node={current} disabled={locked} hideSubmit groupResponse={responses[current.id]} onResponseChange={update} /></div>
			<div className="shared-activity__nav">
				<button className="shared-activity__quiet" type="button" disabled={locked || index === 0} onClick={() => move(index - 1)} aria-label="Previous question"><ArrowLeft size={18} /></button>
				{index < node.questions.length - 1 ? <button className="shared-activity__primary" type="button" disabled={locked || !ready[current.id]} onClick={() => move(index + 1)}>Next <ArrowRight size={18} /></button> : <button className="shared-activity__primary" type="button" disabled={disabled || !canSubmit} onClick={() => {
					const attempt = retryableAggregateAttempt(pendingSubmission, () => ({ type: "submit-question-group" as const, nodeId: node.id, responses: ordered }), (intent) => Boolean(onAction?.({ intent, humanFriendlyMessage: `Answered ${node.questions.length} questions${node.topic ? ` about ${node.topic}` : ""}` })));
					setDelivered(attempt.delivered); setPendingSubmission(attempt.pending);
				}}>{pendingSubmission ? "Retry save answers" : "Finish check"}<Check size={18} /></button>}
			</div>
			{pendingSubmission ? <p role="status">Your answers are ready. Try saving again.</p> : null}
		</> : <p>No questions in this check.</p>}
	</div>;
}

/**
 * A stepped quiz: one question at a time, with skip, flag-for-review, a review
 * step that shows what is still open, and a result card that keeps updating as
 * the teacher grades the open-ended answers.
 */
function Quiz({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "quiz" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const saved = receipt?.action.type === "complete-quiz" ? receipt.action : undefined;
	const [responses, setResponses] = useState<Record<string, UiQuestionGroupResponse>>(() => Object.fromEntries((saved?.answers ?? []).flatMap((answer) => {
		const question = node.questions.find((candidate) => candidate.id === answer.questionId);
		return question ? [[answer.questionId, quizResponseForAnswer(question, answer.answer)] as const] : [];
	})));
	const [ready, setReady] = useState<Record<string, boolean>>(() => Object.fromEntries((saved?.answers ?? []).map((answer) => [answer.questionId, true])));
	const [index, setIndex] = useState(0);
	const [reviewing, setReviewing] = useState(false);
	const [skipped, setSkipped] = useState<string[]>(() => [...(saved?.skippedQuestionIds ?? [])]);
	const [flagged, setFlagged] = useState<string[]>(() => [...(saved?.flaggedQuestionIds ?? [])]);
	const clock = useRef(new QuizTimingTracker(performance.now(), saved ? undefined : node.questions[0]?.id));
	const [finalTiming, setFinalTiming] = useState<UiQuizTiming | undefined>(saved?.timing);
	const [timedOut, setTimedOut] = useState<string[]>(() => [...(saved?.timedOutQuestionIds ?? [])]);
	const [remaining, setRemaining] = useState<number | undefined>(() => questionSeconds(node, 0));
	const [pendingCompletion, setPendingCompletion] = useState<Extract<SharedUiActionIntent, { type: "complete-quiz" }>>();
	const [delivered, setDelivered] = useState(false);
	const completed = receipt?.state === "completed";
	const update = (response: UiQuestionGroupResponse, isReady: boolean) => {
		setResponses((current) => current[response.questionId] && JSON.stringify(current[response.questionId]) === JSON.stringify(response) ? current : { ...current, [response.questionId]: response });
		setReady((current) => current[response.questionId] === isReady ? current : { ...current, [response.questionId]: isReady });
		if (isReady) {
			setSkipped((current) => current.includes(response.questionId) ? current.filter((id) => id !== response.questionId) : current);
		}
	};
	const answers = node.questions.flatMap((question) => responses[question.id] ? [{ questionId: question.id, answer: answerForQuizResponse(responses[question.id]!) }] : []);
	const answerText = Object.fromEntries(answers.map((answer) => [answer.questionId, answer.answer]));
	const resolved = node.questions.filter((question) => ready[question.id] || skipped.includes(question.id)).length;
	const canSubmit = resolved === node.questions.length;
	const buildCompletion = (): Extract<SharedUiActionIntent, { type: "complete-quiz" }> => {
		const credits = Object.fromEntries(node.questions.flatMap((question) => {
			const credit = objectiveCredit(question, answerText[question.id] ?? "");
			return credit === undefined ? [] : [[question.id, credit] as const];
		}));
		const score = Object.values(credits).filter((credit) => credit === 1).length;
		const partialCreditPoints = Object.values(credits).reduce((total, credit) => total + credit, 0);
		return { type: "complete-quiz", nodeId: node.id, resultId: `${node.id}-result`, answers, score, partialCreditPoints, partialCredits: credits, timing: clock.current.finish(performance.now()), flaggedQuestionIds: flagged, pendingGradeQuestionIds: node.questions.filter((question) => !skipped.includes(question.id) && objectiveCredit(question, answerText[question.id] ?? "") === undefined).map((question) => question.id), skippedQuestionIds: skipped, ...(timedOut.length ? { timedOutQuestionIds: timedOut } : {}) };
	};
	const submit = () => {
		const attempt = retryableAggregateAttempt(pendingCompletion, buildCompletion, (intent) => Boolean(onAction?.({ intent, humanFriendlyMessage: `Completed ${node.title}` })));
		setFinalTiming(attempt.intent.timing);
		if (attempt.pending !== pendingCompletion) setPendingCompletion(attempt.pending);
		if (attempt.delivered) setDelivered(true);
	};
	const terminal = completed || delivered;

	const current = node.questions[index];
	const locked = disabled || Boolean(pendingCompletion);
	const settleCurrent = (now: number) => {
		const limit = questionSeconds(node, index);
		const spent = current ? clock.current.snapshot(now).perQuestionMs[current.id] ?? 0 : 0;
		const expired = current && limit && spent >= limit * 1000 && !timedOut.includes(current.id);
		// A click can beat the next clock tick. Record that deadline crossing too,
		// and stop this visit at the deadline rather than charging callback lag.
		if (expired) setTimedOut((ids) => ids.includes(current.id) ? ids : [...ids, current.id]);
		clock.current.visit(undefined, expired ? now - (spent - limit * 1000) : now);
	};
	const remainingFor = (target: number, now: number) => {
		const question = node.questions[target];
		const limit = questionSeconds(node, target);
		if (!question || !limit || timedOut.includes(question.id)) return undefined;
		return Math.max(0, Math.ceil(limit - (clock.current.snapshot(now).perQuestionMs[question.id] ?? 0) / 1000));
	};
	const goTo = (target: number) => {
		if (locked) return;
		const next = Math.min(Math.max(target, 0), node.questions.length - 1);
		const now = performance.now();
		settleCurrent(now);
		clock.current.visit(node.questions[next]?.id, now);
		setReviewing(false);
		setIndex(next);
		setRemaining(remainingFor(next, now));
	};
	const advance = () => {
		if (locked) return;
		const now = performance.now();
		settleCurrent(now);
		if (index >= node.questions.length - 1) {
			clock.current.visit(undefined, now);
			setReviewing(true);
			setRemaining(undefined);
			return;
		}
		clock.current.visit(node.questions[index + 1]?.id, now);
		setIndex(index + 1);
		setRemaining(remainingFor(index + 1, now));
	};
	const advanceRef = useRef(advance);
	advanceRef.current = advance;
	const skip = () => {
		if (current) setSkipped((currentSkipped) => currentSkipped.includes(current.id) ? currentSkipped : [...currentSkipped, current.id]);
		advance();
	};
	const toggleFlag = () => {
		if (current) setFlagged((currentFlagged) => currentFlagged.includes(current.id) ? currentFlagged.filter((id) => id !== current.id) : [...currentFlagged, current.id]);
	};

	const running = !terminal && !reviewing && !locked;
	// Use measured elapsed time, not a count of interval callbacks. Throttled
	// frames cannot extend a limit, and returning to a question retains its time.
	useEffect(() => {
		clock.current.visit(running ? current?.id : undefined, performance.now());
		if (!running) return;
		const tick = () => setRemaining(remainingFor(index, performance.now()));
		tick();
		const handle = setInterval(tick, 100);
		return () => clearInterval(handle);
	}, [running, index, current?.id, current?.timeLimit, node.timeLimit, timedOut]);
	// Running out of time advances rather than submitting, so one slow question
	// never costs the learner the rest of the quiz. The answer is kept.
	useEffect(() => {
		if (!running || remaining !== 0) return;
		const expired = node.questions[index];
		if (!expired) return;
		advanceRef.current();
	}, [running, remaining, index, node.questions]);

	if (terminal) return <div className="shared-activity" data-quiz={node.id}>
		<CompletionMark detail={node.title}>Round complete</CompletionMark>
		<QuizResults node={node} answers={answerText} skipped={skipped} flagged={flagged} timedOut={timedOut} timing={saved?.timing ?? finalTiming} />
		<details className="shared-activity__review"><summary>Your answers</summary>{node.questions.map((question) => <Question key={question.id} node={question} disabled hideSubmit completed groupResponse={responses[question.id]} />)}</details>
	</div>;
	return <div
		className="shared-activity"
		data-quiz={node.id}
		data-quiz-phase={reviewing ? "review" : "answering"}
		onKeyDown={(event) => {
			// Let the arrow keys move between questions, but never steal them from
			// a control that uses them itself (text caret, slider, radio group).
			if (locked || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target as HTMLElement;
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
			if (event.key === "ArrowRight" && !reviewing) { event.preventDefault(); advance(); }
			if (event.key === "ArrowLeft") { event.preventDefault(); reviewing ? goTo(node.questions.length - 1) : goTo(index - 1); }
		}}
	>
		<div className="shared-activity__quiz-head">
			<h4>{node.title}</h4>
			{remaining !== undefined ? <QuizCountdown key={current?.id} remaining={remaining} total={questionSeconds(node, index) ?? remaining} /> : null}
			{reviewing ? <small role="status">Review answers</small> : null}
		</div>
		<RoundProgress current={reviewing ? Math.max(0, node.questions.length - 1) : index} total={node.questions.length} resolved={resolved} label="Quiz progress" />

		{reviewing ? <>
			<ol className={css({ display: "grid", gap: "0.375rem", margin: 0, paddingLeft: 0, listStyle: "none" })}>
				{node.questions.map((question, questionIndex) => {
					const state = skipped.includes(question.id) ? "skipped" : ready[question.id] ? "answered" : "unanswered";
					return <li key={question.id}>
						<button
							type="button"
							className={cx(reviewRow, css({ borderColor: state === "unanswered" ? "var(--destructive)" : "var(--border)" }))}
							disabled={locked}
							onClick={() => goTo(questionIndex)}
						>
							<span className={css({ color: "var(--muted-foreground)" })}>{questionIndex + 1}.</span>
							<span className={css({ flex: 1, overflowWrap: "anywhere" })}>{question.header ?? question.prompt}</span>
							{timedOut.includes(question.id) ? <span className={badge}>timed out</span> : null}
							{flagged.includes(question.id) ? <span className={badge} data-quiz-flagged="true">flagged</span> : null}
							<span className={badge}>{state}</span>
						</button>
					</li>;
				})}
			</ol>
			<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.375rem" })}>
				<button className={button} type="button" disabled={locked} onClick={() => goTo(node.questions.length - 1)}>Back to questions</button>
				<button className="shared-activity__primary" type="button" disabled={disabled || (!pendingCompletion && !canSubmit)} onClick={submit}>{pendingCompletion ? "Retry save quiz" : "Submit quiz"}</button>
			</div>
			{!canSubmit && !pendingCompletion ? <small className={css({ color: "var(--muted-foreground)" })}>Answer or skip every question to submit.</small> : null}
			{pendingCompletion ? <p role="status">Quiz completion is ready to retry.</p> : null}
		</> : current ? <>
			{timedOut.includes(current.id) ? <p role="status" className={css({ color: "var(--destructive)", fontSize: "0.75rem" })}>Time ran out here — you can still answer it.</p> : null}
			{flagged.includes(current.id) ? <p role="status" className={css({ color: "var(--muted-foreground)", fontSize: "0.75rem" })}>Flagged for review.</p> : null}
			<div className="shared-activity__round" key={current.id}><Question node={current} disabled={locked} hideSubmit groupResponse={responses[current.id]} onResponseChange={update} /></div>
			<div className="shared-activity__nav">
				<button className="shared-activity__quiet" data-icon type="button" disabled={locked || index === 0} onClick={() => goTo(index - 1)} aria-label="Previous question"><ArrowLeft size={18} /></button>
				<button className="shared-activity__quiet" data-icon type="button" disabled={locked} onClick={toggleFlag} aria-label={flagged.includes(current.id) ? "Unflag" : "Flag for review"} aria-pressed={flagged.includes(current.id)}><Flag size={17} /></button>
				<button className="shared-activity__quiet" type="button" disabled={locked} onClick={skip}>Skip</button>
				<button className="shared-activity__primary" type="button" disabled={locked} onClick={advance}>{index >= node.questions.length - 1 ? "Review" : "Next"}<ArrowRight size={18} /></button>
			</div>
		</> : null}
	</div>;
}

function QuizProgressBar({ resolved, total }: { resolved: number; total: number }) {
	const percentage = total > 0 ? Math.round((resolved / total) * 100) : 0;
	return <div
		role="progressbar"
		aria-valuemin={0}
		aria-valuemax={total}
		aria-valuenow={resolved}
		aria-label="Quiz progress"
		className={css({ height: "0.375rem", overflow: "hidden", borderRadius: "999px", background: "var(--muted)" })}
	>
		<div className={css({ height: "100%", background: "var(--primary)" })} style={{ width: `${percentage}%` }} />
	</div>;
}

/**
 * The post-submission summary. Objective questions are settled immediately;
 * open-ended ones stay "awaiting teacher" and are excluded from the score until
 * `grade_quiz` delivers a verdict, at which point this card updates in place.
 * Reference answers are deliberately not shown — the teacher works the
 * misconception instead of handing over an answer key.
 */
function QuizResults({ node, answers, skipped, flagged, timedOut = [], timing }: { node: Extract<UiDocumentNode, { type: "quiz" }>; answers: Record<string, string>; skipped: string[]; flagged: string[]; timedOut?: string[]; timing?: UiQuizTiming }) {
	const grades = useContext(QuizGradesContext).grades[`${node.id}-result`] ?? [];
	const summary = summarizeQuiz(node.questions, answers, skipped, grades);
	return <div className={css({ display: "grid", gap: "0.5rem", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.75rem" })} data-quiz-results={node.id}>
		<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" })}>
			<strong role="status">
				{summary.decided > 0 ? `${formatPoints(summary.earned)} of ${summary.decided} scored` : "Awaiting your teacher's review"}
			</strong>
			<span className={css({ display: "inline-flex", alignItems: "baseline", gap: "0.625rem" })}>
				{timing ? <span className="shared-quiz-result__total"><small>Total time</small><strong>{formatQuizDuration(timing.totalMs)}</strong></span> : null}
				{summary.pending > 0 ? <small className={css({ color: "var(--muted-foreground)" })}>{summary.pending} awaiting grading</small> : null}
			</span>
		</div>
		<QuizProgressBar resolved={summary.decided} total={summary.total} />
		<ol className={css({ display: "grid", gap: "0.25rem", margin: 0, paddingLeft: 0, listStyle: "none" })}>
			{node.questions.map((question, questionIndex) => {
				const outcome = quizOutcome(question, answers[question.id], { skipped: skipped.includes(question.id), grades });
				const timeMs = timing?.perQuestionMs[question.id];
				const quick = isQuickQuizAnswer({ timeMs, timeLimitSeconds: questionSeconds(node, questionIndex), answered: Boolean(answers[question.id]?.trim()) && !skipped.includes(question.id), timedOut: timedOut.includes(question.id) });
				return <li key={question.id} className="shared-quiz-result__question" data-quiz-outcome={outcome.kind} data-question-timing={question.id}>
					<span aria-hidden="true" className="shared-quiz-result__mark">{outcomeMark(outcome)}</span>
					<div><p>{questionIndex + 1}. {question.header ?? question.prompt}</p>
						<div className="shared-quiz-result__meta">
							<span>{outcomeLabel(outcome)}</span>
							{timeMs !== undefined ? <span aria-label={`Time spent: ${formatQuizDuration(timeMs)}`}><Clock size={13} aria-hidden="true" /><time dateTime={`PT${timeMs / 1000}S`}>{formatQuizDuration(timeMs)}</time></span> : null}
							{quick ? <span data-speed="quick" title="Answered within the first quarter of the question's time limit."><Zap size={13} aria-hidden="true" />Quick</span> : null}
							{timedOut.includes(question.id) ? <span data-timeout>Timed out</span> : null}
							{flagged.includes(question.id) ? <span>Flagged</span> : null}
						</div>
					</div>
				</li>;
			})}
		</ol>
		{timing ? <details className="shared-quiz-result__timing-note"><summary>About timing</summary><p>Question times include return visits and exclude the review screen. Total time includes review. Quick means an answer took at most one quarter of its time limit; accuracy is scored separately.</p></details> : null}
		{grades.some((grade) => grade.note) ? <div className={css({ display: "grid", gap: "0.25rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" })}>
			{grades.filter((grade) => grade.note).map((grade) => <small key={grade.questionId} className={css({ color: "var(--muted-foreground)" })}>
				<strong>{node.questions.findIndex((question) => question.id === grade.questionId) + 1}.</strong> {grade.note}
			</small>)}
		</div> : null}
	</div>;
}

/**
 * Quizzes are timed by default, because a retrieval check the learner can sit
 * on indefinitely stops being retrieval. The model overrides it per quiz or per
 * question, and `0` at either level means untimed — the escape hatch for a
 * question that is meant to be thought about rather than raced.
 */
const DEFAULT_QUESTION_SECONDS = 120;

function questionSeconds(node: Extract<UiDocumentNode, { type: "quiz" }>, index: number): number | undefined {
	const question = node.questions[index];
	if (!question) return undefined;
	const limit = question.timeLimit ?? node.timeLimit ?? DEFAULT_QUESTION_SECONDS;
	return limit > 0 ? limit : undefined;
}

function formatPoints(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function outcomeMark(outcome: QuizOutcome): string {
	if (outcome.kind === "objective") return outcome.correct ? "✓" : "✗";
	if (outcome.kind === "graded") return outcome.verdict === "correct" ? "✓" : outcome.verdict === "partial" ? "◐" : "✗";
	if (outcome.kind === "skipped") return "–";
	return "◌";
}

function outcomeLabel(outcome: QuizOutcome): string {
	switch (outcome.kind) {
		case "objective": return outcome.correct ? "correct" : "incorrect";
		case "graded": return outcome.verdict;
		case "skipped": return "skipped";
		case "pending": return "grading…";
		default: return "no answer";
	}
}

/**
 * The one interaction with a feedback loop that costs no conversational turn:
 * the learner moves a parameter and the readouts recompute locally. Nothing is
 * dispatched, so they can take twenty attempts in the time one graded answer
 * would take.
 */
const TASK_LABEL: Record<UiTaskNode["kind"], { badge: string; items: string; verb: string }> = {
	assignment: { badge: "Assignment", items: "Steps", verb: "Submit assignment" },
	practice: { badge: "Practice", items: "Exercises", verb: "Log this session" },
	draft: { badge: "Draft", items: "Steps", verb: "Submit draft" },
	fieldwork: { badge: "Fieldwork", items: "Collection protocol", verb: "Record findings" },
};

/** A date the learner can act on, not an ISO string. */
function formatSchedule(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function wordCount(value: string): number {
	const trimmed = value.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Work the learner does away from the conversation. The item list is checkable
 * as they go and survives across sessions, so a task can be picked up later;
 * the submission is the one thing that ends it and hands the work back.
 */
export function TaskBrief({ node }: { node: UiTaskNode }) {
  const labels = TASK_LABEL[node.kind];
  const overdue = !!node.dueAt && Date.now() > Date.parse(node.dueAt);
  const notYetOpen = !!node.availableFrom && Date.now() < Date.parse(node.availableFrom);
  return <div data-task-brief={node.id} className={section}>
		<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.5rem" })}>
			<span className={badge}>{labels.badge}</span>
			<h4 className={css({ flex: 1, fontWeight: 700 })}>{node.title}</h4>
			{node.round !== undefined ? <small className={css({ color: "var(--muted-foreground)" })}>Round {node.round}</small> : null}
			{node.estimatedMinutes !== undefined ? <small className={css({ color: "var(--muted-foreground)" })}>~{node.estimatedMinutes} min</small> : null}
			{node.dueAt ? <small
				className={css({ fontWeight: 650 })}
				style={{ color: overdue ? "var(--destructive)" : "var(--muted-foreground)" }}
			>{overdue ? "Was due " : "Due "}{formatSchedule(node.dueAt)}</small> : null}
		</div>
		{notYetOpen ? <p role="status" className={css({ color: "var(--muted-foreground)", fontSize: "0.8125rem" })}>Opens {formatSchedule(node.availableFrom!)} — you can read the brief now.</p> : null}
		<MarkdownBlock content={node.brief} />

		{node.criteria?.length ? <div className={css({ display: "grid", gap: "0.25rem" })}>
			<strong className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Judged on</strong>
			<ul className={css({ display: "grid", gap: "0.125rem", margin: 0, paddingLeft: "1.125rem" })}>
				{node.criteria.map((criterion) => <li key={criterion} className={css({ fontSize: "0.8125rem" })}>{criterion}</li>)}
			</ul>
		</div> : null}

  </div>;
}

function Task({ documentId, node, receipt, receipts, disabled, onAction }: { documentId: string; node: UiTaskNode; receipt?: UiActionReceipt; receipts: UiActionReceipt[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const submitted = receipt?.action.type === "submit-task" ? receipt.action : undefined;
	const [submission, setSubmission] = useState(() => submitted?.submission ?? "");
	const [attachments, setAttachments] = useState<UiSubmissionAttachment[]>(() => submitted?.attachments ?? []);
	const [uploading, setUploading] = useState(false);
	const [note, setNote] = useState<Record<string, string>>({});
	type SavedTask = { intent: Extract<SharedUiActionIntent, { type: "submit-task" }>; savedAt: string };
	const [saved, setSaved] = useState<SavedTask>();
	const [saving, setSaving] = useState(false);
	const [restored, setRestored] = useState(false);
	const [saveError, setSaveError] = useState("");
	const storageKey = JSON.stringify([documentId, node.id, node.round ?? 0]);
	useEffect(() => {
		let active = true;
		setRestored(false); setSaved(undefined);
		void localRead<SavedTask>("tasks", storageKey).then((value) => {
			if (!active) return;
			setSaved(value);
			setSubmission(value?.intent.submission ?? submitted?.submission ?? "");
			setAttachments(value?.intent.attachments ?? submitted?.attachments ?? []);
			setRestored(true);
		}).catch(() => { if (active) { setSaveError("Could not restore local work. Try saving again."); setRestored(true); } });
		return () => { active = false; };
	}, [storageKey]);
	const labels = TASK_LABEL[node.kind];
	const format = node.submission?.format ?? "none";
	const now = Date.now();
	const opensAt = node.availableFrom ? Date.parse(node.availableFrom) : undefined;
	const dueAt = node.dueAt ? Date.parse(node.dueAt) : undefined;
	// Scheduling is advisory, not a lock: a late submission is still accepted,
	// because refusing it helps nobody's learning.
	const notYetOpen = opensAt !== undefined && Number.isFinite(opensAt) && now < opensAt;
	const overdue = dueAt !== undefined && Number.isFinite(dueAt) && now > dueAt;
	const terminal = receipt?.state === "completed" || Boolean(saved);
	const target = node.submission?.targetWords;
	const words = wordCount(submission);
	const itemDone = (itemId: string) => receipts.some((entry) => entry.state === "completed" && entry.action.type === "complete-task-item" && entry.action.nodeId === node.id && entry.action.itemId === itemId && entry.action.completed)
		|| node.items?.find((item) => item.id === itemId)?.status === "done";
	const submit = async () => {
		setSaving(true); setSaveError("");
		const value: SavedTask = {
			intent: { type: "submit-task", nodeId: node.id, submission: submission.trim(), attachments, ...(node.round !== undefined ? { round: node.round } : {}) },
			savedAt: new Date().toISOString(),
		};
		try {
			await localWrite("tasks", storageKey, value);
			setSaved(value);
			// Host notification is independent of durable local saving.
			try { onAction?.({ intent: value.intent, humanFriendlyMessage: `${labels.verb}: ${node.title}` }); } catch { /* Work is already saved locally. */ }
		} catch (cause) {
			setSaveError(cause instanceof Error ? cause.message : "Could not save on this device. Please retry.");
		} finally { setSaving(false); }
	};

	return <div className={section} data-task={node.id} data-task-kind={node.kind}>
		<TaskBrief node={node} />
		<SaveTaskToCourse task={node} />

		{node.items?.length ? <div className={css({ display: "grid", gap: "0.375rem" })}>
			<strong className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{labels.items}</strong>
			{node.items.map((item) => {
				const done = itemDone(item.id);
				return <div key={item.id} className={css({ display: "grid", gap: "0.25rem", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.5rem 0.625rem" })}>
					<label className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.8125rem" })}>
						<input
							type="checkbox"
							disabled={disabled || terminal}
							checked={done}
							onChange={() => onAction?.({
								intent: { type: "complete-task-item", nodeId: node.id, itemId: item.id, completed: !done, ...(note[item.id]?.trim() ? { note: note[item.id]!.trim() } : {}) },
								humanFriendlyMessage: `${done ? "Reopened" : "Completed"}: ${item.title}`,
							})}
						/>
						<span>
							<strong>{item.title}</strong>
							{item.detail ? <span className={css({ display: "block", color: "var(--muted-foreground)" })}>{item.detail}</span> : null}
						</span>
					</label>
					{item.note ? <small className={css({ color: "var(--muted-foreground)" })}>Recorded: {item.note}</small> : null}
					{done || terminal ? null : <input
						className={input}
						disabled={disabled || !restored || saving}
						aria-label={`Note for ${item.title}`}
						placeholder="What happened? (optional)"
						value={note[item.id] ?? ""}
						onChange={(event) => { const value = event.currentTarget.value; setNote((current) => ({ ...current, [item.id]: value })); }}
					/>}
				</div>;
			})}
		</div> : null}

		{format === "none" ? null : terminal ? <div className={css({ display: "grid", gap: "0.375rem", borderTop: "1px solid var(--border)", paddingTop: "0.625rem" })}>
			<p role="status" className={css({ fontWeight: 650 })}>Saved on this device</p>
			<AttachmentLinks attachments={saved?.intent.attachments ?? submitted?.attachments ?? attachments} />
			{(saved?.intent.submission ?? submitted?.submission) ? <blockquote className={css({ margin: 0, borderLeft: "3px solid var(--border)", paddingLeft: "0.625rem", fontSize: "0.8125rem", color: "var(--muted-foreground)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" })}>{saved?.intent.submission ?? submitted?.submission}</blockquote> : null}
		</div> : <div className={css({ display: "grid", gap: "0.375rem", borderTop: "1px solid var(--border)", paddingTop: "0.625rem" })}>
			<label className={css({ display: "grid", gap: "0.25rem", fontSize: "0.75rem", fontWeight: 650, color: "var(--muted-foreground)" })}>
				{node.submission?.label ?? "Your submission"}
				{format === "link"
					? <input className={input} type="url" disabled={disabled || !restored || saving} value={submission} placeholder={node.submission?.placeholder ?? "https://"} onChange={(event) => setSubmission(event.currentTarget.value)} />
					: <textarea className={cx(input, css({ minHeight: "6rem" }))} disabled={disabled || !restored || saving} value={submission} placeholder={node.submission?.placeholder ?? "Your work"} onChange={(event) => setSubmission(event.currentTarget.value)} />}
			</label>
			<SubmissionAttachments value={attachments} onChange={setAttachments} disabled={disabled || !restored || saving} onBusyChange={setUploading} />
			{target ? <small className={css({ color: words >= target ? "var(--muted-foreground)" : "var(--muted-foreground)" })}>{words} of about {target} words</small> : null}
			<div>
				<button className="shared-task__submit" type="button" disabled={disabled || !restored || saving || uploading || notYetOpen || (!submission.trim() && !attachments.length)} onClick={submit}>{saving ? "Saving…" : labels.verb}</button>
			</div>
			{saveError ? <p role="alert">{saveError}</p> : null}
		</div>}
	</div>;
}

function Checklist({ title, nodeId, items, actionType, disabled, onAction }: { title: string; nodeId: string; items: Array<{ id: string; title: string; done: boolean }>; actionType: "complete-goal-step" | "complete-plan-item"; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	return <div className={section}><h4 className={css({ fontWeight: 700 })}>{title}</h4>{items.map((item) => <label key={item.id} className={css({ display: "flex", gap: "0.5rem" })}><input disabled={disabled || (actionType === "complete-goal-step" && item.done)} type="checkbox" checked={item.done} onChange={() => onAction?.({ intent: actionType === "complete-goal-step" ? { type: actionType, nodeId, stepId: item.id } : { type: actionType, nodeId, itemId: item.id, completed: !item.done }, humanFriendlyMessage: `${item.done ? "Reopened" : "Completed"}: ${item.title}` })} />{item.title}</label>)}</div>;
}

function Plan({ nodeId, title, overview, items, disabled, onAction }: { nodeId: string; title: string; overview?: string; items: UiStudyPlanItem[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	return <div className={section}><h4 className={css({ fontWeight: 700 })}>{title}</h4>{overview ? <MarkdownBlock content={overview} /> : null}<PlanItems nodeId={nodeId} items={items} disabled={disabled} onAction={onAction} /></div>;
}

function PlanItems({ nodeId, items, disabled, onAction }: { nodeId: string; items: UiStudyPlanItem[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	return <ul className={css({ display: "grid", gap: "0.5rem", paddingLeft: "1rem" })}>{items.map((item) => <li key={item.id}><Checklist title={item.title} nodeId={nodeId} items={[{ id: item.id, title: item.detail ?? item.title, done: item.status === "done" }]} actionType="complete-plan-item" disabled={disabled} onAction={onAction} />{item.children ? <PlanItems nodeId={nodeId} items={item.children} disabled={disabled} onAction={onAction} /> : null}</li>)}</ul>;
}

function Notes({ node, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "notes" }>; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const [value, setValue] = useState(node.value);
	return <div className={section}><label htmlFor={node.id} className={css({ fontWeight: 700 })}>{node.title}</label><textarea disabled={disabled} id={node.id} className={input} value={value} placeholder={node.placeholder} onChange={(event) => setValue(event.currentTarget.value)} /><button disabled={disabled} className={button} type="button" onClick={() => onAction?.({ intent: { type: "update-notes", nodeId: node.id, value }, humanFriendlyMessage: `Updated ${node.title}` })}>Save notes</button></div>;
}

function Deck({ node, receipts, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "deck" }>; receipts: UiActionReceipt[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const completion = receipts.find((receipt) => receipt.action.type === "complete-deck" && receipt.state === "completed");
	const savedRatings = completion?.action.type === "complete-deck" ? completion.action.ratings : [];
	const [index, setIndex] = useState(() => savedRatings.length);
	const [revealed, setRevealed] = useState(false);
	const [ratings, setRatings] = useState(() => [...savedRatings]);
	const sent = useRef(Boolean(completion));
	const [pendingCompletion, setPendingCompletion] = useState<Extract<SharedUiActionIntent, { type: "complete-deck" }>>();
	const [delivered, setDelivered] = useState(false);
	const card = node.cards[index];
	const cardButton = useRef<HTMLButtonElement>(null);
	const [lastRating, setLastRating] = useState<number | undefined>();
	const ratingLock = useRef(false);
	const revealTimer = useFlashcardAutoReveal({
		cardKey: `${node.id}:${card?.id ?? "complete"}`,
		revealed,
		disabled: disabled || Boolean(pendingCompletion) || delivered || !card,
		onReveal: () => setRevealed(true),
	});
	const complete = (nextRatings: typeof ratings, pending = pendingCompletion) => {
		if (sent.current) return false;
		const summary = { reviewed: nextRatings.length, lapses: nextRatings.filter((entry) => entry.rating === 0).length };
		const attempt = retryableAggregateAttempt(pending, () => ({ type: "complete-deck" as const, nodeId: node.id, ratings: nextRatings, summary }), (intent) => Boolean(onAction?.({ intent, humanFriendlyMessage: `Completed ${summary.reviewed} flashcards on ${node.topic}${summary.lapses ? ` with ${summary.lapses} difficult recall${summary.lapses === 1 ? "" : "s"}` : ""}` })));
		if (attempt.pending !== pendingCompletion) setPendingCompletion(attempt.pending);
		if (attempt.delivered) {
			sent.current = true;
			setDelivered(true);
			setIndex(node.cards.length);
		}
		return attempt.delivered;
	};
	if (!card || delivered) return <div className="shared-activity" data-deck={node.id}>
		<CompletionMark detail={`Session complete. ${savedRatings.length || ratings.length} card${(savedRatings.length || ratings.length) === 1 ? "" : "s"} reviewed.`}>Deck complete</CompletionMark>
		<p className="shared-activity__card-note">{node.title}</p>
	</div>;
	const rate = (rating: 0 | 1 | 2 | 3) => {
		if (!revealed || disabled || pendingCompletion || ratingLock.current) return;
		ratingLock.current = true;
		const outcome = applyReview(initialSrsState(Date.now()), rating, Date.now());
		const nextRatings = [...ratings, { cardId: card.id, rating, appliedIntervalDays: outcome.appliedIntervalDays, easeAfter: outcome.next.ease }];
		setRatings(nextRatings);
		setLastRating(rating);
		setRevealed(false);
		if (index + 1 === node.cards.length) complete(nextRatings);
		else setIndex(index + 1);
		requestAnimationFrame(() => { ratingLock.current = false; cardButton.current?.focus(); });
	};
	const ratingIcons = [RotateCcw, Lightbulb, ThumbsUp, Zap];
	return <div className="shared-activity" data-deck={node.id} onKeyDown={(event) => {
		if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || !revealed) return;
		if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
		const rating = Number(event.key) - 1;
		if (rating >= 0 && rating <= 3 && Number.isInteger(rating)) { event.preventDefault(); rate(rating as 0 | 1 | 2 | 3); }
	}}>
		<div className="shared-activity__head"><h4>{node.title}</h4></div>
		<RoundProgress current={index} total={node.cards.length} label="Cards reviewed" />
		<FlashcardTimer timer={revealTimer} disabled={disabled || Boolean(pendingCompletion)} />
		<span className="flashcard-timer-sr" aria-live="polite" aria-atomic="true">{revealed ? `Answer: ${card.back}` : ""}</span>
		<div className="shared-activity__card-stack" key={card.id}>
			<button ref={cardButton} disabled={disabled || Boolean(pendingCompletion)} className="shared-activity__card" data-revealed={revealed} type="button" aria-label={revealed ? "Hide answer" : "Reveal answer"} aria-describedby={`${node.id}-${card.id}-face`} aria-pressed={revealed} onClick={() => setRevealed((value) => !value)}>
				<small>{revealed ? "Answer" : "Recall the answer"}</small>
				<span id={`${node.id}-${card.id}-face`} className="shared-activity__card-content" key={revealed ? "back" : "front"}>{revealed ? card.back : card.front}</span>
				<small><RotateCcw size={14} aria-hidden="true" />{revealed ? "Tap to see the prompt" : "Tap to reveal"}</small>
			</button>
		</div>
		{pendingCompletion ? <><p role="status">Final rating is ready to retry.</p><button disabled={disabled} className="shared-activity__primary" type="button" onClick={() => complete(pendingCompletion.ratings, pendingCompletion)}>Retry save deck</button></> : <>
			<div className="shared-activity__ratings" aria-label="Rate your recall">{["Again", "Hard", "Good", "Easy"].map((label, rating) => {
				const Icon = ratingIcons[rating]!;
				return <button disabled={disabled || !revealed} key={label} className="shared-activity__rating" data-rating={rating} type="button" onClick={() => rate(rating as 0 | 1 | 2 | 3)} aria-keyshortcuts={String(rating + 1)}><Icon size={19} aria-hidden="true" />{label}</button>;
			})}</div>
			<p className="shared-activity__card-note" role="status">{revealed ? "How easily did it come to you?" : lastRating === undefined ? "Think first. Flip when you're ready." : lastRating < 2 ? "Marked for more practice. Keep going." : "Got it. On to the next."}</p>
		</>}
	</div>;
}

function Resource({ nodeId, title, content, uri, markdown = false, receipt, disabled, onAction }: { nodeId?: string; title: string; content?: string; uri?: string; markdown?: boolean; receipt?: UiActionReceipt; disabled?: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	return <div className={section}><h4 className={css({ fontWeight: 700 })}>{title}</h4>{content ? markdown ? <MarkdownBlock content={content} /> : <pre className={css({ overflowX: "auto", whiteSpace: "pre-wrap" })}>{content}</pre> : null}{uri ? <a className={button} href={uri} target="_blank" rel="noreferrer">Open resource</a> : null}{nodeId ? <SaveControl nodeId={nodeId} title={title} receipt={receipt} disabled={Boolean(disabled)} onAction={onAction} /> : null}</div>;
}

function SaveControl({ nodeId, title, receipt, disabled, onAction }: { nodeId: string; title: string; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	if (receipt?.state === "completed") return <p role="status">Saved to artifacts.</p>;
	return <button className={button} type="button" disabled={disabled} onClick={() => onAction?.({ intent: { type: "save-artifact", nodeId }, humanFriendlyMessage: `Saved ${title}` })}>Save artifact</button>;
}

function Media({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "media" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const [failed, setFailed] = useState(() => intentionallyUnavailable(node.resource.uri));
	if (failed) return <div className={section}><UnavailableResource title={node.resource.title} uri={node.resource.uri} kind={node.kind} /><SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} /></div>;
	if (node.kind === "audio") return <div className={section}><strong>{node.resource.title}</strong><audio controls src={node.resource.uri} onError={() => setFailed(true)} /><SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} /></div>;
	if (node.kind === "video") return <div className={section}><strong>{node.resource.title}</strong><video controls src={node.resource.uri} onError={() => setFailed(true)} className={css({ maxWidth: "100%" })} /><SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} /></div>;
	return <Resource nodeId={node.id} title={node.resource.title} uri={node.resource.uri} content="Animation opens only from its validated resource URL." receipt={receipt} disabled={disabled} onAction={onAction} />;
}

function intentionallyUnavailable(uri: string | undefined): boolean {
	if (!uri) return true;
	try {
		return new URL(uri).hostname.endsWith(".invalid");
	} catch {
		return true;
	}
}

function UnavailableResource({ title, uri, kind }: { title: string; uri?: string; kind: string }) {
	return <div className={section} role="status"><strong>{title}</strong><p>This {kind} resource is unavailable here. The lesson remains usable.</p>{uri && !intentionallyUnavailable(uri) ? <a className={button} href={uri} target="_blank" rel="noreferrer">Open source</a> : null}</div>;
}

function RemoteImage({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "image" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const [failed, setFailed] = useState(() => intentionallyUnavailable(node.resource.uri));
	if (failed) return <div className={section}><UnavailableResource title={node.resource.title} uri={node.resource.uri} kind="image" /><SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} /></div>;
	return <figure className={section}><img src={node.resource.uri} alt={node.alt} onError={() => setFailed(true)} className={css({ maxWidth: "100%", borderRadius: "0.5rem" })} /><figcaption>{node.resource.title}</figcaption><SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} /></figure>;
}

function Handoff({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "handoff" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const completed = receipt?.state === "completed";
	const commit = () => !disabled && (completed || onAction?.({ intent: { type: "open-handoff", nodeId: node.id }, humanFriendlyMessage: `Opened ${node.target} handoff` }) !== false);
	return <div className={section}><strong>Continue on {node.target}</strong><p>{node.reason}</p><p className={css({ color: "var(--muted-foreground)" })}>{node.context}</p>{completed ? <p role="status">Handoff recorded.</p> : null}{node.target === "web" ? <a className={button} href="/" onClick={(event) => { if (!commit()) event.preventDefault(); }}>Open Keating web</a> : <button className={button} type="button" disabled={disabled || completed} onClick={commit}>Open {node.target} handoff</button>}</div>;
}
