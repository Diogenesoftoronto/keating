import { css } from "../../../styled-system/css";

// Room controls still import these three legacy styles.
export const courseLabelClass = css({
  fontFamily: "var(--mono-display)",
  fontSize: "0.63rem",
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
});

export const courseInputClass = css({
  w: "100%",
  border: "1px solid var(--ink)",
  bg: "var(--paper)",
  px: "0.65rem",
  py: "0.55rem",
  fontSize: "0.82rem",
  color: "var(--ink)",
  outline: 0,
  _focus: { boxShadow: "0 0 0 2px var(--peer-blue, #3468b3)" },
  _placeholder: { color: "color-mix(in srgb, var(--ink-soft) 80%, transparent)" },
});

export const courseButtonClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
  border: "1px solid var(--ink)",
  bg: "var(--paper)",
  px: "0.7rem",
  py: "0.48rem",
  fontSize: "0.74rem",
  fontWeight: 750,
  color: "var(--ink)",
  whiteSpace: "nowrap",
  cursor: "pointer",
  _hover: { bg: "var(--course-wash, #ddebdd)" },
  _disabled: { opacity: 0.5, cursor: "not-allowed" },
});

export function formatCourseRelative(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 20_160) return `${Math.round(minutes / 1_440)}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
