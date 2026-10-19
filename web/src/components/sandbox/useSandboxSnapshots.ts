/** Snapshot state for the sandbox dialog: session log, saved (IndexedDB) list, and create/restore actions. */
import { useCallback, useEffect, useState } from "react";
import {
  getSnapshotLog,
  nodePodCreateSnapshot,
  nodePodLoadSnapshotsFromDB,
  nodePodRestoreSnapshot,
} from "../../keating/nodepod-runtime";
import { errorMessage, type PushSandboxEvent } from "./sandbox-helpers";

export function useSandboxSnapshots({
  pushEvent,
  refreshVfs,
}: {
  pushEvent: PushSandboxEvent;
  refreshVfs: () => Promise<void>;
}) {
  const [snapshots, setSnapshots] = useState<ReturnType<typeof getSnapshotLog>>(() => getSnapshotLog());
  const [dbSnapshots, setDbSnapshots] = useState<Awaited<ReturnType<typeof nodePodLoadSnapshotsFromDB>>>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [showDbSnapshots, setShowDbSnapshots] = useState(false);

  /* IndexedDB snapshots on mount */
  useEffect(() => {
    nodePodLoadSnapshotsFromDB().then(setDbSnapshots).catch(() => setDbSnapshots([]));
  }, []);

  const refreshSnapshots = useCallback(() => {
    setSnapshots(getSnapshotLog());
  }, []);

  const refreshDbSnapshots = useCallback(async () => {
    try {
      const fromDB = await nodePodLoadSnapshotsFromDB();
      setDbSnapshots(fromDB);
    } catch {
      setDbSnapshots([]);
    }
  }, []);

  const createSnapshotAction = useCallback(async () => {
    setSnapLoading(true);
    const started = performance.now();
    try {
      const snap = await nodePodCreateSnapshot(`manual-${Date.now()}`);
      pushEvent("snapshots", "snapshot.create", true, { id: snap.id }, Math.round(performance.now() - started));
      refreshSnapshots();
      await refreshDbSnapshots();
    } catch (e) {
      pushEvent("snapshots", "snapshot.create", false, { error: errorMessage(e) }, Math.round(performance.now() - started));
    } finally {
      setSnapLoading(false);
    }
  }, [pushEvent, refreshSnapshots, refreshDbSnapshots]);

  const restoreSnapshotAction = useCallback(async (data: unknown) => {
    const started = performance.now();
    try {
      await nodePodRestoreSnapshot(data);
      pushEvent("snapshots", "snapshot.restore", true, {}, Math.round(performance.now() - started));
      refreshVfs();
    } catch (e) {
      pushEvent("snapshots", "snapshot.restore", false, { error: errorMessage(e) }, Math.round(performance.now() - started));
    }
  }, [pushEvent, refreshVfs]);

  return {
    snapshots,
    dbSnapshots,
    snapLoading,
    showDbSnapshots,
    setShowDbSnapshots,
    refreshSnapshots,
    refreshDbSnapshots,
    createSnapshotAction,
    restoreSnapshotAction,
  };
}

export type SandboxSnapshots = ReturnType<typeof useSandboxSnapshots>;
