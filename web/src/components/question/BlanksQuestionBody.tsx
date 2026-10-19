/** Fill-in-the-blank question body: the template with an input per blank, Enter moving focus to the next blank. */
import type { MutableRefObject } from "react";
import { css } from "../../../styled-system/css";
import { parseQuestionTemplate } from "../question-template";
import type { QuestionField } from "../QuestionRenderer";
import type { BlankState } from "./question-answers";
import { questionStyles, sm } from "./question-styles";

export function BlanksQuestionBody({
	q,
	state,
	submitted,
	blankRefs,
	onSetValue,
	onEnter,
}: {
	q: QuestionField;
	state: BlankState;
	submitted: boolean;
	blankRefs: MutableRefObject<(HTMLInputElement | null)[]>;
	onSetValue: (blankIdx: number, value: string) => void;
	/** Called on Enter in the last blank; the parent decides whether to advance or submit. */
	onEnter: () => void;
}) {
	return (
		<div className={css({ display: "grid", gap: "0.75rem", maxWidth: "100%" })}>
			<div className={css({ fontSize: "0.875rem", fontWeight: 500, lineHeight: 1.625, overflowWrap: "break-word" })}>
				{parseQuestionTemplate(q.question).map((part, idx) => {
					if (!part.isBlank) {
						return <span key={idx} className={questionStyles.breakWords}>{part.text}</span>;
					}
					const blankIdx = part.index;
					const blankDef = q.blanks?.[blankIdx];
					return (
						<span key={idx} className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", marginInline: "0.125rem", [sm]: { marginInline: "0.25rem" } })}>
							<input
								ref={(el) => { blankRefs.current[blankIdx] = el; }}
								type="text"
								disabled={submitted}
								className={css({ display: "inline-block", height: "1.75rem", width: "4rem", borderRadius: "0.25rem", border: "1px solid var(--border)", background: "var(--background)", paddingInline: "0.375rem", textAlign: "center", fontSize: "0.875rem", outline: "none", _focus: { borderColor: "var(--primary)" }, "&::placeholder": { color: "color-mix(in srgb, var(--muted-foreground) 50%, transparent)" }, [sm]: { width: "5rem", paddingInline: "0.5rem" } })}
								placeholder={blankDef?.placeholder ?? "___"}
								value={state.values[blankIdx] ?? ""}
								onChange={(e) => onSetValue(blankIdx, e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										const nextBlank = blankRefs.current[blankIdx + 1];
										if (nextBlank) nextBlank.focus();
										else onEnter();
									}
								}}
							/>
							{blankDef?.hint && (
								<span className={css({ display: "none", fontSize: "0.625rem", color: "var(--muted-foreground)", [sm]: { display: "inline" } })}>{blankDef.hint}</span>
							)}
						</span>
					);
				})}
			</div>
		</div>
	);
}
