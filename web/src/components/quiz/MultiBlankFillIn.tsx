/** Multi-blank fill-in question: the template with one input per blank, answers joined by "|". */
import { useMemo, useRef } from "react";
import { css, cx } from "../../../styled-system/css";
import { parseQuestionTemplate } from "../question-template";
import { quizStyles, sm } from "./quiz-styles";

export function MultiBlankFillIn({
	question,
	blanks,
	answer,
	onChange,
	revealed,
	correctAnswers,
}: {
	question: string;
	blanks: { placeholder?: string; hint?: string }[];
	answer: string;
	onChange: (val: string) => void;
	revealed: boolean;
	correctAnswers: string[];
}) {
	const values = useMemo(() => answer.split("|").map((s) => s.trim()), [answer]);
	const parts = useMemo(() => parseQuestionTemplate(question), [question]);
	const blankRefs = useRef<(HTMLInputElement | null)[]>([]);

	const setValue = (idx: number, val: string) => {
		const next = [...values];
		next[idx] = val;
		onChange(next.join("|"));
	};

	let blankCounter = 0;
	return (
		<div className={css({ minWidth: 0 })}>
			<div className={css({ fontSize: "0.875rem", fontWeight: 500, lineHeight: "1.75rem", overflowWrap: "break-word" })}>
				{parts.map((part, idx) => {
					if (!part.isBlank) {
						return <span key={idx} className={css({ whiteSpace: "pre-wrap", overflowWrap: "break-word" })}>{part.text}</span>;
					}
					const bIdx = blankCounter++;
					const blankDef = blanks[bIdx];
					const isCorrect = revealed && values[bIdx]?.trim().toLowerCase() === correctAnswers[bIdx]?.trim().toLowerCase();
					const isWrong = revealed && values[bIdx]?.trim() && !isCorrect;
					return (
						<span key={idx} className={css({ display: "inline-flex", maxWidth: "100%", alignItems: "baseline", gap: "0.25rem", marginInline: "0.25rem", verticalAlign: "baseline" })}>
							<input
								ref={(el) => { blankRefs.current[bIdx] = el; }}
								type="text"
								disabled={revealed}
								aria-label={blankDef?.hint ? `${blankDef.hint} blank` : `Blank ${bIdx + 1}`}
								title={blankDef?.hint}
								className={cx(
									quizStyles.fieldBase, "activity-field",
									css({ display: "inline-block", height: "1.75rem", width: "7rem", paddingInline: "0.5rem", textAlign: "center", [sm]: { width: "10rem" }, "&::placeholder": { color: "color-mix(in srgb, var(--muted-foreground) 50%, transparent)" } }),
									isCorrect ? quizStyles.inputCorrect : isWrong ? quizStyles.inputWrong : quizStyles.inputNeutral,
								)}
								placeholder={blankDef?.placeholder ?? "___"}
								value={values[bIdx] ?? ""}
								onChange={(e) => setValue(bIdx, e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										const nextBlank = blankRefs.current[bIdx + 1];
										if (nextBlank) nextBlank.focus();
									}
								}}
							/>
							{revealed && (
								<span className={css({ fontSize: "0.625rem", color: isCorrect ? "#059669" : "var(--destructive)" })}>
									{isCorrect ? "✓" : `✗ ${correctAnswers[bIdx] ?? ""}`}
								</span>
							)}
						</span>
					);
				})}
			</div>
		</div>
	);
}
