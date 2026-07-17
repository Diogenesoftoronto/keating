import { useEffect, useMemo, useRef, useState, useCallback, useTransition } from "react";
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
  Download,
  FileCode,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitCompare,
  HardDrive,
  CircleHelp,
  Home,
  Maximize2,
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
  Upload,
  X,
} from "lucide-react";
import { JsonCrackBlock } from "./JsonCrackBlock";
import { Spinner } from "./Spinner";
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
	lixCommit,
	lixCreateBranch,
	lixSwitchBranch,
	lixListBranches,
	lixListCommits,
	lixDiffCommits,
	getSandboxLix,
	type SandboxCommit,
	type SandboxBranch,
} from "../keating/lix-sandbox";
import {
  buildSandboxPortableBundle,
  importSandboxPortableBundle,
  type KeatingSandboxPortableBundle,
} from "../keating/sandbox-export";
import { css, cx } from "../../styled-system/css";

type DiffChange = Awaited<ReturnType<typeof lixDiffCommits>>[number];

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

function modeTone(mode: KeatingAgentRuntimeConfig["mode"]): string {
  if (mode === "browser-only") return css({ background: "rgb(245 158 11 / 0.12)", color: "#b45309", borderColor: "rgb(245 158 11 / 0.4)", _dark: { color: "#fcd34d" } });
  if (mode === "browser-nodepod") return css({ background: "rgb(20 184 166 / 0.12)", color: "#0f766e", borderColor: "rgb(20 184 166 / 0.4)", _dark: { color: "#5eead4" } });
  if (mode === "host") return css({ background: "rgb(249 115 22 / 0.12)", color: "#c2410c", borderColor: "rgb(249 115 22 / 0.4)", _dark: { color: "#fdba74" } });
  if (mode === "remote") return css({ background: "rgb(16 185 129 / 0.12)", color: "#047857", borderColor: "rgb(16 185 129 / 0.4)", _dark: { color: "#6ee7b7" } });
  return css({ background: "rgb(14 165 233 / 0.12)", color: "#0369a1", borderColor: "rgb(14 165 233 / 0.4)", _dark: { color: "#7dd3fc" } });
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
    case "host": return "Host execution (trusted)";
    case "remote": return "Remote server";
    case "cloud": return "Cloud container";
    default: return "Unknown";
  }
}

