/**
 * Runtime dialog ("sandbox") for the in-browser NodePod workspace. This file
 * owns the dialog/tab chrome, boot and teardown, and wires the per-concern
 * hooks and panels in ./sandbox/*.
 */
import { Select } from "./Select";
import { useEffect, useMemo, useRef, useState, useCallback, useTransition } from "react";
import Activity from "reicon-react/icons/Activity";
import Cpu from "reicon-react/icons/Cpu";
import FolderOpen from "reicon-react/icons/FolderOpen";
import Play from "reicon-react/icons/Play";
import PowerOff from "reicon-react/icons/PowerOff";
import RefreshCw from "reicon-react/icons/Refresh";
import Terminal from "reicon-react/icons/TerminalSquare";
import X from "reicon-react/icons/X";
import { KeatingIcon } from "./KeatingIcon";
import "./sandbox-view.css";
import { DesktopWorkspacePanel } from "./DesktopWorkspacePanel";
import { isDesktopNativeRuntime } from "../lib/desktop-native";

import { nodePodControlAction } from "../keating/agent-runtime";
import { bootNodePod, teardownNodePod } from "../keating/nodepod-runtime";
import "@xterm/xterm/css/xterm.css";
import { SandboxActivityPanel } from "./sandbox/SandboxActivityPanel";
import { SandboxFilesPanel } from "./sandbox/SandboxFilesPanel";
import { SandboxHistoryPanel } from "./sandbox/SandboxHistoryPanel";
import { SandboxProbesPanel } from "./sandbox/SandboxProbesPanel";
import { SandboxShellPanel } from "./sandbox/SandboxShellPanel";
import { SandboxSnapshotsPanel } from "./sandbox/SandboxSnapshotsPanel";
import { SandboxStatusPanel } from "./sandbox/SandboxStatusPanel";
import { errorMessage, isAdvancedTab, runtimeLabel, runtimeStatusLabel } from "./sandbox/sandbox-helpers";
import { RuntimeSpinner, styles } from "./sandbox/sandbox-shared";
import { useSandboxActivityLog } from "./sandbox/useSandboxActivityLog";
import { useSandboxFiles } from "./sandbox/useSandboxFiles";
import { useSandboxHistory } from "./sandbox/useSandboxHistory";
import { useSandboxProbe } from "./sandbox/useSandboxProbe";
import { useSandboxRuntime } from "./sandbox/useSandboxRuntime";
import { useSandboxSnapshots } from "./sandbox/useSandboxSnapshots";
import { useSandboxTerminal } from "./sandbox/useSandboxTerminal";

type TabId = "status" | "vfs" | "shell" | "snapshots" | "vc" | "log" | "probes";

/* ─── component ───────────────────────────────────────────── */

