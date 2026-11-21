import { Plan } from "../../components/lesson/StudyPlan";
import { LessonConceptMap, LessonImage } from "../../components/lesson/LessonProse";
import { useCardBookmarks } from "../../components/flashcards/useCardBookmarks";
import { useKeatingUiSettings } from "../../hooks/use-ui-settings";
import { playReviewSound, ratingSound } from "../../components/flashcards/review-feedback";
import { IconButton } from "../../design-system/kit";
import { LessonFrame, LessonCallout, LessonScore } from "../../components/lesson/LessonFrame";
import { LessonSlider } from "../../components/lesson/LessonSlider";
import { Meter } from "../../design-system/charts";
import { questionResponse as responseForQuestion } from "@keating/learner-contracts";
import { openUiDiagnosticComponentForNode } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { useQuizPerformance } from "../../components/QuizPerformanceEstimate";
import { MAX_RECORDING_SECONDS, ResponseCapture } from "../../components/ResponseCapture";
import { localRead, localWrite } from "../../submissions/local-store";
import { SubmissionAttachments, AttachmentLinks } from "../../components/SubmissionAttachments";
import { EarlierRounds, useEarlierRounds } from "../../components/homework/EarlierRounds";
import { PrintAssignmentButton } from "../../components/homework/PrintAssignmentButton";
import { taskDraftKey, taskSubmissionKey, type SavedTaskDraft } from "../homework/task-storage";
import { Select } from "../../components/Select";
import type { UiSubmissionAttachment } from "@keating/learner-contracts";
import type React from "react";
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { KeatingGlyph, type GlyphName } from "../../design-system/glyphs";
import { CompletionMark, RoundProgress } from "../../components/quiz/ActivityGame";
import { QuizCountdown } from "../../components/quiz/QuizCountdown";
import { QuizTimingTracker } from "../../components/quiz/timing";
import { formatQuizDuration, isQuickQuizAnswer } from "../../components/quiz/game";
import { FlashcardTimer } from "../../components/flashcards/FlashcardTimer";
import { useFlashcardAutoReveal } from "../../components/flashcards/useFlashcardAutoReveal";
import "./activity.css";
import type { UiActionReceipt, UiDocument, UiDocumentNode, UiQuestion, UiQuestionGroupResponse, UiQuizTiming, UiTaskNode } from "@keating/learner-contracts";
import { SimulationRenderer } from "../../components/SimulationRenderer";
import { SystemDesignWorkbench } from "../../components/SystemDesignWorkbench";
import { ExamRenderer } from "../../components/ExamRenderer";
import { CodingChallenge } from "../../components/CodingChallenge";
import { TeachingLab } from "../../components/TeachingLab";
import { MusicLab } from "../../components/MusicLab";
import { ManipulativeRenderer } from "../../components/manipulatives/ManipulativeRenderer";
import { LanguagePractice } from "../../components/LanguagePractice";
import { MarkdownBlock } from "../../components/MarkdownBlock";
import { parseQuestionTemplate } from "../../components/question-template";
import { QuizGradesContext } from "../../components/quiz-grades-context";
import { applyReview, formatInterval, initialSrsState } from "../srs";
import { objectiveCredit, type QuizOutcome, quizOutcome, summarizeQuiz } from "./quiz-progress";
import type { SharedUiActionIntent } from "./shared-actions";

export interface SharedUiActionEvent {
	intent: SharedUiActionIntent;
	humanFriendlyMessage: string;
}

const panel = "lesson-document";

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
	return <section className={panel} data-shared-openui-document={document.id} data-openui-revision={document.revision}
		data-openui-diagnostic-nodes={document.nodes.map(openUiDiagnosticComponentForNode).join(" ")}>
		{document.title ? <h3 className="lesson-document__title">{document.title}</h3> : null}
		{document.description ? <p className="lesson-document__lede">{document.description}</p> : null}
		{!interactive ? <div role="status" className="lesson-document__inactive">
			<p>This interaction is {document.lifecycle.replace("_", " ")}. Its content remains available, but controls are disabled.</p>
			{retryable ? <button className="lesson-quiet k-bloom shared-retry" type="button" onClick={() => onAction?.({ intent: { type: "retry" }, humanFriendlyMessage: "Retry this interaction" })}><KeatingGlyph name="refresh" size={13} />Retry interaction</button> : null}
		</div> : null}
		{document.nodes.map((node) => <SharedNode key={`${document.id}:${node.id}`} documentId={document.id} documentRevision={document.revision} persistent={document.retention !== "ephemeral"} node={node} receipts={receipts} disabled={!interactive} onAction={onAction} />)}
	</section>;
}

