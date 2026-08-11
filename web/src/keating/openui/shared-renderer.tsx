import { useEffect, useRef, useState } from "react";
import type { UiActionReceipt, UiDocument, UiDocumentNode, UiQuestion, UiQuestionGroupResponse, UiStudyPlanItem } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import { MarkdownBlock } from "../../components/MarkdownBlock";
import { MermaidRenderer } from "../../components/MermaidRenderer";
import { applyReview, initialSrsState } from "../srs";
import type { SharedUiActionIntent } from "./shared-actions";

export interface SharedUiActionEvent {
	intent: SharedUiActionIntent;
	humanFriendlyMessage: string;
}

const panel = css({ marginBlock: "0.75rem", display: "grid", gap: "0.75rem", border: "1px solid var(--border)", borderRadius: "0.75rem", background: "var(--background)", padding: "1rem" });
const section = css({ display: "grid", gap: "0.625rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", _first: { borderTop: "none", paddingTop: 0 } });
const button = css({ minHeight: "2.5rem", border: "1px solid var(--border)", borderRadius: "0.5rem", paddingInline: "0.75rem", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", _hover: { background: "var(--muted)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" } });
const input = css({ width: "100%", minHeight: "2.5rem", border: "1px solid var(--border)", borderRadius: "0.5rem", background: "var(--background)", padding: "0.625rem", color: "var(--foreground)" });

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
		{document.nodes.map((node) => <SharedNode key={node.id} node={node} receipts={receipts} disabled={!interactive} onAction={onAction} />)}
	</section>;
}

function SharedNode({ node, receipts, disabled, onAction }: { node: UiDocumentNode; receipts: UiActionReceipt[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	if (node.type === "markdown") return <div className={section}><MarkdownBlock content={node.markdown} /></div>;
	if (node.type === "callout") return <aside className={css({ display: "grid", gap: "0.625rem", borderTop: "1px solid var(--border)", borderLeft: "3px solid var(--primary)", paddingTop: "0.75rem", paddingLeft: "0.75rem" })} data-callout-tone={node.tone}>
		<strong>{node.title ?? node.tone}</strong><MarkdownBlock content={node.markdown} />
	</aside>;
	if (node.type === "question") return <Question node={node} receipt={completedNodeReceipt(receipts, node.id, ["submit-answer", "choose-option"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "question-group") return <QuestionGroup node={node} receipt={completedNodeReceipt(receipts, node.id, ["submit-question-group"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "quiz") return <Quiz node={node} receipt={completedNodeReceipt(receipts, node.id, ["complete-quiz"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "goal") return <Checklist title={node.title} nodeId={node.id} items={node.steps.map((step) => ({ id: step.id, title: step.title, done: step.status === "done" }))} actionType="complete-goal-step" disabled={disabled} onAction={onAction} />;
	if (node.type === "deck") return <Deck node={node} receipts={receipts.filter((receipt) => receipt.state === "completed" && ((receipt.action.type === "rate-card" || receipt.action.type === "complete-deck") && receipt.action.nodeId === node.id))} disabled={disabled} onAction={onAction} />;
	if (node.type === "study-plan") return node.items ? <Plan nodeId={node.id} title={node.title ?? "Study plan"} overview={node.overview} items={node.items} disabled={disabled} onAction={onAction} /> : <Resource nodeId={node.id} title={node.resource?.title ?? "Study plan"} content={node.resource?.content} uri={node.resource?.uri} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "artifact") return <Resource nodeId={node.id} title={node.resource.title} content={node.resource.content} uri={node.resource.uri} markdown={node.resource.format === "markdown"} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
	if (node.type === "concept-map") return <div className={section}>{node.title ? <h4 className={css({ fontWeight: 700 })}>{node.title}</h4> : null}<MermaidRenderer content={node.source} /></div>;
	if (node.type === "notes") return <Notes node={node} disabled={disabled} onAction={onAction} />;
	if (node.type === "image") return <RemoteImage node={node} receipt={completedNodeReceipt(receipts, node.id, ["save-artifact"])} disabled={disabled} onAction={onAction} />;
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

function responseForQuestion(node: UiQuestion, answer: string, selected: string[], blankAnswers: string[], rowSelections: string[], rowReasons: string[]): UiQuestionGroupResponse {
	if (node.kind === "classification" || node.kind === "matching") return {
		questionId: node.id,
		type: "rows",
		rows: (node.items ?? []).map((item, index) => ({ item, optionId: rowSelections[index] ?? "", ...(node.requireReasons ? { reason: rowReasons[index] ?? "" } : {}) })),
	};
	if (node.kind === "blanks" || node.kind === "fill_in") return { questionId: node.id, type: "blanks", answers: blankAnswers };
	if (node.choices) return { questionId: node.id, type: "choice", optionIds: selected, ...(node.allowText ? { text: answer } : {}) };
	return { questionId: node.id, type: "text", answer };
}

function responseReady(node: UiQuestion, answer: string, selected: string[], blankAnswers: string[], rowSelections: string[], rowReasons: string[]): boolean {
	if (node.kind === "classification" || node.kind === "matching") return rowSelections.length > 0 && rowSelections.every(Boolean) && (!node.requireReasons || rowReasons.every((reason) => reason.trim().length > 0));
	if (node.kind === "blanks" || node.kind === "fill_in") return blankAnswers.length > 0 && blankAnswers.every((entry) => entry.trim().length > 0);
	if (node.choices) return selected.length > 0 || (node.allowText === true && answer.trim().length > 0);
	return answer.trim().length > 0;
}

function answerForQuizResponse(response: UiQuestionGroupResponse): string {
	if (response.type === "text") return response.answer;
	if (response.type === "choice") return response.optionIds.join(",") || (response.text ?? "");
	if (response.type === "blanks") return response.answers.join(",");
	return response.rows.map((row) => `${row.item}:${row.optionId}${row.reason ? ` (${row.reason})` : ""}`).join("; ");
}

function quizResponseForAnswer(question: UiQuestion, answer: string): UiQuestionGroupResponse {
	if (question.kind === "blanks" || question.kind === "fill_in") return { questionId: question.id, type: "blanks", answers: answer ? answer.split(",") : [] };
	if (question.choices) return { questionId: question.id, type: "choice", optionIds: answer ? answer.split(",") : [] };
	return { questionId: question.id, type: "text", answer };
}

function Question({ node, receipt, disabled, onAction, groupResponse, hideSubmit = false, completed: completedOverride = false, onResponseChange }: { node: UiQuestion; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean; groupResponse?: UiQuestionGroupResponse; hideSubmit?: boolean; completed?: boolean; onResponseChange?: (response: UiQuestionGroupResponse, ready: boolean) => void }) {
	const savedAction = receipt?.action;
	const savedAnswer = savedAction?.type === "submit-answer" ? savedAction.answer : undefined;
	const initialRows = groupResponse?.type === "rows" ? groupResponse.rows : undefined;
	const initialBlanks = groupResponse?.type === "blanks" ? groupResponse.answers : undefined;
	const initialSelected = groupResponse?.type === "choice" ? groupResponse.optionIds : undefined;
	const initialText = groupResponse?.type === "text" ? groupResponse.answer : groupResponse?.type === "choice" ? groupResponse.text : undefined;
	const savedRows = Array.isArray(savedAnswer) && savedAnswer.every((entry) => typeof entry === "object")
		? savedAnswer as Array<{ item: string; optionId: string; reason?: string }>
		: undefined;
	const [answer, setAnswer] = useState(() => initialText ?? (typeof savedAnswer === "string" ? savedAnswer : ""));
	const [selected, setSelected] = useState<string[]>(() => initialSelected ?? (savedAction?.type === "choose-option" ? [...savedAction.optionIds] : []));
	const [rowSelections, setRowSelections] = useState<string[]>(() => node.items?.map((item) => initialRows?.find((row) => row.item === item)?.optionId ?? savedRows?.find((row) => row.item === item)?.optionId ?? "") ?? []);
	const [rowReasons, setRowReasons] = useState<string[]>(() => node.items?.map((item) => initialRows?.find((row) => row.item === item)?.reason ?? savedRows?.find((row) => row.item === item)?.reason ?? "") ?? []);
	const blankCount = node.blanks?.length ?? (node.prompt.match(/_{3,}|\{\{blank\}\}/g)?.length ?? 0);
	const [blankAnswers, setBlankAnswers] = useState<string[]>(() => initialBlanks ?? (Array.isArray(savedAnswer) && savedAnswer.every((entry) => typeof entry === "string")
		? [...savedAnswer]
		: Array.from({ length: blankCount }, () => "")));
	const multiple = node.multiSelect || node.kind === "multi_select";
	const rows = node.kind === "classification" || node.kind === "matching";
	const blanks = node.kind === "blanks" || node.kind === "fill_in";
	const payload = rows
		? (node.items ?? []).map((item, index) => ({ item, optionId: rowSelections[index] ?? "", ...(node.requireReasons ? { reason: rowReasons[index] ?? "" } : {}) }))
		: blanks ? blankAnswers : node.choices ? selected : answer;
	const ready = responseReady(node, answer, selected, blankAnswers, rowSelections, rowReasons);
	const completed = receipt?.state === "completed" || completedOverride;
	const groupValue = responseForQuestion(node, answer, selected, blankAnswers, rowSelections, rowReasons);
	useEffect(() => {
		onResponseChange?.(groupValue, ready);
	}, [groupValue, onResponseChange, ready]);
	const submit = () => onAction?.({
		intent: node.choices && !rows
			? { type: "choose-option", nodeId: node.id, optionIds: selected }
			: { type: "submit-answer", nodeId: node.id, answer: payload },
		humanFriendlyMessage: `Answered: ${node.prompt}`,
	});
	return <fieldset className={section} data-question-kind={node.kind ?? "text"}>
		<legend className={css({ fontWeight: 650 })}>{node.header ?? node.prompt}</legend>
		{node.header ? <p>{node.prompt}</p> : null}
		{rows ? <div className={css({ display: "grid", gap: "0.75rem" })}>{node.items?.map((item, rowIndex) => <div key={`${node.id}-${rowIndex}`} className={css({ display: "grid", gap: "0.375rem", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.625rem" })}>
			<strong>{item}</strong>
			<select disabled={disabled || completed} className={input} aria-label={`${node.choiceLabel ?? "Choice"} for ${item}`} value={rowSelections[rowIndex]} onChange={(event) => setRowSelections((current) => current.map((value, index) => index === rowIndex ? event.currentTarget.value : value))}><option value="">Select…</option>{node.choices?.map((choice) => <option key={choice.id} value={choice.id} disabled={node.kind === "matching" && node.uniqueMatches !== false && rowSelections.some((selected, index) => index !== rowIndex && selected === choice.id)}>{choice.label}</option>)}</select>
			{node.requireReasons ? <input disabled={disabled || completed} className={input} aria-label={`${node.reasonLabel ?? "Reason"} for ${item}`} value={rowReasons[rowIndex]} onChange={(event) => setRowReasons((current) => current.map((value, index) => index === rowIndex ? event.currentTarget.value : value))} placeholder={node.reasonLabel ?? "Reason"} /> : null}
		</div>)}</div>
			: blanks ? <div className={css({ display: "grid", gap: "0.375rem" })}>{blankAnswers.map((value, index) => <input disabled={disabled || completed} key={`${node.id}-blank-${index}`} className={input} aria-label={`Blank ${index + 1}`} value={value} onChange={(event) => setBlankAnswers((current) => current.map((entry, entryIndex) => entryIndex === index ? event.currentTarget.value : entry))} placeholder={node.blanks?.[index]?.placeholder ?? `Blank ${index + 1}`} />)}</div>
				: node.choices ? <div className={css({ display: "grid", gap: "0.375rem" })}>{node.choices.map((choice) => <label key={choice.id} className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}><input disabled={disabled || completed} type={multiple ? "checkbox" : "radio"} name={node.id} checked={selected.includes(choice.id)} onChange={() => setSelected((current) => multiple ? current.includes(choice.id) ? current.filter((id) => id !== choice.id) : [...current, choice.id] : [choice.id])} />{choice.label}</label>)}{node.allowText ? <textarea disabled={disabled || completed} className={input} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} placeholder="Or explain your own answer" /> : null}</div>
					: node.kind === "slider" ? <div className={css({ display: "grid", gap: "0.375rem" })}><input disabled={disabled || completed} type="range" min={node.min ?? 0} max={node.max ?? 100} step={node.step ?? 1} value={answer || node.min || 0} onChange={(event) => setAnswer(event.currentTarget.value)} /><output>{answer || node.min || 0}</output></div>
						: <textarea disabled={disabled || completed} className={input} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} placeholder="Type your answer" />}
		{node.hint ? <small>{node.hint}</small> : null}
		{completed ? !hideSubmit ? <p role="status">Answer saved.</p> : null : !hideSubmit ? <button className={button} type="button" disabled={disabled || !ready} onClick={submit}>Submit answer</button> : null}
	</fieldset>;
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
	return <div className={section} data-question-group={node.id}>
		{node.title ? <h4 className={css({ fontWeight: 700 })}>{node.title}</h4> : null}
		{node.intro ? <p>{node.intro}</p> : null}
		{node.questions.map((question) => <Question key={question.id} node={question} disabled={disabled} hideSubmit completed={completed} groupResponse={responses[question.id]} onResponseChange={update} />)}
		{completed ? <p role="status">Answers saved.</p> : <button className={button} type="button" disabled={disabled || !canSubmit} onClick={() => onAction?.({ intent: { type: "submit-question-group", nodeId: node.id, responses: ordered }, humanFriendlyMessage: `Answered ${node.questions.length} questions${node.topic ? ` about ${node.topic}` : ""}` })}>Submit answers</button>}
	</div>;
}

function quizOpenEnded(question: UiQuestion): boolean {
	return question.kind === "short_answer" || question.kind === "transfer" || (question.kind === "fill_in" && !question.blanks?.length);
}

function quizCredit(question: UiQuestion, answer: string): number | undefined {
	if (quizOpenEnded(question) || (!question.correctAnswer && !question.correctAnswers?.length)) return undefined;
	if (question.kind === "multi_select") {
		const actual = answer.split(",").filter(Boolean).sort();
		const expected = [...(question.correctAnswers ?? [])].sort();
		return actual.length === expected.length && actual.every((value, index) => value === expected[index]) ? 1 : 0;
	}
	if (question.kind === "fill_in" && question.blanks?.length) {
		const actual = answer.split(",").map((value) => value.trim().toLocaleLowerCase());
		const expected = (question.correctAnswers ?? [question.correctAnswer ?? ""]).map((value) => value.trim().toLocaleLowerCase());
		return actual.length === expected.length && actual.every((value, index) => value === expected[index]) ? 1 : 0;
	}
	return answer.trim().toLocaleLowerCase() === (question.correctAnswer ?? question.correctAnswers?.[0] ?? "").trim().toLocaleLowerCase() ? 1 : 0;
}

function Quiz({ node, receipt, disabled, onAction }: { node: Extract<UiDocumentNode, { type: "quiz" }>; receipt?: UiActionReceipt; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const saved = receipt?.action.type === "complete-quiz" ? receipt.action : undefined;
	const [responses, setResponses] = useState<Record<string, UiQuestionGroupResponse>>(() => Object.fromEntries((saved?.answers ?? []).flatMap((answer) => {
		const question = node.questions.find((candidate) => candidate.id === answer.questionId);
		return question ? [[answer.questionId, quizResponseForAnswer(question, answer.answer)] as const] : [];
	})));
	const [ready, setReady] = useState<Record<string, boolean>>(() => Object.fromEntries((saved?.answers ?? []).map((answer) => [answer.questionId, true])));
	const startedAt = useRef(Date.now());
	const firstAnswerAt = useRef<Record<string, number>>({});
	const [pendingCompletion, setPendingCompletion] = useState<Extract<SharedUiActionIntent, { type: "complete-quiz" }>>();
	const [delivered, setDelivered] = useState(false);
	const completed = receipt?.state === "completed";
	const update = (response: UiQuestionGroupResponse, isReady: boolean) => {
		setResponses((current) => current[response.questionId] && JSON.stringify(current[response.questionId]) === JSON.stringify(response) ? current : { ...current, [response.questionId]: response });
		setReady((current) => current[response.questionId] === isReady ? current : { ...current, [response.questionId]: isReady });
		if (isReady && firstAnswerAt.current[response.questionId] === undefined) firstAnswerAt.current[response.questionId] = Math.max(0, Date.now() - startedAt.current);
	};
	const answers = node.questions.flatMap((question) => responses[question.id] ? [{ questionId: question.id, answer: answerForQuizResponse(responses[question.id]!) }] : []);
	const canSubmit = answers.length === node.questions.length && node.questions.every((question) => ready[question.id]);
	const buildCompletion = (): Extract<SharedUiActionIntent, { type: "complete-quiz" }> => {
		const credits = Object.fromEntries(node.questions.flatMap((question) => {
			const answer = answers.find((candidate) => candidate.questionId === question.id)?.answer ?? "";
			const credit = quizCredit(question, answer);
			return credit === undefined ? [] : [[question.id, credit] as const];
		}));
		const score = Object.values(credits).filter((credit) => credit === 1).length;
		const partialCreditPoints = Object.values(credits).reduce((total, credit) => total + credit, 0);
		return { type: "complete-quiz", nodeId: node.id, resultId: `${node.id}-result`, answers, score, partialCreditPoints, partialCredits: credits, timing: { totalMs: Math.max(0, Date.now() - startedAt.current), perQuestionMs: Object.fromEntries(node.questions.map((question) => [question.id, firstAnswerAt.current[question.id] ?? 0])) }, flaggedQuestionIds: [], pendingGradeQuestionIds: node.questions.filter((question) => quizCredit(question, answers.find((candidate) => candidate.questionId === question.id)?.answer ?? "") === undefined).map((question) => question.id), skippedQuestionIds: [] };
	};
	const submit = () => {
		const attempt = retryableAggregateAttempt(pendingCompletion, buildCompletion, (intent) => Boolean(onAction?.({ intent, humanFriendlyMessage: `Completed ${node.title}` })));
		if (attempt.pending !== pendingCompletion) setPendingCompletion(attempt.pending);
		if (attempt.delivered) setDelivered(true);
	};
	const terminal = completed || delivered;
	return <div className={section} data-quiz={node.id}><h4 className={css({ fontWeight: 700 })}>{node.title}</h4>{node.questions.map((question) => <Question key={question.id} node={question} disabled={disabled || Boolean(pendingCompletion)} hideSubmit completed={terminal} groupResponse={responses[question.id]} onResponseChange={update} />)}{terminal ? <p role="status">Quiz saved.</p> : <><button className={button} type="button" disabled={disabled || (!pendingCompletion && !canSubmit)} onClick={submit}>{pendingCompletion ? "Retry save quiz" : "Submit quiz"}</button>{pendingCompletion ? <p role="status">Quiz completion is ready to retry.</p> : null}</>}</div>;
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
	if (!card || delivered) return <div className={section}><h4 className={css({ fontWeight: 700 })}>{node.title}</h4><p role="status">Session complete. {savedRatings.length || ratings.length} card{(savedRatings.length || ratings.length) === 1 ? "" : "s"} reviewed.</p></div>;
	const rate = (rating: 0 | 1 | 2 | 3) => {
		const outcome = applyReview(initialSrsState(Date.now()), rating, Date.now());
		const nextRatings = [...ratings, { cardId: card.id, rating, appliedIntervalDays: outcome.appliedIntervalDays, easeAfter: outcome.next.ease }];
		setRatings(nextRatings);
		setRevealed(false);
		if (index + 1 === node.cards.length) {
			complete(nextRatings);
		} else setIndex(index + 1);
	};
	return <div className={section} data-deck={node.id}><h4 className={css({ fontWeight: 700 })}>{node.title}</h4><small>{ratings.length}/{node.cards.length} reviewed.</small><button disabled={disabled || Boolean(pendingCompletion)} className={button} type="button" onClick={() => setRevealed((value) => !value)}>{revealed ? card.back : card.front}</button>{pendingCompletion ? <><p role="status">Final rating is ready to retry.</p><button disabled={disabled} className={button} type="button" onClick={() => complete(pendingCompletion.ratings, pendingCompletion)}>Retry save deck</button></> : revealed ? <div className={css({ display: "flex", flexWrap: "wrap", gap: "0.375rem" })}>{["Again", "Hard", "Good", "Easy"].map((label, rating) => <button disabled={disabled} key={label} className={button} type="button" onClick={() => rate(rating as 0 | 1 | 2 | 3)}>{label}</button>)}</div> : null}</div>;
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
