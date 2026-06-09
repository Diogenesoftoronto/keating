import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ArtifactViewer } from "./ArtifactViewer";
import { KeatingStorage } from "../keating/storage";

interface ArtifactBrowserOverlayProps {
  open: boolean;
  artifactId?: string;
  onClose: () => void;
}

const artifactStorage = new KeatingStorage();

export function ArtifactBrowserOverlay({ open, artifactId, onClose }: ArtifactBrowserOverlayProps) {
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
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Artifact browser"
      onClick={onClose}
    >
      <div
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-[100vw] flex-col border-l border-border bg-background shadow-2xl sm:max-w-[960px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Artifact browser</div>
            <div className="text-xs text-muted-foreground">Browse lesson plans, maps, animations, benchmarks, and evolutions.</div>
          </div>
          <button
            type="button"
            className="dialog-icon-button inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Close artifact browser"
            title="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6">
          <ArtifactViewer storage={artifactStorage} artifactId={artifactId} onClose={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
