import { useState } from "react";
import { Check, ListTree, X } from "lucide-react";
import { css } from "../../styled-system/css";
import type { PlanRevisionChange } from "@keating/learner-contracts";
import { keatingStorage } from "../hooks/keating-storage";
import {
	getPlanRevisionProposal,
	resolvePlanRevisionProposal,
	type PlanRevisionProposal,
	type PlanRevisionProposalStatus,
} from "../keating/plan-revisions";

const STATUS_LABEL: Record<Exclude<PlanRevisionProposalStatus, "pending">, string> = {
	accepted: "Accepted — the plan is updated.",
	declined: "Declined — the plan is unchanged.",
	stale: "The plan changed since this was proposed, so it no longer applies.",
};

function describe(change: PlanRevisionChange): { heading: string; items: readonly { id: string; title: string }[] } {
	switch (change.op) {
		case "complete-item":
			return { heading: `Mark "${change.itemId}" as done`, items: [] };
		case "insert-prerequisite":
			return { heading: `Add a prerequisite before "${change.beforeItemId}"`, items: [change.item] };
		case "expand-item":
			return { heading: `Split "${change.itemId}" into ${change.children.length} steps`, items: change.children };
	}
}

const buttonClass = css({
	display: "inline-flex", alignItems: "center", gap: "0.375rem", borderRadius: "0.5rem",
	padding: "0.375rem 0.75rem", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer",
	border: "1px solid var(--border)", _disabled: { opacity: 0.6, cursor: "default" },
});

/** Accept/Decline for a tutor plan change proposed while plan approval is on. */
export function PlanRevisionCard({ proposal: initial }: { proposal: PlanRevisionProposal }) {
	// The stored proposal is the source of truth once the learner has answered, even after reload.
	const [status, setStatus] = useState<PlanRevisionProposalStatus>(() => getPlanRevisionProposal(initial.id)?.status ?? initial.status);
	const [busy, setBusy] = useState(false);
	const { heading, items } = describe(initial.change);

	const decide = async (decision: "accept" | "decline") => {
		setBusy(true);
		try {
			const next = await resolvePlanRevisionProposal(keatingStorage, initial.id, decision);
			setStatus(next ?? "stale");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={css({
			marginBlock: "0.75rem", borderRadius: "0.75rem", padding: "1rem",
			border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)",
			background: "color-mix(in srgb, var(--primary) 5%, transparent)",
		})}>
			<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
				<ListTree size={16} className={css({ color: "var(--primary)", flexShrink: 0 })} />
				<span className={css({ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted-foreground)" })}>Proposed plan change</span>
			</div>
			<p className={css({ marginTop: "0.5rem", fontSize: "0.9375rem", fontWeight: 600 })}>{heading}</p>
			{items.length > 0 && (
				<ul className={css({ marginTop: "0.5rem", paddingLeft: "1.25rem", listStyle: "disc", fontSize: "0.875rem" })}>
					{items.map((item) => <li key={item.id}>{item.title}</li>)}
				</ul>
			)}
			{status === "pending" ? (
				<div className={css({ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
					<button type="button" disabled={busy} onClick={() => void decide("accept")}
						className={`${buttonClass} ${css({ background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" })}`}>
						<Check size={14} /> Accept
					</button>
					<button type="button" disabled={busy} onClick={() => void decide("decline")} className={buttonClass}>
						<X size={14} /> Decline
					</button>
				</div>
			) : (
				<p role="status" className={css({ marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--muted-foreground)" })}>{STATUS_LABEL[status]}</p>
			)}
		</div>
	);
}
