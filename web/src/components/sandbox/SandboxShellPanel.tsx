/** Terminal tab of the sandbox runtime dialog: toolbar plus the xterm mount point. */
import Maximize2 from "reicon-react/icons/Maximize2";
import RotateCcw from "reicon-react/icons/RotateLeft";
import type { RefObject } from "react";
import { css } from "../../../styled-system/css";
import { KeatingIcon } from "../KeatingIcon";
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
      <div className={styles.textXsMuted}>
        Start NodePod to use the shell.
      </div>
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
            <KeatingIcon icon={RotateCcw} size={12} />
            Clear
          </button>
          <button
            type="button"
            onClick={onFit}
            className={styles.outlineButtonSmBg}
          >
            <KeatingIcon icon={Maximize2} size={12} />
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
        <div className={styles.textXsMuted}>Booting terminal…</div>
      )}
    </div>
  );
}
