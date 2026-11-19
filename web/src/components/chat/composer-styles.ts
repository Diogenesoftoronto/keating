/**
 * Shared interaction styles for the chat composer controls.
 */
import { css, cx } from "../../../styled-system/css";

export const srInteractiveClass = css({
  transitionProperty:
    "color, background-color, border-color, opacity, box-shadow, transform",
  transitionDuration: "150ms",
});

/* Quiet icon buttons, as drawn: no box at rest. The glyph carries the hover (its accent part
   lights and moves) and `k-bloom` puts a halftone bloom behind it. */
export const composerIconButtonStyles = css.raw({
  position: "relative",
  display: "inline-flex",
  width: "1.3462rem",
  height: "1.3462rem",
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.1923rem",
  border: "1px solid transparent",
  backgroundColor: "transparent",
  color: "var(--ink-soft)",
  _hover: { color: "var(--ink)" },
  _disabled: {
    color: "var(--ink-soft)",
    opacity: 0.5,
  },
});
export const composerIconButtonClass = cx(
  srInteractiveClass,
  "k-bloom",
  css(composerIconButtonStyles),
);
