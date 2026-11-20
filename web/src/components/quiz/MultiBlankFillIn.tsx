import { KeatingGlyph } from "../../design-system/glyphs";
/** Multi-blank fill-in question: the template with one input per blank, answers joined by "|". */
import { useMemo, useRef } from "react";
import { parseQuestionTemplate } from "../question-template";

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
		<div>
			<div className="quiz-blanks">
				{parts.map((part, idx) => {
					if (!part.isBlank) {
						return <span key={idx}>{part.text}</span>;
					}
					const bIdx = blankCounter++;
					const blankDef = blanks[bIdx];
					const isCorrect = revealed && values[bIdx]?.trim().toLowerCase() === correctAnswers[bIdx]?.trim().toLowerCase();
					const isWrong = revealed && values[bIdx]?.trim() && !isCorrect;
					return (
						<span key={idx} className="quiz-blank">
							<input
								ref={(el) => { blankRefs.current[bIdx] = el; }}
								type="text"
								disabled={revealed}
								aria-label={blankDef?.hint ? `${blankDef.hint} blank` : `Blank ${bIdx + 1}`}
								title={blankDef?.hint}
								className="quiz-field"
								data-result={isCorrect ? "correct" : isWrong ? "wrong" : undefined}
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
								<span className="lesson-verdict" data-result={isCorrect ? "correct" : "wrong"}>
									<KeatingGlyph name={isCorrect ? "check" : "x"} size={13}/>{isCorrect ? "Correct" : `Not quite · ${correctAnswers[bIdx] ?? ""}`}
								</span>
							)}
						</span>
					);
				})}
			</div>
		</div>
	);
}
