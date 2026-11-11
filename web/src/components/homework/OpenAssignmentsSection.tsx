import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, MessageSquareText } from "lucide-react";
import { css } from "../../../styled-system/css";
import {
	ASSIGNMENT_STATUS_LABEL,
	describeDue,
	nextStepLabel,
	type AssignmentEntry,
} from "../../keating/homework/open-assignments";
import { PrintAssignmentButton } from "./PrintAssignmentButton";

const KIND_LABEL: Record<AssignmentEntry["kind"], string> = {
	assignment: "Assignment",
	practice: "Practice",
	draft: "Draft",
	fieldwork: "Fieldwork",
	connect: "Connect",
	person: "Person brief",
};

const ITEM_NOUN: Record<AssignmentEntry["kind"], string> = {
	assignment: "steps",
	practice: "exercises",
	draft: "steps",
	fieldwork: "protocol steps",
	connect: "ways to share",
	person: "questions",
};

const styles = {
	section: css({ mt: "1.25rem", border: "2px solid var(--ink)", bg: "var(--card)", color: "var(--ink)" }),
	head: css({ display: "flex", flexDir: "column", gap: "0.25rem", borderBottom: "1px solid var(--ink)", p: "1rem", md: { px: "1.25rem" } }),
	title: css({ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: "var(--mono-display)", fontSize: "1.125rem", fontWeight: 700 }),
	copy: css({ maxW: "66ch", fontSize: "0.75rem", lineHeight: "1.2rem", color: "var(--ink-soft)" }),
	list: css({ display: "grid", gap: "0.75rem", m: 0, p: "0.75rem", listStyle: "none", md: { p: "1rem" } }),
	row: css({ display: "grid", gap: "0.5rem", minW: 0, border: "1px solid var(--ink)", borderRadius: "0.25rem", bg: "var(--paper)", p: "0.75rem", _focusWithin: { outline: "2px solid var(--accent)", outlineOffset: "1px" } }),
	rowHead: css({ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.375rem 0.5rem", minW: 0 }),
	kind: css({ border: "1px solid var(--ink)", borderRadius: "9999px", px: "0.45rem", py: "0.1rem", fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }),
	rowTitle: css({ flex: "1 1 12rem", minW: 0, overflowWrap: "anywhere", fontFamily: "var(--mono-display)", fontSize: "0.9375rem", fontWeight: 700, lineHeight: "1.3rem" }),
	ask: css({ overflowWrap: "anywhere", fontSize: "0.8125rem", lineHeight: "1.25rem" }),
	facts: css({ display: "flex", flexWrap: "wrap", gap: "0.25rem 0.875rem", m: 0, p: 0, listStyle: "none", fontSize: "0.75rem", lineHeight: "1.1rem", color: "var(--ink-soft)", "& li": { display: "inline-flex", alignItems: "center", gap: "0.3rem" }, "& svg": { flexShrink: 0 } }),
	overdue: css({ color: "var(--ink)", fontWeight: 700 }),
	actions: css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", borderTop: "1px solid color-mix(in srgb, var(--ink) 20%, transparent)", pt: "0.625rem" }),
	primary: css({
		display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", minH: "2.75rem", maxW: "100%",
		border: "2px solid var(--ink)", borderRadius: "0.25rem", bg: "var(--ink)", color: "var(--paper)", px: "0.875rem",
		fontFamily: "var(--mono-body)", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer",
		_hover: { bg: "var(--accent-dim)", color: "white" },
		_focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" },
	}),
	empty: css({ m: "0.75rem", border: "1px dashed color-mix(in srgb, var(--ink) 38%, transparent)", p: "1rem", fontSize: "0.75rem", lineHeight: "1.2rem", color: "var(--ink-soft)", md: { m: "1rem" } }),
	subhead: css({ px: "0.75rem", pt: "0.25rem", fontFamily: "var(--mono-display)", fontSize: "0.875rem", fontWeight: 700, md: { px: "1rem" } }),
	status: css({ px: "1rem", pb: "0.75rem", fontSize: "0.6875rem", color: "var(--ink-soft)" }),
};

function AssignmentRow({ entry, now, onOpen }: { entry: AssignmentEntry; now: number; onOpen: (entry: AssignmentEntry) => void }) {
	const due = describeDue(entry.dueAt, now);
	const answers = entry.draft ? { submission: entry.draft.submission, notes: entry.draft.notes } : entry.submission ? { submission: entry.submission.text } : undefined;
	return <li className={styles.row} data-assignment={entry.key} data-assignment-status={entry.status} data-session={entry.sessionId}>
		<div className={styles.rowHead}>
			<span className={styles.kind}>{KIND_LABEL[entry.kind]}</span>
			<h3 className={styles.rowTitle}>{entry.title}</h3>
		</div>
		{entry.ask ? <p className={styles.ask}>{entry.ask}</p> : null}
		<ul className={styles.facts}>
			<li className={entry.overdue ? styles.overdue : undefined}>
				<CalendarClock size={13} aria-hidden="true" />
				{entry.overdue ? `${due}. You can still hand it in.` : due}
			</li>
			{entry.notYetOpen && entry.availableFrom !== null ? <li>Opens {new Date(entry.availableFrom).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}</li> : null}
			<li>{entry.status === "feedback_received" ? <MessageSquareText size={13} aria-hidden="true" /> : entry.status === "done" ? <CheckCircle2 size={13} aria-hidden="true" /> : <ClipboardList size={13} aria-hidden="true" />}{ASSIGNMENT_STATUS_LABEL[entry.status]}</li>
			{entry.items.total > 0 ? <li>{entry.items.done} of {entry.items.total} {ITEM_NOUN[entry.kind]} done</li> : null}
			{entry.hasDraft ? <li>Draft saved on this device</li> : null}
			{entry.round > 1 ? <li>Round {entry.round}</li> : null}
			{entry.node.estimatedMinutes !== undefined ? <li>About {entry.node.estimatedMinutes} minutes</li> : null}
			{entry.sessionTitle ? <li>From “{entry.sessionTitle}”</li> : null}
		</ul>
		<div className={styles.actions}>
			<button type="button" className={styles.primary} onClick={() => onOpen(entry)} aria-label={`${nextStepLabel(entry)}: ${entry.title}`}>
				{nextStepLabel(entry)}<ArrowRight size={15} aria-hidden="true" />
			</button>
			<PrintAssignmentButton node={entry.node} answers={answers} sessionTitle={entry.sessionTitle} />
		</div>
	</li>;
}

/**
 * Homework outside the chat: open work first (overdue, then by due date,
 * then newest), and handed-in work below while it waits for or holds the
 * tutor's feedback. Each row returns to the task in its session.
 */
export function OpenAssignmentsSection({ open, handedIn = [], now, onOpen, status }: {
	open: readonly AssignmentEntry[];
	handedIn?: readonly AssignmentEntry[];
	now: number;
	onOpen: (entry: AssignmentEntry) => void;
	/** Loading or error text, announced politely. */
	status?: string;
}) {
	return <section className={styles.section} aria-labelledby="coming-up-assignments" data-open-assignments>
		<div className={styles.head}>
			<h2 id="coming-up-assignments" className={styles.title}><ClipboardList size={18} aria-hidden="true" />Open assignments</h2>
			<p className={styles.copy}>Homework your tutor gave you in a session. Pick it up here, print it to work on paper, and hand it in from the task.</p>
		</div>
		{open.length ? <ul className={styles.list} aria-label="Open assignments">
			{open.map((entry) => <AssignmentRow key={entry.key} entry={entry} now={now} onOpen={onOpen} />)}
		</ul> : <p className={styles.empty} data-open-assignments-empty>
			No open assignments. When your tutor sets homework in a session (an assignment, a practice set, a draft or fieldwork), it is listed here so you can come back to it without searching your chats. You can also ask for one: “Give me an assignment on this.”
		</p>}
		{handedIn.length ? <>
			<h3 className={styles.subhead}>Handed in</h3>
			<ul className={styles.list} aria-label="Handed-in assignments">
				{handedIn.slice(0, 6).map((entry) => <AssignmentRow key={entry.key} entry={entry} now={now} onOpen={onOpen} />)}
			</ul>
		</> : null}
		{status ? <p className={styles.status} role="status" aria-live="polite">{status}</p> : null}
	</section>;
}
