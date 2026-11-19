import type { UiActionReceipt, UiDocumentNode, UiQuestion } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import { MarkdownBlock } from "../MarkdownBlock";
import { focusRing, muted } from "./SessionWorkspaceView";

/**
 * Still previews of materials the learner works on in the conversation. The
 * live quiz and deck renderers run a clock and accept answers; shown a second
 * time in the panel they look answerable and are not. These show what the
 * material contains and leave the doing to the chat card.
 */

type QuizNode = Extract<UiDocumentNode, { type: "quiz" }>;
type DeckNode = Extract<UiDocumentNode, { type: "deck" }>;

const card = "h1-material-preview-row";
const list = css({ display: "flex", flexDirection: "column", gap: "0.5rem", listStyle: "none", margin: 0, padding: 0, minWidth: 0 });
const prose = css({ fontSize: "0.875rem", lineHeight: 1.5, overflowWrap: "anywhere", minWidth: 0, "& p": { margin: 0 } });
const reveal = css({
	fontSize: "0.8125rem", lineHeight: 1.45,
	"& > summary": { cursor: "pointer", fontWeight: 600, color: "var(--muted-foreground)", borderRadius: "0.25rem", width: "fit-content", ...focusRing },
	"& > summary:hover": { color: "var(--foreground)" },
	"&[open] > summary": { marginBottom: "0.375rem" },
});

const QUESTION_KIND: Record<NonNullable<UiQuestion["kind"]>, string> = {
	choice: "Multiple choice", multiple_choice: "Multiple choice", multi_select: "Choose all that apply", true_false: "True or false", dropdown: "Choose one",
	text: "Written answer", short_answer: "Short answer", transfer: "Apply it", blanks: "Fill in the blanks", fill_in: "Fill in the blank",
	classification: "Sort into groups", matching: "Match", ordering: "Put in order", slider: "Pick a value",
};

function questionKind(question: UiQuestion): string {
	if (question.kind) return QUESTION_KIND[question.kind];
	return question.choices?.length ? "Multiple choice" : "Written answer";
}

/** True once the learner has finished the quiz in the conversation. */
export function quizCompleted(receipts: readonly UiActionReceipt[], nodeId: string): boolean {
	return receipts.some((receipt) => receipt.action.type === "complete-quiz" && receipt.action.nodeId === nodeId
		&& (receipt.state === "accepted" || receipt.state === "completed"));
}

function referenceAnswer(question: UiQuestion): string | null {
	const answers = question.correctAnswers?.length ? question.correctAnswers : question.correctAnswer ? [question.correctAnswer] : [];
	if (!answers.length) return null;
	// Choice answers are stored as option ids; show what the learner saw.
	return answers.map((answer) => question.choices?.find((choice) => choice.id === answer)?.label ?? answer).join("; ");
}

/** The questions as a list. Answers stay hidden until the learner has finished the quiz. */
export function QuizPreview({ node, completed }: { node: QuizNode; completed: boolean }) {
	const count = node.questions.length;
	return <div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 0 })} data-material-preview="quiz">
		<p className={muted}>
			{count} {count === 1 ? "question" : "questions"}{node.mode === "exam" ? " · exam" : ""}.
			{completed ? " You finished this one, so the answers are available below." : " Answers appear here after you finish it in the conversation."}
		</p>
		<ol className={list}>
			{node.questions.map((question, index) => {
				const answer = completed ? referenceAnswer(question) : null;
				return <li key={question.id} className={card}>
					<span className={muted}>Question {index + 1} · {questionKind(question)}</span>
					<div className={prose}><MarkdownBlock content={question.prompt} /></div>
					{question.choices?.length ? <ul className={css({ display: "flex", flexDirection: "column", gap: "0.125rem", margin: 0, paddingLeft: "1.125rem", fontSize: "0.8125rem", lineHeight: 1.45, listStyle: "disc", overflowWrap: "anywhere" })}>
						{question.choices.map((choice) => <li key={choice.id}>{choice.label}</li>)}
					</ul> : null}
					{answer || (completed && question.explanation) ? <details className={reveal}>
						<summary>Show answer</summary>
						{answer ? <p className={css({ fontWeight: 600, overflowWrap: "anywhere" })}>{answer}</p> : null}
						{question.explanation ? <div className={prose}><MarkdownBlock content={question.explanation} /></div> : null}
					</details> : null}
				</li>;
			})}
		</ol>
	</div>;
}

/** Cards to flip through. Looking here never changes the review schedule. */
export function DeckPreview({ node }: { node: DeckNode }) {
	const count = node.cards.length;
	return <div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 0 })} data-material-preview="deck">
		{node.description ? <div className={prose}><MarkdownBlock content={node.description} /></div> : null}
		<p className={muted}>{count} {count === 1 ? "card" : "cards"}. Flip through them here; your review schedule only changes when you review the deck in the conversation.</p>
		<ol className={list}>
			{node.cards.map((entry, index) => <li key={entry.id} className={card}>
				<span className={muted}>Card {index + 1}</span>
				<div className={prose}><MarkdownBlock content={entry.front} /></div>
				<details className={reveal}>
					<summary>Show the back</summary>
					<div className={prose}><MarkdownBlock content={entry.back} /></div>
				</details>
			</li>)}
		</ol>
	</div>;
}
