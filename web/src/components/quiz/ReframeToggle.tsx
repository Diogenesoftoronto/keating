/** Selector for alternative wordings ("reframes") of a quiz question. */
import { css } from "../../../styled-system/css";
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
		<label className={css({ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
			<span>View</span>
			<Select
				aria-label="Question wording"
				value={active ?? ""}
				onValueChange={(value) => onChange(value || null)}
				className={css({
					border: 0,
					borderBottom: "1px solid var(--border)",
					borderRadius: 0,
					background: "transparent",
					padding: "0.2rem 1.25rem 0.2rem 0.125rem",
					fontSize: "0.6875rem",
					color: "var(--foreground)",
					_focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" },
				})}
			>
				<option value="">Default</option>
				{modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
			</Select>
		</label>
	);
}
