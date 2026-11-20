import { Meter } from "../../design-system/charts";
import { useId, useState, type ReactNode } from "react";
import { formatActiveWork } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import type { PlanReview, ResourceReview, TeachingDraftInteraction, TeachingDraftSnapshot, TeachingPolicyCheck } from "@keating/learner-contracts";
import type { TeachingDraftReceiptRecord } from "../../keating/storage";
import { DRAFT_CHECK_PASS_LINE, describeTeachingCheck } from "../../keating/judgement/check-descriptions";
import { draftOrigin } from "../../keating/judgement/draft-progress";
import type { DraftCheckVerdict, JudgementLabelRecord } from "../../keating/judgement/turn-records";

const muted = css({ color: "var(--muted-foreground)", fontSize: "0.75rem", lineHeight: 1.5 });
const summary = css({ cursor: "pointer", fontSize: "0.75rem", fontWeight: 650, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "1px" } });
const pre = css({ marginTop: "0.35rem", overflowX: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.6875rem", lineHeight: 1.5 });
const draftPicker = css({ display: "flex", flexWrap: "wrap", gap: "0.375rem" });
const draftButton = css({
	minHeight: "1.75rem", padding: "0.25rem 0.5rem", borderRadius: "0.375rem", border: "1px solid var(--border)",
	fontSize: "0.75rem", textAlign: "start", "&[aria-pressed=true]": { fontWeight: 650, background: "var(--accent)", color: "var(--accent-foreground)" },
});
const passedButton = css({ minHeight: "1.5rem", fontSize: "0.75rem", textDecoration: "underline", textUnderlineOffset: "0.175em" });
const actionLabels: Record<TeachingDraftInteraction["action"], string> = {
	none: "no activity recommended",
	create: "activity recommended",
	continue: "continue the open activity",
	"grade-first": "grade pending work first",
};

const planTriggerLabels: Record<PlanReview["trigger"], string> = {
	"graded-attempt": "a graded attempt",
	"stalled-focus": "a stalled plan item",
	"progression-requested": "a pacing request",
	"goal-requested": "a new goal",
};

const resourceGapLabels: Record<ResourceReview["gap"], string> = {
	plan: "a study plan",
	retrieval: "a quiz or flashcards",
	map: "a concept map",
	"away-work": "an assignment, practice set, draft or fieldwork",
};

const resourceTriggerLabels: Record<ResourceReview["trigger"], string> = {
	"goal-requested": "the learner named a goal",
	"session-length": "the session had gone several turns without one",
};

const planActionLabels: Record<PlanReview["action"], string> = {
	continue: "continue the current item",
	"suggest-advance": "propose marking the item done",
	"insert-prerequisite": "propose a prerequisite",
	"expand-item": "propose splitting the item",
	"propose-new-plan": "propose a new plan",
};

const resultLabels: Record<TeachingPolicyCheck["status"], string> = { pass: "passed", fail: "failed", unknown: "unknown" };
const attemptLabels = { pass: "passed checks", fail: "failed checks", unknown: "inconclusive", "generation-error": "generation failed" };
const kindLabels = { model: "judged", runtime: "runtime", quality: "quality" } as const;

/** Reviewer controls for draft checks. Labels are review data; the released reply never changes. */
export interface DraftCheckLabelControls {
	labels: readonly JudgementLabelRecord[];
	onLabel: (input: { attempt: number; check: TeachingPolicyCheck; verdict: DraftCheckVerdict | null; note?: string }) => void;
}

function CheckLabel({ attempt, check, controls }: { attempt: number; check: TeachingPolicyCheck; controls: DraftCheckLabelControls }) {
	const label = controls.labels.find(({ target }) => target.kind === "draft-check" && target.attempt === attempt && target.checkId === check.id);
	const verdict = (label?.verdict as DraftCheckVerdict | undefined) ?? "";
	const modelSaysViolation = check.status === "fail";
	const disagrees = label && (label.verdict === "violation") !== modelSaysViolation;
	return (
		<span className={css({ display: "inline-flex", flexWrap: "wrap", gap: "0.25rem", alignItems: "center" })}>
			<select
				aria-label={`Your verdict for ${describeTeachingCheck(check.id).title}, draft ${attempt}`}
				value={verdict}
				onChange={(event) => controls.onLabel({ attempt, check, verdict: (event.target.value || null) as DraftCheckVerdict | null, note: label?.note })}
				className={css({ fontSize: "0.6875rem", minHeight: "1.75rem", maxWidth: "10rem" })}
			>
				<option value="">Not reviewed</option>
				<option value="violation">Violation present</option>
				<option value="no-violation">No violation</option>
			</select>
			{label ? <span className={muted}>{disagrees ? "Disagrees with model" : "Agrees with model"}</span> : null}
			{label ? (
				<input
					aria-label={`Note for ${describeTeachingCheck(check.id).title}, draft ${attempt}`}
					placeholder="Why (optional)"
					defaultValue={label.note ?? ""}
					onBlur={(event) => { const note = event.target.value.trim(); if (note !== (label.note ?? "")) controls.onLabel({ attempt, check, verdict: label.verdict as DraftCheckVerdict, note }); }}
					className={css({ fontSize: "0.6875rem", minHeight: "1.75rem", minWidth: "8rem", flex: "1 1 8rem" })}
				/>
			) : null}
		</span>
	);
}

function CheckRow({ attempt, check, controls, compact }: { attempt: number; check: TeachingPolicyCheck; controls?: DraftCheckLabelControls; compact?: boolean }) {
	const description = describeTeachingCheck(check.id);
	const marker = compact && check.source === "jev";
	return (
		<tr className={css({ color: check.status === "pass" ? "var(--foreground)" : "var(--destructive)", verticalAlign: "top" })}>
			<th scope="row" className={css({ fontWeight: 400, overflowWrap: "anywhere", paddingBlock: "0.2rem", paddingInlineEnd: "0.5rem" })}>
				{description.question ? (
					<details>
						<summary className={css({ cursor: "pointer" })}>{description.title}</summary>
						<p className={muted}>{description.question}</p>
					</details>
				) : description.title}
				<span className={css({ display: "block", fontFamily: "var(--mono-body)", fontSize: "0.625rem", color: "var(--muted-foreground)" })}>{check.id} · {check.severity} · {kindLabels[description.kind]}</span>
			</th>
			<td>{resultLabels[check.status]}</td>
			<td>
				{check.probability === null ? "Unknown" : (
					<Meter max={1} value={check.probability} valueText={check.probability.toFixed(3)}
						label={`P(violation) for ${description.title}`} threshold={marker ? { value: DRAFT_CHECK_PASS_LINE, label: "Pass line" } : undefined}/>
				)}
			</td>
			{controls ? <td><CheckLabel attempt={attempt} check={check} controls={controls} /></td> : null}
		</tr>
	);
}

function CheckTable({ attempt, checks, controls, compact }: { attempt: number; checks: readonly TeachingPolicyCheck[]; controls?: DraftCheckLabelControls; compact?: boolean }) {
	const [showPassed, setShowPassed] = useState(false);
	const passedId = useId();
	const head = <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">P(violation)</th>{controls ? <th scope="col">Your verdict</th> : null}</tr></thead>;
	const table = (rows: readonly TeachingPolicyCheck[]) => (
		<div className={css({ overflowX: "auto", maxWidth: "100%" })}>
			<table className={css({ width: "100%", fontSize: "0.6875rem", textAlign: "left", borderCollapse: "collapse", "& th, & td": { paddingInlineEnd: "0.75rem", paddingBlock: "0.2rem" } })}>
				{head}
				<tbody>{rows.map((check) => <CheckRow key={check.id} attempt={attempt} check={check} controls={controls} compact={compact} />)}</tbody>
			</table>
		</div>
	);
	// Problems first; a long list of passing checks stays one click away.
	const flagged = checks.filter((check) => check.status !== "pass");
	const passed = checks.filter((check) => check.status === "pass");
	return (
		<>
			{flagged.length ? table(flagged) : <p className={muted}>No check flagged this draft.</p>}
			{passed.length && compact ? (
				<div>
					<button type="button" className={passedButton} aria-expanded={showPassed} aria-controls={passedId} onClick={() => setShowPassed(value => !value)}>
						{showPassed ? "Hide" : "Show"} {passed.length} passed {passed.length === 1 ? "check" : "checks"}
					</button>
					<div id={passedId} hidden={!showPassed}>{showPassed ? table(passed) : null}</div>
				</div>
			) : passed.length ? (
				<details>
					<summary className={summary}>{passed.length} {passed.length === 1 ? "check" : "checks"} passed</summary>
					{table(passed)}
				</details>
			) : null}
		</>
	);
}

/** Receipts recorded before paired drafting carry no variant. */
const variantLabel = (variant: string | undefined) => (variant && variant !== "default" ? variant : null);

function InteractionSummary({ interaction }: { interaction: TeachingDraftInteraction }) {
	const families = interaction.families.map(({ family, components }) => `${family} (${components.join(", ")})`).join("; ");
	return (
		<div data-testid="draft-interaction">
			<p className={muted}>
				Interaction: {actionLabels[interaction.action]}
				{families ? ` · ${families}` : ""}
				{interaction.continueNodeId ? ` · node ${interaction.continueNodeId}` : ""}
				{interaction.lead === "answer-first" ? " · answer first" : ""}
				{` · ${interaction.paired ? "interactive and prose drafts competed blind" : "single draft style"}`}
			</p>
			<p className={muted}>Material features judged true: {interaction.features.length ? interaction.features.join(", ") : "none"}</p>
		</div>
	);
}

/**
 * The draft gate's decision for one tutor turn, shown beside the turn so a
 * reviewer can see which checks passed, which drafts were rejected and what
 * plan state the drafts were judged against. Draft text is never stored.
 */
export function DraftReviewReceipt({ receipt, controls, embedded = false, open, compact = false }: {
	receipt: Pick<TeachingDraftReceiptRecord, "snapshot" | "activeWork"> & { snapshot: TeachingDraftSnapshot };
	controls?: DraftCheckLabelControls;
	/** Inside a turn summary the receipt is one section, not a separate card. */
	embedded?: boolean;
	open?: boolean;
	compact?: boolean;
}) {
	const snapshot = receipt.snapshot;
	const [selected, setSelected] = useState<number>();
	const flagged = snapshot.attempts.find(attempt => attempt.status !== "pass" || attempt.checks.some(check => check.status !== "pass"));
	const selectedDraft = snapshot.attempts.find(attempt => attempt.attempt === selected)
		?? flagged ?? snapshot.attempts.find(attempt => attempt.attempt === snapshot.selectedAttempt) ?? snapshot.attempts[0];
	const activeWork = formatActiveWork(receipt.activeWork);
	const released = snapshot.phase === "released";
	const reviewed = snapshot.attempts.filter(attempt => attempt.status !== "generation-error").length;
	const selectedVariant = variantLabel(snapshot.attempts.find(({ attempt }) => attempt === snapshot.selectedAttempt)?.variant);
	return (
		<details data-testid="draft-review-receipt" open={open} className={embedded ? undefined : css({ marginTop: "1rem", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.625rem 0.75rem" })}>
			<summary className={summary}>
				Draft review · {released ? "released" : snapshot.phase}
				{snapshot.selectedAttempt ? ` draft ${snapshot.selectedAttempt}` : ""}
				{selectedVariant ? ` (${selectedVariant})` : ""} · {reviewed} {reviewed === 1 ? "draft" : "drafts"} checked
			</summary>
			<div className={css({ display: "grid", gap: "0.625rem", marginTop: "0.5rem" })}>
				<p className={muted}>
					{snapshot.judgeModel ?? "No reviewer dispatched"} · {snapshot.reasoning} reasoning · {snapshot.standard} response · {(snapshot.elapsedMs / 1000).toFixed(1)} s
					{snapshot.reason ? ` · outcome: ${snapshot.reason}` : ""}
					{snapshot.planningMs === undefined ? "" : ` · planning ${Math.round(snapshot.planningMs)} ms`}
				</p>
				{snapshot.interaction ? <InteractionSummary interaction={snapshot.interaction} /> : null}
				{snapshot.backgroundActivity ? <p className={muted} data-testid="draft-background-learning">
					Background learning · saved preference for {snapshot.backgroundActivity.preferredKind}, used without waiting for a hosted prediction.
					{" Current teaching checks and your request still take precedence."}
				</p> : null}
				{snapshot.activityLearning ? <p className={muted} data-testid="draft-activity-learning">
					{snapshot.activityLearning.validation === null && snapshot.activityLearning.counts.exposures === 0 && snapshot.activityLearning.reasons.length === 0
						? "Learning history · this released reply is eligible to be linked to a later recorded answer."
						: <>Chat predictions · {snapshot.activityLearning.status === "active" ? "TabPFN selected among approved replies" : "usual reply selection retained"}
							{` · ${snapshot.activityLearning.counts.labelled} linked graded outcomes · ${snapshot.activityLearning.counts.validation} later checks.`}
							{" This estimates the next recorded answer; it does not show causal improvement or unaided learning."}</>}
				</p> : null}
				{snapshot.resourceReview ? (
					<p className={muted} data-testid="draft-resource-review">
						Session resources · the tutor was invited to add {resourceGapLabels[snapshot.resourceReview.gap]} because {resourceTriggerLabels[snapshot.resourceReview.trigger]}. The tutor decides whether it fits.
					</p>
				) : null}
				{snapshot.planReview ? (
					<p className={muted} data-testid="draft-plan-review">
						Plan review after {planTriggerLabels[snapshot.planReview.trigger]}: {planActionLabels[snapshot.planReview.action]}
						{snapshot.planReview.action === "continue" ? "" : " (the learner decides)"}
					</p>
				) : null}
				<p className={muted}>Uncalibrated probability estimates. A check passes at P(violation) ≤ {DRAFT_CHECK_PASS_LINE.toFixed(2)}.{controls ? " Your verdicts are saved as review labels; the released reply does not change." : ""}</p>
				{compact && snapshot.attempts.length > 1 ? <div className={draftPicker} role="group" aria-label="Drafts">
					{snapshot.attempts.map(attempt => <button key={attempt.attempt} type="button" className={draftButton}
						aria-pressed={selectedDraft === attempt} onClick={() => setSelected(attempt.attempt)}>
						Draft {attempt.attempt}{variantLabel(attempt.variant) ? ` · ${attempt.variant}` : ""} · {released && attempt.attempt === snapshot.selectedAttempt ? "released" : attemptLabels[attempt.status]}
					</button>)}
				</div> : null}
				{snapshot.attempts.map((attempt) => {
					const origin = draftOrigin(snapshot, attempt);
					const content = <>
						{origin && <p className={muted}>{origin}</p>}
						<p className={muted}>Generation {Math.round(attempt.generationMs)} ms · review {Math.round(attempt.judgementMs)} ms</p>
						{attempt.unavailableTools?.length ? <p className={muted}>Tried to call tools this session does not offer: {attempt.unavailableTools.map(name => <code key={name}>{name}</code>).reduce<ReactNode[]>((all, item, index) => index ? [...all, ", ", item] : [item], [])}</p> : null}
						<CheckTable attempt={attempt.attempt} checks={attempt.checks} controls={controls} compact={compact} />
					</>;
					if (compact) return selectedDraft === attempt ? <div key={attempt.attempt} className={css({ minWidth: 0, display: "grid", gap: "0.375rem" })}>
						<p className={muted}>Draft {attempt.attempt}{variantLabel(attempt.variant) ? ` · ${attempt.variant}` : ""} · {attempt.reasoning} reasoning · {attempt.standard}</p>
						{content}
					</div> : null;
					return (
					<details key={attempt.attempt} open={attempt.attempt === snapshot.selectedAttempt}>
						<summary className={summary}>
							Draft {attempt.attempt}
							{variantLabel(attempt.variant) ? ` · ${attempt.variant}` : ""} · {attempt.status} · {attempt.reasoning} reasoning · {attempt.standard}
						</summary>
						{content}
					</details>
					);
				})}
				{activeWork ? (
					<details>
						<summary className={summary}>Active work at this turn</summary>
						<pre className={pre}>{activeWork}</pre>
					</details>
				) : null}
			</div>
		</details>
	);
}
