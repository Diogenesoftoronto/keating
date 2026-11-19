import { EmptyState, Loading } from "../../design-system/kit";
/** Snapshots tab of the sandbox runtime dialog: session and saved snapshot lists with create/restore. */
import { css } from "../../../styled-system/css";
import { KeatingGlyph } from "../../design-system/glyphs";
import { styles } from "./sandbox-shared";
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
        <KeatingGlyph name="undo" size={12} /> Restore
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
      <EmptyState heading="Start NodePod to use snapshots." />
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
              <KeatingGlyph name="refresh" size={12} /> Refresh
            </button>
          )}
          <button
            type="button"
            onClick={createSnapshotAction}
            disabled={snapLoading}
            className={styles.primaryButtonSm}
          >
            {snapLoading ? <Loading size="inline" label="Create" /> : <><KeatingGlyph name="plus" size={12} /> Create</>}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState heading={emptyMessage} />
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
