/** Classification question body: a table of items, each with a choice select and a justification field. */
import { css, cx } from "../../../styled-system/css";
import { Select } from "../Select";
import type { QuestionField } from "../QuestionRenderer";
import type { BlankState } from "./question-answers";
import { questionStyles, sm } from "./question-styles";

export function ClassificationQuestionBody({
	q,
	state,
	submitted,
	onSetValue,
	onEnter,
}: {
	q: QuestionField;
	state: BlankState;
	submitted: boolean;
	onSetValue: (rowIndex: number, field: "choice" | "reason", value: string) => void;
	/** Called on Enter in a justification field; the parent decides whether to advance or submit. */
	onEnter: () => void;
}) {
	return (
		<div className={css({ display: "grid", gap: "0.75rem", maxWidth: "100%" })}>
			<p className="activity-prompt">{q.question}</p>
			<div className={css({ display: "none", gap: "0.5rem", paddingInline: "0.5rem", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)", [sm]: { display: "grid", gridTemplateColumns: "minmax(0,0.9fr) minmax(0,0.9fr) minmax(0,1.4fr)" } })}>
				<span>{q.itemLabel ?? "Item"}</span>
				<span>{q.choiceLabel ?? "Choice"}</span>
				<span>{q.reasonLabel ?? "Justification"}</span>
			</div>
			{/* Rows read as a table, not as stacked boxes: hairlines only, and the
			    select/input inside each row carries the visible edge. */}
			<div className={css({ display: "grid" })}>
				{state.classifications.map((row, rowIndex) => (
					<div
						key={`${row.item}-${rowIndex}`}
						className={css({ display: "grid", gap: "0.5rem", padding: "0.625rem 0.5rem", "&:not(:last-child)": { borderBottom: "1px solid var(--border)" }, [sm]: { gridTemplateColumns: "minmax(0,0.9fr) minmax(0,0.9fr) minmax(0,1.4fr)", alignItems: "center" } })}
					>
						<div className={css({ minWidth: 0 })}>
							<span className={css({ fontSize: "0.625rem", fontWeight: 500, color: "var(--muted-foreground)", [sm]: { display: "none" } })}>
								{q.itemLabel ?? "Item"}
							</span>
							<div className={css({ overflowWrap: "break-word", fontSize: "0.875rem", fontWeight: 500 })}>{row.item}</div>
						</div>
						<label className={cx(questionStyles.stack1, css({ minWidth: 0 }))}>
							<span className={css({ fontSize: "0.625rem", fontWeight: 500, color: "var(--muted-foreground)", [sm]: { display: "none" } })}>
								{q.choiceLabel ?? "Choice"}
							</span>
							<Select
								value={row.choice}
								disabled={submitted}
								onValueChange={(value) => onSetValue(rowIndex, "choice", value)}
								className={questionStyles.field}
							>
								<option value="">Select...</option>
								{q.choices?.map((choice) => (
									<option key={choice} value={choice}>
										{choice}
									</option>
								))}
							</Select>
						</label>
						<label className={cx(questionStyles.stack1, css({ minWidth: 0 }))}>
							<span className={css({ fontSize: "0.625rem", fontWeight: 500, color: "var(--muted-foreground)", [sm]: { display: "none" } })}>
								{q.reasonLabel ?? "Justification"}
							</span>
							<input
								type="text"
								value={row.reason}
								disabled={submitted}
								onChange={(e) => onSetValue(rowIndex, "reason", e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") onEnter();
								}}
								placeholder={q.requireReasons ? "One phrase..." : "Optional..."}
								className={questionStyles.field}
							/>
						</label>
					</div>
				))}
			</div>
		</div>
	);
}
