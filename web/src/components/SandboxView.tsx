import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Cpu,
  FileCode,
  FolderOpen,
  HardDrive,
  Home,
  Loader2,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { JsonCrackBlock } from "./JsonCrackBlock";
import {
  loadAgentRuntimeConfig,
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
  type ShellSession,
  nodePodRunCapturing,
  nodePodCreateSnapshot,
  nodePodRestoreSnapshot,
  getSnapshotLog,
  NODEPOD_LOCAL_ENDPOINT,
} from "../keating/nodepod-runtime";

type TabId = "status" | "vfs" | "shell" | "snapshots" | "log" | "probes";

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

function modeTone(mode: KeatingAgentRuntimeConfig["mode"]): string {
  if (mode === "browser-only") return "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/40";
  if (mode === "browser-nodepod") return "bg-teal-500/12 text-teal-700 dark:text-teal-300 border-teal-500/40";
  if (mode === "remote") return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
  return "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/40";
}

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
    case "browser-nodepod": return "NodePod (local)";
    case "browser-only": return "Browser-only (no sandbox)";
    case "remote": return "Remote server";
    case "cloud": return "Cloud container";
    default: return "Unknown";
  }
}

/* ─── component ───────────────────────────────────────────── */

export function SandboxView({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [runtime, setRuntime] = useState<KeatingAgentRuntimeConfig | null>(null);
  const [nodePodActive, setNodePodActive] = useState(false);
  const [booting, setBooting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("status");
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
  const [newName, setNewName] = useState("");
  const [createType, setCreateType] = useState<"file" | "dir">("file");

  /* shell */
  const [shellInput, setShellInput] = useState("");
  const [shellSessions, setShellSessions] = useState<ShellSession[]>([]);
  const [shellRunning, setShellRunning] = useState(false);

  /* snapshots */
  const [snapshots, setSnapshots] = useState<ReturnType<typeof getSnapshotLog>>(() => getSnapshotLog());
  const [snapLoading, setSnapLoading] = useState(false);

  /* probes */
  const [probeKind, setProbeKind] = useState("config");
  const [payloadText, setPayloadText] = useState("{}");
  const [runningProbe, setRunningProbe] = useState(false);

  const logRef = useRef<HTMLDivElement | null>(null);

  /* tabs availability depends on runtime mode */
  const availableTabs = useMemo(() => {
    const all: { id: TabId; label: string; icon: ReactNode }[] = [
      { id: "status", label: "Status", icon: <Activity size={14} /> },
      { id: "probes", label: "Probes", icon: <Play size={14} /> },
      { id: "log", label: "Log", icon: <ScrollText size={14} /> },
    ];
    if (nodePodActive) {
      all.splice(1, 0,
        { id: "vfs", label: "Files", icon: <FileCode size={14} /> },
        { id: "shell", label: "Shell", icon: <Terminal size={14} /> },
        { id: "snapshots", label: "Snapshots", icon: <HardDrive size={14} /> }
      );
    }
    return all;
  }, [nodePodActive]);

  useEffect(() => {
    if (!open) return;
    refreshAll();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  /* ── refresh helpers ──────────────────────────────────── */

  const pushEvent = useCallback((tab: string, operation: string, ok: boolean, output: unknown, durationMs?: number | null) => {
    const ev: LogEvent = { id: uid(), timestamp: Date.now(), tab, operation, ok, output, durationMs };
    setEvents((prev) => [ev, ...prev].slice(0, 500));
    if (logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshConfig();
    if (nodePodActive) {
      await refreshVfs();
    }
    refreshSnapshots();
  }, [nodePodActive]);

  const refreshConfig = useCallback(async () => {
    const config = await loadAgentRuntimeConfig(true);
    setRuntime(config);
    const active = config.mode === "browser-nodepod";
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

  const refreshSnapshots = useCallback(() => {
    setSnapshots(getSnapshotLog());
  }, []);

  /* ── boot / teardown ──────────────────────────────────── */

  const handleBoot = useCallback(async () => {
    setBooting(true);
    const started = performance.now();
    try {
      await bootNodePod();
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
    await teardownNodePod();
    setNodePodActive(false);
    setNodePodInfoState(null);
    setVfsEntries([]);
    setSelectedFile(null);
    setFileContent("");
    pushEvent("status", "teardownNodePod", true, { mode: "torn down" }, Math.round(performance.now() - started));
  }, [pushEvent]);

  /* ── vfs actions ──────────────────────────────────────── */

  const openDir = useCallback((path: string) => {
    setVfsPath(path);
    refreshVfs();
  }, [refreshVfs]);

  const goUp = useCallback(() => {
    const parts = vfsPath.split("/").filter(Boolean);
    parts.pop();
    const next = parts.length === 0 ? "/workspace" : `/${parts.join("/")}`;
    openDir(next);
  }, [vfsPath, openDir]);

  const openFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    try {
      const content = await nodePodReadTextFile(path);
      setFileContent(content);
      setFileDirty(false);
    } catch (e) {
      setFileContent("// Error reading file:\n// " + (e instanceof Error ? e.message : String(e)));
      setFileDirty(false);
    }
  }, []);

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

  /* ── shell actions ────────────────────────────────────── */

  const runShell = useCallback(async () => {
    const raw = shellInput.trim();
    if (!raw) return;
    const [cmd, ...args] = raw.split(/\s+/);
    setShellInput("");
    setShellRunning(true);

    const id = uid();
    const startedAt = performance.now();

    // Optimistic running session — visible immediately
    const runningSession: ShellSession = {
      id,
      command: cmd,
      args,
      stdout: "",
      stderr: "",
      exitCode: null,
      running: true,
      startedAt,
      durationMs: null,
      ok: false,
      result: "",
    };
    setShellSessions((prev) => [...prev.slice(-19), runningSession]);

    const started = performance.now();
    try {
      const session = await nodePodRunCapturing(cmd, args);
      // Replace the optimistic session with the completed one
      setShellSessions((prev) => prev.map((s) => (s.id === id ? session : s)));
      pushEvent("shell", raw, session.ok, { exitCode: session.exitCode, stdoutLength: session.stdout.length }, Math.round(performance.now() - started));
    } catch (e) {
      const errorSession: ShellSession = {
        id,
        command: cmd,
        args,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: -1,
        running: false,
        startedAt,
        durationMs: Math.round(performance.now() - started),
        ok: false,
        result: "",
      };
      setShellSessions((prev) => prev.map((s) => (s.id === id ? errorSession : s)));
      pushEvent("shell", raw, false, { error: errorSession.stderr }, errorSession.durationMs);
    } finally {
      setShellRunning(false);
    }
  }, [shellInput, pushEvent]);

  /* ── snapshot actions ─────────────────────────────────── */

  const createSnapshotAction = useCallback(async () => {
    setSnapLoading(true);
    const started = performance.now();
    try {
      const snap = await nodePodCreateSnapshot(`manual-${Date.now()}`);
      pushEvent("snapshots", "snapshot.create", true, { id: snap.id }, Math.round(performance.now() - started));
      refreshSnapshots();
    } catch (e) {
      pushEvent("snapshots", "snapshot.create", false, { error: e instanceof Error ? e.message : String(e) }, Math.round(performance.now() - started));
    } finally {
      setSnapLoading(false);
    }
  }, [pushEvent, refreshSnapshots]);

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
        // BUG FIX: was checking "snapshot" but select value is "snapshot.create"
        const operation =
          probeKind === "config" ? "runtime.ping" :
          probeKind === "node-version" ? "shell.exec" :
          probeKind === "snapshot.create" ? "snapshot.create" :
          "runtime.ping";
        const output = await nodePodExecute(operation, payload);
        pushEvent("probes", `probe.${probeKind}`, true, output, Math.round(performance.now() - started));
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

  const runtimeHealth = !runtime
    ? "unknown"
    : runtime.mode === "browser-nodepod"
    ? "sandbox active"
    : runtime.mode !== "browser-only"
    ? "remote available"
    : "browser-only fallback";

  return (
    <div className="fixed inset-0 z-[1000] bg-black/35 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Sandbox runtime view">
      <div className="ml-auto flex h-full w-full max-w-[40rem] flex-col border-l-2 border-border bg-background text-foreground shadow-2xl">
        {/* header */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Cpu size={18} className="text-primary" />
              <h2 className="truncate text-base font-semibold">Sandbox View</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {runtime ? runtimeLabel(runtime.mode) : "Loading runtime config…"}
            </p>
          </div>
          <button
            type="button"
            className="chat-action-button inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
            aria-label="Close sandbox view"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        {/* tab bar */}
        <div className="flex shrink-0 gap-1 border-b border-border bg-muted/20 px-2 py-1.5 overflow-x-auto">
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {nodePodActive ? (
              <button
                type="button"
                onClick={handleTeardown}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-destructive hover:bg-destructive/10"
              >
                <PowerOff size={12} /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={handleBoot}
                disabled={booting}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {booting ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                Boot
              </button>
            )}
            <button
              type="button"
              onClick={refreshAll}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-accent"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">{renderTab()}</div>
      </div>
    </div>
  );

  function renderTab() {
    switch (activeTab) {
      case "status": return renderStatus();
      case "vfs": return renderVfs();
      case "shell": return renderShell();
      case "snapshots": return renderSnapshots();
      case "log": return renderLog();
      case "probes": return renderProbes();
      default: return null;
    }
  }

  function renderStatus() {
    const hasRecentErrors = events.slice(0, 10).some((e) => !e.ok);
    const recentEvents = events.slice(0, 5);
    const probeCount = events.filter((e) => e.tab === "probes").length;
    const snapshotCount = snapshots.length;
    const vfsFileCount = vfsEntries.filter((e) => !e.isDir).length;

    return (
      <div className="grid gap-4">
        {/* ── runtime identity card ── */}
        <div className="rounded-md border border-border bg-muted/25 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${modeTone(runtime?.mode ?? "browser-only")}`}>
                <Activity size={13} />
                {runtime?.label ?? "Loading runtime"}
              </span>
              {hasRecentErrors && (
                <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                  <Bug size={10} /> Errors in log
                </span>
              )}
            </div>
            <span className="text-xs font-medium text-muted-foreground">{runtimeHealth}</span>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Mode</dt>
              <dd className="mt-0.5 font-mono text-sm">{runtime?.mode ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Endpoint</dt>
              <dd className="mt-0.5 break-all font-mono text-sm">{runtime?.executionEndpoint ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Snapshots</dt>
              <dd className="mt-0.5 font-mono text-sm">{snapshotCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Probes</dt>
              <dd className="mt-0.5 font-mono text-sm">{probeCount}</dd>
            </div>
          </dl>
        </div>

        {/* ── capabilities grid ── */}
        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Capabilities</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Source Editing", available: runtime?.mode !== "browser-only" },
              { label: "File System", available: nodePodActive },
              { label: "Shell", available: nodePodActive },
              { label: "Snapshots", available: nodePodActive },
              { label: "Benchmarks", available: true },
              { label: "Policy Evolution", available: true },
              { label: "Prompt Evolution", available: true },
              { label: "Self-Improve", available: runtime?.mode !== "browser-only" },
            ].map((cap) => (
              <div
                key={cap.label}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                  cap.available
                    ? "border-border bg-muted/20"
                    : "border-dashed border-muted-foreground/20 text-muted-foreground/60"
                }`}
              >
                {cap.available ? <CheckCircle2 size={12} className="text-primary shrink-0" /> : <div className="w-3 h-3 rounded-full border border-muted-foreground/30 shrink-0" />}
                {cap.label}
              </div>
            ))}
          </div>
        </div>

        {/* ── runtime-specific detail panel ── */}
        {runtime?.mode === "browser-nodepod" && (
          <div className="rounded-md border border-teal-500/30 bg-teal-500/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Cpu size={14} className="text-teal-600 dark:text-teal-300" />
                NodePod Sandbox
              </div>
              {nodePodActive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300">
                  <Activity size={9} /> Active
                </span>
              )}
            </div>

            {nodePodInfoState ? (
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Instance</dt>
                  <dd className="mt-0.5 break-all font-mono">{nodePodInfoState.instanceId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">SharedArrayBuffer</dt>
                  <dd className="mt-0.5 font-mono">{nodePodInfoState.sabEnabled ? "enabled" : "disabled"}</dd>
                </div>
                {nodePodInfoState.memoryStats ? (
                  <>
                    <div>
                      <dt className="text-muted-foreground">VFS Files</dt>
                      <dd className="mt-0.5 font-mono">{nodePodInfoState.memoryStats.vfs.fileCount} <span className="text-muted-foreground">({fmtBytes(nodePodInfoState.memoryStats.vfs.totalBytes)})</span></dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Heap</dt>
                      <dd className="mt-0.5 font-mono">{nodePodInfoState.memoryStats.heap ? `${nodePodInfoState.memoryStats.heap.usedMB.toFixed(1)} / ${nodePodInfoState.memoryStats.heap.limitMB.toFixed(1)} MB` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Module Cache</dt>
                      <dd className="mt-0.5 font-mono">{nodePodInfoState.memoryStats.engine.moduleCacheSize}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Transform Cache</dt>
                      <dd className="mt-0.5 font-mono">{nodePodInfoState.memoryStats.engine.transformCacheSize}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            ) : nodePodActive ? (
              <div className="text-xs text-muted-foreground">Sandbox is active but introspection is not available.</div>
            ) : (
              <div className="text-xs text-muted-foreground">NodePod is not running.</div>
            )}
          </div>
        )}

        {runtime?.mode === "remote" && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Cpu size={14} className="text-emerald-600 dark:text-emerald-300" />
                Remote Runtime
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                <Activity size={9} /> Connected
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Endpoint</dt>
                <dd className="mt-0.5 break-all font-mono">{runtime.executionEndpoint}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Fallback</dt>
                <dd className="mt-0.5 font-mono">{runtime.fallback.message ?? "none"}</dd>
              </div>
            </dl>
          </div>
        )}

        {runtime?.mode === "browser-only" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold">
              <Bug size={14} className="text-amber-600 dark:text-amber-300" />
              Browser-Only Mode
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Running without a Node.js sandbox. Source editing, file system, shell, and snapshots are unavailable. Switch to <strong>NodePod</strong> via the Boot button, or configure a <strong>Remote runtime</strong> in Settings.
            </p>
          </div>
        )}

        {/* ── recent activity ── */}
        {recentEvents.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Activity</div>
            <div className="grid gap-1.5">
              {recentEvents.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                  <span className={`inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-semibold ${ev.ok ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"}`}>
                    {ev.ok ? "OK" : "ERR"}
                  </span>
                  <span className="text-muted-foreground">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  <span className="font-mono text-muted-foreground">{ev.operation}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderVfs() {
    if (!nodePodActive) {
      return (
        <div className="text-xs text-muted-foreground">
          Sandbox is not active. Boot NodePod to use the file system.
        </div>
      );
    }
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => openDir("/workspace")} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent" title="Go to /workspace"><Home size={13} /></button>
          <button type="button" onClick={goUp} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent" title="Go up"><ChevronLeft size={13} /></button>
          <span className="text-xs font-mono text-muted-foreground">{vfsPath}</span>
        </div>

        {vfsLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="rounded-md border border-border">
            {vfsEntries.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">Empty directory</div>
            ) : (
              vfsEntries.map((entry) => (
                <div key={entry.path} className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs last:border-b-0 hover:bg-muted/30">
                  <span className="shrink-0">{entry.isDir ? <FolderOpen size={14} className="text-primary" /> : <FileCode size={14} className="text-muted-foreground" />}</span>
                  <button
                    type="button"
                    className="min-w-0 truncate text-left font-mono hover:text-primary"
                    onClick={() => entry.isDir ? openDir(entry.path) : openFile(entry.path)}
                  >
                    {entry.name}
                  </button>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{entry.isDir ? "dir" : fmtBytes(entry.size)}</span>
                  <button type="button" className="shrink-0 text-destructive/70 hover:text-destructive" onClick={() => deleteSelected(entry.path, entry.isDir)}><Trash2 size={12} /></button>
                </div>
              ))
            )}
          </div>
        )}

        {/* create + editor */}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono"
            placeholder="new_name.js"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createItem()}
          />
          <select className="rounded-md border border-border bg-background px-2 py-1.5 text-xs" value={createType} onChange={(e) => setCreateType(e.target.value as "file" | "dir")}>
            <option value="file">File</option>
            <option value="dir">Dir</option>
          </select>
          <button type="button" onClick={createItem} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-accent">
            <Plus size={12} /> Add
          </button>
        </div>

        {selectedFile && (
          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
              <span className="text-xs font-semibold">{selectedFile}</span>
              <div className="flex items-center gap-1">
                {fileDirty && <span className="text-xs text-amber-600 dark:text-amber-300">unsaved</span>}
                <button type="button" onClick={saveFile} className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90"><Save size={12} /> Save</button>
              </div>
            </div>
            <textarea
              className="min-h-48 w-full resize-y bg-background px-3 py-2 font-mono text-xs leading-relaxed"
              spellCheck={false}
              value={fileContent}
              onChange={(e) => { setFileContent(e.target.value); setFileDirty(true); }}
            />
          </div>
        )}
      </div>
    );
  }

  function renderShell() {
    if (!nodePodActive) {
      return (
        <div className="text-xs text-muted-foreground">
          Sandbox is not active. Boot NodePod to use the shell.
        </div>
      );
    }
    return (
      <div className="grid gap-3">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            placeholder="node -v"
            value={shellInput}
            onChange={(e) => setShellInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runShell(); }}
          />
          <button
            type="button"
            onClick={runShell}
            disabled={shellRunning}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {shellRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {shellRunning ? "Running" : "Run"}
          </button>
        </div>

        {shellSessions.length === 0 && (
          <div className="text-xs text-muted-foreground">Run a shell command to see output here.</div>
        )}

        <div className="grid gap-2">
          {shellSessions.map((sess) => (
            <div key={sess.id} className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-1.5">
                <span className="font-mono text-xs">
                  <span className="text-muted-foreground">$</span> {sess.command} {sess.args.join(" ")}
                </span>
                <span className={`text-xs font-medium ${sess.ok ? "text-primary" : "text-destructive"}`}>
                  {sess.exitCode === null ? (sess.running ? "running…" : "unknown") : sess.ok ? sess.exitCode : `exit ${sess.exitCode}`}
                  {sess.durationMs !== null && <span className="ml-1 text-[10px] text-muted-foreground">({sess.durationMs}ms)</span>}
                </span>
              </div>
              {sess.stdout && (
                <pre className="max-h-40 overflow-auto border-b border-dashed border-border px-3 py-2 text-xs">{sess.stdout}</pre>
              )}
              {sess.stderr && (
                <pre className="max-h-40 overflow-auto px-3 py-2 text-xs text-destructive">{sess.stderr}</pre>
              )}
            </div>
          )).reverse()}
        </div>
      </div>
    );
  }

  function renderSnapshots() {
    if (!nodePodActive) {
      return (
        <div className="text-xs text-muted-foreground">
          Sandbox is not active. Boot NodePod to use snapshots.
        </div>
      );
    }
    return (
      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Snapshots ({snapshots.length})</span>
          <button
            type="button"
            onClick={createSnapshotAction}
            disabled={snapLoading}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {snapLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Create
          </button>
        </div>
        {snapshots.length === 0 ? (
          <div className="text-xs text-muted-foreground">No snapshots yet.</div>
        ) : (
          <div className="grid gap-2">
            {snapshots.map((snap, idx) => (
              <div key={snap.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono font-medium">{snap.id}</div>
                  <div className="text-[10px] text-muted-foreground">{snap.instanceId} · {new Date(snap.createdAt).toLocaleString()}</div>
                </div>
                <button
                  type="button"
                  onClick={() => restoreSnapshotAction(snap.data)}
                  className="ml-2 shrink-0 inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-accent"
                >
                  <RotateCcw size={12} /> Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderLog() {
    return (
      <div className="grid gap-2" ref={logRef}>
        {events.length === 0 ? (
          <div className="text-xs text-muted-foreground">No events yet. Run a probe, shell command, or VFS operation.</div>
        ) : (
          events.map((ev, idx) => (
            <div key={ev.id} className="rounded-md border border-border p-2.5">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={`inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-semibold ${ev.ok ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"}`}>{ev.ok ? "OK" : "ERR"}</span>
                <span className="text-[10px] text-muted-foreground">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                <span className="text-[10px] font-medium text-muted-foreground">{ev.tab}</span>
                <span className="text-[10px] font-mono">{ev.operation}</span>
                {ev.durationMs !== undefined && <span className="text-[10px] text-muted-foreground">{ev.durationMs}ms</span>}
              </div>
              <JsonCrackBlock value={ev.output} maxHeight="10rem" />
            </div>
          ))
        )}
      </div>
    );
  }

  function renderProbes() {
    return (
      <div className="grid gap-3">
        <label className="mb-0.5 block text-xs font-medium text-muted-foreground">Operation</label>
        <select
          className="mb-1 w-full rounded-md border border-border bg-background px-2 py-2 text-xs"
          value={probeKind}
          onChange={(e) => setProbeKind(e.target.value)}
        >
          <option value="config">agent_runtime.config</option>
          <option value="runtime.ping">runtime.ping</option>
          <option value="shell.exec">shell.exec</option>
          <option value="snapshot.create">snapshot.create</option>
        </select>

        <label className="mb-0.5 block text-xs font-medium text-muted-foreground">Payload JSON</label>
        <textarea
          className="min-h-28 w-full resize-y rounded-md border border-border bg-muted/20 px-3 py-2 font-mono text-xs leading-relaxed"
          spellCheck={false}
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runProbe}
            disabled={runningProbe}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {runningProbe ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Run probe
          </button>
          {events.some((e) => e.tab === "probes") && (
            <button type="button" onClick={copyOutput} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs hover:bg-accent">
              <Copy size={14} /> {copiedIndex !== null ? "Copied" : "Copy latest"}
            </button>
          )}
        </div>

        {events.filter((e) => e.tab === "probes").length > 0 && (
          <div className="mt-2 rounded-md border border-border bg-muted/20 p-3">
            <h3 className="mb-2 text-xs font-semibold">Latest probe result</h3>
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
