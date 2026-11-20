/**
 * The quiz footer (board L1): a quiet back glyph at the leading edge, the
 * remaining count in mono, and the one ink primary on the trailing edge.
 */
import { KeatingGlyph } from "../../design-system/glyphs";
import { finishButtonLabel } from "./quiz-session";

export function QuizNavigation({
	isFirst,
	isLast,
	isPending,
	currentAnswered,
	allAnswered,
	submitted,
	unansweredCount,
	onPrev,
	onNext,
	onFinish,
}: {
	isFirst: boolean;
	isLast: boolean;
	isPending: boolean;
	currentAnswered: boolean;
	allAnswered: boolean;
	submitted: boolean;
	unansweredCount: number;
	onPrev: () => void;
	onNext: () => void;
	onFinish: () => void;
}) {
	return (
		<nav className="lesson-foot" aria-label="Quiz questions">
			<button
				type="button"
				onClick={onPrev}
				disabled={isPending || isFirst}
				title="Back"
				className="lesson-quiet k-bloom activity-back-action"
			>
				<KeatingGlyph name="left" size={15} /><span className="lesson-sr">Back</span>
			</button>
			{!isLast ? (
				<button
					type="button"
					onClick={onNext}
					disabled={isPending}
					className="lesson-primary"
					data-glyph-surface="inverse"
				>
					{currentAnswered ? "Lock in & next" : "Skip for now"} <KeatingGlyph name={currentAnswered ? "right" : "skip"} size={13} />
				</button>
			) : (
				<button
					type="button"
					onClick={onFinish}
					disabled={!allAnswered || submitted}
					title={allAnswered ? undefined : `${unansweredCount} unanswered`}
					className="lesson-primary"
					data-glyph-surface="inverse"
				>
					<KeatingGlyph name="send" size={13} /> {finishButtonLabel(allAnswered, unansweredCount)}
				</button>
			)}
		</nav>
	);
}
