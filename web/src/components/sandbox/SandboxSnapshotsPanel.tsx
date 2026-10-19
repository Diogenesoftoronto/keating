/** Snapshots tab of the sandbox runtime dialog: session and saved snapshot lists with create/restore. */
import Plus from "reicon-react/icons/Plus";
import RefreshCw from "reicon-react/icons/Refresh";
import RotateCcw from "reicon-react/icons/RotateLeft";
import { css } from "../../../styled-system/css";
import { KeatingIcon } from "../KeatingIcon";
import { RuntimeSpinner, styles } from "./sandbox-shared";
import type { SandboxSnapshots } from "./useSandboxSnapshots";

type SnapshotRowData = SandboxSnapshots["snapshots"][number];

function SnapshotRow({ snap, onRestore }: { snap: SnapshotRowData; onRestore: (data: unknown) => void }) {
  return (
    <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem" })}>
      <div className={styles.minW0}>
        <div className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", fontWeight: 500 })}>{snap.id}</div>
        <div className={styles.text10Muted}>{snap.instanceId} · {new Date(snap.createdAt).toLocaleString()}</div>
      </div>
      <button
        type="button"
        onClick={() => onRestore(snap.data)}
        className={css({ marginLeft: "0.5rem", display: "inline-flex", height: "1.75rem", flexShrink: 0, alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", _hover: { background: "var(--accent)" } })}
      >
        <KeatingIcon icon={RotateCcw} size={12} /> Restore
      </button>
    </div>
  );
}

export function SandboxSnapshotsPanel({
  snapshotState,
  nodePodActive,
}: {
  snapshotState: SandboxSnapshots;
  nodePodActive: boolean;
}) {
  const {
    snapshots,
    dbSnapshots,
    snapLoading,
    showDbSnapshots,
    setShowDbSnapshots,
    refreshDbSnapshots,
    createSnapshotAction,
    restoreSnapshotAction,
  } = snapshotState;

  if (!nodePodActive) {
    return (
      <div className={styles.textXsMuted}>
        Start NodePod to use snapshots.
      </div>
    );
  }

  const visible = showDbSnapshots ? dbSnapshots : snapshots;
  const emptyMessage = showDbSnapshots
    ? "No saved snapshots yet. Create one to return to this workspace later."
    : "Save a snapshot before your next experiment.";

  return (
    <div className={styles.grid3}>
      <div className="runtime-view-intro"><h3>Snapshots</h3></div>
      <div className="runtime-wrap-toolbar">
        <div className={css({ display: "flex", alignItems: "center", gap: "0.75rem" })}>
          <span className={styles.semiboldXs}>
            {showDbSnapshots ? `Saved (${dbSnapshots.length})` : `Session (${snapshots.length})`}
          </span>
          <button
            type="button"
            onClick={() => setShowDbSnapshots((v) => !v)}
            className={css({ fontSize: "10px", color: "var(--muted-foreground)", textDecorationLine: "underline", _hover: { color: "var(--foreground)" } })}
          >
            {showDbSnapshots ? "Show session" : "Show saved"}
          </button>
        </div>
        <div className={css({ display: "flex", gap: "0.25rem" })}>
          {showDbSnapshots && (
            <button
              type="button"
              onClick={refreshDbSnapshots}
              className={styles.outlineButtonSmBg}
            >
              <KeatingIcon icon={RefreshCw} size={12} /> Refresh
            </button>
          )}
          <button
            type="button"
            onClick={createSnapshotAction}
            disabled={snapLoading}
            className={styles.primaryButtonSm}
          >
            {snapLoading ? <RuntimeSpinner size={12} /> : <KeatingIcon icon={Plus} size={12} />}
            Create
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className={styles.textXsMuted}>{emptyMessage}</div>
      ) : (
        <div className={styles.grid2}>
          {visible.map((snap) => (
            <SnapshotRow key={snap.id} snap={snap} onRestore={restoreSnapshotAction} />
          ))}
        </div>
      )}
    </div>
  );
}
