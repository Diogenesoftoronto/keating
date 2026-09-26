import { useMemo, useState } from "react";
import {
	acceptedProfilePatch,
	profileFieldSpec,
	type DeclaredLearnerProfile,
	type ProfileProposal,
} from "@keating/learner-contracts";
import { KeatingBot } from "./KeatingBot";
import "./profile-proposal-review.css";

/**
 * The single gate between anything Keating inferred and the learner's profile.
 *
 * Extraction and Anki mining both end here, and neither writes anything. Each
 * row shows the proposal beside the learner's own words that produced it, and
 * stays pending until the learner acts on it: nothing is pre-accepted, so
 * dismissing this card without a decision applies nothing at all.
 */

export type ProposalVerdict = "pending" | "accepted" | "discarded";

/**
 * Verdict toggling as a pure function, so the one rule that matters — a row is
 * undecided until the learner decides, and acting twice undecides it again —
 * is testable without a DOM.
 */
export function toggleVerdict(
	verdicts: readonly ProposalVerdict[],
	index: number,
	verdict: ProposalVerdict,
): readonly ProposalVerdict[] {
	return verdicts.map((existing, position) => (position === index
		// Acting on the same row twice returns it to undecided, so a misclick
		// is recoverable without restarting the card.
		? (existing === verdict ? "pending" : verdict)
		: existing));
}

/** The proposals the learner kept, in their original order. */
export function acceptedProposals(
	proposals: readonly ProfileProposal[],
	verdicts: readonly ProposalVerdict[],
): readonly ProfileProposal[] {
	return proposals.filter((_, index) => verdicts[index] === "accepted");
}

/** Human labels for the enum values, which are wire tokens rather than prose. */
function readValue(proposal: ProfileProposal): string {
	if (proposal.field === "interests") return proposal.value;
	return proposal.value.replace(/-/gu, " ");
}

function readField(proposal: ProfileProposal): string {
	if (proposal.field === "interests") return "Interest";
	try {
		return profileFieldSpec(proposal.field).asks.replace(/^the learner['’]s /iu, "").replace(/^their /iu, "");
	} catch {
		return proposal.field;
	}
}

const SOURCE_LABELS: Record<ProfileProposal["source"], string> = {
	conversation: "from what you typed",
	speech: "from what you said",
	"anki-import": "from your imported decks",
};

export interface ProfileProposalReviewProps {
	proposals: readonly ProfileProposal[];
	/** Called with only the accepted proposals, once, when the learner confirms. */
	onApply: (accepted: readonly ProfileProposal[], patch: Partial<DeclaredLearnerProfile>) => void;
	onDismiss?: () => void;
	heading?: string;
}

export function ProfileProposalReview({ proposals, onApply, onDismiss, heading = "Here is what I picked up." }: ProfileProposalReviewProps) {
	const [verdicts, setVerdicts] = useState<readonly ProposalVerdict[]>(() => proposals.map(() => "pending"));
	const accepted = useMemo(() => acceptedProposals(proposals, verdicts), [proposals, verdicts]);
	const decided = verdicts.filter(verdict => verdict !== "pending").length;

	if (proposals.length === 0) return null;

	const setVerdict = (index: number, verdict: ProposalVerdict) => {
		setVerdicts(current => toggleVerdict(current, index, verdict));
	};

	return <section className="proposal-review" aria-labelledby="proposal-review-title">
		<header className="proposal-review__head">
			<KeatingBot size={56} state="sorting" label="" />
			<div>
				<h3 id="proposal-review-title">{heading}</h3>
				<p>Nothing is saved until you say so. Keep what fits, drop the rest — you can change any of it later in Settings → Learning.</p>
			</div>
		</header>
		<ul className="proposal-review__list">
			{proposals.map((proposal, index) => {
				const verdict = verdicts[index] ?? "pending";
				return <li key={`${proposal.field}:${proposal.value}:${index}`} data-verdict={verdict} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
					<div className="proposal-review__claim">
						<span className="proposal-review__field">{readField(proposal)}</span>
						<strong className="proposal-review__value">{readValue(proposal)}</strong>
					</div>
					<blockquote className="proposal-review__evidence">
						{proposal.evidence}
						<cite>{SOURCE_LABELS[proposal.source]}</cite>
					</blockquote>
					<div className="proposal-review__verdict">
						<button type="button" className="dialog-compact-button" aria-pressed={verdict === "accepted"} onClick={() => setVerdict(index, "accepted")}>Keep</button>
						<button type="button" className="dialog-compact-button" aria-pressed={verdict === "discarded"} onClick={() => setVerdict(index, "discarded")}>Drop</button>
					</div>
				</li>;
			})}
		</ul>
		<footer className="proposal-review__actions">
			<p className="proposal-review__count" role="status">{accepted.length === 0
				? `Nothing kept yet · ${decided} of ${proposals.length} reviewed`
				: `Keeping ${accepted.length} of ${proposals.length}`}</p>
			<div>
				{onDismiss && <button type="button" className="dialog-compact-button" onClick={onDismiss}>Not now</button>}
				<button type="button" className="proposal-review__apply dialog-compact-button" onClick={() => onApply(accepted, acceptedProfilePatch(accepted))}>
					{accepted.length === 0 ? "Save nothing" : `Save ${accepted.length}`}
				</button>
			</div>
		</footer>
	</section>;
}
