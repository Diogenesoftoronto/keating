import { Select } from "./Select";
import { useEffect, useMemo, useRef, useState, useCallback, useTransition } from "react";
import Activity from "reicon-react/icons/Activity";
import Bug from "reicon-react/icons/Bug";
import CheckCircle2 from "reicon-react/icons/CheckCircle";
import ChevronLeft from "reicon-react/icons/ChevronLeft";
import Copy from "reicon-react/icons/Copy";
import Cpu from "reicon-react/icons/Cpu";
import Download from "reicon-react/icons/Download";
import FileCode from "reicon-react/icons/CodeFile";
import FolderOpen from "reicon-react/icons/FolderOpen";
import GitBranch from "reicon-react/icons/BranchUp";
import GitCommit from "reicon-react/icons/Save";
import GitCompare from "reicon-react/icons/Code2";
import HardDrive from "reicon-react/icons/HardDrive";
import CircleHelp from "reicon-react/icons/HelpCircle";
import Home from "reicon-react/icons/Home";
import Maximize2 from "reicon-react/icons/Maximize2";
import Play from "reicon-react/icons/Play";
import Plus from "reicon-react/icons/Plus";
import Power from "reicon-react/icons/Power";
import PowerOff from "reicon-react/icons/PowerOff";
import RefreshCw from "reicon-react/icons/Refresh";
import RotateCcw from "reicon-react/icons/RotateLeft";
import Save from "reicon-react/icons/Save";
import Terminal from "reicon-react/icons/TerminalSquare";
import Trash2 from "reicon-react/icons/Trash2";
import Upload from "reicon-react/icons/Upload";
import X from "reicon-react/icons/X";
import { KeatingIcon } from "./KeatingIcon";
import "./sandbox-view.css";
import { JsonCrackBlock } from "./JsonCrackBlock";

import {
  loadAgentRuntimeConfig,
  nodePodControlAction,
  type KeatingAgentRuntimeConfig,
} from "../keating/agent-runtime";
import {
  bootNodePod,
  teardownNodePod,
  nodePodExecute,
  nodePodInfo,
  nodePodReaddir,
  nodePodReadTextFile,
  nodePodWriteTextFile,
  nodePodDeletePath,
  nodePodCreatePath,
  type VfsEntry,
  nodePodCreateSnapshot,
  nodePodRestoreSnapshot,
  getSnapshotLog,
  NODEPOD_LOCAL_ENDPOINT,
  nodePodDiffFile,
  nodePodCreateTerminal,
  nodePodDetachTerminal,
  nodePodGetTerminal,
  nodePodLoadSnapshotsFromDB,
  nodePodGetAllFileContents,
  isNodePodActive,
} from "../keating/nodepod-runtime";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { diffStrings, type LineDiff } from "../keating/sandbox-engine";
import {
	sandboxCommit,
	sandboxCreateBranch,
	sandboxCheckoutBranch,
	sandboxListBranches,
	sandboxListCommits,
	sandboxDiffCommits,
	sandboxReadCommitFiles,
	getSandboxRepo,
	type SandboxCommit,
	type SandboxBranch,
} from "../keating/sandbox-git";
import {
  buildSandboxPortableBundle,
  importSandboxPortableBundle,
  type KeatingSandboxPortableBundle,
} from "../keating/sandbox-export";
import { css, cx } from "../../styled-system/css";

type DiffChange = Awaited<ReturnType<typeof sandboxDiffCommits>>[number];

type TabId = "status" | "vfs" | "shell" | "snapshots" | "vc" | "log" | "probes";

interface LogEvent {
  id: string;
  timestamp: number;
  tab: string;
  operation: string;
  ok: boolean;
  durationMs?: number | null;
  output: unknown;
}

