/** Diagnostics tab of the sandbox runtime dialog: probe operation, JSON payload, run and latest result. */
import Copy from "reicon-react/icons/Copy";
import Play from "reicon-react/icons/Play";
import { css, cx } from "../../../styled-system/css";
import { JsonCrackBlock } from "../JsonCrackBlock";
import { KeatingIcon } from "../KeatingIcon";
import { Select } from "../Select";
import type { SandboxLogEvent } from "./sandbox-helpers";
import { RuntimeSpinner, styles } from "./sandbox-shared";
import type { SandboxProbe } from "./useSandboxProbe";

export function SandboxProbesPanel({ probe, events }: { probe: SandboxProbe; events: SandboxLogEvent[] }) {
  const { probeKind, setProbeKind, payloadText, setPayloadText, runningProbe, copiedIndex, runProbe, copyOutput } = probe;
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
