/**
 * Everything judged for one tutor turn, in pipeline order: drafts and their
 * checks, the completed-reply review, learning extraction and memory admission.
 * The chat inspector and the review view render this same component; only the
 * review view passes label controls.
 */
import { MEMORY_CATEGORIES, type ActiveWork, type MemoryCategory, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { DraftReviewReceipt, type DraftCheckLabelControls } from "./trajectory/DraftReviewReceipt";
import type { JudgementLabelRecord, MemoryVerdict, TurnExtraction, TurnJudgementRecord, TurnMemoryDecision } from "../keating/judgement/turn-records";

const muted = css({ color: "var(--muted-foreground)", fontSize: "0.75rem", lineHeight: 1.5 });
const mono = css({ fontFamily: "var(--mono-body)", fontSize: "0.6875rem" });
const sectionSummary = css({ cursor: "pointer", fontSize: "0.75rem", fontWeight: 650, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" } });
const quoteClass = css({ borderInlineStart: "3px solid var(--border)", paddingInlineStart: "0.5rem", fontSize: "0.75rem", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
const button = css({ borderRadius: "0.375rem", border: "1px solid var(--border)", background: "var(--background)", paddingInline: "0.5rem", minHeight: "1.75rem", fontSize: "0.6875rem", fontWeight: 600,
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" }, _disabled: { opacity: 0.45, cursor: "not-allowed" }, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" } });

const extractionKinds: Record<string, string> = {
	"answer-step": "Learner reasoning step",
	"lesson-fact": "Taught fact",
	"learner-idea": "Learner idea",
	"worked-example": "Worked example",
	"assigned-task": "Assigned task",
	"learning-constraint": "Study constraint",
	memory: "Memory candidate",
	"important-question": "Important question",
};
const memoryReasons: Record<string, string> = {
	accepted: "admitted",
	"below-threshold": "below the admission threshold",
	"not-memory": "judged not to be a lasting memory",
	uncalibrated: "no calibration installed",
	unavailable: "judgement model unavailable",
	"invalid-response": "judgement response was invalid",
	"invalid-candidate": "passage could not be verified",
	aborted: "review was cancelled",
};
const replyQuestions: Record<string, string> = { move: "Tutor move", need: "Learner need", fit: "Response fit" };
const words = (value: string) => value.replaceAll(/[_-]/g, " ");

export interface MemoryLabelControls {
	labels: readonly JudgementLabelRecord[];
	onLabel: (input: { decision: TurnMemoryDecision; verdict: MemoryVerdict | null; category?: MemoryCategory }) => void;
}
export interface TurnJudgementSummaryProps {
	draft?: { snapshot: TeachingDraftSnapshot; activeWork?: ActiveWork };
	record?: Pick<TurnJudgementRecord, "replyReview" | "extraction" | "memory">;
	status?: "running" | "completed" | "cancelled";
	/** "turn" shows everything; on review messages each side shows its own extraction. */
	role?: "turn" | "tutor" | "learner";
	checkControls?: DraftCheckLabelControls;
	memoryControls?: MemoryLabelControls;
	open?: boolean;
}

const extractionFor = (record: TurnJudgementSummaryProps["record"], role: NonNullable<TurnJudgementSummaryProps["role"]>) =>
	(record?.extraction ?? []).filter((row) => role === "turn" || row.role === role);

/** One line a reviewer can scan before expanding the turn. */
export function summarizeTurnJudgements({ draft, record, status, role = "turn", labels = [] }: Pick<TurnJudgementSummaryProps, "draft" | "record" | "status" | "role"> & { labels?: readonly JudgementLabelRecord[] }): string {
	const parts: string[] = [];
	if (status === "running") parts.push("in progress");
	if (status === "cancelled") parts.push("cancelled");
	const snapshot = draft?.snapshot;
	const tutorSide = role !== "learner";
	if (tutorSide && snapshot) {
		const flagged = snapshot.attempts.reduce((sum, attempt) => sum + attempt.checks.filter((check) => check.status !== "pass").length, 0);
		parts.push(`${snapshot.attempts.length} ${snapshot.attempts.length === 1 ? "draft" : "drafts"}`);
		parts.push(`${flagged} flagged ${flagged === 1 ? "check" : "checks"}`);
		parts.push(snapshot.phase === "released" ? `released draft ${snapshot.selectedAttempt ?? "?"}` : snapshot.phase);
	}
	if (tutorSide && record?.replyReview) {
		const move = record.replyReview.answers.find((answer) => answer.id === "move");
		parts.push(move ? `move: ${words(move.choice)}` : "reply reviewed");
	}
	const extraction = extractionFor(record, role);
	const passages = extraction.reduce((sum, row) => sum + row.items.length, 0);
	if (extraction.length) parts.push(`${passages} ${passages === 1 ? "passage" : "passages"} extracted`);
	if (tutorSide && record?.memory.length) {
		const admitted = record.memory.filter((row) => row.accepted).length;
		parts.push(`${admitted} of ${record.memory.length} ${record.memory.length === 1 ? "memory" : "memories"} admitted`);
	}
	if (labels.length) parts.push(`${labels.length} reviewer ${labels.length === 1 ? "label" : "labels"}`);
	return parts.join(" · ") || "No judgement recorded";
}

function ReplyReviewSection({ review }: { review: NonNullable<TurnJudgementRecord["replyReview"]> }) {
	return (
		<details>
			<summary className={sectionSummary}>Completed-reply review · {review.answers.length} {review.answers.length === 1 ? "question" : "questions"}</summary>
			<p className={muted}>{review.backend} / {review.model} · {review.calibrated ? "calibration attached" : "uncalibrated"}. Developer review only; no learner state changed.</p>
			<ul className={css({ display: "grid", gap: "0.25rem", paddingInlineStart: "1rem" })}>
				{review.answers.map((answer) => (
					<li key={answer.id} className={muted}>
						<strong>{replyQuestions[answer.id] ?? answer.id}:</strong> {words(answer.choice)} · confidence {answer.confidence.toFixed(2)}
						<details>
							<summary className={css({ cursor: "pointer" })}>All options</summary>
							{answer.probabilities.map((option) => (
								<span key={option.label} className={css({ display: "flex", gap: "0.375rem", alignItems: "center" })}>
									<meter aria-label={`${replyQuestions[answer.id] ?? answer.id}: ${option.label}`} min={0} max={1} value={option.value} className={css({ width: "4rem" })} />
									<span className={mono}>{option.value.toFixed(3)} {words(option.label)}</span>
								</span>
							))}
						</details>
					</li>
				))}
			</ul>
		</details>
	);
}

function ExtractionSection({ rows }: { rows: readonly TurnExtraction[] }) {
	const total = rows.reduce((sum, row) => sum + row.items.length, 0);
	return (
		<details>
			<summary className={sectionSummary}>Learning extraction · {total} {total === 1 ? "passage" : "passages"}</summary>
			<div className={css({ display: "grid", gap: "0.5rem", marginTop: "0.25rem" })}>
				{rows.map((row) => (
					<div key={row.role} className={css({ display: "grid", gap: "0.25rem" })}>
						<p className={muted}>
							From the {row.role === "learner" ? "learner message" : "tutor reply"} · {row.status}
							{row.model ? ` · ${row.model}` : ""}{row.elapsedMs !== undefined ? ` · ${(row.elapsedMs / 1000).toFixed(1)} s` : ""}
						</p>
						{row.items.map((item) => (
							<div key={`${item.messageId}:${item.start}`} className={css({ display: "grid", gap: "0.125rem" })}>
								<span className={muted}><strong>{extractionKinds[item.kind] ?? item.kind}</strong> · characters {item.start}–{item.end}</span>
								{item.quote !== undefined ? <blockquote className={quoteClass}>{item.quote}</blockquote>
									: <span className={muted}>Passage hidden. Turn on “Save judgements for review” or redacted details to keep passages.</span>}
							</div>
						))}
						{!row.items.length ? <p className={muted}>Nothing extracted from this message.</p> : null}
						{row.reasons.length ? <ul className={css({ paddingInlineStart: "1rem" })}>{row.reasons.map((reason, index) => <li key={index} className={muted}>{reason}</li>)}</ul> : null}
					</div>
				))}
				<p className={muted}>Extracted passages are exact quotes used as evidence; they do not judge correctness or mastery.</p>
			</div>
		</details>
	);
}

const effectText: Record<JudgementLabelRecord["effect"], string> = {
	applied: "Applied: later turns see this change.",
	"pending-account": "Saved. It applies once you are signed in to the account that holds this memory.",
	failed: "Saved, but memory storage was unavailable. Try again later.",
	none: "",
};

function MemoryRow({ decision, controls }: { decision: TurnMemoryDecision; controls?: MemoryLabelControls }) {
	const label = controls?.labels.find(({ target }) => target.kind === "memory-admission" && target.candidateId === decision.candidate.id);
	const [category, setCategory] = useState<MemoryCategory>(MEMORY_CATEGORIES.includes(decision.category as MemoryCategory) ? decision.category as MemoryCategory : MEMORY_CATEGORIES[0]);
	const redacted = !decision.candidate.evidence;
	const admittedNow = label ? label.verdict === "admit" : decision.accepted;
	return (
		<li className={css({ display: "grid", gap: "0.25rem" })}>
			{redacted ? <span className={muted}>Passage hidden.</span> : <blockquote className={quoteClass}>{decision.candidate.evidence}</blockquote>}
			<span className={muted}>
				Model: {decision.accepted ? "admitted" : `not admitted, ${memoryReasons[decision.reason] ?? decision.reason}`}
				{decision.category && decision.category !== "not-memory" ? ` · ${words(decision.category)}` : ""}
				{decision.probability !== null ? ` · P(worth remembering) ${decision.probability.toFixed(3)}` : ""}
				{decision.threshold !== null ? ` (admits at ≥ ${decision.threshold.toFixed(2)})` : ""}
				{decision.backend ? ` · ${decision.backend}` : ""}
				{!decision.committed && decision.accepted ? " · bank write skipped" : ""}
			</span>
			{label ? <span className={muted}><strong>You: {label.verdict === "admit" ? `admitted as ${words(label.category ?? "")}` : "removed from memory"}.</strong> {effectText[label.effect]}</span> : null}
			{controls ? (
				<span className={css({ display: "flex", flexWrap: "wrap", gap: "0.375rem", alignItems: "center" })}>
					{admittedNow ? (
						<button type="button" className={button} onClick={() => controls.onLabel({ decision, verdict: "reject" })}>Remove from memory</button>
					) : (
						<>
							<select aria-label="Memory category" value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} className={css({ fontSize: "0.6875rem", minHeight: "1.75rem" })}>
								{MEMORY_CATEGORIES.map((option) => <option key={option} value={option}>{words(option)}</option>)}
							</select>
							<button type="button" className={button} disabled={redacted} title={redacted ? "The passage was not kept, so it cannot be admitted." : undefined}
								onClick={() => controls.onLabel({ decision, verdict: "admit", category })}>Admit to memory</button>
						</>
					)}
					{label ? <button type="button" className={button} onClick={() => controls.onLabel({ decision, verdict: null })}>Undo my decision</button> : null}
				</span>
			) : null}
		</li>
	);
}

function MemorySection({ rows, controls }: { rows: readonly TurnMemoryDecision[]; controls?: MemoryLabelControls }) {
	const admitted = rows.filter((row) => row.accepted).length;
	return (
		<details>
			<summary className={sectionSummary}>Memory admission · {admitted} of {rows.length} admitted</summary>
			<p className={muted}>Admitted memories are model estimates shown to the tutor on later turns.{controls ? " Removing or admitting one here changes what later turns see; past replies stay as they were." : ""}</p>
			<ul className={css({ display: "grid", gap: "0.625rem", marginTop: "0.375rem", listStyle: "none" })}>
				{rows.map((row) => <MemoryRow key={row.candidate.id} decision={row} controls={controls} />)}
			</ul>
		</details>
	);
}

export function TurnJudgementSummary({ draft, record, status, role = "turn", checkControls, memoryControls, open }: TurnJudgementSummaryProps) {
	const extraction = extractionFor(record, role);
	const tutorSide = role !== "learner";
	const labels = [...(checkControls?.labels ?? []), ...(memoryControls?.labels ?? [])].filter((label, index, all) => all.findIndex((row) => row.id === label.id) === index);
	const headline = summarizeTurnJudgements({ draft, record, status, role, labels });
	const showDraft = tutorSide && draft;
	const showReview = tutorSide && record?.replyReview;
	const showMemory = tutorSide && !!record?.memory.length;
	if (!showDraft && !showReview && !extraction.length && !showMemory) return null;
	return (
		<details data-testid="turn-judgements" open={open} className={css({ marginTop: "0.75rem", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", minWidth: 0 })}>
			<summary className={sectionSummary}>{role === "learner" ? "Extracted from this message" : "Judgements"} · {headline}</summary>
			<div className={css({ display: "grid", gap: "0.5rem", marginTop: "0.5rem", minWidth: 0 })}>
				{showDraft ? <DraftReviewReceipt receipt={draft} controls={checkControls} embedded /> : null}
				{showReview ? <ReplyReviewSection review={record.replyReview!} /> : null}
				{extraction.length ? <ExtractionSection rows={extraction} /> : null}
				{showMemory ? <MemorySection rows={record!.memory} controls={memoryControls} /> : null}
			</div>
		</details>
	);
}
