/** "Correct" / "Incorrect" pill shown on revealed objective questions. */
import { CheckCircle2, XCircle } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { dark } from "./quiz-styles";

export function QuizResultBadge({ correct }: { correct: boolean }) {
	return (
		<span
			className={cx(
				css({
					display: "inline-flex",
					alignItems: "center",
					gap: "0.25rem",
					borderRadius: "9999px",
					border: "1px solid",
					padding: "0.125rem 0.5rem",
					fontSize: "0.6875rem",
					fontWeight: 500,
				}),
				correct
					? css({
						borderColor: "rgba(16, 185, 129, 0.5)",
						background: "rgba(16, 185, 129, 0.1)",
						color: "#047857",
						[dark]: { color: "#6ee7b7" },
					})
					: css({
						borderColor: "color-mix(in srgb, var(--destructive) 50%, transparent)",
						background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
						color: "var(--destructive)",
					}),
			)}
		>
			{correct ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
			{correct ? "Correct" : "Incorrect"}
		</span>
	);
}
