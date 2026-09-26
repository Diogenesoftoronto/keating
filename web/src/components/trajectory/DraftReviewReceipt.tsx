import { formatActiveWork } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import type { PlanReview, TeachingDraftInteraction } from "@keating/learner-contracts";
import type { TeachingDraftReceiptRecord } from "../../keating/storage";

const muted = css({ color: "var(--muted-foreground)", fontSize: "0.75rem", lineHeight: 1.5 });
const summary = css({ cursor: "pointer", fontSize: "0.75rem", fontWeight: 650, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" } });
const pre = css({ marginTop: "0.35rem", overflowX: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.6875rem", lineHeight: 1.5 });

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

const planActionLabels: Record<PlanReview["action"], string> = {
	continue: "continue the current item",
	"suggest-advance": "propose marking the item done",
	"insert-prerequisite": "propose a prerequisite",
	"expand-item": "propose splitting the item",
	"propose-new-plan": "propose a new plan",
};

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
export function DraftReviewReceipt({ receipt }: { receipt: TeachingDraftReceiptRecord }) {
	const snapshot = receipt.snapshot;
	const activeWork = formatActiveWork(receipt.activeWork);
	const released = snapshot.phase === "released";
	const selectedVariant = variantLabel(snapshot.attempts.find(({ attempt }) => attempt === snapshot.selectedAttempt)?.variant);
	return (
		<details data-testid="draft-review-receipt" className={css({ marginTop: "1rem", border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.625rem 0.75rem" })}>
			<summary className={summary}>
				Draft review · {released ? "released" : snapshot.phase}
				{snapshot.selectedAttempt ? ` draft ${snapshot.selectedAttempt}` : ""}
				{selectedVariant ? ` (${selectedVariant})` : ""} · {snapshot.attempts.length} {snapshot.attempts.length === 1 ? "draft" : "drafts"} checked
			</summary>
			<div className={css({ display: "grid", gap: "0.625rem", marginTop: "0.5rem" })}>
				<p className={muted}>
					{snapshot.judgeModel ?? "No reviewer dispatched"} · {snapshot.reasoning} reasoning · {snapshot.standard} response · {(snapshot.elapsedMs / 1000).toFixed(1)} s
					{snapshot.reason ? ` · outcome: ${snapshot.reason}` : ""}
					{snapshot.planningMs === undefined ? "" : ` · planning ${Math.round(snapshot.planningMs)} ms`}
				</p>
				{snapshot.interaction ? <InteractionSummary interaction={snapshot.interaction} /> : null}
				{snapshot.planReview ? (
					<p className={muted} data-testid="draft-plan-review">
						Plan review after {planTriggerLabels[snapshot.planReview.trigger]}: {planActionLabels[snapshot.planReview.action]}
						{snapshot.planReview.action === "continue" ? "" : " (the learner decides)"}
					</p>
				) : null}
				<p className={muted}>Uncalibrated probability estimates. A check passes at P(violation) ≤ 0.20.</p>
				{snapshot.attempts.map((attempt) => (
					<details key={attempt.attempt} open={attempt.attempt === snapshot.selectedAttempt}>
						<summary className={summary}>
							Draft {attempt.attempt}
							{variantLabel(attempt.variant) ? ` · ${attempt.variant}` : ""} · {attempt.status} · {attempt.reasoning} reasoning · {attempt.standard}
						</summary>
						<p className={muted}>Generation {Math.round(attempt.generationMs)} ms · review {Math.round(attempt.judgementMs)} ms</p>
						<div className={css({ overflowX: "auto", maxWidth: "100%" })}>
							<table className={css({ width: "100%", fontSize: "0.6875rem", textAlign: "left", borderCollapse: "collapse" })}>
								<thead><tr><th scope="col">Check</th><th scope="col">Source</th><th scope="col">Result</th><th scope="col">P(violation)</th></tr></thead>
								<tbody>
									{attempt.checks.map((check) => (
										<tr key={check.id} className={css({ color: check.status === "pass" ? "var(--foreground)" : "var(--destructive)" })}>
											<th scope="row" className={css({ fontWeight: 400, overflowWrap: "anywhere", paddingBlock: "0.2rem" })}>{check.id}</th>
											<td>{check.source}</td>
											<td>{check.status}</td>
											<td>{check.probability === null ? "Unknown" : check.probability.toFixed(3)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</details>
				))}
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
