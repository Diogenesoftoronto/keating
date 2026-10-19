/** Activity tab of the sandbox runtime dialog: the event log with expandable JSON output. */
import Activity from "reicon-react/icons/Activity";
import Bug from "reicon-react/icons/Bug";
import CheckCircle2 from "reicon-react/icons/CheckCircle";
import type { RefObject } from "react";
import { JsonCrackBlock } from "../JsonCrackBlock";
import { KeatingIcon } from "../KeatingIcon";
import type { SandboxLogEvent } from "./sandbox-helpers";

export function SandboxActivityPanel({
  events,
  logRef,
}: {
  events: SandboxLogEvent[];
  logRef: RefObject<HTMLDivElement | null>;
}) {
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
