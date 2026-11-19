import { useEffect, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import "./lesson/lesson.css";
import {
	constraintPlanningMessage, LEARNING_PASSAGES_CHANGED_EVENT, PLAN_AROUND_CONSTRAINT_EVENT, plannableConstraints, recordConstraintAction,
	type PlannableConstraint,
} from "../keating/learning-intelligence/outlook";

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
		<div className="lesson-constraints" aria-label="Dates you mentioned">
			{items.map(item => (
				<span key={item.referenceId} className="lesson-constraint">
					<button
						type="button"
						className="lesson-constraint-chip"
						title={`Plan around “${item.quote}”`}
						onClick={() => {
							recordConstraintAction(sessionId, item.referenceId, "planned");
							window.dispatchEvent(new CustomEvent(PLAN_AROUND_CONSTRAINT_EVENT, { detail: { sessionId, text: constraintPlanningMessage(item.quote) } }));
						}}
					>
						<KeatingGlyph name="calendar" size={14} />
						<span>Plan around</span>
						<span className="lesson-constraint-quote">“{item.quote}”</span>
					</button>
					<button type="button" className="lesson-constraint-dismiss" aria-label={`Don't plan around “${item.quote}”`}
						onClick={() => recordConstraintAction(sessionId, item.referenceId, "dismissed")}>
						<KeatingGlyph name="x" size={14} />
					</button>
				</span>
			))}
		</div>
	);
}
