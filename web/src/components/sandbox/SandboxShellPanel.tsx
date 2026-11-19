import { EmptyState, Loading } from "../../design-system/kit";
/** Terminal tab of the sandbox runtime dialog: toolbar plus the xterm mount point. */
import type { RefObject } from "react";
import { css } from "../../../styled-system/css";
import { KeatingGlyph } from "../../design-system/glyphs";
import { styles } from "./sandbox-shared";

export function SandboxShellPanel({
  nodePodActive,
  terminalContainerRef,
  terminalReady,
  onClear,
  onFit,
}: {
  nodePodActive: boolean;
  terminalContainerRef: RefObject<HTMLDivElement | null>;
  terminalReady: boolean;
  onClear: () => void;
  onFit: () => void;
}) {
  if (!nodePodActive) {
    return (
      <EmptyState heading="Start NodePod to use the shell." />
    );
  }
  return (
    <div className="runtime-terminal-view">
      <div className="runtime-wrap-toolbar">
        <span className={styles.semiboldXs}>Terminal</span>
        <div className={css({ display: "flex", gap: "0.25rem" })}>
          <button
            type="button"
            onClick={onClear}
            className={styles.outlineButtonSmBg}
          >
            <KeatingGlyph name="undo" size={12} />
            Clear
          </button>
          <button
            type="button"
            onClick={onFit}
            className={styles.outlineButtonSmBg}
          >
            <KeatingGlyph name="expand" size={12} />
            Fit
          </button>
        </div>
      </div>
      <div
        ref={terminalContainerRef}
        className={css({ width: "100%", overflow: "hidden", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "black" })}
        style={{ flex: 1, minHeight: "18rem" }}
      />
      {!terminalReady && (
        <Loading label="Booting terminal…" />
      )}
    </div>
  );
}
