import { LessonFrame } from "./lesson/LessonFrame";
import { useState } from "react";
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
		<LessonFrame kind="Proposed plan change" glyph="tree" title={heading} footer={status === "pending" ? <>
				<button type="button" disabled={busy} onClick={()=>void decide("decline")}>Decline</button>
				<button type="button" className="lesson-primary" disabled={busy} onClick={()=>void decide("accept")}>Accept</button>
			</> : <span role="status">{STATUS_LABEL[status]}</span>}>
			{items.length > 0 && <ul>{items.map(item=><li key={item.id}>{item.title}</li>)}</ul>}
		</LessonFrame>
	);
}
