/**
 * Full-page states of the course workspace shown instead of the desk: the
 * loading placeholder and the "course unavailable" error with a way back.
 */
import { ButtonLink, Loading } from "../../design-system/kit";
import { css } from "../../../styled-system/css";
import { workspaceStyles as s } from "./styles";

export function WorkspaceLoading() {
  return (
  <div className={s.page}>
    <Loading label="Opening course desk…" size="page" />
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
      <h1 className="cw-empty-title">
        Course unavailable
      </h1>
      <p className={css({ mt: "0.75rem", color: "var(--destructive)" })}>
        {error || "This course could not be loaded."}
      </p>
      <ButtonLink to="/courses" glyph="left">Course library</ButtonLink>
    </div>
  </div>
  );
}
