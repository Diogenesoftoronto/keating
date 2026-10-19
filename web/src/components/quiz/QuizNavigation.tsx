/** Back / next / finish controls under the live quiz question. */
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { finishButtonLabel } from "./quiz-session";
import { quizStyles, sm } from "./quiz-styles";

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
		<nav className={quizStyles.nav} aria-label="Quiz questions">
			<button
				type="button"
				onClick={onPrev}
				disabled={isPending || isFirst}
				className={cx(quizStyles.buttonSecondary, "activity-back-action", css({ flex: 1, justifyContent: "center", [sm]: { flex: "0 0 auto" } }))}
			>
				<ChevronLeft size={14} /> Back
			</button>
			{!isLast ? (
				<button
					type="button"
					onClick={onNext}
					disabled={isPending}
					className={cx(quizStyles.buttonPrimary, "activity-main-action", css({ flex: 1, justifyContent: "center", [sm]: { flex: "0 0 auto" } }))}
				>
					{currentAnswered ? "Lock in & next" : "Skip for now"} <ChevronRight size={16} />
				</button>
			) : (
				<button
					type="button"
					onClick={onFinish}
					disabled={!allAnswered || submitted}
					title={allAnswered ? undefined : `${unansweredCount} unanswered`}
					className={cx(quizStyles.buttonPrimary, "activity-main-action", css({ flex: 1, justifyContent: "center", gap: "0.5rem", [sm]: { flex: "0 0 auto" } }))}
				>
					<Send size={14} /> {finishButtonLabel(allAnswered, unansweredCount)}
				</button>
			)}
		</nav>
	);
}
