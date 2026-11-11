import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ArtifactBrowserSurfaceProps } from "./artifact-browser-shared";
import { ArtifactSurfaceBody } from "./workspace/ArtifactSurfaceBody";
import { useSurfaceFocus } from "./workspace/useSurfaceFocus";
import { css, cx } from "../../styled-system/css";

export function ArtifactBrowserOverlay(props: ArtifactBrowserSurfaceProps) {
  const { open, onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  // Modal: Escape closes, Tab stays inside, focus returns to the opener.
  const headingRef = useSurfaceFocus(open, onClose, dialogRef, true);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={css({
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "color-mix(in srgb, var(--background) 70%, transparent)",
        backdropFilter: "blur(4px)",
      })}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={props.sessionId ? "Session workspace" : "Artifact browser"}
        className={css({
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          display: "flex",
          height: "100%",
          width: "100%",
          maxWidth: "100vw",
          minWidth: 0,
          overflow: "hidden",
          flexDirection: "column",
          borderLeftWidth: "1px",
          borderColor: "var(--border)",
          background: "var(--background)",
          boxShadow: "0 25px 50px -12px rgb(0 0 0 / 0.25)",
          sm: { maxWidth: "960px" },
        })}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={css({
          display: "flex",
          minHeight: "3.5rem",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          borderBottomWidth: "1px",
          borderColor: "var(--border)",
          paddingInline: { base: "0.75rem", sm: "1rem" },
          paddingBlock: "0.625rem",
        })}>
          <div className={css({ minWidth: 0 })}>
            <div className={css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" })}>{props.sessionId ? "Workspace" : "Artifact browser"}</div>
            <div className={css({ maxWidth: "100%", overflowWrap: "break-word", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" })}>{props.sessionId ? "This session's study plan and concept maps." : "Browse lesson plans, maps, animations, benchmarks, and evolutions."}</div>
          </div>
          <button
            type="button"
            className={cx("dialog-icon-button", css({
              display: "inline-flex",
              flexShrink: 0,
              height: "2.75rem",
              width: "2.75rem",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
              transitionDuration: "150ms",
              _hover: {
                background: "var(--accent)",
                color: "var(--accent-foreground)",
              },
              _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "2px" },
            }))}
            aria-label={props.sessionId ? "Close workspace" : "Close artifact browser"}
            title="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className={css({
          minHeight: 0,
          minWidth: 0,
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: { base: "0.625rem", sm: "0.75rem" },
          sm: { padding: "1.5rem" },
        })}>
          <ArtifactSurfaceBody {...props} headingRef={headingRef} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
