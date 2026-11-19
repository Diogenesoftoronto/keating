/**
 * Panda CSS class names for the course workspace shell (page chrome, tabs, and
 * the three-column grid). Shared by the workspace page and the sub-components
 * extracted from it so every piece renders with identical styling.
 */
import { css } from "../../../styled-system/css";
export const workspaceStyles = {
  page: css({ minH: "100vh", bg: "var(--paper)", color: "var(--ink)" }),
  grid: "cw-grid",
  left: "cw-outline",
  center: "cw-center",
  right: "cw-rail",
  sectionLabel: "k-eyebrow",
  input: "k-input",
};
