import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ArtifactViewer } from "./ArtifactViewer";
import {
  artifactBrowserStorage,
  type ArtifactBrowserSurfaceProps,
} from "./artifact-browser-shared";
import { css, cx } from "../../styled-system/css";

export function ArtifactBrowserOverlay({ open, artifactId, onClose }: ArtifactBrowserSurfaceProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

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
      role="dialog"
      aria-modal="true"
      aria-label="Artifact browser"
      onClick={onClose}
    >
      <div
        className={css({
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          display: "flex",
          height: "100%",
          width: "100%",
          maxWidth: "100dvw",
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
            <div className={css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" })}>Artifact browser</div>
            <div className={css({ maxWidth: "100%", overflowWrap: "break-word", fontSize: "0.75rem", lineHeight: "1.25rem", color: "var(--muted-foreground)" })}>Browse lesson plans, maps, animations, benchmarks, and evolutions.</div>
          </div>
          <button
            type="button"
            className={cx("dialog-icon-button", css({
              display: "inline-flex",
              height: "2rem",
              width: "2rem",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
              transitionDuration: "150ms",
              _hover: {
                background: "var(--accent)",
                color: "var(--accent-foreground)",
              },
            }))}
            aria-label="Close artifact browser"
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
          <ArtifactViewer storage={artifactBrowserStorage} artifactId={artifactId} onClose={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
