/** Choice / free-text question body: answer tiles, an optional "or type your own" input. */
import { css, cx } from "../../../styled-system/css";
import { AnswerTile } from "../quiz/ActivityGame";
import type { QuestionField } from "../QuestionRenderer";
import type { BlankState } from "./question-answers";
import { questionStyles } from "./question-styles";

export function ChoiceQuestionBody({
	q,
	state,
	submitted,
	onToggleChoice,
	onSetText,
	onEnter,
}: {
	q: QuestionField;
	state: BlankState;
	submitted: boolean;
	onToggleChoice: (choice: string, multiSelect: boolean) => void;
	onSetText: (value: string) => void;
	/** Called on Enter in the text input; the parent decides whether to advance or submit. */
	onEnter: () => void;
}) {
	return (
		<>
			<p className="activity-prompt">{q.question}</p>

			{q.choices && q.choices.length > 0 && (
				<div className="activity-answer-grid" role="group" aria-label={q.multiSelect ? "Choose all that apply" : "Choose an answer"}>
					{q.choices.map((choice, choiceIndex) => <AnswerTile key={choice} label={choice} index={choiceIndex} selected={state.selected.includes(choice)} multiple={q.multiSelect} disabled={submitted} onClick={() => onToggleChoice(choice, q.multiSelect ?? false)} />)}
				</div>
			)}

			{q.allowText && (
				<div className={questionStyles.stack2}>
					{q.choices && q.choices.length > 0 && (
						<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
							<div className={css({ height: "1px", flex: 1, background: "var(--border)" })} />
							<span>or type your own</span>
							<div className={css({ height: "1px", flex: 1, background: "var(--border)" })} />
						</div>
					)}
					<input
						type="text"
						aria-label="Your answer" className={cx(questionStyles.field, "activity-field", css({ paddingInline: "0.75rem" }))}
						placeholder="Your answer..."
						value={state.text}
						disabled={submitted}
						onChange={(e) => onSetText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") onEnter();
						}}
					/>
				</div>
			)}
		</>
	);
}