/* ─── helpers ─────────────────────────────────────────────── */

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function uid() {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function runtimeLabel(mode: KeatingAgentRuntimeConfig["mode"]): string {
  switch (mode) {
    case "browser-nodepod": return "NodePod · local";
    case "browser-only": return "This browser";
    case "host": return "Host machine";
    case "remote": return "Remote server";
    case "cloud": return "Cloud container";
    default: return "Unknown";
  }
}

const styles = {
  panel: "runtime-panel",
  header: "runtime-header",
  minW0: "runtime-min-w0",
  flexCenter: "runtime-flex-center",
  body: "runtime-body",
  grid2: "runtime-grid2",
  grid3: "runtime-grid3",
  card: "runtime-card",
  textXsMuted: "runtime-text-xs-muted",
  text10Muted: "runtime-text10-muted",
  semiboldXs: "runtime-semibold-xs",
  mono: "runtime-mono",
  monoXs: "runtime-mono-xs",
  primaryButtonSm: "runtime-primary-button-sm",
  primaryButton: "runtime-primary-button",
  outlineButtonSmBg: "runtime-outline-button-sm-bg",
  outlineButton: "runtime-outline-button",
  inputBase: "runtime-input-base",
  inputMono: "runtime-input-mono",
  hidden: "runtime-hidden",
};

function RuntimeSpinner({ size = 16 }: { size?: number }) {
  return <KeatingIcon icon={RefreshCw} size={size} className="runtime-spinner" />;
}


/* ─── component ───────────────────────────────────────────── */

export function SandboxView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [runtime, setRuntime] = useState<KeatingAgentRuntimeConfig | null>(null);
  const [nodePodActive, setNodePodActive] = useState(false);
  const [booting, setBooting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("status");
  const [isTabPending, startTabTransition] = useTransition();
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  /* status */
  const [nodePodInfoState, setNodePodInfoState] = useState<Awaited<ReturnType<typeof nodePodInfo>> | null>(null);

  /* vfs */
  const [vfsPath, setVfsPath] = useState("/workspace");
  const [vfsEntries, setVfsEntries] = useState<VfsEntry[]>([]);
  const [vfsLoading, setVfsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diffLines, setDiffLines] = useState<LineDiff[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [createType, setCreateType] = useState<"file" | "dir">("file");

  /* shell */
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);

  /* snapshots */
  const [snapshots, setSnapshots] = useState<ReturnType<typeof getSnapshotLog>>(() => getSnapshotLog());
  const [dbSnapshots, setDbSnapshots] = useState<Awaited<ReturnType<typeof nodePodLoadSnapshotsFromDB>>>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [showDbSnapshots, setShowDbSnapshots] = useState(false);

  /* version control (Lix) */
  const [vcBranches, setVcBranches] = useState<SandboxBranch[]>([]);
  const [vcCommits, setVcCommits] = useState<SandboxCommit[]>([]);
  const [vcActiveBranch, setVcActiveBranch] = useState<string>("main");
  const [vcCommitMessage, setVcCommitMessage] = useState("");
  const [vcNewBranchName, setVcNewBranchName] = useState("");
  const [vcLoading, setVcLoading] = useState(false);
  const [vcDiff, setVcDiff] = useState<{
    fromCommit: string;
    toCommit: string;
    changes: DiffChange[];
  } | null>(null);
  const [portableBusy, setPortableBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  /* probes */
  const [probeKind, setProbeKind] = useState("config");
  const [payloadText, setPayloadText] = useState("{}");
  const [runningProbe, setRunningProbe] = useState(false);

  const logRef = useRef<HTMLDivElement | null>(null);

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

  /* ── IndexedDB snapshots on mount ─────────────────────── */
  useEffect(() => {
    nodePodLoadSnapshotsFromDB().then(setDbSnapshots).catch(() => setDbSnapshots([]));
  }, []);

  /* Fit the terminal to its visible panel, including after reopening. */
  useEffect(() => {
    if (!open || !nodePodActive || activeTab !== "shell") return;
    const term = nodePodGetTerminal();
    const container = terminalContainerRef.current;
    if (!term || !container) return;
    term.attach(container);
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { term.fit(); setTerminalReady(true); });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [open, activeTab, nodePodActive]);

  /* ── refresh helpers ──────────────────────────────────── */

  const pushEvent = useCallback((tab: string, operation: string, ok: boolean, output: unknown, durationMs?: number | null) => {
    const ev: LogEvent = { id: uid(), timestamp: Date.now(), tab, operation, ok, output, durationMs };
    setEvents((prev) => [ev, ...prev].slice(0, 500));
    if (logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, []);

  async function refreshAll() {
    await refreshConfig();
    if (nodePodActive) {
      await refreshVfs();
      await refreshVc();
    }
    refreshSnapshots();
  }

  const refreshConfig = useCallback(async () => {
    const config = await loadAgentRuntimeConfig(true);
    setRuntime(config);
    const active = isNodePodActive();
    setNodePodActive(active);
    if (active || getSnapshotLog().length > 0) {
      const info = await nodePodInfo().catch(() => null);
      setNodePodInfoState(info);
    }
  }, []);

  const refreshVfs = useCallback(async () => {
    setVfsLoading(true);
    try {
      const entries = await nodePodReaddir(vfsPath).catch(() => []);
      setVfsEntries(entries);
    } catch {
      setVfsEntries([]);
    } finally {
      setVfsLoading(false);
    }
  }, [vfsPath]);

  useEffect(() => {
    if (open && nodePodActive && activeTab === "vfs") void refreshVfs();
  }, [open, nodePodActive, activeTab, refreshVfs]);

  const refreshSnapshots = useCallback(() => {
    setSnapshots(getSnapshotLog());
  }, []);

  /* ── boot / teardown ──────────────────────────────────── */

  const handleBoot = useCallback(async () => {
    setBooting(true);
    const started = performance.now();
    try {
      const pod = await bootNodePod();
      if (!pod) throw new Error("NodePod could not start. Try again or check Activity.");
      const term = nodePodCreateTerminal({
        Terminal: XTerm,
        FitAddon,
        SerializeAddon,
      });
      if (term) {
        if (terminalContainerRef.current) {
          term.attach(terminalContainerRef.current);
          term.fit();
        }
        setTerminalReady(true);
      }
      await refreshConfig();
      pushEvent("status", "bootNodePod", true, { mode: "booted" }, Math.round(performance.now() - started));
    } catch (e) {
      pushEvent("status", "bootNodePod", false, { error: e instanceof Error ? e.message : String(e) }, Math.round(performance.now() - started));
    } finally {
      setBooting(false);
    }
  }, [pushEvent, refreshConfig]);

  const handleTeardown = useCallback(async () => {
    const started = performance.now();
    nodePodDetachTerminal();
    setTerminalReady(false);
    await teardownNodePod();
    setNodePodActive(false);
    setActiveTab("status");
    await refreshConfig();
    setNodePodInfoState(null);
    setVfsEntries([]);
    setSelectedFile(null);
    setFileContent("");
    pushEvent("status", "teardownNodePod", true, { mode: "torn down" }, Math.round(performance.now() - started));
  }, [pushEvent, refreshConfig]);

  /* ── vfs actions ──────────────────────────────────────── */

  const openDir = useCallback((path: string) => {
    setVfsPath(path);
  }, []);

  const goUp = useCallback(() => {
    const parts = vfsPath.split("/").filter(Boolean);
    parts.pop();
    const next = parts.length === 0 ? "/workspace" : `/${parts.join("/")}`;
    openDir(next);
  }, [vfsPath, openDir]);

  const openFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setShowDiff(false);
    setDiffLines([]);
    try {
      const content = await nodePodReadTextFile(path);
      setFileContent(content);
      setFileDirty(false);
    } catch (e) {
      setFileContent("// Error reading file:\n// " + (e instanceof Error ? e.message : String(e)));
      setFileDirty(false);
    }
  }, []);

  const computeDiff = useCallback(async () => {
    if (!selectedFile) return;
    setDiffLoading(true);
    try {
      const result = await nodePodDiffFile(selectedFile);
      if (result && result.baseline !== undefined) {
        const lines = diffStrings(result.baseline, result.current);
        setDiffLines(lines);
      } else {
        setDiffLines([]);
      }
    } catch {
      setDiffLines([]);
    } finally {
      setDiffLoading(false);
    }
  }, [selectedFile]);

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      await nodePodWriteTextFile(selectedFile, fileContent);
      setFileDirty(false);
      pushEvent("vfs", `write ${selectedFile}`, true, { bytes: fileContent.length });
      refreshVfs();
    } catch (e) {
      pushEvent("vfs", `write ${selectedFile}`, false, { error: e instanceof Error ? e.message : String(e) });
    }
  }, [selectedFile, fileContent, pushEvent, refreshVfs]);

  const deleteSelected = useCallback(async (path: string, isDir: boolean) => {
    try {
      await nodePodDeletePath(path, isDir);
      if (selectedFile === path) {
        setSelectedFile(null);
        setFileContent("");
      }
      pushEvent("vfs", `delete ${path}`, true, {});
      refreshVfs();
    } catch (e) {
      pushEvent("vfs", `delete ${path}`, false, { error: e instanceof Error ? e.message : String(e) });
    }
  }, [selectedFile, pushEvent, refreshVfs]);

  const createItem = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await nodePodCreatePath(vfsPath, newName.trim(), createType === "dir");
      pushEvent("vfs", `create ${createType} ${newName}`, true, {});
      setNewName("");
      refreshVfs();
    } catch (e) {
      pushEvent("vfs", `create ${createType} ${newName}`, false, { error: e instanceof Error ? e.message : String(e) });
    }
  }, [newName, vfsPath, createType, pushEvent, refreshVfs]);

  /* ── shell actions (xterm terminal via NodePod) ────────── */

  const clearTerminal = useCallback(() => {
    const term = nodePodGetTerminal();
    if (term) term.clear();
  }, []);

  const focusTerminal = useCallback(() => {
    const term = nodePodGetTerminal();
    if (term) requestAnimationFrame(() => term.fit());
  }, []);

  /* ── snapshot actions ─────────────────────────────────── */

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
      pushEvent("snapshots", "snapshot.create", false, { error: e instanceof Error ? e.message : String(e) }, Math.round(performance.now() - started));
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
      pushEvent("snapshots", "snapshot.restore", false, { error: e instanceof Error ? e.message : String(e) }, Math.round(performance.now() - started));
    }
  }, [pushEvent, refreshVfs]);

  /* ── version control (git) actions ────────────────────── */

  const refreshVc = useCallback(async () => {
    try {
      const [branches, commits] = await Promise.all([
        sandboxListBranches(),
        sandboxListCommits(),
      ]);
      const repo = await getSandboxRepo();
      const activeId = await repo.activeBranchId();
      setVcBranches(branches);
      setVcCommits(commits);
      setVcActiveBranch(activeId);
    } catch {
      setVcBranches([]);
      setVcCommits([]);
    }
  }, []);

  const createBranchAction = useCallback(async () => {
    if (!vcNewBranchName.trim()) return;
    setVcLoading(true);
    try {
      await sandboxCreateBranch(vcNewBranchName.trim());
      setVcNewBranchName("");
      await refreshVc();
      pushEvent("vc", "branch.create", true, { name: vcNewBranchName.trim() });
    } catch (e) {
      pushEvent("vc", "branch.create", false, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setVcLoading(false);
    }
  }, [vcNewBranchName, refreshVc, pushEvent]);

  const switchBranchAction = useCallback(async (branchId: string) => {
    setVcLoading(true);
    try {
      await sandboxCheckoutBranch(branchId);
      await refreshVc();
      pushEvent("vc", "branch.switch", true, { branchId });
    } catch (e) {
      pushEvent("vc", "branch.switch", false, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setVcLoading(false);
    }
  }, [refreshVc, pushEvent]);

  const commitToVcAction = useCallback(async () => {
    const message = vcCommitMessage.trim() || `checkpoint-${Date.now()}`;
    setVcLoading(true);
    try {
      const files = await nodePodGetAllFileContents();
      const commitId = await sandboxCommit(files, message);
      setVcCommitMessage("");
      await refreshVc();
      pushEvent("vc", "commit", true, { commitId, files: files.length });
    } catch (e) {
      pushEvent("vc", "commit", false, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setVcLoading(false);
    }
  }, [vcCommitMessage, refreshVc, pushEvent]);

  const diffCommitsAction = useCallback(async (fromCommitId: string, toCommitId: string) => {
    setVcLoading(true);
    try {
      const changes = await sandboxDiffCommits(fromCommitId, toCommitId);
      setVcDiff({ fromCommit: fromCommitId, toCommit: toCommitId, changes });
    } catch {
      setVcDiff(null);
    } finally {
      setVcLoading(false);
    }
  }, []);

  const restoreCommitAction = useCallback(async (commitId: string) => {
    const started = performance.now();
    setVcLoading(true);
    try {
      const files = await sandboxReadCommitFiles(commitId);
      for (const file of files) {
        await nodePodWriteTextFile(file.path, file.content);
      }
      await refreshVfs();
      pushEvent("vc", "commit.restore", true, { commitId, files: files.length }, Math.round(performance.now() - started));
    } catch (e) {
      pushEvent("vc", "commit.restore", false, { error: e instanceof Error ? e.message : String(e) }, Math.round(performance.now() - started));
    } finally {
      setVcLoading(false);
    }
  }, [pushEvent, refreshVfs]);

  const exportPortableAction = useCallback(async () => {
    setPortableBusy(true);
    try {
      const bundle = await buildSandboxPortableBundle();
      const text = `${JSON.stringify(bundle, null, 2)}\n`;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `keating-sandbox-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      pushEvent("vc", "portable.export", true, {
        files: bundle.nodepod.files.length,
        snapshots: bundle.nodepod.snapshots.length,
        gitObjects: Object.keys(bundle.vc.objects).length,
      });
    } catch (e) {
      pushEvent("vc", "portable.export", false, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPortableBusy(false);
    }
  }, [pushEvent]);

  const importPortableAction = useCallback(async (file: File) => {
    setPortableBusy(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as KeatingSandboxPortableBundle;
      const result = await importSandboxPortableBundle(bundle);
      await Promise.all([refreshVc(), refreshDbSnapshots()]);
      await refreshVfs();
      pushEvent("vc", "portable.import", true, result);
    } catch (e) {
      pushEvent("vc", "portable.import", false, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPortableBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }, [pushEvent, refreshDbSnapshots, refreshVc, refreshVfs]);

  /* ── probes ───────────────────────────────────────────── */

  const runProbe = useCallback(async () => {
    setRunningProbe(true);
    const started = performance.now();
    let finalPayload: unknown = {};

    try {
      const latestRuntime = await loadAgentRuntimeConfig(true);
      setRuntime(latestRuntime);

      if (probeKind === "config") {
        finalPayload = {
          ok: true,
          output: latestRuntime,
          durationMs: Math.round(performance.now() - started),
        };
        pushEvent("probes", "agent_runtime.config", true, (finalPayload as Record<string, unknown>).output);
        return;
      }

      if (latestRuntime.mode === "browser-only" || !latestRuntime.executionEndpoint) {
        finalPayload = {
          reason: "No execution endpoint is configured.",
          mode: latestRuntime.mode,
          fallback: latestRuntime.fallback,
        };
        pushEvent("probes", `probe.${probeKind}`, false, finalPayload, Math.round(performance.now() - started));
        return;
      }

      let payload: unknown;
      try {
        payload = payloadText.trim() ? JSON.parse(payloadText) : {};
      } catch (error) {
        throw new Error(`Probe payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (latestRuntime.executionEndpoint === NODEPOD_LOCAL_ENDPOINT) {
        const operation = probeKind;
        const output = await nodePodExecute(operation, payload);
        const ok = !(output && typeof output === "object" && "ok" in output && output.ok === false);
        pushEvent("probes", `probe.${probeKind}`, ok, output, Math.round(performance.now() - started));
        return;
      }

      const response = await fetch(`${latestRuntime.executionEndpoint}/execute`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ operation: probeKind, payload }),
      });
      const body = response.headers.get("content-type")?.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text();
      pushEvent("probes", `probe.${probeKind}`, response.ok, body, Math.round(performance.now() - started));
    } catch (error) {
      pushEvent("probes", `probe.${probeKind}`, false, {
        error: error instanceof Error ? error.message : String(error),
      }, Math.round(performance.now() - started));
    } finally {
      setRunningProbe(false);
    }
  }, [probeKind, payloadText, pushEvent]);

  const copyOutput = useCallback(async () => {
    const latestProbe = events.find((e) => e.tab === "probes");
    if (!latestProbe) return;
    const text = formatJson(latestProbe.output);
    await navigator.clipboard.writeText(text);
    const idx = events.indexOf(latestProbe);
    setCopiedIndex(idx);
    window.setTimeout(() => setCopiedIndex(null), 1200);
  }, [events]);

  /* ─── render ─── */

  if (!open) return null;

  const nodePodAction = nodePodControlAction(runtime, nodePodActive);
  const status = booting ? "Starting…" : nodePodActive ? "Running" : runtime?.executionEndpoint ? "Configured" : "Stopped";
  const advancedTab = ["snapshots", "vc", "probes"].includes(activeTab) ? activeTab : "";

  return (
    <dialog ref={dialogRef} className="sandbox-runtime" aria-labelledby="runtime-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className="runtime-heading">
            <span className="runtime-mark"><KeatingIcon icon={Cpu} size={24} active={nodePodActive} /></span>
            <div className={styles.minW0}>
              <h2 id="runtime-title">Runtime</h2>
              <p>{runtime ? runtimeLabel(runtime.mode) : "Loading environment…"}</p>
            </div>
          </div>
          <button type="button" className="runtime-icon-button" aria-label="Close runtime" onClick={onClose} autoFocus><KeatingIcon icon={X} size={20} /></button>
        </header>

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
      </div>
    </dialog>
  );

  function renderTab() {
    switch (activeTab) {
      case "status": return renderStatus();
      case "vfs": return renderVfs();
      case "shell": return renderShell();
      case "snapshots": return renderSnapshots();
      case "vc": return renderVC();
      case "log": return renderLog();
      case "probes": return renderProbes();
      default: return null;
    }
  }

  function renderStatus() {
    const memory = nodePodInfoState?.memoryStats;
    const recentEvents = events.slice(0, 3);
    const isLocal = !runtime || runtime.mode === "browser-only" || runtime.mode === "browser-nodepod";
    const latestFailure = events[0] && !events[0].ok ? events[0] : null;

    return (
      <div className="runtime-overview">
        {latestFailure && <div className="runtime-error" role="alert"><KeatingIcon icon={Bug} size={18} /><span>{typeof latestFailure.output === "object" && latestFailure.output && "error" in latestFailure.output ? String(latestFailure.output.error) : "An operation failed. Open Activity for details."}</span></div>}
        <section className="runtime-intro">
          <p className="runtime-eyebrow">{isLocal ? "Local environment" : "Execution environment"}</p>
          <h3>{nodePodActive ? "Ready to run." : isLocal ? "Your browser workspace." : runtimeLabel(runtime!.mode)}</h3>
          <p>{nodePodActive ? "JavaScript, TypeScript, and your files. All in this browser." : isLocal ? "Start NodePod to run code, edit files, and save your experiments." : "Use diagnostics to check the connection and inspect runtime output."}</p>
        </section>

        {nodePodActive && <>
          <dl className="runtime-metrics">
            <div><dt>Files</dt><dd>{memory?.vfs.fileCount ?? "—"}</dd></div>
            <div><dt>Storage</dt><dd>{memory ? fmtBytes(memory.vfs.totalBytes) : "—"}</dd></div>
            <div><dt>Snapshots</dt><dd>{snapshots.length}</dd></div>
          </dl>
          <div className="runtime-shortcuts">
            <button type="button" onClick={() => setActiveTab("vfs")}><KeatingIcon icon={FolderOpen} size={22} /><span><strong>Browse files</strong><small>Open your workspace</small></span><KeatingIcon icon={ChevronLeft} size={16} className="runtime-next" /></button>
            <button type="button" onClick={() => setActiveTab("shell")}><KeatingIcon icon={Terminal} size={22} /><span><strong>Open terminal</strong><small>Run a command</small></span><KeatingIcon icon={ChevronLeft} size={16} className="runtime-next" /></button>
          </div>
        </>}

        <section className="runtime-recent">
          <div className="runtime-section-heading"><h3>Recent activity</h3>{events.length > 0 && <button type="button" className="runtime-text-button" onClick={() => setActiveTab("log")}>View all <span>{events.length}</span></button>}</div>
          {recentEvents.length === 0 ? <p className="runtime-empty-inline">Your runs and workspace changes will appear here.</p> : recentEvents.map((event) => (
            <button type="button" className="runtime-event-row" key={event.id} onClick={() => setActiveTab("log")}>
              <KeatingIcon icon={event.ok ? CheckCircle2 : Bug} size={18} className={event.ok ? "runtime-success" : "runtime-failure"} />
              <span>{event.operation === "bootNodePod" ? "NodePod started" : event.operation === "teardownNodePod" ? "NodePod stopped" : event.operation}</span>
              <time dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </button>
          ))}
        </section>

        <details className="runtime-details">
          <summary><KeatingIcon icon={Cpu} size={18} />Environment details</summary>
          <dl className="runtime-facts">
            <div><dt>Environment</dt><dd>{runtime ? runtimeLabel(runtime.mode) : "Loading…"}</dd></div>
            <div><dt>Endpoint</dt><dd>{runtime?.executionEndpoint ?? "No execution endpoint"}</dd></div>
            {nodePodInfoState && <><div><dt>Instance</dt><dd>{nodePodInfoState.instanceId}</dd></div><div><dt>Shared memory</dt><dd>{nodePodInfoState.sabEnabled ? "Available" : "Unavailable"}</dd></div></>}
            {memory && <><div><dt>Heap memory</dt><dd>{memory.heap ? `${memory.heap.usedMB.toFixed(1)} / ${memory.heap.limitMB.toFixed(1)} MB` : "Unavailable"}</dd></div><div><dt>Cached modules</dt><dd>{memory.engine.moduleCacheSize}</dd></div><div><dt>Cached transforms</dt><dd>{memory.engine.transformCacheSize}</dd></div></>}
          </dl>
          {runtime && <div className="runtime-capabilities">{[
            { label: "File access", available: nodePodActive || runtime.capabilities.remoteSandbox || runtime.capabilities.hostProjectAccess },
            { label: "Shell", available: nodePodActive || runtime.capabilities.remoteSandbox || runtime.capabilities.localCommandExecution },
            { label: "Snapshots", available: nodePodActive || runtime.capabilities.durableCompute },
            { label: "Native binaries", available: runtime.capabilities.nativeBinaries },
          ].map((capability) => <span key={capability.label} data-available={capability.available}><KeatingIcon icon={capability.available ? CheckCircle2 : X} size={15} />{capability.label}<span className="runtime-sr-only">: {capability.available ? "available" : "unavailable"}</span></span>)}</div>}
        </details>

        <details className="runtime-details">
          <summary><KeatingIcon icon={CircleHelp} size={18} />Choose an environment</summary>
          <div className="runtime-environment-guide">
            <section><h4>NodePod · in your browser</h4><p>JavaScript, files, and snapshots. No native binaries or hard security boundary.</p><code>keating web --browser-only-agent 3000</code></section>
            <section><h4>Host · your own machine</h4><p>Installed tools and local files. Use for trusted code.</p><code>keating web --host 3000 --allow-local-exec --root=/path/to/project</code></section>
            <section><h4>Remote · an external service</h4><p>Provider isolation and native tools, through your configured gateway.</p><code>keating web --remote 3000 --remote-provider=daytona --remote-endpoint=https://sandbox.example</code></section>
            <section><h4>Cloud · a hosted runtime</h4><p>Your deployment supplies execution and credentials.</p><code>keating web --cloud 3000 --cloud-endpoint=https://keating.help</code></section>
          </div>
        </details>
      </div>
    );
  }

  function renderVfs() {
    if (!nodePodActive) {
      return (
        <div className={styles.textXsMuted}>
          Start NodePod to use the file system.
        </div>
      );
    }
    return (
      <div className={styles.grid3}>
        <div className={styles.flexCenter}>
          <button type="button" onClick={() => openDir("/workspace")} className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", _hover: { background: "var(--accent)" } })} aria-label="Go to workspace" title="Go to /workspace"><KeatingIcon icon={Home} size={13} /></button>
          <button type="button" onClick={goUp} className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", _hover: { background: "var(--accent)" } })} aria-label="Go to parent folder" title="Go up"><KeatingIcon icon={ChevronLeft} size={13} /></button>
          <span className="runtime-file-path runtime-mono-xs">{vfsPath}</span>
        </div>

        {vfsLoading ? (
          <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}><RuntimeSpinner size={13} /> Loading…</div>
        ) : (
          <div className={styles.card}>
            {vfsEntries.length === 0 ? (
              <div className={css({ padding: "0.75rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Empty directory</div>
            ) : (
              vfsEntries.map((entry) => (
                <div key={entry.path} data-file-row className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderBottomWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem", fontSize: "0.75rem", _last: { borderBottomWidth: 0 }, _hover: { background: "rgb(from var(--muted) r g b / 0.3)" } })}>
                  <span className={css({ flexShrink: 0 })}>{entry.isDir ? <KeatingIcon icon={FolderOpen} size={14} className={css({ color: "var(--primary)" })} /> : <KeatingIcon icon={FileCode} size={14} className={css({ color: "var(--muted-foreground)" })} />}</span>
                  <button
                    type="button"
                    className={css({ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", _hover: { color: "var(--primary)" } })}
                    onClick={() => entry.isDir ? openDir(entry.path) : openFile(entry.path)}
                  >
                    {entry.name}
                  </button>
                  <span className={css({ marginLeft: "auto", flexShrink: 0, fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{entry.isDir ? "dir" : fmtBytes(entry.size)}</span>
                  <button type="button" className={css({ flexShrink: 0, color: "rgb(from var(--destructive) r g b / 0.7)", _hover: { color: "var(--destructive)" } })} aria-label={`Delete ${entry.name}`} onClick={() => deleteSelected(entry.path, entry.isDir)}><KeatingIcon icon={Trash2} size={12} /></button>
                </div>
              ))
            )}
          </div>
        )}

        {/* create + editor */}
        <div className="runtime-create-item">
          <input
            className={css({ flex: 1, borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.375rem 0.5rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem" })}
            aria-label="New file or folder name" placeholder="new_name.js"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createItem()}
          />
          <Select aria-label="New item type" className={cx("runtime-item-type", css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.375rem 0.5rem", fontSize: "0.75rem" }))} value={createType} onValueChange={(value) => setCreateType(value as "file" | "dir")}>
            <option value="file">File</option>
            <option value="dir">Folder</option>
          </Select>
          <button type="button" onClick={createItem} className={css({ display: "inline-flex", height: "2rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", _hover: { background: "var(--accent)" } })}>
            <KeatingIcon icon={Plus} size={12} /> Add
          </button>
        </div>

        {selectedFile && (
          <div className={styles.card}>
            <div className="runtime-file-toolbar">
              <span className={styles.semiboldXs}>{selectedFile}</span>
              <div className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
                {fileDirty && <span className={css({ fontSize: "0.75rem", color: "#d97706", _dark: { color: "#fcd34d" } })}>unsaved</span>}
                <button
                  type="button"
                  onClick={() => { setShowDiff((s) => !s); if (!showDiff) computeDiff(); }}
                  className={cx(
                    css({ display: "inline-flex", height: "1.75rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", paddingInline: "0.5rem", fontSize: "0.75rem" }),
                    showDiff
                      ? css({ borderColor: "var(--secondary)", background: "var(--secondary)", color: "var(--secondary-foreground)" })
                      : css({ borderColor: "var(--border)", _hover: { background: "var(--accent)" } })
                  )}
                >
                  <KeatingIcon icon={GitCompare} size={12} /> {showDiff ? "Hide diff" : "Show diff"}
                </button>
                <button type="button" onClick={saveFile} className={styles.primaryButtonSm}><KeatingIcon icon={Save} size={12} /> Save</button>
              </div>
            </div>

            {showDiff ? (
              <div className={css({ minHeight: "12rem", width: "100%", overflow: "auto", background: "var(--background)", padding: "0.5rem 0.75rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", lineHeight: 1.625 })}>
                {diffLoading ? (
                  <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--muted-foreground)" })}><RuntimeSpinner size={13} /> Computing diff…</div>
                ) : diffLines.length === 0 ? (
                  <div className={css({ color: "var(--muted-foreground)" })}>No changes — file matches baseline.</div>
                ) : (
                  <div className={css({ display: "grid", gap: 0 })}>
                    {diffLines.map((line, idx) => (
                      <div
                        key={idx}
                        className={cx(
                          css({ display: "flex", gap: "0.5rem", paddingInline: "0.25rem" }),
                          line.type === "removed"
                            ? css({ background: "rgb(239 68 68 / 0.1)", color: "#b91c1c", _dark: { color: "#fca5a5" } })
                            : line.type === "added"
                            ? css({ background: "rgb(34 197 94 / 0.1)", color: "#15803d", _dark: { color: "#86efac" } })
                            : css({ color: "var(--muted-foreground)" })
                        )}
                      >
                        <span className={css({ width: "1rem", flexShrink: 0, userSelect: "none", textAlign: "center", fontSize: "10px", opacity: 0.5 })}>
                          {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
                        </span>
                        <span className={css({ wordBreak: "break-all" })}>{line.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <textarea
                className={css({ minHeight: "12rem", width: "100%", resize: "vertical", background: "var(--background)", padding: "0.5rem 0.75rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", lineHeight: 1.625 })}
                spellCheck={false}
                aria-label={`Edit ${selectedFile}`}
                value={fileContent}
                onChange={(e) => { setFileContent(e.target.value); setFileDirty(true); }}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  function renderShell() {
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
              onClick={clearTerminal}
              className={styles.outlineButtonSmBg}
            >
              <KeatingIcon icon={RotateCcw} size={12} />
              Clear
            </button>
            <button
              type="button"
              onClick={focusTerminal}
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

  function renderSnapshots() {
    if (!nodePodActive) {
      return (
        <div className={styles.textXsMuted}>
          Start NodePod to use snapshots.
        </div>
      );
    }
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

        {showDbSnapshots ? (
          dbSnapshots.length === 0 ? (
            <div className={styles.textXsMuted}>No saved snapshots yet. Create one to return to this workspace later.</div>
          ) : (
            <div className={styles.grid2}>
              {dbSnapshots.map((snap) => (
                <div key={snap.id} className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem" })}>
                  <div className={styles.minW0}>
                    <div className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", fontWeight: 500 })}>{snap.id}</div>
                    <div className={styles.text10Muted}>{snap.instanceId} · {new Date(snap.createdAt).toLocaleString()}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => restoreSnapshotAction(snap.data)}
                    className={css({ marginLeft: "0.5rem", display: "inline-flex", height: "1.75rem", flexShrink: 0, alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", _hover: { background: "var(--accent)" } })}
                  >
                    <KeatingIcon icon={RotateCcw} size={12} /> Restore
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          snapshots.length === 0 ? (
            <div className={styles.textXsMuted}>Save a snapshot before your next experiment.</div>
          ) : (
            <div className={styles.grid2}>
              {snapshots.map((snap) => (
                <div key={snap.id} className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem" })}>
                  <div className={styles.minW0}>
                    <div className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", fontWeight: 500 })}>{snap.id}</div>
                    <div className={styles.text10Muted}>{snap.instanceId} · {new Date(snap.createdAt).toLocaleString()}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => restoreSnapshotAction(snap.data)}
                    className={css({ marginLeft: "0.5rem", display: "inline-flex", height: "1.75rem", flexShrink: 0, alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", _hover: { background: "var(--accent)" } })}
                  >
                    <KeatingIcon icon={RotateCcw} size={12} /> Restore
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    );
  }

  function renderVC() {
    if (!nodePodActive) {
      return (
        <div className={styles.textXsMuted}>
          Start NodePod to use version control.
        </div>
      );
    }
    return (
      <div className={styles.grid3}>
        <div className="runtime-view-intro"><h3>History</h3></div>
        {/* Branch controls */}
        <div className="runtime-wrap-toolbar">
          <span className={styles.semiboldXs}>
            Branch: <span className={styles.mono}>{vcActiveBranch}</span>
          </span>
          <div className={css({ display: "flex", alignItems: "center", gap: "0.375rem" })}>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className={styles.hidden}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importPortableAction(file);
              }}
            />
            <button
              type="button"
              onClick={exportPortableAction}
              disabled={portableBusy}
              className={styles.outlineButtonSmBg}
            >
              <KeatingIcon icon={Download} size={12} /> Export
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={portableBusy}
              className={styles.outlineButtonSmBg}
            >
              <KeatingIcon icon={Upload} size={12} /> Import
            </button>
            <button
              type="button"
              onClick={refreshVc}
              className={styles.outlineButtonSmBg}
            >
              <KeatingIcon icon={RefreshCw} size={12} /> Refresh
            </button>
          </div>
        </div>

        {/* New branch */}
        <div className={css({ display: "flex", gap: "0.5rem" })}>
          <input
            className={styles.inputMono}
            aria-label="New branch name" placeholder="experiment-name"
            value={vcNewBranchName}
            onChange={(e) => setVcNewBranchName(e.target.value)}
          />
          <button
            type="button"
            onClick={createBranchAction}
            disabled={vcLoading || !vcNewBranchName.trim()}
            className={styles.primaryButton}
          >
            <KeatingIcon icon={GitBranch} size={13} /> Branch
          </button>
        </div>

        {/* Commit */}
        <div className={css({ display: "flex", gap: "0.5rem" })}>
          <input
            className={cx(styles.inputBase, css({ flex: 1 }))}
            aria-label="Commit message" placeholder="Describe your changes"
            value={vcCommitMessage}
            onChange={(e) => setVcCommitMessage(e.target.value)}
          />
          <button
            type="button"
            onClick={commitToVcAction}
            disabled={vcLoading}
            className={styles.primaryButton}
          >
            <KeatingIcon icon={GitCommit} size={13} /> Commit
          </button>
        </div>

        {/* Branches list */}
        {vcBranches.length > 0 && (
          <div className={css({ display: "grid", gap: "0.25rem" })}>
            <span className={css({ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" })}>Branches</span>
            {vcBranches.map((b) => (
              <div key={b.id} className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.375rem 0.75rem" })}>
                <span className={styles.monoXs}>{b.name}</span>
                {b.id !== vcActiveBranch && (
                  <button
                    type="button"
                    onClick={() => switchBranchAction(b.id)}
                    disabled={vcLoading}
                    className={css({ display: "inline-flex", height: "1.5rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "10px", _hover: { background: "var(--accent)" }, _disabled: { opacity: 0.5 } })}
                  >
                    <KeatingIcon icon={RotateCcw} size={10} /> Switch
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Commits list */}
        {vcCommits.length > 0 ? (
          <div className={styles.grid2}>
            <span className={css({ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" })}>Commits</span>
            {vcCommits.map((c, i) => (
              <div key={c.id} className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem" })}>
                <div className="runtime-wrap-toolbar">
                  <span className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", fontWeight: 500 })}>{c.id.slice(0, 24)}</span>
                  <span className={styles.text10Muted}>{c.fileCount} files</span>
                </div>
                <div className={css({ marginTop: "0.125rem", fontSize: "0.75rem" })}>{c.message}</div>
                <div className={styles.text10Muted}>{new Date(c.createdAt).toLocaleString()}</div>
                <div className={css({ marginTop: "0.375rem", display: "flex", flexWrap: "wrap", gap: "0.25rem" })}>
                  {i < vcCommits.length - 1 && (
                    <button
                      type="button"
                      onClick={() => diffCommitsAction(c.id, vcCommits[i + 1].id)}
                      className={css({ display: "inline-flex", height: "1.5rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "10px", _hover: { background: "var(--accent)" } })}
                    >
                      <KeatingIcon icon={GitCompare} size={10} /> Diff with next
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => restoreCommitAction(c.id)}
                    disabled={vcLoading}
                    title="Write this commit's files back into the sandbox"
                    className={css({ display: "inline-flex", height: "1.5rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "10px", _hover: { background: "var(--accent)" }, _disabled: { opacity: 0.5 } })}
                  >
                    <KeatingIcon icon={RotateCcw} size={10} /> Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.textXsMuted}>
            No commits yet. Edit a file, then commit to save a version.
          </div>
        )}

        {/* Diff view */}
        {vcDiff && (
          <div className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.1)", padding: "0.75rem" })}>
            <div className={css({ marginBottom: "0.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" })}>
              <span className={styles.semiboldXs}>Diff</span>
              <button
                type="button"
                onClick={() => setVcDiff(null)}
                className={css({ fontSize: "10px", color: "var(--muted-foreground)", _hover: { color: "var(--foreground)" } })}
              >
                Close
              </button>
            </div>
            <div className={css({ display: "grid", maxHeight: "15rem", gap: "0.25rem", overflow: "auto" })}>
              {vcDiff.changes.filter((c) => c.status !== "unchanged").map((c) => (
                <div key={c.path} className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem" })}>
                  <span className={cx(css({ width: "4rem", flexShrink: 0, fontSize: "10px", fontWeight: 700 }), c.status === "added" ? css({ color: "#16a34a" }) : c.status === "removed" ? css({ color: "#dc2626" }) : css({ color: "#d97706" }))}>
                    {c.status.toUpperCase()}
                  </span>
                  <span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{c.path}</span>
                </div>
              ))}
              {vcDiff.changes.filter((c) => c.status !== "unchanged").length === 0 && (
                <div className={styles.textXsMuted}>No changes</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderLog() {
    return (
      <div className="runtime-activity" ref={logRef}>
        <div className="runtime-section-heading"><h3>Activity</h3><span className="runtime-count">{events.length} {events.length === 1 ? "event" : "events"}</span></div>
        {events.length === 0 ? <div className="runtime-empty"><KeatingIcon icon={Activity} size={30} /><h4>No activity yet</h4><p>Run a command or edit a file. Its result will appear here.</p></div> : events.map((event) => (
          <details key={event.id} className="runtime-log-entry">
            <summary><KeatingIcon icon={event.ok ? CheckCircle2 : Bug} size={19} className={event.ok ? "runtime-success" : "runtime-failure"} /><span className="runtime-log-title"><strong>{event.operation}</strong><small>{new Date(event.timestamp).toLocaleTimeString()} · {event.ok ? "Completed" : "Failed"}{event.durationMs != null ? ` · ${event.durationMs} ms` : ""}</small></span></summary>
            <div className="runtime-log-output"><JsonCrackBlock value={event.output} maxHeight="22rem" /></div>
          </details>
        ))}
      </div>
    );
  }

  function renderProbes() {
    return (
      <div className={styles.grid3}>
        <div className="runtime-view-intro"><h3>Diagnostics</h3><p>Check the runtime and inspect its response.</p></div>
        <label htmlFor="runtime-probe-operation">Operation</label>
        <Select
          className={css({ marginBottom: "0.25rem", width: "100%", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.5rem", fontSize: "0.75rem" })}
          id="runtime-probe-operation"
          value={probeKind}
          onValueChange={setProbeKind}
        >
          <option value="config">Read configuration</option>
          <option value="runtime.ping">Ping runtime</option>
          <option value="shell.exec">Run shell command</option>
          <option value="snapshot.create">Create snapshot</option>
        </Select>

        <label htmlFor="runtime-probe-payload">Payload · JSON</label>
        <textarea
          className={css({ minHeight: "7rem", width: "100%", resize: "vertical", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.2)", padding: "0.5rem 0.75rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", lineHeight: 1.625 })}
          spellCheck={false}
          id="runtime-probe-payload"
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
        />

        <div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
          <button
            type="button"
            onClick={runProbe}
            disabled={runningProbe}
            className={styles.primaryButton}
          >
            {runningProbe ? <RuntimeSpinner size={15} /> : <KeatingIcon icon={Play} size={15} />}
            Run check
          </button>
          {events.some((e) => e.tab === "probes") && (
            <button type="button" onClick={copyOutput} className={styles.outlineButton}>
              <KeatingIcon icon={Copy} size={14} /> {copiedIndex !== null ? "Copied" : "Copy latest"}
            </button>
          )}
        </div>

        {events.filter((e) => e.tab === "probes").length > 0 && (
          <div className={cx("runtime-probe-output", css({ marginTop: "0.5rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.2)", padding: "0.75rem" }))}>
            <h3 className={css({ marginBottom: "0.5rem", fontSize: "0.75rem", fontWeight: 600 })}>Latest probe result</h3>
            <JsonCrackBlock
              value={events.find((e) => e.tab === "probes")?.output ?? null}
              maxHeight="18rem"
              title="Probe Result"
            />
          </div>
        )}
      </div>
    );
  }
}
