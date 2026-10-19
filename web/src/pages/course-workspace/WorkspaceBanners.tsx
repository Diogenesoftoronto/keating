/**
 * Notices shown between the top bar and the workspace grid: a dismissible
 * error alert, and the prompt a learner sees when a teacher has requested full
 * access to their work.
 */
import { X } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { workspaceStyles as s } from "./styles";

export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss(): void;
}) {
  return (
  <div
    role="alert"
    className={css({
      position: "sticky",
      top: "88px",
      zIndex: 30,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "1rem",
      borderBottom: "1px solid var(--destructive)",
      bg: "#f8e4de",
      px: "1rem",
      py: "0.6rem",
      color: "#7d2b1d",
    })}
  >
    <span>{error}</span>
    <button type="button" onClick={onDismiss} aria-label="Dismiss">
      <X size={16} />
    </button>
  </div>
  );
}

export function TeacherAccessBanner({
  onRespond,
}: {
  onRespond(approve: boolean): void;
}) {
  return (
  <div
    className={css({
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "center",
      gap: "0.75rem",
      borderBottom: "2px solid var(--ink)",
      bg: "#fff0d4",
      px: "1rem",
      py: "0.75rem",
      fontSize: "0.82rem",
    })}
  >
    <strong>
      Your teacher requested full access to current and future course work.
    </strong>
    <button
      type="button"
      className={cx(s.button, s.primaryButton)}
      onClick={() => onRespond(true)}
    >
      Approve once
    </button>
    <button
      type="button"
      className={s.button}
      onClick={() => onRespond(false)}
    >
      Keep private
    </button>
  </div>
  );
}
