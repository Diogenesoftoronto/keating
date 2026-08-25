import { css } from "../../../styled-system/css";

export const focusableClass = css({
	_focusVisible: {
		outline: "3px solid var(--accent)",
		outlineOffset: "2px",
	},
});

export const compactButtonClass = css({
	display: "inline-flex",
	minHeight: "2.25rem",
	alignItems: "center",
	justifyContent: "center",
	gap: "0.375rem",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	background: "var(--background)",
	paddingInline: "0.625rem",
	fontSize: "0.75rem",
	fontWeight: 600,
	color: "var(--foreground)",
	transitionProperty: "background-color, color, border-color",
	transitionDuration: "150ms",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
	_disabled: { cursor: "not-allowed", opacity: 0.45 },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
});

export const primaryButtonClass = css({
	display: "inline-flex",
	minHeight: "2.25rem",
	alignItems: "center",
	justifyContent: "center",
	gap: "0.375rem",
	borderRadius: "0.375rem",
	border: "1px solid var(--ink)",
	background: "var(--ink)",
	paddingInline: "0.75rem",
	fontSize: "0.75rem",
	fontWeight: 650,
	color: "var(--paper)",
	transitionProperty: "opacity, background-color",
	transitionDuration: "150ms",
	_hover: { opacity: 0.86 },
	_disabled: { cursor: "not-allowed", opacity: 0.45 },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
});

export const iconButtonClass = css({
	display: "inline-flex",
	width: "2.25rem",
	height: "2.25rem",
	flex: "0 0 auto",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	color: "var(--muted-foreground)",
	_hover: { background: "var(--accent)", color: "var(--accent-foreground)" },
	_disabled: { cursor: "not-allowed", opacity: 0.45 },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "2px" },
});

export const inputClass = css({
	width: "100%",
	minHeight: "2.25rem",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	background: "var(--background)",
	paddingInline: "0.625rem",
	fontSize: "0.8125rem",
	color: "var(--foreground)",
	_placeholder: { color: "var(--muted-foreground)" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
});

export const textareaClass = css({
	width: "100%",
	minHeight: "5.25rem",
	resize: "vertical",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	background: "var(--background)",
	padding: "0.625rem",
	fontSize: "0.8125rem",
	lineHeight: 1.5,
	color: "var(--foreground)",
	_placeholder: { color: "var(--muted-foreground)" },
	_focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" },
});

export const sectionHeadingClass = css({
	fontSize: "0.6875rem",
	fontWeight: 700,
	letterSpacing: "0.08em",
	textTransform: "uppercase",
	color: "var(--muted-foreground)",
});

export const srOnlyClass = css({
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

export const metaTextClass = css({
	fontSize: "0.6875rem",
	lineHeight: 1.4,
	color: "var(--muted-foreground)",
});
