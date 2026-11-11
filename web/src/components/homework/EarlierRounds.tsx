import { createContext, useContext, useEffect, useState } from "react";
import type { UiTaskNode } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import { MarkdownBlock } from "../MarkdownBlock";
import { AttachmentLinks } from "../SubmissionAttachments";
import type { AssignmentRound } from "../../keating/homework/open-assignments";

/**
 * Where a task card finds the rounds before the one it shows. Earlier rounds
 * live in earlier messages (other documents), so the card asks storage; a
 * test or story can supply them synchronously through `peek`.
 */
export interface HomeworkRoundsSource {
	peek?(documentId: string, node: UiTaskNode): AssignmentRound[] | undefined;
	load(documentId: string, node: UiTaskNode): Promise<AssignmentRound[]>;
}

const defaultSource: HomeworkRoundsSource = {
	async load(documentId, node) {
		const { loadEarlierRounds } = await import("../../keating/homework/load-assignments");
		const entry = await loadEarlierRounds(documentId, node.id);
		if (!entry) return [];
		const currentRound = node.round ?? 1;
		return entry.earlierRounds.filter((round) => round.round < currentRound && round.documentId !== documentId);
	},
};

export const HomeworkRoundsContext = createContext<HomeworkRoundsSource>(defaultSource);

/** Earlier rounds of this task, empty for a first round. */
export interface EarlierRoundsState {
	rounds: AssignmentRound[];
	/** The earlier rounds could not be read. They are not lost; the learner can try again. */
	failed: boolean;
	retry(): void;
}

export function useEarlierRounds(documentId: string, node: UiTaskNode): EarlierRoundsState {
	const source = useContext(HomeworkRoundsContext);
	const revising = (node.round ?? 1) > 1;
	const [rounds, setRounds] = useState<AssignmentRound[]>(() => revising ? source.peek?.(documentId, node) ?? [] : []);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		if (!revising) return;
		let active = true;
		setFailed(false);
		void source.load(documentId, node)
			.then((value) => { if (active) setRounds(value); })
			.catch(() => { if (active) setFailed(true); });
		return () => { active = false; };
	}, [documentId, node.id, node.round, revising, source, attempt]);
	return { rounds, failed, retry: () => setAttempt((value) => value + 1) };
}

const FEEDBACK_PREVIEW = 4_000;
const moreButton = css({ minHeight: "2.75rem", paddingInline: "0.75rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", _hover: { borderColor: "var(--ink)" }, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } });

/** Long feedback is shortened for scanning, with the whole of it one press away. */
function Feedback({ text }: { text: string }) {
	const long = text.length > FEEDBACK_PREVIEW;
	const [full, setFull] = useState(false);
	return <div className={css({ display: "grid", gap: "0.375rem", justifyItems: "start", fontSize: "0.8125rem" })}>
		<div className={css({ minWidth: 0, maxWidth: "100%" })}><MarkdownBlock content={long && !full ? `${text.slice(0, FEEDBACK_PREVIEW - 1)}…` : text} /></div>
		{long ? <button type="button" className={moreButton} aria-expanded={full} onClick={() => setFull((value) => !value)}>{full ? "Show less" : "Show full feedback"}</button> : null}
	</div>;
}

function when(at: number): string {
	return at ? new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "an earlier time";
}

const quote = css({ margin: 0, borderLeft: "3px solid var(--border)", paddingLeft: "0.625rem", fontSize: "0.8125rem", color: "var(--foreground)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
const label = css({ fontSize: "0.75rem", fontWeight: 650, color: "var(--muted-foreground)" });

/**
 * What the learner handed in each earlier round and how the tutor replied,
 * collapsed above the current round so a revision starts from the feedback.
 */
export function EarlierRounds({ rounds, failed = false, onRetry }: { rounds: readonly AssignmentRound[]; failed?: boolean; onRetry?: () => void }) {
	if (!rounds.length && !failed) return null;
	return <div data-task-earlier-rounds className={css({ display: "grid", gap: "0.375rem" })}>
		{failed ? <p role="alert" className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", margin: 0, fontSize: "0.8125rem" })}>
			Your earlier rounds could not be loaded. Nothing was deleted.
			{onRetry ? <button type="button" className={moreButton} onClick={onRetry}>Try again</button> : null}
		</p> : null}
		{rounds.map((round) => <details key={`${round.documentId}:${round.round}`} className={css({ border: "1px solid var(--border)", borderRadius: "{radii.keating}", padding: "0.5rem 0.625rem" })}>
			<summary className={css({ cursor: "pointer", fontSize: "0.8125rem", fontWeight: 650, minHeight: "2rem", display: "flex", alignItems: "center", _focusVisible: { outline: "3px solid var(--primary)", outlineOffset: "2px", borderRadius: "0.25rem" } })}>
				Round {round.round}: {round.submission ? round.feedback ? "your work and the tutor's feedback" : "your work, no reply recorded yet" : "not handed in"}
			</summary>
			<div className={css({ display: "grid", gap: "0.5rem", paddingTop: "0.5rem" })}>
				{round.submission ? <div className={css({ display: "grid", gap: "0.25rem" })}>
					<span className={label}>You handed in, {when(round.submission.submittedAt)}</span>
					{round.submission.text ? <blockquote className={quote}>{round.submission.text}</blockquote> : null}
					{round.submission.attachments.length ? <AttachmentLinks attachments={round.submission.attachments} /> : null}
				</div> : <p className={css({ fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>No submission was recorded for this round on this device.</p>}
				{round.feedback ? <div className={css({ display: "grid", gap: "0.25rem" })}>
					<span className={label}>Tutor's reply, {when(round.feedback.at)}</span>
					<Feedback text={round.feedback.text} />
				</div> : null}
			</div>
		</details>)}
	</div>;
}
