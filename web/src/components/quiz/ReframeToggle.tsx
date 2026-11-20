/** Selector for alternative wordings ("reframes") of a quiz question. */
import { Select } from "../Select";

export function ReframeToggle({
	modes,
	active,
	onChange,
}: {
	modes: string[];
	active: string | null;
	onChange: (mode: string | null) => void;
}) {
	if (modes.length === 0) return null;
	return (
		<label className="quiz-reframe">
			<span>View</span>
			<Select
				aria-label="Question wording"
				value={active ?? ""}
				onValueChange={(value) => onChange(value || null)}
			>
				<option value="">Default</option>
				{modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
			</Select>
		</label>
	);
}
