import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { css, cx } from "../../styled-system/css";

const styles = {
  header: css({
    mx: "auto",
    mt: "1.5rem",
    maxW: "72rem",
    px: "1rem",
  }),
  frame: css({
    overflow: "hidden",
    border: "2px solid var(--ink)",
    bg: "var(--card)",
    boxShadow: "4px 4px 0 color-mix(in srgb, var(--ink) 18%, transparent)",
  }),
  headingRow: css({
    display: "flex",
    flexDir: "column",
    gap: "1rem",
    px: "1rem",
    py: "1rem",
    md: {
      flexDir: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      px: "1.25rem",
      py: "1.25rem",
    },
  }),
  heading: css({ minW: 0 }),
  context: css({
    mb: "0.25rem",
    fontFamily: "var(--mono-body)",
    fontSize: "0.75rem",
    color: "var(--accent-dim)",
  }),
  title: css({
    fontFamily: "var(--mono-display)",
    fontSize: "1.75rem",
    fontWeight: 700,
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
    md: { fontSize: "2rem" },
  }),
  description: css({
    mt: "0.5rem",
    maxW: "64ch",
    fontSize: "0.875rem",
    lineHeight: "1.375rem",
    color: "var(--ink-soft)",
  }),
  actions: css({
    display: "flex",
    w: "100%",
    flexShrink: 0,
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
    md: { w: "auto", justifyContent: "flex-end" },
  }),
  switcher: css({
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    borderTop: "1px solid var(--ink)",
    bg: "color-mix(in srgb, var(--paper) 76%, var(--card))",
  }),
  switchLink: css({
    display: "flex",
    minH: "2.75rem",
    alignItems: "center",
    justifyContent: "center",
    borderRight: "1px solid var(--ink)",
    px: "1rem",
    fontFamily: "var(--mono-body)",
    fontSize: "0.8125rem",
    fontWeight: 650,
    textDecoration: "none",
    transitionProperty: "background-color, color",
    transitionDuration: "150ms",
    _last: { borderRight: 0 },
    _hover: { bg: "var(--accent)", color: "var(--accent-foreground)" },
    _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "-3px" },
  }),
  switchActive: css({ bg: "var(--ink)", color: "var(--paper)" }),
  switchInactive: css({ color: "var(--ink)" }),
  metric: css({
    minW: 0,
    border: "1px solid var(--ink)",
    bg: "var(--card)",
    p: "1rem",
    boxShadow: "3px 3px 0 color-mix(in srgb, var(--ink) 14%, transparent)",
  }),
  metricHead: css({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    fontSize: "0.75rem",
    color: "var(--ink-soft)",
  }),
  metricLabel: css({ minW: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
  metricIcon: css({ flexShrink: 0, color: "var(--accent-dim)" }),
  metricValue: css({
    mt: "0.625rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "var(--mono-display)",
    fontSize: "1.5rem",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  }),
  metricDetail: css({
    mt: "0.25rem",
    minW: 0,
    overflowWrap: "break-word",
    fontSize: "0.75rem",
    lineHeight: "1.125rem",
    color: "var(--ink-soft)",
  }),
};

export function LearningInsightsHeader({
  current,
  context,
  title,
  description,
  actions,
}: {
  current: "usage" | "bench";
  context: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.frame}>
        <div className={styles.headingRow}>
          <div className={styles.heading}>
            <p className={styles.context}>{context}</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.description}>{description}</p>
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
        <nav className={styles.switcher} aria-label="Learning intelligence">
          <Link
            to="/usage"
            aria-current={current === "usage" ? "page" : undefined}
            className={cx(
              styles.switchLink,
              current === "usage" ? styles.switchActive : styles.switchInactive,
            )}
          >
            Learning activity
          </Link>
          <Link
            to="/bench"
            aria-current={current === "bench" ? "page" : undefined}
            className={cx(
              styles.switchLink,
              current === "bench" ? styles.switchActive : styles.switchInactive,
            )}
          >
            Model benchmark
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function LearningMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricHead}>
        <span className={styles.metricLabel}>{label}</span>
        <span className={styles.metricIcon}>{icon}</span>
      </div>
      <div className={styles.metricValue}>{value}</div>
      <div className={styles.metricDetail}>{detail}</div>
    </div>
  );
}
