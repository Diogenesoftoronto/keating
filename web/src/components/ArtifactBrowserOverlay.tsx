import { useOpenMaterials } from "./workspace/useOpenMaterials";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../design-system/kit";
import type { ArtifactBrowserSurfaceProps } from "./artifact-browser-shared";
import { ArtifactSurfaceBody } from "./workspace/ArtifactSurfaceBody";
import { useSurfaceFocus } from "./workspace/useSurfaceFocus";
import { css } from "../../styled-system/css";

export function ArtifactBrowserOverlay(props: ArtifactBrowserSurfaceProps) {
  const { open, onClose } = props;
  // Chat keeps this surface mounted at both widths. Use its existing Materials
  // control to open the correct surface and preserve the session's selection.
  const showWorkspace = useRef(props.onViewChange);
  showWorkspace.current = props.onViewChange;
  const openMaterials = useCallback(() => {
    const control = document.querySelector<HTMLButtonElement>("button[data-material-count]");
    if (!control) return;
    if (control.getAttribute("aria-pressed") === "true") showWorkspace.current?.("workspace");
    else control.click();
  }, []);
  useOpenMaterials(props.materials?.sessionId, openMaterials);
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

  const showsSession = Boolean(props.sessionId && !props.artifactId && (props.view ?? "workspace") === "workspace");

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
        aria-label={props.sessionId ? "Materials" : "Artifact browser"}
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

          sm: { maxWidth: "960px" },
        })}
        onClick={(event) => event.stopPropagation()}
      >
        {/* The session's materials panel carries its own heading and close button. */}
        {!showsSession && <header className="h1-toolbar k-halftone">
          <strong>{props.sessionId ? "All materials" : "Artifact browser"}</strong>
          <IconButton glyph="x" label={props.sessionId ? "Close materials" : "Close artifact browser"} onClick={onClose} />
        </header>}

        <div className={css({
          minHeight: 0,
          minWidth: 0,
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: { base: "0.625rem", sm: "0.75rem" },
          sm: { padding: "1.5rem" },
        })}>
          <ArtifactSurfaceBody {...props} headingRef={headingRef} modal />
        </div>
      </div>
    </div>,
    document.body,
  );
}
