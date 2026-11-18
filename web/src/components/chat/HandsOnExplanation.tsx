import type { ReactNode } from "react";
import { css } from "../../../styled-system/css";

const disclosureClass = css({
  marginBlock: "0.5rem",
  borderTop: "1px solid var(--border)",
  borderBottom: "1px solid var(--border)",
});
const summaryClass = css({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "fit-content",
  minHeight: "2.75rem",
  cursor: "pointer",
  color: "var(--muted-foreground)",
  fontWeight: 500,
  _hover: { color: "var(--foreground)" },
  _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px", borderRadius: "0.25rem" },
  "&::-webkit-details-marker": { display: "none" },
});
const chevronClass = css({
  display: "inline-block",
  transition: "transform 150ms ease-out",
  "details[open] > summary > &": { transform: "rotate(90deg)" },
  _motionReduce: { transition: "none" },
});
const bodyClass = css({ paddingBottom: "0.75rem" });

/**
 * The prose a tutor wrote ahead of a requested hands-on control, kept whole and
 * in its authored order. A native disclosure, so it opens with Enter or Space
 * and the browser's find-in-page can reveal it.
 */
export function HandsOnExplanation({ children }: { children: ReactNode }) {
  return (
    <details className={disclosureClass} data-hands-on-explanation>
      <summary className={summaryClass}><span className={chevronClass} aria-hidden="true">▸</span>Read the explanation</summary>
      <div className={bodyClass}>{children}</div>
    </details>
  );
}
