/**
 * Matching question body: an answer bank of draggable choices plus a row per
 * item that accepts a drop or a select. Drag state lives in the parent reducer.
 */
import type { Dispatch } from "react";
import { css, cx } from "../../../styled-system/css";
import { Select } from "../Select";
import type { QuestionField } from "../QuestionRenderer";
import type { BlankState } from "./question-answers";
import { questionStyles, sm } from "./question-styles";
import type { QuestionInteractionAction } from "./question-state";

export function MatchingQuestionBody({
	q,
	state,
	submitted,
	draggingMatch,
	dragOverRow,
	dispatch,
	onSetChoice,
}: {
	q: QuestionField;
	state: BlankState;
	submitted: boolean;
	draggingMatch: string | null;
	dragOverRow: number | null;
	dispatch: Dispatch<QuestionInteractionAction>;
	onSetChoice: (rowIndex: number, value: string, unique: boolean) => void;
}) {
	const selectedMatches = new Set(state.classifications.map((row) => row.choice).filter(Boolean));
	return (
		<div className={css({ display: "grid", gap: "0.75rem", maxWidth: "100%" })}>
			<p className="activity-prompt">{q.question}</p>
			{/* Frameless: the choices are already outlined, so a wrapper border
			    would just be a box around boxes. */}
			<div>
				<div data-matching-bank-label className={css({ marginBottom: "0.5rem", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" })}>
					{q.choiceLabel ?? "Answer bank"}
				</div>
				<ol data-matching-bank className={css({ display: "grid", gap: "0.5rem", [sm]: { gridTemplateColumns: "repeat(auto-fit,minmax(11rem,1fr))" } })}>
					{q.choices?.map((choice, choiceIndex) => {
						const used = selectedMatches.has(choice);
						return (
							<li key={choice} className={css({ minWidth: 0 })}>
								<button
									type="button"
									draggable={!submitted && (!used || q.uniqueMatches === false)}
									disabled={submitted || (used && q.uniqueMatches !== false)}
									onDragStart={(event) => {
										event.dataTransfer.setData("text/plain", choice);
										event.dataTransfer.effectAllowed = "move";
								dispatch({ type: "drag-start", value: choice });
									}}
									onDragEnd={() => {
								dispatch({ type: "drag-end" });
									}}
									className={cx(
										css({
											display: "inline-flex",
											minHeight: "2rem",
											width: "100%",
											maxWidth: "100%",
											alignItems: "center",
											gap: "0.5rem",
											borderRadius: "0.375rem",
											border: "1px solid",
											padding: "0.375rem 0.625rem",
											textAlign: "left",
											fontSize: "0.75rem",
											transition: "color 150ms, background-color 150ms, border-color 150ms",
											[sm]: { fontSize: "0.875rem" },
										}),
										used
											? css({ borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)", color: "var(--primary)", _disabled: { opacity: 0.7 } })
											: css({ borderColor: "var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", _hover: { borderColor: "color-mix(in srgb, var(--primary) 50%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)" } }),
									)}
									title={used && q.uniqueMatches !== false ? "Already matched" : "Drag to a row"}
								>
									<span className={cx("font-terminal", css({ fontSize: "0.6875rem", color: "var(--muted-foreground)" }))}>
										{String.fromCharCode(65 + choiceIndex)}
									</span>
									<span className={cx(questionStyles.minFlex, questionStyles.breakWords)}>{choice}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</div>
			<div className={questionStyles.stack2}>
				{state.classifications.map((row, rowIndex) => (
					<div
						key={`${row.item}-${rowIndex}`}
						data-matching-row
						onDragOver={(event) => {
							event.preventDefault();
						dispatch({ type: "drag-over", row: rowIndex });
						}}
					onDragLeave={() => {
						if (dragOverRow === rowIndex) dispatch({ type: "drag-over", row: null });
					}}
						onDrop={(event) => {
							event.preventDefault();
							const value = event.dataTransfer.getData("text/plain") || draggingMatch;
							if (value) {
								onSetChoice(rowIndex, value, q.uniqueMatches !== false);
								dispatch({ type: "drag-end" });
							}
						}}
						className={cx(
							// Rows are separated by a hairline rather than boxed: the answer
							// chip inside already has its own outline.
							css({
								display: "grid",
								gap: "0.75rem",
								borderRadius: "0.375rem",
								padding: "0.625rem 0.5rem",
								transition: "color 150ms, background-color 150ms",
								"&:not(:last-child)": { borderBottom: "1px solid var(--border)" },
								[sm]: { gridTemplateColumns: "2rem minmax(0,1fr) minmax(13rem,0.38fr)", alignItems: "center" },
							}),
							dragOverRow === rowIndex &&
								css({ background: "color-mix(in srgb, var(--primary) 10%, transparent)" }),
						)}
					>
						<div className={cx("font-terminal", css({ fontSize: "0.75rem", color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }))}>
							{rowIndex + 1}.
						</div>
						<div className={css({ minWidth: 0, overflowWrap: "break-word", fontSize: "0.875rem", fontWeight: 500 })}>
							{row.item}
						</div>
						<div className={css({ minWidth: 0 })}>
							{row.choice ? (
								<div className={css({ display: "flex", minHeight: "2.25rem", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--primary) 50%, transparent)", background: "color-mix(in srgb, var(--primary) 10%, transparent)", padding: "0.375rem 0.5rem", fontSize: "0.875rem", color: "var(--primary)" })}>
									<span className={cx(questionStyles.minFlex, questionStyles.breakWords)}>{row.choice}</span>
									<button
										type="button"
										disabled={submitted}
										onClick={() => onSetChoice(rowIndex, "", q.uniqueMatches !== false)}
										className={css({ flexShrink: 0, borderRadius: "0.25rem", border: "1px solid var(--border)", background: "var(--background)", padding: "0.125rem 0.375rem", fontSize: "0.625rem", color: "var(--muted-foreground)", _hover: { borderColor: "color-mix(in srgb, var(--primary) 60%, transparent)", color: "var(--primary)" } })}
									>
										Clear
									</button>
								</div>
							) : (
								<Select
									value={row.choice}
									disabled={submitted}
									onValueChange={(value) => onSetChoice(rowIndex, value, q.uniqueMatches !== false)}
									aria-label={`Match for ${row.item}`} className={css({ height: "3rem", width: "100%", borderRadius: "0.375rem", border: "1px dashed var(--border)", background: "color-mix(in srgb, var(--muted) 20%, transparent)", paddingInline: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)", outline: "none", _focus: { borderColor: "var(--primary)" }, [sm]: { fontSize: "0.875rem" } })}
								>
									<option value="">Drop or choose...</option>
									{q.choices?.map((choice, choiceIndex) => {
										const usedElsewhere = q.uniqueMatches !== false && selectedMatches.has(choice) && row.choice !== choice;
										return (
											<option key={choice} value={choice} disabled={usedElsewhere}>
												{String.fromCharCode(65 + choiceIndex)}. {choice}
											</option>
										);
									})}
								</Select>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
