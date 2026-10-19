/**
 * Full-page states of the course workspace shown instead of the desk: the
 * loading placeholder and the "course unavailable" error with a way back.
 */
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { css, cx } from "../../../styled-system/css";
import { workspaceStyles as s } from "./styles";

export function WorkspaceLoading() {
  return (
  <div className={s.page}>
    <p
      className={css({
        py: "8rem",
        textAlign: "center",
        color: "var(--ink-soft)",
      })}
    >
      Opening course desk…
    </p>
  </div>
  );
}

export function WorkspaceUnavailable({ error }: { error: string }) {
  return (
  <div className={s.page}>
    <div
      className={css({
        mx: "auto",
        maxW: "42rem",
        px: "1rem",
        py: "6rem",
        textAlign: "center",
      })}
    >
      <h1 className={css({ fontFamily: "Georgia, serif", fontSize: "2rem" })}>
        Course unavailable
      </h1>
      <p className={css({ mt: "0.75rem", color: "var(--destructive)" })}>
        {error || "This course could not be loaded."}
      </p>
      <Link
        to="/courses"
        className={cx(
          s.button,
          css({ mt: "1.5rem", textDecoration: "none", color: "inherit" }),
        )}
      >
        <ArrowLeft size={15} /> Course library
      </Link>
    </div>
  </div>
  );
}
