import { css } from "../../../styled-system/css";

/**
 * One vocabulary of course-surface classes. Every course panel imports these so
 * the reading desk, the discussion, and the builder look like one workspace.
 */

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

export const coursePrimaryButtonClass = css({
  bg: "var(--course-green, #1e9b50)",
  color: "white",
  _hover: { bg: "var(--course-green-dark, #14743c)" },
});

export const courseQuietButtonClass = css({
  border: "1px solid transparent",
  bg: "transparent",
  px: "0.4rem",
  py: "0.25rem",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "var(--ink-soft)",
  _hover: { color: "var(--ink)", bg: "var(--course-wash, #ddebdd)" },
});

export const courseDangerButtonClass = css({ color: "var(--destructive)" });

export const courseCardClass = css({
  border: "1px solid var(--ink)",
  bg: "var(--card)",
});

export const coursePanelClass = css({
  border: "2px solid var(--ink)",
  bg: "var(--card)",
  boxShadow: "4px 4px 0 color-mix(in srgb, var(--ink) 22%, transparent)",
});

export const courseSectionClass = css({
  mt: "1rem",
  borderTop: "1px solid var(--ink)",
  pt: "0.85rem",
});

export const courseEmptyClass = css({
  border: "1px dashed color-mix(in srgb, var(--ink) 45%, transparent)",
  bg: "color-mix(in srgb, var(--paper) 70%, transparent)",
  p: "0.85rem",
  fontSize: "0.75rem",
  lineHeight: 1.5,
  color: "var(--ink-soft)",
});

export const courseCountChipClass = css({
  display: "inline-flex",
  minW: "1.15rem",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid color-mix(in srgb, var(--ink) 35%, transparent)",
  px: "0.28rem",
  fontFamily: "var(--mono-display)",
  fontSize: "0.6rem",
  fontWeight: 700,
  color: "var(--ink-soft)",
});

export function courseAvatarColor(role: string): string {
  return role === "teacher" || role === "owner"
    ? "var(--course-green, #1e9b50)"
    : "var(--peer-blue, #3468b3)";
}

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
