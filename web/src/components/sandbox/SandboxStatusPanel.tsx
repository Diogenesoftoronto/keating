/**
 * Overview tab of the sandbox runtime dialog: intro, metrics, shortcuts, recent
 * activity, environment details and the environment guide.
 *
 * Mostly a flat render tree; the only branching is showing sections by runtime state.
 */
import Bug from "reicon-react/icons/Bug";
import CheckCircle2 from "reicon-react/icons/CheckCircle";
import ChevronLeft from "reicon-react/icons/ChevronLeft";
import Cpu from "reicon-react/icons/Cpu";
import FolderOpen from "reicon-react/icons/FolderOpen";
import CircleHelp from "reicon-react/icons/HelpCircle";
import Terminal from "reicon-react/icons/TerminalSquare";
import X from "reicon-react/icons/X";
import type { KeatingAgentRuntimeConfig } from "../../keating/agent-runtime";
import type { nodePodInfo, getSnapshotLog } from "../../keating/nodepod-runtime";
import { KeatingIcon } from "../KeatingIcon";
import {
  failureBannerMessage,
  fmtBytes,
  recentEventLabel,
  runtimeLabel,
  type SandboxLogEvent,
} from "./sandbox-helpers";

export function SandboxStatusPanel({
  runtime,
  nodePodActive,
  nodePodInfoState,
  snapshots,
  events,
  onSelectTab,
}: {
  runtime: KeatingAgentRuntimeConfig | null;
  nodePodActive: boolean;
  nodePodInfoState: Awaited<ReturnType<typeof nodePodInfo>> | null;
  snapshots: ReturnType<typeof getSnapshotLog>;
  events: SandboxLogEvent[];
  onSelectTab: (tab: "vfs" | "shell" | "log") => void;
}) {
  const memory = nodePodInfoState?.memoryStats;
  const recentEvents = events.slice(0, 3);
  const isLocal = !runtime || runtime.mode === "browser-only" || runtime.mode === "browser-nodepod";
  const latestFailure = events[0] && !events[0].ok ? events[0] : null;

  return (
    <div className="runtime-overview">
      {latestFailure && <div className="runtime-error" role="alert"><KeatingIcon icon={Bug} size={18} /><span>{failureBannerMessage(latestFailure)}</span></div>}
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
          <button type="button" onClick={() => onSelectTab("vfs")}><KeatingIcon icon={FolderOpen} size={22} /><span><strong>Browse files</strong><small>Open your workspace</small></span><KeatingIcon icon={ChevronLeft} size={16} className="runtime-next" /></button>
          <button type="button" onClick={() => onSelectTab("shell")}><KeatingIcon icon={Terminal} size={22} /><span><strong>Open terminal</strong><small>Run a command</small></span><KeatingIcon icon={ChevronLeft} size={16} className="runtime-next" /></button>
        </div>
      </>}

      <section className="runtime-recent">
        <div className="runtime-section-heading"><h3>Recent activity</h3>{events.length > 0 && <button type="button" className="runtime-text-button" onClick={() => onSelectTab("log")}>View all <span>{events.length}</span></button>}</div>
        {recentEvents.length === 0 ? <p className="runtime-empty-inline">Your runs and workspace changes will appear here.</p> : recentEvents.map((event) => (
          <button type="button" className="runtime-event-row" key={event.id} onClick={() => onSelectTab("log")}>
            <KeatingIcon icon={event.ok ? CheckCircle2 : Bug} size={18} className={event.ok ? "runtime-success" : "runtime-failure"} />
            <span>{recentEventLabel(event.operation)}</span>
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
