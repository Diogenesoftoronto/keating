import { useEffect, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { css } from "../../styled-system/css";
import {
	constraintPlanningMessage, LEARNING_PASSAGES_CHANGED_EVENT, PLAN_AROUND_CONSTRAINT_EVENT, plannableConstraints, recordConstraintAction,
	type PlannableConstraint,
} from "../keating/learning-intelligence/outlook";

const row = css({ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.375rem", marginTop: "0.375rem" });
const chip = css({
	display: "inline-flex", alignItems: "center", gap: "0.375rem", maxWidth: "100%", minHeight: "2rem",
	border: "1px solid var(--border)", borderRadius: "999px", background: "var(--background)", color: "var(--foreground)",
	paddingInline: "0.625rem", fontSize: "0.75rem", lineHeight: 1.3, cursor: "pointer", textAlign: "left",
	_hover: { borderColor: "var(--primary)" }, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" },
});
const dismiss = css({
	display: "inline-grid", placeItems: "center", width: "2rem", height: "2rem", border: 0, borderRadius: "999px",
	background: "transparent", color: "var(--muted-foreground)", cursor: "pointer",
	_hover: { background: "var(--muted)" }, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" },
});
const quoteClass = css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "22rem" });

/**
 * When Clairic finds a deadline in the learner's own message, offer to plan
 * around it. Nothing changes until they choose to; then the request is sent as
 * their message and the tutor updates the goal with its usual tools.
 */
export function ConstraintPlanChips({ sessionId, messageIds, messageText }: { sessionId?: string; messageIds: readonly string[]; messageText: string }) {
	const [items, setItems] = useState<PlannableConstraint[]>([]);
	const key = JSON.stringify(messageIds);
	useEffect(() => {
		const refresh = () => setItems(plannableConstraints(sessionId, messageIds, messageText));
		refresh();
		window.addEventListener(LEARNING_PASSAGES_CHANGED_EVENT, refresh);
		window.addEventListener("storage", refresh);
		return () => {
			window.removeEventListener(LEARNING_PASSAGES_CHANGED_EVENT, refresh);
			window.removeEventListener("storage", refresh);
		};
		// messageIds is compared by value through `key`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionId, key, messageText]);
	if (!sessionId || !items.length) return null;
	return (
		<div className={row} aria-label="Dates you mentioned">
			{items.map(item => (
				<span key={item.referenceId} className={css({ display: "inline-flex", alignItems: "center", maxWidth: "100%" })}>
					<button
						type="button"
						className={chip}
						title={`Plan around “${item.quote}”`}
						onClick={() => {
							recordConstraintAction(sessionId, item.referenceId, "planned");
							window.dispatchEvent(new CustomEvent(PLAN_AROUND_CONSTRAINT_EVENT, { detail: { sessionId, text: constraintPlanningMessage(item.quote) } }));
						}}
					>
						<CalendarClock size={14} aria-hidden />
						<span>Plan around</span>
						<span className={quoteClass}>“{item.quote}”</span>
					</button>
					<button type="button" className={dismiss} aria-label={`Don't plan around “${item.quote}”`}
						onClick={() => recordConstraintAction(sessionId, item.referenceId, "dismissed")}>
						<X size={14} aria-hidden />
					</button>
				</span>
			))}
		</div>
	);
}
