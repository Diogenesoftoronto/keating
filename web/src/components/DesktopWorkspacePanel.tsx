import { useCallback, useEffect, useRef, useState } from "react";
import { executeDesktopNative } from "../lib/desktop-native";
import { Select } from "./Select";
import "./desktop-workspace.css";

type Execute = (operation: string, payload: Record<string, unknown>) => Promise<unknown>;
type Entry = { name: string; path: string; isDir: boolean; size: number };
type ProcessResult = { processId: string; stdout?: string; stderr?: string; running?: boolean; exitCode?: number | null; timedOut?: boolean; truncated?: boolean; command?: string };

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function joinPath(directory: string, name: string) { return `${directory.replace(/[\\/]$/, "")}/${name}`; }

/** Real desktop files and subprocess output. This is deliberately not a PTY terminal. */
export function DesktopWorkspacePanel({ workspacePath, execute = executeDesktopNative, onDirtyChange }: {
  workspacePath: string;
  execute?: Execute;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<"files" | "commands">("files");
  const [directory, setDirectory] = useState(workspacePath);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("file");
  const [command, setCommand] = useState("");
  const [commandCwd, setCommandCwd] = useState(workspacePath);
  const [timeoutMs, setTimeoutMs] = useState("120000");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [process, setProcess] = useState<ProcessResult | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [lastCommand, setLastCommand] = useState("");
  const [processes, setProcesses] = useState<ProcessResult[]>([]);
  const readGeneration = useRef(0);
  const listGeneration = useRef(0);
  const dirty = selected !== "" && content !== saved;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  const refresh = useCallback(async () => {
    const generation = ++listGeneration.current;
    setLoading(true);
    try {
      const result = await execute("fs.list", { path: directory }) as Entry[];
      if (generation !== listGeneration.current) return;
      setEntries(result.map((entry) => ({ ...entry, path: /^(?:[A-Za-z]:[\\/]|\/)/.test(entry.path) ? entry.path : joinPath(workspacePath, entry.path) })).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)));
    } catch (e) { if (generation === listGeneration.current) setError(message(e)); }
    finally { if (generation === listGeneration.current) setLoading(false); }
  }, [directory, execute, workspacePath]);

  const refreshProcesses = useCallback(async () => {
    try { setProcesses(await execute("process.list", {}) as ProcessResult[]); }
    catch (e) { setError(message(e)); }
  }, [execute]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (tab === "commands") void refreshProcesses(); }, [tab, refreshProcesses]);
  useEffect(() => () => { readGeneration.current++; listGeneration.current++; }, []);
  useEffect(() => {
    if (!process?.running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await execute("process.poll", { processId: process.processId }) as ProcessResult;
        if (cancelled) return;
        setStdout(result.stdout ?? "");
        setStderr(result.stderr ?? "");
        if (!result.running) { setProcess({ ...result, processId: process.processId }); void refresh(); return; }
        timer = setTimeout(poll, 400);
      } catch (e) {
        if (!cancelled) { setError(message(e)); timer = setTimeout(poll, 1500); }
      }
    };
    timer = setTimeout(poll, 100);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [process?.processId, process?.running, execute, refresh]);

  async function openFile(entry: Entry) {
    if (entry.isDir) { setDirectory(entry.path); return; }
    if (dirty) { setError("Save or discard your edits before opening another file."); return; }
    const generation = ++readGeneration.current;
    setFileLoading(true); setError(""); setNotice("");
    try {
      const result = await execute("fs.read", { path: entry.path }) as { content: string; encoding?: string };
      if (generation !== readGeneration.current) return;
      if ((result.encoding && !["utf8", "utf-8"].includes(result.encoding)) || result.content.includes("\0")) throw new Error("This file is not UTF-8 text. Open it with a desktop application.");
      setSelected(entry.path); setContent(result.content); setSaved(result.content);
    } catch (e) { if (generation === readGeneration.current) setError(message(e)); }
    finally { if (generation === readGeneration.current) setFileLoading(false); }
  }

  async function saveFile() {
    setSaving(true); setError("");
    const value = content;
    try { await execute("fs.write", { path: selected, content: value }); setSaved(value); setNotice("Saved on this computer."); await refresh(); }
    catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  }

  async function createEntry() {
    const name = newName.trim();
    if (!name || name === "." || name === ".." || /[\\/]/.test(name)) { setError("Use a name without folder separators."); return; }
    if (entries.some((entry) => entry.name === name)) { setError("That name already exists in this folder."); return; }
    setSaving(true); setError("");
    try {
      const path = joinPath(directory, name);
      await execute(newKind === "folder" ? "fs.mkdir" : "fs.write", { path, ...(newKind === "file" ? { content: "", exclusive: true } : {}) });
      setNewName(""); setNotice(`Created ${name}.`); await refresh();
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  }

  async function runCommand() {
    setStarting(true); setError(""); setNotice(""); setStdout(""); setStderr("");
    try {
      const result = await execute("process.start", { command: command.trim(), cwd: commandCwd, shell: true, timeoutMs: Number(timeoutMs) }) as ProcessResult;
      setLastCommand(command.trim()); setProcess({ ...result, running: true });
      setStdout(result.stdout ?? ""); setStderr(result.stderr ?? "");
      void refreshProcesses();
    } catch (e) { setError(message(e)); }
    finally { setStarting(false); }
  }

  async function stopCommand() {
    if (!process) return;
    setStopping(true);
    try {
      const result = await execute("process.stop", { processId: process.processId }) as ProcessResult;
      setProcess({ ...result, processId: process.processId });
      setStdout(result.stdout ?? ""); setStderr(result.stderr ?? "");
    }
    catch (e) { setError(message(e)); }
    finally { setStopping(false); }
  }

  async function sendInput() {
    if (!process?.running) return;
    setSending(true);
    try { await execute("process.write", { processId: process.processId, input: `${input}\n` }); setInput(""); }
    catch (e) { setError(message(e)); }
    finally { setSending(false); }
  }

  return <section className="desktop-workspace" aria-label="Native workspace">
    <div className="desktop-workspace-intro"><p>Files stay on this computer. Commands use your installed tools and your account’s permissions.</p><code title={workspacePath}>{workspacePath}</code></div>
    <nav className="desktop-workspace-tabs" aria-label="Workspace views">
      <button type="button" aria-pressed={tab === "files"} onClick={() => setTab("files")}>Files{dirty ? " •" : ""}</button>
      <button type="button" aria-pressed={tab === "commands"} onClick={() => setTab("commands")}>Commands{process?.running ? " · Running" : ""}</button>
    </nav>
    {error && <div role="alert" className="runtime-error">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
    {notice && <p className="desktop-workspace-notice" role="status">{notice}</p>}
    <div hidden={tab !== "files"} className="desktop-workspace-files">
      <div className="desktop-workspace-toolbar">
        <button type="button" disabled={directory === workspacePath} onClick={() => setDirectory(directory.replace(/[\\/][^\\/]+[\\/]?$/, "") || workspacePath)}>Up</button>
        <code title={directory}>{directory === workspacePath ? "Workspace" : directory.slice(workspacePath.length + 1)}</code>
        <button type="button" disabled={loading} onClick={() => { setError(""); void refresh(); }}>Refresh files</button>
      </div>
      <div className="desktop-workspace-file-list" aria-label="Workspace files" aria-busy={loading}>
        {loading && entries.length === 0 ? <p role="status">Loading files…</p> : entries.length === 0 ? <p>Create a file below, or run a command to start a project.</p> : entries.map((entry) => <button type="button" key={entry.path} disabled={fileLoading || saving} aria-pressed={!entry.isDir && selected === entry.path} onClick={() => void openFile(entry)}><span aria-hidden="true">{entry.isDir ? "▸" : "·"}</span><span>{entry.name}{entry.isDir ? "/" : ""}</span><small>{entry.isDir ? "Folder" : `${entry.size.toLocaleString()} B`}</small></button>)}
      </div>
      <form className="desktop-workspace-create" onSubmit={(e) => { e.preventDefault(); void createEntry(); }}>
        <Select aria-label="New item type" value={newKind} onValueChange={setNewKind}><option value="file">File</option><option value="folder">Folder</option></Select>
        <input aria-label="New item name" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" disabled={!newName.trim() || saving || loading}>Create</button>
      </form>
      {fileLoading && <p role="status">Opening file…</p>}
      {selected && <div className="desktop-workspace-editor">
        <div className="desktop-workspace-toolbar"><code title={selected}>{selected.split(/[\\/]/).pop()}{dirty ? " · Unsaved" : ""}</code><button type="button" disabled={!dirty || saving} onClick={() => { setContent(saved); setError(""); }}>Discard edits</button><button type="button" className="runtime-primary-button" disabled={!dirty || saving} onClick={() => void saveFile()}>{saving ? "Saving…" : "Save file"}</button></div>
        <textarea aria-label={`Edit ${selected.split(/[\\/]/).pop()}`} value={content} disabled={saving || fileLoading} spellCheck={false} onChange={(e) => { setContent(e.target.value); setNotice(""); }} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (dirty && !saving) void saveFile(); } }} />
      </div>}
    </div>
    <div hidden={tab !== "commands"} className="desktop-workspace-commands">
      <div className="desktop-workspace-processes"><div className="desktop-workspace-toolbar"><small>Processes stay available when this panel closes.</small><button type="button" onClick={() => void refreshProcesses()}>Refresh processes</button></div>{processes.filter((item) => item.processId !== process?.processId && item.running).map((item) => <button type="button" key={item.processId} onClick={() => { setProcess(item); setLastCommand(item.command ?? "Native process"); setStdout(item.stdout ?? ""); setStderr(item.stderr ?? ""); }}>{item.command ?? "Native process"} · View output</button>)}</div>
      <form onSubmit={(e) => { e.preventDefault(); void runCommand(); }}>
        <label>Working folder<input value={commandCwd} onChange={(e) => setCommandCwd(e.target.value)} disabled={starting || process?.running} /></label>
        <label>Command<textarea value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} placeholder="python3 --version" rows={2} disabled={starting || process?.running} /></label>
        <label>Time limit<Select value={timeoutMs} onValueChange={setTimeoutMs} disabled={starting || process?.running}><option value="120000">2 minutes</option><option value="600000">10 minutes</option><option value="1800000">30 minutes</option></Select></label>
        <div className="desktop-workspace-toolbar"><small>Runs directly on your computer.</small>{process?.running ? <button type="button" className="runtime-stop" disabled={stopping} onClick={() => void stopCommand()}>{stopping ? "Stopping…" : "Stop command"}</button> : <button type="submit" className="runtime-primary-button" disabled={starting || !command.trim()}>{starting ? "Starting…" : "Run command"}</button>}</div>
      </form>
      {process && <section className="desktop-workspace-output" aria-label="Command output"><div className="desktop-workspace-toolbar"><code>{lastCommand}</code><span role="status">{process.running ? "Running" : process.timedOut ? "Time limit reached" : `Exited ${process.exitCode ?? "without a code"}`}</span></div><pre tabIndex={0} aria-label="Standard output">{stdout || (process.running ? "Waiting for output…" : "No standard output.")}</pre>{stderr && <><h3>Standard error</h3><pre tabIndex={0}>{stderr}</pre></>}{process.truncated && <p>Output was truncated. Write large results to a file to keep them in full.</p>}</section>}
      {process?.running && <form className="desktop-workspace-stdin" onSubmit={(e) => { e.preventDefault(); void sendInput(); }}><label>Process input<input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Send a line of text" disabled={sending} /></label><button type="submit" disabled={sending}>Send input</button><small>Text input and output only. Interactive terminal apps need a separate terminal.</small></form>}
    </div>
  </section>;
}
