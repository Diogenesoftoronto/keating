/**
 * Shared interaction styles for the chat composer controls.
 */
import { css, cx } from "../../../styled-system/css";

export const srInteractiveClass = css({
  transitionProperty:
    "color, background-color, border-color, opacity, box-shadow, transform",
  transitionDuration: "150ms",
});

export const composerIconButtonStyles = css.raw({
  display: "inline-flex",
  width: "2rem",
  height: "2rem",
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.375rem",
  border: "1px solid var(--border)",
  color: "var(--muted-foreground)",
  _hover: {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  _disabled: {
    color: "var(--muted-foreground)",
    opacity: 0.72,
  },
  sm: { width: "2.25rem", height: "2.25rem" },
});
export const composerIconButtonClass = cx(
  srInteractiveClass,
  css(composerIconButtonStyles),
);
