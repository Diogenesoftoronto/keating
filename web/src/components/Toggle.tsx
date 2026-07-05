import { css } from "../../styled-system/css";

export interface ToggleProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	/** "primary" (default brand) or "success" (green, e.g. visible/on-meaning-good). */
	tone?: "primary" | "success";
	/** Accessible label, used when there is no adjacent visible text. */
	"aria-label"?: string;
}

const wrapperClass = css({
	position: "relative",
	display: "inline-flex",
	cursor: "pointer",
	alignItems: "center",
});
const srOnlyClass = css({
	position: "absolute",
	width: "1px",
	height: "1px",
	padding: 0,
	margin: "-1px",
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	borderWidth: 0,
});
const trackBaseClass = css({
	height: "1.25rem",
	width: "2.25rem",
	borderRadius: "9999px",
	transitionProperty: "background-color",
	transitionDuration: "150ms",
	position: "relative",
});
const trackToneClass = {
	primary: css({ backgroundColor: "var(--primary)" }),
	success: css({ backgroundColor: "var(--green)" }),
} as const;
const trackOffClass = css({ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 30%, transparent)" });
const knobClass = css({
	position: "absolute",
	top: "2px",
	left: "2px",
	height: "1rem",
	width: "1rem",
	borderRadius: "9999px",
	backgroundColor: "var(--paper)",
	transitionProperty: "transform",
	transitionDuration: "150ms",
});
const knobOnClass = css({ transform: "translateX(1rem)" });

/**
 * Shared on/off switch used across settings tabs. Replaces the repeated
 * `sr-only peer` + `h-5 w-9` markup that was copy-pasted in every tab.
 *
 * Tailwind's `peer-checked:` modifier compiled conditionally via the JIT
 * engine, so when the Tailwind layer was removed the switches degraded to
 * native browser checkboxes. This Panda version renders an explicit
 * track + knob pair and toggles track color / knob offset based on `checked`.
 */
export function Toggle({ checked, onChange, disabled, tone = "primary", "aria-label": ariaLabel }: ToggleProps) {
	const trackClass = checked ? trackToneClass[tone] : trackOffClass;
	return (
		<label className={wrapperClass} aria-label={ariaLabel}>
			<input
				type="checkbox"
				className={srOnlyClass}
				checked={checked}
				disabled={disabled}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span className={`${trackBaseClass} ${trackClass}`} aria-hidden="true">
				<span className={`${knobClass} ${checked ? knobOnClass : ""}`} />
			</span>
		</label>
	);
}