function SharedNode({ documentId, documentRevision, persistent = true, node, receipts, disabled, onAction }: { documentId: string; documentRevision: number; persistent?: boolean; node: UiDocumentNode; receipts: UiActionReceipt[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	if (node.type === "markdown") return <div className="shared-markdown"><MarkdownBlock content={node.markdown} /></div>;
	if (node.type === "callout") return <LessonCallout tone={node.tone} title={node.title}><MarkdownBlock content={node.markdown}/></LessonCallout>;
	if (node.type === "question") return <LessonFrame glyph="help" kind="Quick check"><Question node={node} receipt={completedNodeReceipt(receipts, node.id, ["submit-answer", "choose-option"])} disabled={disabled} onAction={onAction} /></LessonFrame>;
	if (node.type === "question-group") return <QuestionGroup node={node} receipt={completedNodeReceipt(receipts, node.id, ["submit-question-group"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "quiz") return node.mode === "exam"
		? <ExamRenderer documentId={documentId} node={node} receipt={completedNodeReceipt(receipts, node.id, ["complete-quiz"])} disabled={disabled} onAction={onAction} />
		: <Quiz documentId={documentId} documentRevision={documentRevision} node={node} receipt={completedNodeReceipt(receipts, node.id, ["complete-quiz"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "goal") return <Checklist title={node.title} nodeId={node.id} items={node.steps.map((step) => ({ id: step.id, title: step.title, done: step.status === "done" }))} actionType="complete-goal-step" disabled={disabled} onAction={onAction} />;
	if (node.type === "deck") return <Deck node={node} receipts={receipts.filter((receipt) => receipt.state === "completed" && ((receipt.action.type === "rate-card" || receipt.action.type === "complete-deck") && receipt.action.nodeId === node.id))} disabled={disabled} onAction={onAction} />;
	if (node.type === "study-plan") return node.items ? <Plan receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} persistent={persistent} nodeId={node.id} title={node.title ?? "Study plan"} overview={node.overview} items={node.items} disabled={disabled} onAction={onAction} /> : <Resource nodeId={node.id} title={node.resource?.title ?? "Study plan"} content={node.resource?.content} uri={node.resource?.uri} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "artifact") return <Resource nodeId={node.id} title={node.resource.title} content={node.resource.content} uri={node.resource.uri} markdown={node.resource.format === "markdown"} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "concept-map") return <LessonConceptMap title={node.title} source={node.source} />;
	if (node.type === "notes") return <Notes node={node} disabled={disabled} onAction={onAction} />;
	if (node.type === "image") return <RemoteImage node={node} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "simulation") return <SimulationRenderer node={node} documentId={persistent ? documentId : undefined} receipt={completedNodeReceipt(receipts, node.id, ["share-simulation"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "coding-challenge") return <CodingChallenge node={node} disabled={disabled} onAction={onAction} />;
	if (node.type === "lab") return <TeachingLab documentId={documentId} documentRevision={documentRevision} node={node} receipts={receipts} disabled={disabled} onAction={onAction} />;
	if (node.type === "music-lab") return <MusicLab node={node} disabled={disabled} />;
	if (node.type === "manipulative") return <ManipulativeRenderer node={node} documentId={persistent ? documentId : undefined} receipt={completedNodeReceipt(receipts, node.id, ["share-manipulative"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "language-practice") return <LanguagePractice node={node} receipt={completedNodeReceipt(receipts, node.id, ["complete-language-practice"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "task" && node.diagram) return <SystemDesignWorkbench documentId={documentId} documentRevision={documentRevision} node={{ ...node, diagram: node.diagram }} receipt={completedNodeReceipt(receipts, node.id, ["submit-task"])} disabled={disabled} onAction={onAction} />;
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

export function Question({ node, receipt, disabled, onAction, groupResponse, hideSubmit = false, completed: completedOverride = false, onResponseChange, onHint, checked = false, onAdvance }: { node: UiQuestion; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean; groupResponse?: UiQuestionGroupResponse; hideSubmit?: boolean; completed?: boolean; onResponseChange?: (response: UiQuestionGroupResponse, ready: boolean) => void; onHint?: () => void; checked?: boolean; onAdvance?: () => void }) {
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
	return <fieldset className="shared-activity shared-activity__question" data-question-kind={node.kind ?? "text"} onKeyDown={event => {
		const target = event.target as HTMLElement;
		if (disabled || completed || event.repeat || event.ctrlKey || event.altKey || event.metaKey || target.closest("textarea,select,input:not([type=radio]):not([type=checkbox]),summary,button")) return;
		if (event.key === "Enter" && ready) {
			event.preventDefault();
			if (hideSubmit) onAdvance?.(); else submit();
		} else if (node.choices && !checked && !rows && !ordering && /^[a-z1-9]$/i.test(event.key)) {
			const i = /[1-9]/.test(event.key) ? Number(event.key)-1 : event.key.toUpperCase().charCodeAt(0)-65;
			const input = event.currentTarget.querySelectorAll<HTMLInputElement>(".shared-activity__choice input")[i];
			if (input) { event.preventDefault(); input.focus(); input.click(); }
		}
	}}>
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
				: <ol className="shared-blanks">{blankAnswers.map((value, index) => <li key={`${node.id}-blank-${index}`}><span className="lesson-index" aria-hidden="true">{index + 1}</span><input disabled={disabled || completed} aria-label={`Blank ${index + 1}`} value={value} onChange={(event) => setBlankAnswers((current) => current.map((entry, entryIndex) => entryIndex === index ? event.currentTarget.value : entry))} placeholder={node.blanks?.[index]?.placeholder ?? `Blank ${index + 1}`} /></li>)}</ol>
				: node.choices ? <div className="shared-activity__choices">{multiple ? <small className="shared-activity__meta">Choose all that fit</small> : null}{node.choices.map((choice, choiceIndex) => <label key={choice.id} className="shared-activity__choice" data-state={checked ? (node.correctAnswers ?? [node.correctAnswer]).includes(choice.id) ? "correct" : selected.includes(choice.id) ? "wrong" : undefined : undefined}><input disabled={disabled || completed} type={multiple ? "checkbox" : "radio"} name={node.id} checked={selected.includes(choice.id)} onChange={() => setSelected((current) => multiple ? current.includes(choice.id) ? current.filter((id) => id !== choice.id) : [...current, choice.id] : [choice.id])} /><span className="shared-activity__letter" aria-hidden="true">{String.fromCharCode(65 + choiceIndex)}</span><span>{choice.label}</span>{checked && ((node.correctAnswers ?? [node.correctAnswer]).includes(choice.id) || selected.includes(choice.id)) ? <span className="lesson-verdict"><KeatingGlyph name={(node.correctAnswers ?? [node.correctAnswer]).includes(choice.id) ? "check" : "x"} size={13}/>{(node.correctAnswers ?? [node.correctAnswer]).includes(choice.id) ? "Correct" : "Your answer"}</span> : null}</label>)}{node.allowText ? <textarea aria-label="Your own answer" disabled={disabled || completed} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} placeholder="Or explain your own answer" /> : null}</div>
					: node.kind === "slider" ? <LessonSlider className="shared-activity__slider" label="Your answer" disabled={disabled || completed} min={node.min ?? 0} max={node.max ?? 100} step={node.step ?? 1} start={node.min ?? 0} value={Number(answer || node.min || 0)} format={formatSliderValue} onChange={(value) => setAnswer(String(value))} />
						: <textarea aria-label="Your answer" disabled={disabled || completed} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} placeholder="Type your answer" />}
		{node.hint ? <details className="shared-activity__hint" onToggle={(event) => { if (event.currentTarget.open) onHint?.(); }}><summary onClick={onHint}><KeatingGlyph name="bulb" size={15} />Hint</summary><p>{node.hint}</p></details> : null}
		{completed ? !hideSubmit ? <p role="status" className="lesson-status" data-tone="ok">Answer saved.</p> : null : !hideSubmit ? <button className="shared-activity__primary" type="button" disabled={disabled || !ready} onClick={submit}>Send answer <KeatingGlyph name="send" size={17} /></button> : null}
	</fieldset>;
}

/**
 * Arrange items into a sequence by dragging, with Up and Down on every row.
 * The buttons are not decoration: a drag-only list is unreachable by keyboard
 * and fiddly on touch, so they are the interaction of record here too.
 */
function OrderingList({ node, order, disabled, onReorder }: { node: UiQuestion; order: string[]; disabled: boolean; onReorder: (next: string[]) => void }) {
	const [dragging, setDragging] = useState<number | undefined>();
	const [over, setOver] = useState<number | undefined>();
	// The row the learner last moved keeps the wash, so a keyboard move is as visible as a drag.
	const [moved, setMoved] = useState<string | undefined>();
	const move = (from: number, to: number) => {
		if (from === to || to < 0 || to >= order.length) return;
		const next = [...order];
		const [item] = next.splice(from, 1);
		if (item === undefined) return;
		next.splice(to, 0, item);
		setMoved(item);
		onReorder(next);
	};
	return <ol className="lesson-group shared-order" data-ordering={node.id}>
		{order.map((item, index) => <li
			key={`${node.id}-order-${item}`}
			className="shared-order__row"
			data-glyph-host
			data-moving={dragging === index || (dragging === undefined && moved === item) ? "true" : undefined}
			data-over={over === index && dragging !== index ? "true" : undefined}
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
		>
			<KeatingGlyph name="grip" size={13} className="shared-order__grip" />
			<span className="lesson-index">{index + 1}</span>
			<span className="shared-order__text">{item}</span>
			<IconButton size="sm" glyph="chevu" disabled={disabled || index === 0} label={`Move ${item} up`} onClick={() => move(index, index - 1)} />
			<IconButton size="sm" glyph="down" disabled={disabled || index === order.length - 1} label={`Move ${item} down`} onClick={() => move(index, index + 1)} />
		</li>)}
	</ol>;
}

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
		"data-over": over === choiceId ? "true" : undefined,
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
		className="shared-sort__item"
		data-glyph-host
		data-dragging={dragging === rowIndex ? "true" : undefined}
		draggable={!disabled}
		aria-grabbed={dragging === rowIndex}
		onDragStart={(event) => {
			event.dataTransfer.setData("text/plain", String(rowIndex));
			event.dataTransfer.effectAllowed = "move";
			setDragging(rowIndex);
		}}
		onDragEnd={() => { setDragging(undefined); setOver(undefined); }}
	>
		<KeatingGlyph name="grip" size={13} className="shared-sort__grip" />
		<span className="shared-sort__text">{item}</span>
		<Select
			disabled={disabled}
			className="shared-sort__select"
			aria-label={`${node.choiceLabel ?? "Choice"} for ${item}`}
			value={choiceOf(rowIndex)}
			onValueChange={(value) => onAssign(rowIndex, value)}
		>
			<option value="">Unassigned</option>
			{node.choices?.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
		</Select>
	</div>;

	return <div className="shared-sort" data-row-assignment={node.id}>
		<div {...dropProps("")} className="shared-sort__pool k-grid">
			<span className="lesson-label">{node.itemLabel ?? "To place"}</span>
			{unassigned.length === 0
				? <small className="lesson-hint">Everything is placed.</small>
				: unassigned.map(({ item, index }) => itemChip(item, index))}
		</div>
		<div className="shared-sort__columns">
			{node.choices?.map((choice) => {
				const assigned = items.map((item, index) => ({ item, index })).filter(({ index }) => choiceOf(index) === choice.id);
				return <div key={choice.id} {...dropProps(choice.id)} className="shared-sort__column k-grid">
					<span className="lesson-label">{choice.label}<span className="lesson-meta"> · {assigned.length}</span></span>
					{assigned.map(({ item, index }) => <div key={`${node.id}-assigned-${index}`} className="shared-sort__placed">
						{itemChip(item, index)}
						{node.requireReasons ? <input
							disabled={disabled}
							className="shared-sort__reason"
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

/**
 * Cloze rendering: the inputs sit inside the sentence, where the gap actually
 * is, rather than in a stack underneath it. Enter moves to the next blank so a
 * multi-blank question can be filled without reaching for the mouse.
 */
function InlineBlanks({ node, values, disabled, onChange }: { node: UiQuestion; values: string[]; disabled: boolean; onChange: (index: number, value: string) => void }) {
	const fields = useRef<(HTMLInputElement | null)[]>([]);
	let blankIndex = -1;
	return <p className="shared-cloze">
		{parseQuestionTemplate(node.prompt).map((part, index) => {
			if (!part.isBlank) return <span key={index} className="shared-cloze__text">{part.text}</span>;
			blankIndex += 1;
			const current = blankIndex;
			const definition = node.blanks?.[current];
			const placeholder = definition?.placeholder ?? "___";
			const value = values[current] ?? "";
			return <input
				key={index}
				ref={(element) => { fields.current[current] = element; }}
				type="text"
				disabled={disabled}
				className="shared-cloze__blank"
				// Sized to what it holds, like a printed blank, never a full-width box.
				style={{ width: `${Math.max(value.length, placeholder.length, 4) + 2}ch` }}
				aria-label={definition?.hint ? `${definition.hint} blank` : `Blank ${current + 1}`}
				title={definition?.hint}
				placeholder={placeholder}
				value={value}
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
	const finish = () => {
		if (disabled || !canSubmit) return;
		const attempt = retryableAggregateAttempt(pendingSubmission, () => ({ type: "submit-question-group" as const, nodeId: node.id, responses: ordered }), (intent) => Boolean(onAction?.({ intent, humanFriendlyMessage: `Answered ${node.questions.length} questions${node.topic ? ` about ${node.topic}` : ""}` })));
		setDelivered(attempt.delivered);
		setPendingSubmission(attempt.pending);
	};
	return <LessonFrame glyph="help" title={node.title} kind="Quick check" data-question-group={node.id}>
		{node.intro ? <details className="shared-activity__hint"><summary>Before you start</summary><p>{node.intro}</p></details> : null}
		{finished ? <><CompletionMark detail="Answers saved.">Check complete</CompletionMark><details className="shared-activity__review"><summary>Your answers</summary>{node.questions.map((question) => <Question key={question.id} node={question} disabled hideSubmit completed groupResponse={responses[question.id]} />)}</details></> : current ? <>
			<RoundProgress current={index} total={node.questions.length} resolved={Object.values(ready).filter(Boolean).length} label="Question progress" />
			<div className="shared-activity__round" key={current.id} ref={focusRound} tabIndex={-1}><Question node={current} disabled={locked} hideSubmit groupResponse={responses[current.id]} onResponseChange={update} onAdvance={index < node.questions.length - 1 ? () => move(index + 1) : finish} /></div>
			<div className="shared-activity__nav">
				<button className="shared-activity__quiet" type="button" disabled={locked || index === 0} onClick={() => move(index - 1)} aria-label="Previous question"><KeatingGlyph name="left" size={18} /></button>
				{index < node.questions.length - 1 ? <button className="shared-activity__primary" type="button" disabled={locked || !ready[current.id]} onClick={() => move(index + 1)}>Next <KeatingGlyph name="right" size={18} /></button> : <button className="shared-activity__primary" type="button" disabled={disabled || !canSubmit} onClick={finish}>{pendingSubmission ? "Retry save answers" : "Finish check"}<KeatingGlyph name="check" size={18} /></button>}
			</div>
			{pendingSubmission ? <p role="status">Your answers are ready. Try saving again.</p> : null}
		</> : <p>No questions in this check.</p>}
	</LessonFrame>;
}

/**
 * A stepped quiz: one question at a time, with skip, flag-for-review, a review
 * step that shows what is still open, and a result card that keeps updating as
 * the teacher grades the open-ended answers.
 */
function Quiz({ documentId, documentRevision, node, receipt, disabled, onAction }: { documentId: string; documentRevision: number; node: Extract<UiDocumentNode, { type: "quiz" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const saved = receipt?.action.type === "complete-quiz" ? receipt.action : undefined;
	const [responses, setResponses] = useState<Record<string, UiQuestionGroupResponse>>(() => Object.fromEntries((saved?.answers ?? []).flatMap((answer) => {
		const question = node.questions.find((candidate) => candidate.id === answer.questionId);
		return question ? [[answer.questionId, quizResponseForAnswer(question, answer.answer)] as const] : [];
	})));
	const [ready, setReady] = useState<Record<string, boolean>>(() => Object.fromEntries((saved?.answers ?? []).map((answer) => [answer.questionId, true])));
	const [index, setIndex] = useState(0);
	const [showAll,setShowAll] = useState(false);
	const [reviewMisses,setReviewMisses] = useState(false);
	const grades = useContext(QuizGradesContext).grades[`${node.id}-result`] ?? [];
	const [checkedAnswer,setCheckedAnswer] = useState<{id:string;answer:string}>();
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
	const prediction = useQuizPerformance({ documentId, documentRevision, node, disabled, completed: completed || delivered });
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
		const attempt = retryableAggregateAttempt(pendingCompletion, buildCompletion, (intent) => { prediction.prepareSubmission(intent); return Boolean(onAction?.({ intent, humanFriendlyMessage: `Completed ${node.title}` })); });
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
		prediction.touch();
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
		prediction.touch();
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
	const credit = current?.choices && ready[current.id] ? objectiveCredit(current,answerText[current.id] ?? "") : undefined;
	const checked = Boolean(current && checkedAnswer?.id === current.id && checkedAnswer.answer === answerText[current.id]);
	const checkOrAdvance = () => {
		if (!locked && current && credit !== undefined && !checked) setCheckedAnswer({id:current.id, answer:answerText[current.id]!});
		else advance();
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

	const revisit = terminal ? node.questions.filter(question => {
		const outcome = quizOutcome(question,answerText[question.id],{skipped:skipped.includes(question.id),grades});
		return flagged.includes(question.id) || outcome.kind === "skipped" || outcome.kind === "objective" && !outcome.correct || outcome.kind === "graded" && outcome.verdict !== "correct";
	}) : [];
	if (terminal) return <LessonFrame glyph="quiz" title={node.title} kind="Quiz result" data-quiz={node.id} footer={<>
		<button type="button" className="lesson-quiet k-bloom" aria-expanded={showAll} onClick={()=>{setShowAll(!showAll);setReviewMisses(false);}}>All answers <KeatingGlyph name={showAll ? "chevu" : "chev"} size={13}/></button>
		{revisit.length > 0 && <button type="button" className="lesson-primary" aria-expanded={reviewMisses} onClick={()=>{setReviewMisses(!reviewMisses);setShowAll(false);}}>{reviewMisses ? "Close review" : `Review ${revisit.length}`}</button>}
	</>}>
		<CompletionMark>Round complete</CompletionMark>
		{prediction.controls}
		<QuizResults node={node} answers={answerText} skipped={skipped} flagged={flagged} timedOut={timedOut} timing={saved?.timing ?? finalTiming} showAll={showAll}/>
		{(showAll || reviewMisses) && <div className="shared-activity__review">{(showAll ? node.questions : revisit).map(question => <Question key={question.id} node={question} disabled hideSubmit completed groupResponse={responses[question.id]}/>)}</div>}
	</LessonFrame>;
	return <LessonFrame glyph="quiz" kind="Quiz" title={node.title} tools={remaining !== undefined && <QuizCountdown key={current?.id} remaining={remaining} total={questionSeconds(node, index) ?? remaining}/>}
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
		{reviewing ? <small role="status">Review answers</small> : null}
		{prediction.controls}
		<RoundProgress current={reviewing ? Math.max(0, node.questions.length - 1) : index} total={node.questions.length} resolved={resolved} label="Quiz progress" />

		{reviewing ? <>
			<ol className="lesson-rows shared-quiz-review">
				{node.questions.map((question, questionIndex) => {
					const state = skipped.includes(question.id) ? "skipped" : ready[question.id] ? "answered" : "unanswered";
					return <li key={question.id}>
						<button type="button" className="shared-quiz-review__row" data-state={state} disabled={locked} onClick={() => goTo(questionIndex)}>
							<span className="lesson-index">{questionIndex + 1}</span>
							<span className="shared-quiz-review__text">{question.header ?? question.prompt}</span>
							<span className="shared-quiz-review__status">
								{timedOut.includes(question.id) ? <span className="lesson-status" data-tone="bad">timed out</span> : null}
								{flagged.includes(question.id) ? <span className="lesson-status" data-tone="warn" data-quiz-flagged="true">flagged</span> : null}
								<span className="lesson-status" data-tone={state === "answered" ? "ok" : state === "unanswered" ? "bad" : "none"}>{state}</span>
							</span>
						</button>
					</li>;
				})}
			</ol>
			<div className="shared-activity__nav">
				<button className="shared-activity__quiet" type="button" disabled={locked} onClick={() => goTo(node.questions.length - 1)}>Back to questions</button>
				<button className="shared-activity__primary" type="button" disabled={disabled || (!pendingCompletion && !canSubmit)} onClick={submit}>{pendingCompletion ? "Retry save quiz" : "Submit quiz"}</button>
			</div>
			{!canSubmit && !pendingCompletion ? <small className="lesson-hint">Answer or skip every question to submit.</small> : null}
			{pendingCompletion ? <p role="status">Quiz completion is ready to retry.</p> : null}
		</> : current ? <>
			{timedOut.includes(current.id) ? <p role="status" className="lesson-status" data-tone="bad">Time ran out here — you can still answer it.</p> : null}
			{flagged.includes(current.id) ? <p role="status" className="lesson-status" data-tone="warn">Flagged for review.</p> : null}
			<div className="shared-activity__round" key={current.id} onPointerDownCapture={prediction.touch} onKeyDownCapture={prediction.touch} onInputCapture={prediction.touch}><Question node={current} disabled={locked} hideSubmit groupResponse={responses[current.id]} onResponseChange={update} onHint={() => prediction.hint(current.id)} checked={checked} onAdvance={checkOrAdvance} /></div>
			{checked && <div className="lesson-feedback" role="status" data-result={credit === 1 ? "correct" : "wrong"}><KeatingGlyph name={credit === 1 ? "check" : "x"} size={14}/><b>{credit === 1 ? "Correct" : "Not quite"}.</b> {current.explanation}</div>}
			<div className="shared-activity__nav">
				<button className="shared-activity__quiet" data-icon type="button" disabled={locked || index === 0} onClick={() => goTo(index - 1)} aria-label="Previous question"><KeatingGlyph name="left" size={18} /></button>
				<button className="shared-activity__quiet" data-icon type="button" disabled={locked} onClick={toggleFlag} aria-label={flagged.includes(current.id) ? "Unflag" : "Flag for review"} aria-pressed={flagged.includes(current.id)}><KeatingGlyph name="flag" size={18} /></button>
				<button className="shared-activity__quiet" type="button" disabled={locked} onClick={skip}>Skip</button>
				<button className="shared-activity__primary" type="button" disabled={locked} onClick={checkOrAdvance}>{credit !== undefined && !checked ? "Check" : index >= node.questions.length - 1 ? "Review" : "Next"}<KeatingGlyph name="right" size={18} /></button>
			</div>
		</> : null}
	</LessonFrame>;
}

/**
 * The post-submission summary. Objective questions are settled immediately;
 * open-ended ones stay "awaiting teacher" and are excluded from the score until
 * `grade_quiz` delivers a verdict, at which point this card updates in place.
 * Reference answers are deliberately not shown — the teacher works the
 * misconception instead of handing over an answer key.
 */
function QuizResults({ node, answers, skipped, flagged, timedOut = [], timing, showAll }: { showAll: boolean; node: Extract<UiDocumentNode, { type: "quiz" }>; answers: Record<string, string>; skipped: string[]; flagged: string[]; timedOut?: string[]; timing?: UiQuizTiming }) {
	const grades = useContext(QuizGradesContext).grades[`${node.id}-result`] ?? [];
	const summary = summarizeQuiz(node.questions, answers, skipped, grades);
	const partial = node.questions.filter(question => {
		const outcome = quizOutcome(question, answers[question.id], {skipped: skipped.includes(question.id), grades});
		return outcome.kind === "graded" && outcome.verdict === "partial";
	}).length;
	return <div className="lesson-results" data-quiz-results={node.id}>
		<LessonScore score={summary.decided ? `${formatPoints(summary.earned)} of ${summary.decided} scored` : "Awaiting your teacher's review"}
			percent={summary.decided ? summary.percentage : undefined} time={timing && formatQuizDuration(timing.totalMs)}
			correct={summary.correct} partly={partial} missed={summary.decided - summary.skipped - summary.correct - partial}/>
		{summary.pending > 0 && <small>{summary.pending} awaiting grading</small>}
		<ol className="shared-quiz-results">
			{node.questions.map((question, questionIndex) => {
				const outcome = quizOutcome(question, answers[question.id], { skipped: skipped.includes(question.id), grades });
				if (!showAll && !flagged.includes(question.id) && !timedOut.includes(question.id) && (outcome.kind === "objective" && outcome.correct || outcome.kind === "graded" && outcome.verdict === "correct")) return null;
				const timeMs = timing?.perQuestionMs[question.id];
				const quick = isQuickQuizAnswer({ timeMs, timeLimitSeconds: questionSeconds(node, questionIndex), answered: Boolean(answers[question.id]?.trim()) && !skipped.includes(question.id), timedOut: timedOut.includes(question.id) });
				return <li key={question.id} className="shared-quiz-result__question" data-quiz-outcome={outcome.kind} data-question-timing={question.id}>
					<span aria-hidden="true" className="shared-quiz-result__mark"><KeatingGlyph name={outcomeMark(outcome)} size={13} /></span>
					<div><p>{questionIndex + 1}. {question.header ?? question.prompt}</p>
						<div className="shared-quiz-result__meta">
							<span>{outcomeLabel(outcome)}</span>
							{outcome.kind === "pending" && <span>{answers[question.id]}</span>}
							{question.mathProblem && objectiveCredit(question, answers[question.id] ?? "") === undefined ? <span>Not independently checked</span> : null}
							{timeMs !== undefined ? <span aria-label={`Time spent: ${formatQuizDuration(timeMs)}`}><KeatingGlyph name="clock" size={13} /><time dateTime={`PT${timeMs / 1000}S`}>{formatQuizDuration(timeMs)}</time></span> : null}
							{quick ? <span data-speed="quick" title="Answered within the first quarter of the question's time limit."><KeatingGlyph name="spark" size={13} />Quick</span> : null}
							{timedOut.includes(question.id) ? <span data-timeout>Timed out</span> : null}
							{flagged.includes(question.id) ? <span>Flagged</span> : null}
						</div>
					</div>
				</li>;
			})}
		</ol>
		{timing ? <details className="shared-quiz-result__timing-note"><summary>About timing</summary><p>Question times include return visits and exclude the review screen. Total time includes review. Quick means an answer took at most one quarter of its time limit; accuracy is scored separately.</p></details> : null}
		{grades.some((grade) => grade.note) ? <div className="shared-quiz-result__notes">
			{grades.filter((grade) => grade.note).map((grade) => <small key={grade.questionId}>
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

/** A slider answer as people write numbers ("1,250", "0.5"), never a float tail. */
function formatSliderValue(value: number): string {
	return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPoints(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function outcomeMark(outcome: QuizOutcome): GlyphName {
	if (outcome.kind === "objective") return outcome.correct ? "check" : "x";
	if (outcome.kind === "graded") return outcome.verdict === "correct" ? "check" : outcome.verdict === "partial" ? "minus" : "x";
	if (outcome.kind === "skipped") return "minus";
	return "ring";
}

function outcomeLabel(outcome: QuizOutcome): string {
	switch (outcome.kind) {
		case "objective": return outcome.correct ? "Correct" : "Not quite";
		case "graded": return outcome.verdict === "correct" ? "Correct" : outcome.verdict === "partial" ? "Partly" : "Not quite";
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
// Glyphs follow board L4 (lessons-mockups.html, 2026-11-20).
const TASK_LABEL: Record<UiTaskNode["kind"], { badge: string; items: string; verb: string; glyph: GlyphName; itemsGlyph: GlyphName; submitGlyph: GlyphName; submissionGlyph: GlyphName }> = {
	assignment: { badge: "Assignment", items: "Steps", verb: "Submit assignment", glyph: "checklist", itemsGlyph: "checklist", submitGlyph: "send", submissionGlyph: "doc" },
	practice: { badge: "Practice", items: "Exercises", verb: "Log this session", glyph: "checklist", itemsGlyph: "checklist", submitGlyph: "check", submissionGlyph: "pen" },
	draft: { badge: "Draft", items: "Steps", verb: "Submit draft", glyph: "doc", itemsGlyph: "checklist", submitGlyph: "send", submissionGlyph: "pen" },
	fieldwork: { badge: "Fieldwork", items: "Collection protocol", verb: "Record findings", glyph: "globe", itemsGlyph: "checklist", submitGlyph: "save", submissionGlyph: "pen" },
	connect: { badge: "Connect", items: "Ways to share it", verb: "Share what happened", glyph: "people", itemsGlyph: "share", submitGlyph: "send", submissionGlyph: "pen" },
	person: { badge: "Person brief", items: "Questions to ask", verb: "Save what you learned", glyph: "person", itemsGlyph: "help", submitGlyph: "send", submissionGlyph: "pen" },
};

/** AudioResponse and VideoResponse compile to a practice task with a capture; their frame says so. */
function taskFrame(node: UiTaskNode): { glyph: GlyphName; kind: string } {
	const capture = node.submission?.capture;
	if (capture) return { glyph: capture.kind === "audio" ? "mic" : "video", kind: capture.kind === "audio" ? "Audio response" : "Video response" };
	return { glyph: TASK_LABEL[node.kind].glyph, kind: TASK_LABEL[node.kind].badge };
}

/** A short time for the head: "Thu 14:00" within a week, otherwise "14 Mar". */
function formatShortSchedule(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return iso;
	const days = (at.getTime() - Date.now()) / 86_400_000;
	return days > -1 && days < 7
		? at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
		: at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatCaptureLimit(seconds: number): string {
	return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** Person briefs list sources where other tasks list grading criteria. */
const CRITERIA_LABEL: Partial<Record<UiTaskNode["kind"], string>> = { person: "Sources", connect: "Keep in mind" };

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

/** Duration and round: the mono meta at the trailing edge of a task's head. */
function TaskMeta({ node }: { node: UiTaskNode }) {
	const capture = node.submission?.capture;
	const meeting = node.kind === "person" && node.dueAt ? node.dueAt : undefined;
	if (node.estimatedMinutes === undefined && node.round === undefined && !capture && !meeting) return null;
	return <span className="task-meta" data-glyph-host>
		{node.round !== undefined ? <span>Round {node.round}</span> : null}
		{meeting ? <span><KeatingGlyph name="calendar" size={13} /><time dateTime={meeting}>{formatShortSchedule(meeting)}</time></span> : null}
		{node.estimatedMinutes !== undefined ? <span><KeatingGlyph name="clock" size={13} />~{node.estimatedMinutes} min</span>
			: capture ? <span><KeatingGlyph name="clock" size={13} />up to {formatCaptureLimit(capture.timeLimitSeconds ?? MAX_RECORDING_SECONDS)}</span> : null}
	</span>;
}

/** "Judged on" criteria (or a person brief's sources) under a section head. */
function TaskCriteria({ node }: { node: UiTaskNode }) {
	if (!node.criteria?.length) return null;
	const sources = node.kind === "person";
	return <section className="lesson-section" data-task-criteria>
		<h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name={sources ? "link" : "target"} size={13} />{CRITERIA_LABEL[node.kind] ?? "Judged on"}</h4>
		<ul className={`lesson-criteria${sources ? " task-sources" : ""}`} data-glyph-host>
			{node.criteria.map((criterion) => <li key={criterion}><KeatingGlyph name={sources ? "link" : "target"} size={13} /><span>{criterion}</span></li>)}
		</ul>
	</section>;
}

/**
 * Work the learner does away from the conversation. The item list is checkable
 * as they go and survives across sessions, so a task can be picked up later;
 * the submission is the one thing that ends it and hands the work back.
 */
export function TaskBrief({ node, framed = false }: { node: UiTaskNode; framed?: boolean }) {
	const overdue = !!node.dueAt && Date.now() > Date.parse(node.dueAt);
	const notYetOpen = !!node.availableFrom && Date.now() < Date.parse(node.availableFrom);
	const brief = <div data-task-brief={node.id} className="lesson-section">
		{notYetOpen || node.dueAt ? <div className="task-schedule">
			{notYetOpen ? <p role="status" className="lesson-status" data-tone="warn">Opens {formatSchedule(node.availableFrom!)} — you can read the brief now.</p> : null}
			{node.dueAt ? <p className={framed && node.kind === "person" ? "lesson-sr" : "lesson-status"} data-tone={overdue ? "bad" : undefined}>{node.kind === "person" ? (overdue ? "Met " : "Meeting ") : overdue ? "Was due " : "Due "}{formatSchedule(node.dueAt)}</p> : null}
		</div> : null}
		{node.kind === "connect" ? <span className="lesson-label">Your idea</span> : null}
		<MarkdownBlock content={node.brief} />
	</div>;
	// Inside its own frame the head carries the title, kind and duration.
	if (framed) return brief;
	return <div className="task-brief">
		<div className="lesson-section-title" data-glyph-host><KeatingGlyph name={taskFrame(node).glyph} size={13} /><span>{node.title}</span><span className="lesson-meta">{taskFrame(node).kind}</span><TaskMeta node={node} /></div>
		{brief}
		<TaskCriteria node={node} />
	</div>;
}

function TaskStep({ item, done, note, noteOpen, locked, terminal, noteDisabled, onToggle, onOpenNote, onNote }: {
	item: NonNullable<UiTaskNode["items"]>[number]; done: boolean; note: string; noteOpen: boolean; locked: boolean; terminal: boolean; noteDisabled: boolean;
	onToggle: () => void; onOpenNote: () => void; onNote: (value: string) => void;
}) {
	// The note is optional, so it opens on demand rather than sitting under every row.
	const canNote = !done && !terminal;
	const showNote = canNote && (noteOpen || note.length > 0);
	return <li data-done={done ? "true" : undefined}>
		<div className="task-step">
			<label className="task-step__check">
				<input type="checkbox" disabled={locked} checked={done} onChange={onToggle} />
				<span><strong>{item.title}</strong>{item.detail ? <small className="lesson-meta">{item.detail}</small> : null}</span>
			</label>
			{canNote && !showNote ? <button type="button" className="lesson-quiet k-bloom" disabled={noteDisabled} aria-label={`Add a note to ${item.title}`} onClick={onOpenNote}><KeatingGlyph name="note" size={13} />Add a note</button> : null}
		</div>
		{item.note ? <small className="lesson-meta task-step__recorded">Recorded: {item.note}</small> : null}
		{showNote ? <input
			className="task-step__note"
			autoFocus={noteOpen && note.length === 0}
			disabled={noteDisabled}
			aria-label={`Note for ${item.title}`}
			placeholder="What happened? (optional)"
			value={note}
			onChange={(event) => onNote(event.currentTarget.value)}
		/> : null}
	</li>;
}

function Task({ documentId, node, receipt, receipts, disabled, onAction }: { documentId: string; node: UiTaskNode; receipt?: UiActionReceipt; receipts: UiActionReceipt[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const submitted = receipt?.action.type === "submit-task" ? receipt.action : undefined;
	const [submission, setSubmission] = useState(() => submitted?.submission ?? "");
	const [attachments, setAttachments] = useState<UiSubmissionAttachment[]>(() => submitted?.attachments ?? []);
	const [uploading, setUploading] = useState(false);
	const [captureBusy, setCaptureBusy] = useState(false);
	const [note, setNote] = useState<Record<string, string>>({});
	const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
	const submissionId = useId();
	type SavedTask = { intent: Extract<SharedUiActionIntent, { type: "submit-task" }>; savedAt: string };
	const [saved, setSaved] = useState<SavedTask>();
	const [saving, setSaving] = useState(false);
	const [restored, setRestored] = useState(false);
	const [saveError, setSaveError] = useState("");
	const storageKey = taskSubmissionKey(documentId, node.id, node.round);
	const draftKey = taskDraftKey(documentId, node.id, node.round);
	const earlierRounds = useEarlierRounds(documentId, node);
	const [draftSaved, setDraftSaved] = useState("");
	const draftEdited = useRef(false);
	useEffect(() => {
		let active = true;
		draftEdited.current = false;
		setDraftSaved(""); setRestored(false); setSaved(undefined);
		void Promise.all([
			localRead<SavedTask>("tasks", storageKey),
			localRead<SavedTaskDraft>("tasks", draftKey).catch(() => undefined),
		]).then(([value, draft]) => {
			if (!active) return;
			setSaved(value);
			setSubmission(value?.intent.submission ?? submitted?.submission ?? draft?.submission ?? "");
			setAttachments(value?.intent.attachments ?? submitted?.attachments ?? []);
			if (!value && !submitted && draft?.savedAt) setDraftSaved(new Date(draft.savedAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}));
			if (!value && !submitted && draft?.notes) setNote(draft.notes);
			setRestored(true);
		}).catch(() => { if (active) { setSaveError("Could not restore local work. Try saving again."); setRestored(true); } });
		return () => { active = false; };
	}, [storageKey]);
	const labels = TASK_LABEL[node.kind];
	const format = node.submission?.format ?? "none";
	const now = Date.now();
	const opensAt = node.availableFrom ? Date.parse(node.availableFrom) : undefined;
	// Scheduling is advisory, not a lock: a late submission is still accepted,
	// because refusing it helps nobody's learning.
	const notYetOpen = opensAt !== undefined && Number.isFinite(opensAt) && now < opensAt;
	const terminal = receipt?.state === "completed" || Boolean(saved);
	// Unsent work is kept on this device so the task can be finished, or printed with answers, later.
	useEffect(() => {
		if (!restored || terminal || !draftEdited.current) return;
		let current = true;
		setDraftSaved("");
		const timer = setTimeout(() => {
			void localWrite("tasks", draftKey, { submission, notes: note, savedAt: new Date().toISOString() } satisfies SavedTaskDraft).then(() => current && setDraftSaved(new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}))).catch(() => undefined);
		}, 600);
		return () => { current = false; clearTimeout(timer); };
	}, [draftKey, note, restored, submission, terminal]);
	const answers = { submission: saved?.intent.submission ?? submitted?.submission ?? submission, notes: note };
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
	const editable = format !== "none" && !terminal;
	const fieldDisabled = disabled || !restored || saving;
	const doneCount = node.items?.filter((item) => itemDone(item.id)).length ?? 0;
	const capture = editable && node.submission?.capture ? <ResponseCapture key={`${storageKey}:${node.submission.capture.kind}:${node.submission.capture.timeLimitSeconds}`} capture={node.submission.capture} disabled={fieldDisabled || uploading || attachments.length >= 10} onBusyChange={setCaptureBusy} onAttach={(file, summary) => {
		setAttachments(current => [...current, file]);
		setSubmission(current => [current.trim(), summary].filter(Boolean).join("\n\n"));
	}} /> : null;

	const frame = taskFrame(node);
	const savedAt = saved?.savedAt ?? (receipt?.state === "completed" ? receipt.updatedAt : undefined);
	const savedFiles = saved?.intent.attachments ?? submitted?.attachments ?? attachments;
	const savedText = saved?.intent.submission ?? submitted?.submission;
	return <LessonFrame glyph={frame.glyph} title={node.title} kind={frame.kind} tools={<span className="task-tools"><TaskMeta node={node} /><PrintAssignmentButton menu node={node} answers={answers}/></span>} data-task={node.id} data-task-kind={node.kind}
		footer={editable ? <>
			<SubmissionAttachments value={attachments} onChange={setAttachments} disabled={fieldDisabled || captureBusy} onBusyChange={setUploading} />
			{draftSaved && <small role="status" className="lesson-foot-meta">Draft saved {draftSaved}</small>}
			<button className="shared-task__submit" type="button" disabled={disabled || !restored || saving || uploading || captureBusy || notYetOpen || (!submission.trim() && !attachments.length)} onClick={submit}><KeatingGlyph name={labels.submitGlyph} size={13} />{saving ? "Saving…" : labels.verb}</button>
		</> : undefined}>
		<TaskBrief node={node} framed />
		<EarlierRounds rounds={earlierRounds.rounds} failed={earlierRounds.failed} onRetry={earlierRounds.retry} />

		{node.items?.length ? <section className="lesson-section" data-task-items>
			<h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name={labels.itemsGlyph} size={13} />{labels.items}<span className="lesson-meta">{doneCount} of {node.items.length} done</span></h4>
			<ul className="lesson-group task-steps">
				{node.items.map((item) => {
					const done = itemDone(item.id);
					return <TaskStep key={item.id} item={item} done={done} note={note[item.id] ?? ""} noteOpen={Boolean(openNotes[item.id])} locked={disabled || terminal} terminal={terminal} noteDisabled={fieldDisabled}
						onToggle={() => onAction?.({
							intent: { type: "complete-task-item", nodeId: node.id, itemId: item.id, completed: !done, ...(note[item.id]?.trim() ? { note: note[item.id]!.trim() } : {}) },
							humanFriendlyMessage: `${done ? "Reopened" : "Completed"}: ${item.title}`,
						})}
						onOpenNote={() => setOpenNotes((current) => ({ ...current, [item.id]: true }))}
						onNote={(value) => { draftEdited.current = true; setNote((current) => ({ ...current, [item.id]: value })); }} />;
				})}
			</ul>
		</section> : null}

		<TaskCriteria node={node} />
		{capture}

		{format === "none" ? null : terminal ? <section className="lesson-section" data-task-submission>
			<h4 role="status" className="lesson-section-title" data-glyph-host><KeatingGlyph name="doc" size={13} />Saved on this device</h4>
			{savedText ? <p className="task-submitted">{savedText}</p> : null}
			<AttachmentLinks className="lesson-rows task-files" attachments={savedFiles} />
			<p className="lesson-status" data-tone="ok">{[savedAt ? `Submitted ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Submitted", savedFiles.length ? `${savedFiles.length} file${savedFiles.length === 1 ? "" : "s"} attached` : ""].filter(Boolean).join(" · ")}</p>
		</section> : <section className="lesson-section" data-task-submission>
			<div className="lesson-section-title" data-glyph-host><KeatingGlyph name={labels.submissionGlyph} size={13} /><label htmlFor={submissionId}>{node.submission?.label ?? "Your submission"}</label>{target ? <span className="lesson-meta">{words} of about {target} words</span> : null}</div>
			{format === "link"
				? <input id={submissionId} type="url" disabled={fieldDisabled} value={submission} placeholder={node.submission?.placeholder ?? "https://"} onChange={(event) => { draftEdited.current = true; setSubmission(event.currentTarget.value); }} />
				: <textarea id={submissionId} className="task-submission" disabled={fieldDisabled} value={submission} placeholder={node.submission?.placeholder ?? "Your work"} onChange={(event) => { draftEdited.current = true; setSubmission(event.currentTarget.value); }} />}
			{format === "text" ? <p data-task-paper-hint className="lesson-hint">Worked on paper? Attach a photo or scan of your pages. The file is kept with your submission, but the tutor only sees its name, so add a line above about what you did.</p> : null}
			{saveError ? <p role="alert" className="lesson-status" data-tone="bad">{saveError}</p> : null}
		</section>}
	</LessonFrame>;
}

function Checklist({ title, nodeId, items, actionType, disabled, onAction }: { title: string; nodeId: string; items: Array<{ id: string; title: string; done: boolean }>; actionType: "complete-goal-step" | "complete-plan-item"; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const done = items.filter((item) => item.done).length;
	return <section className="lesson-section shared-checklist" data-checklist={nodeId}>
		<h4 className="lesson-section-title" data-glyph-host><KeatingGlyph name="checklist" size={13} />{title}<span className="lesson-meta">{done} of {items.length} done</span></h4>
		<ul className="lesson-group shared-checklist__items">
			{items.map((item) => <li key={item.id} data-done={item.done ? "true" : undefined}><label><input disabled={disabled || (actionType === "complete-goal-step" && item.done)} type="checkbox" checked={item.done} onChange={() => onAction?.({ intent: actionType === "complete-goal-step" ? { type: actionType, nodeId, stepId: item.id } : { type: actionType, nodeId, itemId: item.id, completed: !item.done }, humanFriendlyMessage: `${item.done ? "Reopened" : "Completed"}: ${item.title}` })} /><span>{item.title}</span></label></li>)}
		</ul>
	</section>;
}

function Notes({ node, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "notes" }>; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const [value, setValue] = useState(node.value);
	const [savedValue, setSavedValue] = useState(node.value);
	const [savedAt, setSavedAt] = useState<string>();
	// After a save the notes read as text; Edit brings the well back.
	const [editing, setEditing] = useState(true);
	const dirty = value !== savedValue;
	const save = () => {
		if (onAction?.({ intent: { type: "update-notes", nodeId: node.id, value }, humanFriendlyMessage: `Updated ${node.title}` }) === false) return;
		setSavedValue(value);
		setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
		if (value.trim()) setEditing(false);
	};
	return <LessonFrame glyph="note" title={node.title} kind="Notes" data-notes={node.id} tools={<span className="task-meta" data-glyph-host><span><KeatingGlyph name="people" size={13} />You and Keating</span></span>} footer={editing ? <>
		{dirty ? <button type="button" className="lesson-quiet k-bloom" disabled={disabled} onClick={() => setValue(savedValue)}><KeatingGlyph name="x" size={13} />Discard</button> : null}
		<small className="lesson-foot-meta" role="status">{dirty ? "Draft · not saved" : savedAt ? `Saved ${savedAt}` : ""}</small>
		<button disabled={disabled} className="lesson-primary" type="button" onClick={save}><KeatingGlyph name="save" size={13} />Save notes</button>
	</> : <>
		<button type="button" className="lesson-quiet k-bloom" disabled={disabled} onClick={() => setEditing(true)}><KeatingGlyph name="pen" size={13} />Edit</button>
		<small className="lesson-status shared-notes__saved" data-tone="ok" role="status">Saved {savedAt} · Keating can read these</small>
	</>}>
		{editing ? <>
			<label htmlFor={node.id} className="lesson-label">Your notes<span className="lesson-sr">: {node.title}</span></label>
			<textarea disabled={disabled} id={node.id} className="shared-notes__field" value={value} placeholder={node.placeholder} onChange={(event) => setValue(event.currentTarget.value)} />
		</> : <p className="shared-notes__text">{value}</p>}
	</LessonFrame>;
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
	const [bookmarks,toggleBookmark] = useCardBookmarks();
	const [settings,updateSettings] = useKeatingUiSettings();
	const sound = settings.flashcardSoundEnabled;
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
	if (!card || delivered) return <LessonFrame glyph="layers" title={node.title} kind="Flashcards" data-deck={node.id}>
		<CompletionMark detail={`Session complete. ${savedRatings.length || ratings.length} card${(savedRatings.length || ratings.length) === 1 ? "" : "s"} reviewed.`}>Deck complete</CompletionMark>
		<p className="shared-activity__card-note">{node.title}</p>
	</LessonFrame>;
	const rate = (rating: 0 | 1 | 2 | 3) => {
		if (!revealed || disabled || pendingCompletion || ratingLock.current) return;
		ratingLock.current = true;
		playReviewSound(ratingSound(rating), sound);
		const outcome = applyReview(initialSrsState(Date.now()), rating, Date.now());
		const nextRatings = [...ratings, { cardId: card.id, rating, appliedIntervalDays: outcome.appliedIntervalDays, easeAfter: outcome.next.ease }];
		setRatings(nextRatings);
		setLastRating(rating);
		setRevealed(false);
		if (index + 1 === node.cards.length) complete(nextRatings);
		else setIndex(index + 1);
		requestAnimationFrame(() => { ratingLock.current = false; cardButton.current?.focus(); });
	};
	const ratingIcons: GlyphName[] = ["refresh", "bulb", "up", "spark"];
	return <LessonFrame glyph="layers" title={node.title} kind="Flashcards" data-deck={node.id} footer={<>
		<IconButton glyph={sound ? "speaker" : "mute"} label="Card sounds" pressed={sound} onClick={()=>updateSettings({flashcardSoundEnabled:!sound})}/>
		<IconButton glyph="bookmark" label="Keep this card" pressed={bookmarks.has(card.id)} onClick={()=>toggleBookmark(card.id)}/>
		<small>{revealed ? "How easily did it come to you?" : "Think first, then reveal"}</small>
	</>} onKeyDown={(event) => {
		if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || !revealed) return;
		if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
		const rating = Number(event.key) - 1;
		if (rating >= 0 && rating <= 3 && Number.isInteger(rating)) { event.preventDefault(); rate(rating as 0 | 1 | 2 | 3); }
	}}>
		<Meter max={node.cards.length} value={index + 1} tone="ink" label="Card position" valueText={`${index + 1} of ${node.cards.length}`}/>
		<FlashcardTimer timer={revealTimer} disabled={disabled || Boolean(pendingCompletion)} />
		<span className="flashcard-timer-sr" aria-live="polite" aria-atomic="true">{revealed ? `Answer: ${card.back}` : ""}</span>
		<div className="shared-activity__card-stack" key={card.id}>
			<button ref={cardButton} disabled={disabled || Boolean(pendingCompletion)} className="shared-activity__card" data-revealed={revealed} type="button" aria-label={revealed ? "Hide answer" : "Reveal answer"} aria-describedby={`${node.id}-${card.id}-face`} aria-pressed={revealed} onClick={() => {if (!revealed) playReviewSound("flip", sound); setRevealed(!revealed);}}>
				<small>{revealed ? "Answer" : "Recall the answer"}</small>
				<span id={`${node.id}-${card.id}-face`} className="shared-activity__card-content" key={revealed ? "back" : "front"}>{revealed ? card.back : card.front}</span>
				<small><KeatingGlyph name="refresh" size={14} />{revealed ? "Tap to see the prompt" : "Reveal · Space"}</small>
			</button>
		</div>
		{pendingCompletion ? <><p role="status">Final rating is ready to retry.</p><button disabled={disabled} className="shared-activity__primary" type="button" onClick={() => complete(pendingCompletion.ratings, pendingCompletion)}>Retry save deck</button></> : <>
			<div className="shared-activity__ratings" aria-label="Rate your recall">{["Again", "Hard", "Good", "Easy"].map((label, rating) => {
				const glyph = ratingIcons[rating]!;
				return <button disabled={disabled || !revealed} key={label} className="shared-activity__rating" data-rating={rating} type="button" onClick={() => rate(rating as 0 | 1 | 2 | 3)} aria-keyshortcuts={String(rating + 1)}><KeatingGlyph name={glyph} size={14} />{label}<small>{formatInterval(applyReview(initialSrsState(0), rating as 0 | 1 | 2 | 3, 0).appliedIntervalDays)}</small><kbd>{rating + 1}</kbd></button>;
			})}</div>
			<p className="shared-activity__card-note" role="status">{lastRating === undefined || revealed ? "" : lastRating < 2 ? "Marked for more practice. Keep going." : "Got it. On to the next."}</p>
		</>}
	</LessonFrame>;
}

function Resource({ nodeId, title, content, uri, markdown = false, receipt, disabled, onAction }: { nodeId?: string; title: string; content?: string; uri?: string; markdown?: boolean; receipt?: UiActionReceipt; disabled?: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const footer = uri || nodeId ? <>
		{uri ? <a className="lesson-quiet k-bloom" href={uri} target="_blank" rel="noreferrer"><KeatingGlyph name="ext" size={13} />Open resource</a> : null}
		{nodeId ? <SaveControl nodeId={nodeId} title={title} receipt={receipt} disabled={Boolean(disabled)} onAction={onAction} /> : null}
	</> : undefined;
	return <LessonFrame glyph="doc" title={title} kind="Resource" data-resource={nodeId} footer={footer}>
		{content ? markdown ? <MarkdownBlock content={content} /> : <pre className="shared-resource__text">{content}</pre> : null}
	</LessonFrame>;
}

/** Saving is a quiet action; once saved it reads as an ok status. */
function SaveControl({ nodeId, title, receipt, disabled, onAction }: { nodeId: string; title: string; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	if (receipt?.state === "completed") return <p role="status" className="lesson-status shared-save__done" data-tone="ok">Saved to artifacts.</p>;
	return <button className="lesson-quiet k-bloom" type="button" disabled={disabled} onClick={() => onAction?.({ intent: { type: "save-artifact", nodeId }, humanFriendlyMessage: `Saved ${title}` })}><KeatingGlyph name="save" size={13} />Save artifact</button>;
}

const MEDIA_FRAME: Record<string, { glyph: GlyphName; kind: string }> = { audio: { glyph: "speaker", kind: "Audio" }, video: { glyph: "video", kind: "Video" } };

function Media({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "media" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const [failed, setFailed] = useState(() => intentionallyUnavailable(node.resource.uri));
	const frame = MEDIA_FRAME[node.kind];
	if (!frame && failed) return <UnavailableResource title={node.resource.title} uri={node.resource.uri} kind={node.kind}><SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} /></UnavailableResource>;
	if (!frame) return <Resource nodeId={node.id} title={node.resource.title} uri={node.resource.uri} content="Animation opens only from its validated resource URL." receipt={receipt} disabled={disabled} onAction={onAction} />;
	return <LessonFrame glyph={frame.glyph} title={node.resource.title} kind={frame.kind} data-media={node.id} footer={<SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} />}>
		{failed ? <div className="lesson-section" role="status">
			<p className="lesson-status" data-tone="warn">This {node.kind} resource is unavailable here. The lesson remains usable.</p>
			{node.resource.uri && !intentionallyUnavailable(node.resource.uri) ? <a className="lesson-quiet k-bloom" href={node.resource.uri} target="_blank" rel="noreferrer"><KeatingGlyph name="ext" size={13} />Open source</a> : null}
		</div> : node.kind === "audio"
			? <audio className="shared-media__audio" controls src={node.resource.uri} onError={() => setFailed(true)} />
			: <div className="lesson-stage k-grid lesson-bleed shared-media__stage"><video controls src={node.resource.uri} onError={() => setFailed(true)} /></div>}
	</LessonFrame>;
}

function intentionallyUnavailable(uri: string | undefined): boolean {
	if (!uri) return true;
	try {
		return new URL(uri).hostname.endsWith(".invalid");
	} catch {
		return true;
	}
}

/** A missing resource is a warn status, one sentence and a quiet way out, never a box. */
function UnavailableResource({ title, uri, kind, children }: { title: string; uri?: string; kind: string; children?: React.ReactNode }) {
	const source = uri && !intentionallyUnavailable(uri) ? uri : undefined;
	return <div className="shared-unavailable" role="status">
		<p className="lesson-status" data-tone="warn">{title}</p>
		<p className="shared-unavailable__note">This {kind} resource is unavailable here. The lesson remains usable.</p>
		{source || children ? <div className="shared-unavailable__actions">
			{source ? <a className="lesson-quiet k-bloom" href={source} target="_blank" rel="noreferrer"><KeatingGlyph name="ext" size={13} />Open source</a> : null}
			{children}
		</div> : null}
	</div>;
}

function RemoteImage({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "image" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const src = node.resource.uri;
	if (!src || intentionallyUnavailable(src)) return <UnavailableResource title={node.resource.title} uri={src} kind="image"><SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} /></UnavailableResource>;
	return <LessonImage src={src} alt={node.alt ?? node.resource.title} title={node.resource.title} actions={<SaveControl nodeId={node.id} title={node.resource.title} receipt={receipt} disabled={disabled} onAction={onAction} />} />;
}

function Handoff({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "handoff" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const completed = receipt?.state === "completed";
	const commit = () => !disabled && (completed || onAction?.({ intent: { type: "open-handoff", nodeId: node.id }, humanFriendlyMessage: `Opened ${node.target} handoff` }) !== false);
	return <LessonFrame glyph={node.target === "web" ? "ext" : "screen"} title={`Continue on ${node.target}`} kind="Continue elsewhere" data-handoff={node.id} footer={<>
		{completed ? <p role="status" className="lesson-status" data-tone="ok">Handoff recorded.</p> : null}
		{node.target === "web"
			? <a className="lesson-primary" href="/" onClick={(event) => { if (!commit()) event.preventDefault(); }}><KeatingGlyph name="ext" size={13} />Open Keating web</a>
			: <button className="lesson-primary" type="button" disabled={disabled || completed} onClick={commit}><KeatingGlyph name="screen" size={13} />Open {node.target} handoff</button>}
	</>}>
		<p className="shared-handoff__reason">{node.reason}</p>
		<p className="lesson-hint">{node.context}</p>
	</LessonFrame>;
}
