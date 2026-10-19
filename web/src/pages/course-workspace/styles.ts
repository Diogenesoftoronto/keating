/**
 * Panda CSS class names for the course workspace shell (page chrome, tabs, and
 * the three-column grid). Shared by the workspace page and the sub-components
 * extracted from it so every piece renders with identical styling.
 */
import { css } from "../../../styled-system/css";
import {
  courseButtonClass,
  courseInputClass,
  courseLabelClass,
  coursePrimaryButtonClass,
} from "../../components/courses/course-ui";

export const workspaceStyles = {
  page: css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" }),
  top: css({
    position: "sticky",
    top: 0,
    zIndex: 40,
    borderBottom: "2px solid var(--ink)",
    bg: "color-mix(in srgb, var(--paper) 94%, transparent)",
    backdropFilter: "blur(12px)",
  }),
  topInner: css({
    mx: "auto",
    display: "flex",
    w: "100%",
    maxW: "104rem",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.6rem",
    px: "1rem",
    py: "0.5rem",
  }),
  tabRow: css({
    mx: "auto",
    display: "flex",
    w: "100%",
    minW: 0,
    maxW: "104rem",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    px: "1rem",
    pb: "0.45rem",
  }),
  tab: css({
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    borderBottom: "3px solid transparent",
    px: "0.5rem",
    py: "0.35rem",
    fontFamily: "var(--mono-display)",
    fontSize: "0.68rem",
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--ink-soft)",
    cursor: "pointer",
    _hover: { color: "var(--ink)" },
  }),
  grid: css({
    mx: "auto",
    display: "grid",
    w: "100%",
    gridTemplateColumns: "minmax(0, 1fr)",
    minH: "calc(100vh - 96px)",
    maxW: "104rem",
    lg: { gridTemplateColumns: "17rem minmax(0, 1fr)" },
    xl: { gridTemplateColumns: "17rem minmax(0, 1fr) 19rem" },
  }),
  left: css({
    borderBottom: "2px solid var(--ink)",
    bg: "var(--paper-deep, #e9e2d2)",
    p: "1rem",
    lg: { borderRight: "2px solid var(--ink)", borderBottom: 0 },
  }),
  center: css({
    minW: 0,
    bg: "var(--card)",
    p: { base: "1rem", md: "2rem", xl: "2.5rem" },
  }),
  right: css({
    borderTop: "2px solid var(--ink)",
    bg: "var(--paper-deep, #e9e2d2)",
    p: "1rem",
    lg: { gridColumn: "1 / -1" },
    xl: { gridColumn: "auto", borderTop: 0, borderLeft: "2px solid var(--ink)" },
  }),
  sectionLabel: courseLabelClass,
  button: courseButtonClass,
  primaryButton: coursePrimaryButtonClass,
  input: courseInputClass,
};
