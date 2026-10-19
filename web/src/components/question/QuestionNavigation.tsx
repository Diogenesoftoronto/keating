/** Back / next / submit controls under the current question. */
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { questionStyles, sm } from "./question-styles";

export function QuestionNavigation({
	isFirst,
	isLast,
	isPending,
	currentAnswered,
	allAnswered,
	submitLabel,
	onPrev,
	onNext,
	onSubmit,
}: {
	isFirst: boolean;
	isLast: boolean;
	isPending: boolean;
	currentAnswered: boolean;
	allAnswered: boolean;
	submitLabel: string;
	onPrev: () => void;
	onNext: () => void;
	onSubmit: () => void;
}) {
	return (
		<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" })}>
			<button
				type="button"
				onClick={onPrev}
				disabled={isPending || isFirst}
				className={cx(questionStyles.buttonSecondary, "activity-back-action")} data-question-back
			>
				<ChevronLeft size={14} />
				Back
			</button>

			{!isLast ? (
				<button
					type="button"
					onClick={onNext}
					disabled={isPending}
					className={cx(questionStyles.buttonPrimary, "activity-main-action")}
				>
					{currentAnswered ? "Lock in & next" : "Skip for now"}
					<ChevronRight size={14} />
				</button>
			) : (
				<button
					type="button"
					disabled={!allAnswered}
					className={cx(questionStyles.buttonPrimary, "activity-main-action", css({ gap: "0.375rem", [sm]: { gap: "0.5rem" } }))}
					onClick={onSubmit}
				>
					<ArrowRight size={16} />
					{submitLabel}
				</button>
			)}
		</div>
	);
}
