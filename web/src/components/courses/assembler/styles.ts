/** Panda CSS classes shared by the course assembler sections. */
import { css } from "../../../../styled-system/css";

export const inputClass = css({
  w: "100%",
  border: "1px solid var(--ink)",
  bg: "var(--paper)",
  px: "0.75rem",
  py: "0.65rem",
  fontSize: "0.86rem",
  outline: 0,
  _focus: { boxShadow: "0 0 0 2px var(--peer-blue, #3468b3)" },
});

export const choiceClass = css({
  display: "grid",
  gridTemplateColumns: "1.1rem minmax(0, 1fr)",
  alignItems: "start",
  gap: "0.65rem",
  border: "1px solid var(--ink)",
  bg: "var(--card)",
  p: "0.8rem",
});