export function SandboxView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [booting, setBooting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("status");
  const [isTabPending, startTabTransition] = useTransition();
  const [nativeDirty, setNativeDirty] = useState(false);
  const [confirmNativeClose, setConfirmNativeClose] = useState(false);
  const requestClose = () => {
    if (nativeDirty) { setConfirmNativeClose(true); return; }
    setConfirmNativeClose(false);
    onClose();
  };

  const {
    runtime,
    setRuntime,
    runtimeError,
    nodePodActive,
    setNodePodActive,
    nodePodInfoState,
    setNodePodInfoState,
    refreshConfig,
  } = useSandboxRuntime();
  const { events, pushEvent, logRef } = useSandboxActivityLog();

  const availableTabs = useMemo(() => [
    { id: "status" as const, label: "Overview", icon: <KeatingIcon icon={Cpu} size={17} /> },
    { id: "vfs" as const, label: "Files", icon: <KeatingIcon icon={FolderOpen} size={17} />, disabled: !nodePodActive },
    { id: "shell" as const, label: "Terminal", icon: <KeatingIcon icon={Terminal} size={17} />, disabled: !nodePodActive },
    { id: "log" as const, label: "Activity", icon: <KeatingIcon icon={Activity} size={17} /> },
  ], [nodePodActive]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    void refreshAll();
    return () => { dialog?.close(); };
  }, [open]);

  const files = useSandboxFiles({ pushEvent, active: open && nodePodActive && activeTab === "vfs" });
  const { refreshVfs, resetAfterTeardown } = files;
  const terminal = useSandboxTerminal({ open, nodePodActive, shellTabActive: activeTab === "shell" });
  const { createAndAttachTerminal, detachTerminal } = terminal;
  const snapshotState = useSandboxSnapshots({ pushEvent, refreshVfs });
  const { refreshSnapshots, refreshDbSnapshots } = snapshotState;
  const history = useSandboxHistory({ pushEvent, refreshVfs, refreshDbSnapshots });
  const { refreshVc } = history;
  const probe = useSandboxProbe({ events, pushEvent, setRuntime });

  async function refreshAll() {
    await refreshConfig();
    if (nodePodActive) {
      await refreshVfs();
      await refreshVc();
    }
    refreshSnapshots();
  }

  /* ── boot / teardown ──────────────────────────────────── */

  const handleBoot = useCallback(async () => {
    setBooting(true);
    const started = performance.now();
    try {
      const pod = await bootNodePod();
      if (!pod) throw new Error("NodePod could not start. Try again or check Activity.");
      createAndAttachTerminal();
      await refreshConfig();
      pushEvent("status", "bootNodePod", true, { mode: "booted" }, Math.round(performance.now() - started));
    } catch (e) {
      pushEvent("status", "bootNodePod", false, { error: errorMessage(e) }, Math.round(performance.now() - started));
    } finally {
      setBooting(false);
    }
  }, [pushEvent, refreshConfig, createAndAttachTerminal]);

  const handleTeardown = useCallback(async () => {
    const started = performance.now();
    detachTerminal();
    await teardownNodePod();
    setNodePodActive(false);
    setActiveTab("status");
    await refreshConfig();
    setNodePodInfoState(null);
    resetAfterTeardown();
    pushEvent("status", "teardownNodePod", true, { mode: "torn down" }, Math.round(performance.now() - started));
  }, [pushEvent, refreshConfig, detachTerminal, resetAfterTeardown, setNodePodActive, setNodePodInfoState]);

  /* ─── render ─── */

  if (!open) return null;

  const nodePodAction = nodePodControlAction(runtime, nodePodActive);
  const status = runtimeStatusLabel({ booting, nodePodActive, hasExecutionEndpoint: !!runtime?.executionEndpoint });
  const advancedTab = isAdvancedTab(activeTab) ? activeTab : "";

  return (
    <dialog ref={dialogRef} className="sandbox-runtime" aria-labelledby="runtime-title" onCancel={(event) => { event.preventDefault(); requestClose(); }} onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className="runtime-heading">
            <span className="runtime-mark"><KeatingIcon icon={Cpu} size={24} active={nodePodActive} /></span>
            <div className={styles.minW0}>
              <h2 id="runtime-title">{isDesktopNativeRuntime(runtime) ? "Desktop workspace" : "Runtime"}</h2>
              <p>{runtimeError ? "Workspace unavailable" : isDesktopNativeRuntime(runtime) ? "Native files and processes" : runtime ? runtimeLabel(runtime.mode) : "Loading environment…"}</p>
            </div>
          </div>
          <button type="button" className="runtime-icon-button" aria-label="Close runtime" onClick={requestClose} autoFocus><KeatingIcon icon={X} size={20} /></button>
        </header>

        {confirmNativeClose && <div className="desktop-workspace-close" role="alert"><p>Your file has unsaved edits.</p><div><button type="button" onClick={() => setConfirmNativeClose(false)}>Keep editing</button><button type="button" onClick={() => { setConfirmNativeClose(false); setNativeDirty(false); onClose(); }}>Discard and close</button></div></div>}
        {runtimeError ? <div className="runtime-body"><div className="runtime-error" role="alert">{runtimeError}</div><button type="button" onClick={() => void refreshAll()}>Retry connection</button></div> : isDesktopNativeRuntime(runtime) && runtime?.projectRoot ? <DesktopWorkspacePanel workspacePath={runtime.projectRoot} onDirtyChange={setNativeDirty} /> : <>
        <div className="runtime-control-bar">
          <span className="runtime-state" data-running={nodePodActive} role="status"><span className="runtime-state-dot" />{status}</span>
          <div className="runtime-controls">
            <button type="button" onClick={refreshAll} className="runtime-icon-button" aria-label="Refresh runtime" title="Refresh runtime"><KeatingIcon icon={RefreshCw} size={18} /></button>
            {nodePodAction === "stop" ? (
              <button type="button" onClick={handleTeardown} className="runtime-stop"><KeatingIcon icon={PowerOff} size={17} />Stop</button>
            ) : nodePodAction === "boot" ? (
              <button type="button" onClick={handleBoot} disabled={booting} aria-label={booting ? "Starting NodePod" : "Start NodePod"} className={styles.primaryButton}>
                {booting ? <RuntimeSpinner /> : <KeatingIcon icon={Play} size={17} />}{booting ? "Starting…" : <><span className="runtime-start-full">Start NodePod</span><span className="runtime-start-short">Start</span></>}
              </button>
            ) : null}
          </div>
        </div>

        <nav className="runtime-navigation" aria-label="Runtime views">
          {availableTabs.map((tab) => (
            <button type="button" key={tab.id} disabled={tab.disabled} onClick={() => startTabTransition(() => setActiveTab(tab.id))} aria-pressed={activeTab === tab.id} className="runtime-nav-button" title={tab.disabled ? "Start NodePod to open " + tab.label.toLowerCase() : undefined}>{tab.icon}<span>{tab.label}</span></button>
          ))}
          <Select aria-label="More runtime views" className="runtime-more" data-active={!!advancedTab} value="" onValueChange={(value) => startTabTransition(() => setActiveTab(value as TabId))}>
            <option value="" disabled>More</option>
            <option value="snapshots" disabled={!nodePodActive}>Snapshots</option>
            <option value="vc" disabled={!nodePodActive}>History</option>
            <option value="probes">Diagnostics</option>
          </Select>
        </nav>

        <div className={styles.body} data-view={activeTab} aria-busy={isTabPending}>{renderTab()}</div>
        </>}
      </div>
    </dialog>
  );

  function renderTab() {
    switch (activeTab) {
      case "status":
        return (
          <SandboxStatusPanel
            runtime={runtime}
            nodePodActive={nodePodActive}
            nodePodInfoState={nodePodInfoState}
            snapshots={snapshotState.snapshots}
            events={events}
            onSelectTab={setActiveTab}
          />
        );
      case "vfs": return <SandboxFilesPanel files={files} nodePodActive={nodePodActive} />;
      case "shell":
        return (
          <SandboxShellPanel
            nodePodActive={nodePodActive}
            terminalContainerRef={terminal.terminalContainerRef}
            terminalReady={terminal.terminalReady}
            onClear={terminal.clearTerminal}
            onFit={terminal.fitTerminal}
          />
        );
      case "snapshots": return <SandboxSnapshotsPanel snapshotState={snapshotState} nodePodActive={nodePodActive} />;
      case "vc": return <SandboxHistoryPanel history={history} nodePodActive={nodePodActive} />;
      case "log": return <SandboxActivityPanel events={events} logRef={logRef} />;
      case "probes": return <SandboxProbesPanel probe={probe} events={events} />;
      default: return null;
    }
  }
}
