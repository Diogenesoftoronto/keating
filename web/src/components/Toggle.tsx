export interface ToggleProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	/** "primary" (default brand) or "success" (green, e.g. visible/on-meaning-good). */
	tone?: "primary" | "success";
	/** Accessible label, used when there is no adjacent visible text. */
	"aria-label"?: string;
}

/**
 * Shared on/off switch used across settings tabs. Replaces the repeated
 * `sr-only peer` + `h-5 w-9` markup that was copy-pasted in every tab.
 */
export function Toggle({ checked, onChange, disabled, tone = "primary", "aria-label": ariaLabel }: ToggleProps) {
	const onColor = tone === "success" ? "peer-checked:bg-green-500" : "peer-checked:bg-primary";
	return (
		<label className="relative inline-flex cursor-pointer items-center" aria-label={ariaLabel}>
			<input
				type="checkbox"
				className="sr-only peer"
				checked={checked}
				disabled={disabled}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<div
				className={`h-5 w-9 rounded-full bg-muted-foreground/30 ${onColor} transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4`}
			/>
		</label>
	);
}