const styles = {
  overlay: css({ position: "fixed", inset: 0, zIndex: 1000, background: "rgb(0 0 0 / 0.35)", backdropFilter: "blur(4px)" }),
  panel: css({ marginLeft: "auto", display: "flex", height: "100%", width: "100%", maxWidth: "40rem", flexDirection: "column", borderLeftWidth: "2px", borderColor: "var(--border)", background: "var(--background)", color: "var(--foreground)", boxShadow: "var(--shadow-2xl, 0 25px 50px -12px rgb(0 0 0 / 0.25))" }),
  header: css({ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottomWidth: "2px", borderColor: "var(--border)", padding: "0.75rem 1rem" }),
  minW0: css({ minWidth: 0 }),
  flexCenter: css({ display: "flex", alignItems: "center", gap: "0.5rem" }),
  titleIcon: css({ color: "var(--primary)" }),
  title: css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "1rem", fontWeight: 600 }),
  subtitle: css({ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)" }),
  iconButton: css({ display: "inline-flex", height: "2.25rem", width: "2.25rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", _hover: { background: "var(--accent)", color: "var(--accent-foreground)" } }),
  tabBar: css({ display: "flex", flexShrink: 0, gap: "0.25rem", overflowX: "auto", borderBottomWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.2)", padding: "0.375rem 0.5rem" }),
  tabButton: css({ display: "inline-flex", alignItems: "center", gap: "0.375rem", borderRadius: "0.375rem", padding: "0.375rem 0.625rem", fontSize: "0.75rem", fontWeight: 500, transitionProperty: "color, background-color, border-color", transitionDuration: "150ms" }),
  tabButtonActive: css({ background: "var(--primary)", color: "var(--primary-foreground)" }),
  tabButtonIdle: css({ color: "var(--muted-foreground)", _hover: { background: "var(--muted)", color: "var(--foreground)" } }),
  tabActions: css({ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }),
  body: css({ flex: 1, overflowY: "auto", padding: "1rem" }),
  grid2: css({ display: "grid", gap: "0.5rem" }),
  grid3: css({ display: "grid", gap: "0.75rem" }),
  grid4: css({ display: "grid", gap: "1rem" }),
  card: css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)" }),
  mutedCard: css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.25)", padding: "1rem" }),
  textXs: css({ fontSize: "0.75rem" }),
  textXsMuted: css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }),
  text10Muted: css({ fontSize: "10px", color: "var(--muted-foreground)" }),
  text10: css({ fontSize: "10px" }),
  semiboldXs: css({ fontSize: "0.75rem", fontWeight: 600 }),
  mono: css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" }),
  monoXs: css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem" }),
  primaryButtonSm: css({ display: "inline-flex", height: "1.75rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", background: "var(--primary)", paddingInline: "0.5rem", fontSize: "0.75rem", color: "var(--primary-foreground)", _hover: { background: "color-mix(in srgb, var(--primary) 90%, transparent)" }, _disabled: { opacity: 0.5 } }),
  primaryButton: css({ display: "inline-flex", height: "2.25rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", background: "var(--primary)", paddingInline: "0.75rem", fontSize: "0.75rem", fontWeight: 500, color: "var(--primary-foreground)", _hover: { background: "color-mix(in srgb, var(--primary) 90%, transparent)" }, _disabled: { opacity: 0.5 } }),
  outlineButtonSm: css({ display: "inline-flex", height: "1.75rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", _hover: { background: "var(--accent)" }, _disabled: { opacity: 0.5 } }),
  outlineButtonSmBg: css({ display: "inline-flex", height: "1.75rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", paddingInline: "0.5rem", fontSize: "0.75rem", _hover: { background: "rgb(from var(--muted) r g b / 0.5)" }, _disabled: { opacity: 0.5 } }),
  outlineButton: css({ display: "inline-flex", height: "2.25rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.75rem", fontSize: "0.75rem", _hover: { background: "var(--accent)" }, _disabled: { opacity: 0.5 } }),
  pillBase: css({ display: "inline-flex", alignItems: "center", borderRadius: "9999px", paddingInline: "0.375rem", height: "1.25rem", fontSize: "10px", fontWeight: 600 }),
  okPill: css({ background: "rgb(from var(--primary) r g b / 0.15)", color: "var(--primary)" }),
  errPill: css({ background: "rgb(from var(--destructive) r g b / 0.15)", color: "var(--destructive)" }),
  inputBase: css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.5rem 0.75rem", fontSize: "0.75rem" }),
  inputMono: css({ flex: 1, borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.5rem 0.75rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem" }),
  hidden: css({ display: "none" }),
  sectionLabel: css({ marginBottom: "0.5rem", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" }),
	helpDetails: css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "color-mix(in srgb, var(--muted) 18%, transparent)" }),
	helpSummary: css({ display: "flex", cursor: "pointer", listStyle: "none", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", fontSize: "0.8125rem", fontWeight: 600, _hover: { background: "var(--accent)" }, _focusVisible: { outline: "2px solid var(--ring)", outlineOffset: "-2px" } }),
	helpBody: css({ borderTopWidth: "1px", borderColor: "var(--border)", padding: "1rem", fontSize: "0.75rem", lineHeight: "1.55", color: "var(--muted-foreground)" }),
	helpModeGrid: css({ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }),
	helpMode: css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.75rem" }),
	helpModeTitle: css({ color: "var(--foreground)", fontWeight: 600 }),
	helpCode: css({ marginTop: "0.375rem", overflowX: "auto", borderRadius: "0.25rem", background: "#1c211b", padding: "0.5rem", color: "#f1ece0", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.6875rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }),
};

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
        { id: "snapshots", label: "Snapshots", icon: <HardDrive size={14} /> },
        { id: "vc", label: "Version Control", icon: <GitBranch size={14} /> }
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

  /* ── IndexedDB snapshots on mount ─────────────────────── */
  useEffect(() => {
    nodePodLoadSnapshotsFromDB().then(setDbSnapshots).catch(() => setDbSnapshots([]));
  }, []);

  /* ── Terminal attach when shell tab is active ─────────── */
  useEffect(() => {
    if (!nodePodActive || activeTab !== "shell") return;
    const term = nodePodGetTerminal();
    if (term && terminalContainerRef.current) {
      term.attach(terminalContainerRef.current);
      requestAnimationFrame(() => {
        term.fit();
        setTerminalReady(true);
      });
    }
  }, [activeTab, nodePodActive]);

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
      await refreshVc();
    }
    refreshSnapshots();
  }, [nodePodActive]);

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

  const refreshSnapshots = useCallback(() => {
    setSnapshots(getSnapshotLog());
  }, []);

  /* ── boot / teardown ──────────────────────────────────── */

  const handleBoot = useCallback(async () => {
    setBooting(true);
    const started = performance.now();
    try {
      await bootNodePod();
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

  /* ── version control (Lix) actions ────────────────────── */

  const refreshVc = useCallback(async () => {
    try {
      const [branches, commits] = await Promise.all([
        lixListBranches(),
        lixListCommits(),
      ]);
      const lix = await getSandboxLix();
      const activeId = await lix.activeBranchId();
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
      await lixCreateBranch(vcNewBranchName.trim());
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
      await lixSwitchBranch(branchId);
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
      const commitId = await lixCommit(files, message);
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
      const changes = await lixDiffCommits(fromCommitId, toCommitId);
      setVcDiff({ fromCommit: fromCommitId, toCommit: toCommitId, changes });
    } catch {
      setVcDiff(null);
    } finally {
      setVcLoading(false);
    }
  }, []);

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
        commits: bundle.vc.commits.length,
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
    : runtime.executionEndpoint
    ? runtime.mode === "host" ? "host available" : "remote available"
    : "browser-only fallback";
  const nodePodAction = nodePodControlAction(runtime, nodePodActive);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Sandbox runtime view">
      <div className={styles.panel}>
        {/* header */}
        <header className={styles.header}>
          <div className={styles.minW0}>
            <div className={styles.flexCenter}>
              <Cpu size={18} className={styles.titleIcon} />
              <h2 className={styles.title}>Sandbox View</h2>
            </div>
            <p className={styles.subtitle}>
              {runtime ? runtimeLabel(runtime.mode) : "Loading runtime config…"}
            </p>
          </div>
          <button
            type="button"
            className={cx("chat-action-button", styles.iconButton)}
            aria-label="Close sandbox view"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        {/* tab bar */}
        <div className={styles.tabBar}>
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => startTabTransition(() => setActiveTab(tab.id))}
              aria-busy={isTabPending && activeTab !== tab.id}
              className={cx(
                styles.tabButton,
                activeTab === tab.id
                  ? styles.tabButtonActive
                  : styles.tabButtonIdle
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          <div className={styles.tabActions}>
            {nodePodAction === "stop" ? (
              <button
                type="button"
                onClick={handleTeardown}
                className={css({ display: "inline-flex", height: "1.75rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", color: "var(--destructive)", _hover: { background: "rgb(from var(--destructive) r g b / 0.1)" } })}
              >
                <PowerOff size={12} /> Stop
              </button>
            ) : nodePodAction === "boot" ? (
              <button
                type="button"
                onClick={handleBoot}
                disabled={booting}
                className={styles.primaryButtonSm}
              >
                {booting ? <Spinner size={12} /> : <Power size={12} />}
                Boot
              </button>
            ) : null}
            <button
              type="button"
              onClick={refreshAll}
              className={styles.outlineButtonSm}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        <div className={styles.body} aria-busy={isTabPending} style={{ opacity: isTabPending ? 0.72 : 1, transition: "opacity 120ms ease-out" }}>{renderTab()}</div>
      </div>
    </div>
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
    const hasRecentErrors = events.slice(0, 10).some((e) => !e.ok);
    const recentEvents = events.slice(0, 5);
    const probeCount = events.filter((e) => e.tab === "probes").length;
    const snapshotCount = snapshots.length;
    const vfsFileCount = vfsEntries.filter((e) => !e.isDir).length;

    return (
      <div className={styles.grid4}>
        {/* ── runtime identity card ── */}
        <div className={styles.mutedCard}>
          <div className={css({ marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
            <div className={styles.flexCenter}>
              <span className={cx(css({ display: "inline-flex", alignItems: "center", gap: "0.375rem", borderRadius: "0.375rem", borderWidth: "1px", padding: "0.25rem 0.625rem", fontSize: "0.75rem", fontWeight: 500 }), modeTone(runtime?.mode ?? "browser-only"))}>
                <Activity size={13} />
                {runtime?.label ?? "Loading runtime"}
              </span>
              {hasRecentErrors && (
                <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", background: "rgb(from var(--destructive) r g b / 0.1)", padding: "0.125rem 0.5rem", fontSize: "10px", fontWeight: 600, color: "var(--destructive)" })}>
                  <Bug size={10} /> Errors in log
                </span>
              )}
            </div>
            <span className={css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" })}>{runtimeHealth}</span>
          </div>

          <dl className={css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "1rem", rowGap: "0.5rem", fontSize: "0.75rem", sm: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } })}>
            <div>
              <dt className={css({ color: "var(--muted-foreground)" })}>Mode</dt>
              <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.875rem" })}>{runtime?.mode ?? "—"}</dd>
            </div>
            <div>
              <dt className={css({ color: "var(--muted-foreground)" })}>Endpoint</dt>
              <dd className={css({ marginTop: "0.125rem", wordBreak: "break-all", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.875rem" })}>{runtime?.executionEndpoint ?? "—"}</dd>
            </div>
            <div>
              <dt className={css({ color: "var(--muted-foreground)" })}>Snapshots</dt>
              <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.875rem" })}>{snapshotCount}</dd>
            </div>
            <div>
              <dt className={css({ color: "var(--muted-foreground)" })}>Probes</dt>
              <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.875rem" })}>{probeCount}</dd>
            </div>
          </dl>
        </div>

		<details className={styles.helpDetails}>
			<summary className={styles.helpSummary}>
				<CircleHelp size={15} aria-hidden="true" /> Which execution mode should I use?
			</summary>
			<div className={styles.helpBody}>
				Keating keeps the teaching UI in the browser while execution can happen locally, directly on a trusted host, or behind an isolated external service. Choose based on the code&apos;s trust level and the capabilities it needs.
				<div className={styles.helpModeGrid}>
					<div className={styles.helpMode}>
						<div className={styles.helpModeTitle}>NodePod: local and contained in the browser</div>
						<div>Best for ordinary lesson artifacts, JavaScript experiments, snapshots, and offline work. It is not a hard security boundary and cannot run arbitrary native binaries.</div>
						<pre className={styles.helpCode}>keating web --browser-only-agent 3000</pre>
					</div>
					<div className={styles.helpMode}>
						<div className={styles.helpModeTitle}>Host: direct commands on this machine</div>
						<div>Best for a trusted personal machine when you need installed binaries. Commands and file operations are localhost-only and confined to the selected root, but this is not a sandbox.</div>
						<pre className={styles.helpCode}>keating web --host 3000 --allow-local-exec --root=/path/to/project</pre>
					</div>
					<div className={styles.helpMode}>
						<div className={styles.helpModeTitle}>External: isolated provider or custom gateway</div>
						<div>Best for untrusted code, native binaries, durable jobs, or provider-managed isolation. The service receives POST /api/agent-runtime/execute with an operation and payload.</div>
						<pre className={styles.helpCode}>KEATING_WEB_REMOTE_AUTH_TOKEN=... keating web --remote 3000 --remote-provider=daytona --remote-endpoint=https://sandbox.example</pre>
					</div>
					<div className={styles.helpMode}>
						<div className={styles.helpModeTitle}>Cloud: Keating&apos;s configured hosted runtime</div>
						<div>Best when the deployment already supplies a canonical remote execution service and server-brokered credentials.</div>
						<pre className={styles.helpCode}>keating web --cloud 3000 --cloud-endpoint=https://keating.help</pre>
					</div>
				</div>
			</div>
		</details>

        {/* ── capabilities grid ── */}
        <div>
          <div className={styles.sectionLabel}>Capabilities</div>
          <div className={css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.5rem", sm: { gridTemplateColumns: "repeat(4, minmax(0, 1fr))" } })}>
            {[
			  { label: "Source Editing", available: nodePodActive || !!runtime?.capabilities.remoteSandbox || !!runtime?.capabilities.localCommandExecution },
			  { label: "File System", available: nodePodActive || !!runtime?.capabilities.remoteSandbox || !!runtime?.capabilities.hostProjectAccess },
			  { label: "Shell", available: nodePodActive || !!runtime?.capabilities.remoteSandbox || !!runtime?.capabilities.localCommandExecution },
			  { label: "Snapshots", available: nodePodActive || !!runtime?.capabilities.durableCompute },
              { label: "Benchmarks", available: true },
              { label: "Policy Evolution", available: true },
              { label: "Prompt Evolution", available: true },
			  { label: "Self-Improve", available: nodePodActive || !!runtime?.executionEndpoint },
            ].map((cap) => (
              <div
                key={cap.label}
                className={cx(
                  css({ display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", borderWidth: "1px", padding: "0.5rem 0.75rem", fontSize: "0.75rem" }),
                  cap.available
                    ? css({ borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.2)" })
                    : css({ borderStyle: "dashed", borderColor: "rgb(from var(--muted-foreground) r g b / 0.2)", color: "rgb(from var(--muted-foreground) r g b / 0.6)" })
                )}
              >
                {cap.available ? <CheckCircle2 size={12} className={css({ flexShrink: 0, color: "var(--primary)" })} /> : <div className={css({ height: "0.75rem", width: "0.75rem", flexShrink: 0, borderRadius: "9999px", borderWidth: "1px", borderColor: "rgb(from var(--muted-foreground) r g b / 0.3)" })} />}
                {cap.label}
              </div>
            ))}
          </div>
        </div>

        {/* ── runtime-specific detail panel ── */}
        {runtime?.mode === "browser-nodepod" && (
          <div className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "rgb(20 184 166 / 0.3)", background: "rgb(20 184 166 / 0.05)", padding: "1rem" })}>
            <div className={css({ marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between" })}>
              <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", fontWeight: 600 })}>
                <Cpu size={14} className={css({ color: "#0d9488", _dark: { color: "#5eead4" } })} />
                NodePod Sandbox
              </div>
              {nodePodActive && (
                <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "9999px", background: "rgb(20 184 166 / 0.15)", padding: "0.125rem 0.5rem", fontSize: "10px", fontWeight: 500, color: "#0f766e", _dark: { color: "#5eead4" } })}>
                  <Activity size={9} /> Active
                </span>
              )}
            </div>

            {nodePodInfoState ? (
              <dl className={css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "1rem", rowGap: "0.5rem", fontSize: "0.75rem", sm: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } })}>
                <div>
                  <dt className={css({ color: "var(--muted-foreground)" })}>Instance</dt>
                  <dd className={css({ marginTop: "0.125rem", wordBreak: "break-all", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" })}>{nodePodInfoState.instanceId}</dd>
                </div>
                <div>
                  <dt className={css({ color: "var(--muted-foreground)" })}>SharedArrayBuffer</dt>
                  <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" })}>{nodePodInfoState.sabEnabled ? "enabled" : "disabled"}</dd>
                </div>
                {nodePodInfoState.memoryStats ? (
                  <>
                    <div>
                      <dt className={css({ color: "var(--muted-foreground)" })}>VFS Files</dt>
                      <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" })}>{nodePodInfoState.memoryStats.vfs.fileCount} <span className={css({ color: "var(--muted-foreground)" })}>({fmtBytes(nodePodInfoState.memoryStats.vfs.totalBytes)})</span></dd>
                    </div>
                    <div>
                      <dt className={css({ color: "var(--muted-foreground)" })}>Heap</dt>
                      <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" })}>{nodePodInfoState.memoryStats.heap ? `${nodePodInfoState.memoryStats.heap.usedMB.toFixed(1)} / ${nodePodInfoState.memoryStats.heap.limitMB.toFixed(1)} MB` : "—"}</dd>
                    </div>
                    <div>
                      <dt className={css({ color: "var(--muted-foreground)" })}>Module Cache</dt>
                      <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" })}>{nodePodInfoState.memoryStats.engine.moduleCacheSize}</dd>
                    </div>
                    <div>
                      <dt className={css({ color: "var(--muted-foreground)" })}>Transform Cache</dt>
                      <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" })}>{nodePodInfoState.memoryStats.engine.transformCacheSize}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            ) : nodePodActive ? (
              <div className={styles.textXsMuted}>Sandbox is active but introspection is not available.</div>
            ) : (
              <div className={styles.textXsMuted}>NodePod is not running.</div>
            )}
          </div>
        )}

        {(runtime?.mode === "host" || runtime?.mode === "remote") && (
          <div className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "rgb(16 185 129 / 0.3)", background: "rgb(16 185 129 / 0.05)", padding: "1rem" })}>
            <div className={css({ marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between" })}>
              <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", fontWeight: 600 })}>
                <Cpu size={14} className={css({ color: "#059669", _dark: { color: "#6ee7b7" } })} />
				{runtime.mode === "host" ? "Host Runtime" : "Remote Runtime"}
              </div>
              <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem", borderRadius: "9999px", background: "rgb(16 185 129 / 0.15)", padding: "0.125rem 0.5rem", fontSize: "10px", fontWeight: 500, color: "#047857", _dark: { color: "#6ee7b7" } })}>
				<Activity size={9} /> {runtime.executionEndpoint ? "Connected" : "Unavailable"}
              </span>
            </div>
            <dl className={css({ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "1rem", rowGap: "0.5rem", fontSize: "0.75rem" })}>
              <div>
                <dt className={css({ color: "var(--muted-foreground)" })}>Endpoint</dt>
                <dd className={css({ marginTop: "0.125rem", wordBreak: "break-all", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" })}>{runtime.executionEndpoint}</dd>
              </div>
              <div>
                <dt className={css({ color: "var(--muted-foreground)" })}>Fallback</dt>
                <dd className={css({ marginTop: "0.125rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)" })}>{runtime.fallback.message ?? "none"}</dd>
              </div>
            </dl>
          </div>
        )}

        {runtime?.mode === "browser-only" && (
          <div className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "rgb(245 158 11 / 0.3)", background: "rgb(245 158 11 / 0.05)", padding: "1rem" })}>
            <div className={css({ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", fontWeight: 600 })}>
              <Bug size={14} className={css({ color: "#d97706", _dark: { color: "#fcd34d" } })} />
              Browser-Only Mode
            </div>
            <p className={css({ fontSize: "0.75rem", lineHeight: 1.625, color: "var(--muted-foreground)" })}>
              Running without a Node.js sandbox. Source editing, file system, shell, and snapshots are unavailable. Switch to <strong>NodePod</strong> via the Boot button, or configure a <strong>Remote runtime</strong> in Settings.
            </p>
          </div>
        )}

        {/* ── recent activity ── */}
        {recentEvents.length > 0 && (
          <div>
            <div className={styles.sectionLabel}>Recent Activity</div>
            <div className={css({ display: "grid", gap: "0.375rem" })}>
              {recentEvents.map((ev) => (
                <div key={ev.id} className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem", fontSize: "0.75rem" })}>
                  <span className={cx(styles.pillBase, ev.ok ? styles.okPill : styles.errPill)}>
                    {ev.ok ? "OK" : "ERR"}
                  </span>
                  <span className={css({ color: "var(--muted-foreground)" })}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  <span className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", color: "var(--muted-foreground)" })}>{ev.operation}</span>
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
        <div className={styles.textXsMuted}>
          Sandbox is not active. Boot NodePod to use the file system.
        </div>
      );
    }
    return (
      <div className={styles.grid3}>
        <div className={styles.flexCenter}>
          <button type="button" onClick={() => openDir("/workspace")} className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", _hover: { background: "var(--accent)" } })} title="Go to /workspace"><Home size={13} /></button>
          <button type="button" onClick={goUp} className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", _hover: { background: "var(--accent)" } })} title="Go up"><ChevronLeft size={13} /></button>
          <span className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{vfsPath}</span>
        </div>

        {vfsLoading ? (
          <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}><Spinner size={13} /> Loading…</div>
        ) : (
          <div className={styles.card}>
            {vfsEntries.length === 0 ? (
              <div className={css({ padding: "0.75rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Empty directory</div>
            ) : (
              vfsEntries.map((entry) => (
                <div key={entry.path} className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderBottomWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem", fontSize: "0.75rem", _last: { borderBottomWidth: 0 }, _hover: { background: "rgb(from var(--muted) r g b / 0.3)" } })}>
                  <span className={css({ flexShrink: 0 })}>{entry.isDir ? <FolderOpen size={14} className={css({ color: "var(--primary)" })} /> : <FileCode size={14} className={css({ color: "var(--muted-foreground)" })} />}</span>
                  <button
                    type="button"
                    className={css({ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", _hover: { color: "var(--primary)" } })}
                    onClick={() => entry.isDir ? openDir(entry.path) : openFile(entry.path)}
                  >
                    {entry.name}
                  </button>
                  <span className={css({ marginLeft: "auto", flexShrink: 0, fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{entry.isDir ? "dir" : fmtBytes(entry.size)}</span>
                  <button type="button" className={css({ flexShrink: 0, color: "rgb(from var(--destructive) r g b / 0.7)", _hover: { color: "var(--destructive)" } })} onClick={() => deleteSelected(entry.path, entry.isDir)}><Trash2 size={12} /></button>
                </div>
              ))
            )}
          </div>
        )}

        {/* create + editor */}
        <div className={css({ display: "flex", gap: "0.5rem" })}>
          <input
            className={css({ flex: 1, borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.375rem 0.5rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem" })}
            placeholder="new_name.js"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createItem()}
          />
          <select className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.375rem 0.5rem", fontSize: "0.75rem" })} value={createType} onChange={(e) => setCreateType(e.target.value as "file" | "dir")}>
            <option value="file">File</option>
            <option value="dir">Dir</option>
          </select>
          <button type="button" onClick={createItem} className={css({ display: "inline-flex", height: "2rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", _hover: { background: "var(--accent)" } })}>
            <Plus size={12} /> Add
          </button>
        </div>

        {selectedFile && (
          <div className={styles.card}>
            <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", borderBottomWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.2)", padding: "0.5rem 0.75rem" })}>
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
                  <GitCompare size={12} /> {showDiff ? "Hide diff" : "Show diff"}
                </button>
                <button type="button" onClick={saveFile} className={styles.primaryButtonSm}><Save size={12} /> Save</button>
              </div>
            </div>

            {showDiff ? (
              <div className={css({ minHeight: "12rem", width: "100%", overflow: "auto", background: "var(--background)", padding: "0.5rem 0.75rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", lineHeight: 1.625 })}>
                {diffLoading ? (
                  <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--muted-foreground)" })}><Spinner size={13} /> Computing diff…</div>
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
          Sandbox is not active. Boot NodePod to use the shell.
        </div>
      );
    }
    return (
      <div className={css({ display: "grid", height: "100%", gap: "0.5rem" })} style={{ height: "calc(100% - 40px)" }}>
        <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
          <span className={styles.semiboldXs}>NodePod Terminal</span>
          <div className={css({ display: "flex", gap: "0.25rem" })}>
            <button
              type="button"
              onClick={clearTerminal}
              className={styles.outlineButtonSmBg}
            >
              <RotateCcw size={12} />
              Clear
            </button>
            <button
              type="button"
              onClick={focusTerminal}
              className={styles.outlineButtonSmBg}
            >
              <Maximize2 size={12} />
              Fit
            </button>
          </div>
        </div>
        <div
          ref={terminalContainerRef}
          className={css({ width: "100%", overflow: "hidden", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "black" })}
          style={{ height: "400px", minHeight: "300px" }}
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
          Sandbox is not active. Boot NodePod to use snapshots.
        </div>
      );
    }
    return (
      <div className={styles.grid3}>
        <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
          <div className={css({ display: "flex", alignItems: "center", gap: "0.75rem" })}>
            <span className={styles.semiboldXs}>
              {showDbSnapshots ? `Persisted (${dbSnapshots.length})` : `Session (${snapshots.length})`}
            </span>
            <button
              type="button"
              onClick={() => setShowDbSnapshots((v) => !v)}
              className={css({ fontSize: "10px", color: "var(--muted-foreground)", textDecorationLine: "underline", _hover: { color: "var(--foreground)" } })}
            >
              {showDbSnapshots ? "Show session" : "Show persisted"}
            </button>
          </div>
          <div className={css({ display: "flex", gap: "0.25rem" })}>
            {showDbSnapshots && (
              <button
                type="button"
                onClick={refreshDbSnapshots}
                className={styles.outlineButtonSmBg}
              >
                <RefreshCw size={12} /> Refresh
              </button>
            )}
            <button
              type="button"
              onClick={createSnapshotAction}
              disabled={snapLoading}
              className={styles.primaryButtonSm}
            >
              {snapLoading ? <Spinner size={12} /> : <Plus size={12} />}
              Create
            </button>
          </div>
        </div>

        {showDbSnapshots ? (
          dbSnapshots.length === 0 ? (
            <div className={styles.textXsMuted}>No persisted snapshots yet. They are saved to IndexedDB and survive page reloads.</div>
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
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          snapshots.length === 0 ? (
            <div className={styles.textXsMuted}>No session snapshots yet.</div>
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
                    <RotateCcw size={12} /> Restore
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
          Sandbox is not active. Boot NodePod to use version control.
        </div>
      );
    }
    return (
      <div className={styles.grid3}>
        {/* Branch controls */}
        <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
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
              <Download size={12} /> Export
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={portableBusy}
              className={styles.outlineButtonSmBg}
            >
              <Upload size={12} /> Import
            </button>
            <button
              type="button"
              onClick={refreshVc}
              className={styles.outlineButtonSmBg}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        {/* New branch */}
        <div className={css({ display: "flex", gap: "0.5rem" })}>
          <input
            className={styles.inputMono}
            placeholder="experiment-name"
            value={vcNewBranchName}
            onChange={(e) => setVcNewBranchName(e.target.value)}
          />
          <button
            type="button"
            onClick={createBranchAction}
            disabled={vcLoading || !vcNewBranchName.trim()}
            className={styles.primaryButton}
          >
            <GitBranch size={13} /> Branch
          </button>
        </div>

        {/* Commit */}
        <div className={css({ display: "flex", gap: "0.5rem" })}>
          <input
            className={cx(styles.inputBase, css({ flex: 1 }))}
            placeholder="Commit message (optional)"
            value={vcCommitMessage}
            onChange={(e) => setVcCommitMessage(e.target.value)}
          />
          <button
            type="button"
            onClick={commitToVcAction}
            disabled={vcLoading}
            className={styles.primaryButton}
          >
            <GitCommit size={13} /> Commit
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
                    <RotateCcw size={10} /> Switch
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
                <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
                  <span className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", fontWeight: 500 })}>{c.id.slice(0, 24)}</span>
                  <span className={styles.text10Muted}>{c.fileCount} files</span>
                </div>
                <div className={css({ marginTop: "0.125rem", fontSize: "0.75rem" })}>{c.message}</div>
                <div className={styles.text10Muted}>{new Date(c.createdAt).toLocaleString()}</div>
                {i < vcCommits.length - 1 && (
                  <button
                    type="button"
                    onClick={() => diffCommitsAction(c.id, vcCommits[i + 1].id)}
                    className={css({ marginTop: "0.375rem", display: "inline-flex", height: "1.5rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "10px", _hover: { background: "var(--accent)" } })}
                  >
                    <GitCompare size={10} /> Diff with next
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.textXsMuted}>
            No commits yet. Make changes in the VFS tab and press Commit to track them.
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
      <div className={styles.grid2} ref={logRef}>
        {events.length === 0 ? (
          <div className={styles.textXsMuted}>No events yet. Run a probe, shell command, or VFS operation.</div>
        ) : (
          events.map((ev, idx) => (
            <div key={ev.id} className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.625rem" })}>
              <div className={css({ marginBottom: "0.25rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
                <span className={cx(styles.pillBase, ev.ok ? styles.okPill : styles.errPill)}>{ev.ok ? "OK" : "ERR"}</span>
                <span className={styles.text10Muted}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                <span className={css({ fontSize: "10px", fontWeight: 500, color: "var(--muted-foreground)" })}>{ev.tab}</span>
                <span className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "10px" })}>{ev.operation}</span>
                {ev.durationMs !== undefined && <span className={styles.text10Muted}>{ev.durationMs}ms</span>}
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
      <div className={styles.grid3}>
        <label className={css({ marginBottom: "0.125rem", display: "block", fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" })}>Operation</label>
        <select
          className={css({ marginBottom: "0.25rem", width: "100%", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.5rem", fontSize: "0.75rem" })}
          value={probeKind}
          onChange={(e) => setProbeKind(e.target.value)}
        >
          <option value="config">agent_runtime.config</option>
          <option value="runtime.ping">runtime.ping</option>
          <option value="shell.exec">shell.exec</option>
          <option value="snapshot.create">snapshot.create</option>
        </select>

        <label className={css({ marginBottom: "0.125rem", display: "block", fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" })}>Payload JSON</label>
        <textarea
          className={css({ minHeight: "7rem", width: "100%", resize: "vertical", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.2)", padding: "0.5rem 0.75rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", lineHeight: 1.625 })}
          spellCheck={false}
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
            {runningProbe ? <Spinner size={15} /> : <Play size={15} />}
            Run probe
          </button>
          {events.some((e) => e.tab === "probes") && (
            <button type="button" onClick={copyOutput} className={styles.outlineButton}>
              <Copy size={14} /> {copiedIndex !== null ? "Copied" : "Copy latest"}
            </button>
          )}
        </div>

        {events.filter((e) => e.tab === "probes").length > 0 && (
          <div className={css({ marginTop: "0.5rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.2)", padding: "0.75rem" })}>
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
