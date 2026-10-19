/** Diagnostics probe state for the sandbox dialog: operation, payload, run, and copy-latest. */
import { useCallback, useState } from "react";
import { loadAgentRuntimeConfig, type KeatingAgentRuntimeConfig } from "../../keating/agent-runtime";
import { errorMessage, formatJson, type PushSandboxEvent, type SandboxLogEvent } from "./sandbox-helpers";
import { executeProbe } from "./sandbox-probe";

export function useSandboxProbe({
  events,
  pushEvent,
  setRuntime,
}: {
  events: SandboxLogEvent[];
  pushEvent: PushSandboxEvent;
  setRuntime: (runtime: KeatingAgentRuntimeConfig) => void;
}) {
  const [probeKind, setProbeKind] = useState("config");
  const [payloadText, setPayloadText] = useState("{}");
  const [runningProbe, setRunningProbe] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const runProbe = useCallback(async () => {
    setRunningProbe(true);
    const started = performance.now();
    try {
      const latestRuntime = await loadAgentRuntimeConfig(true);
      setRuntime(latestRuntime);
      const outcome = await executeProbe(probeKind, payloadText, latestRuntime);
      if (outcome.timed) {
        pushEvent("probes", outcome.operation, outcome.ok, outcome.output, Math.round(performance.now() - started));
      } else {
        pushEvent("probes", outcome.operation, outcome.ok, outcome.output);
      }
    } catch (error) {
      pushEvent("probes", `probe.${probeKind}`, false, { error: errorMessage(error) }, Math.round(performance.now() - started));
    } finally {
      setRunningProbe(false);
    }
  }, [probeKind, payloadText, pushEvent, setRuntime]);

  const copyOutput = useCallback(async () => {
    const latestProbe = events.find((e) => e.tab === "probes");
    if (!latestProbe) return;
    const text = formatJson(latestProbe.output);
    await navigator.clipboard.writeText(text);
    const idx = events.indexOf(latestProbe);
    setCopiedIndex(idx);
    window.setTimeout(() => setCopiedIndex(null), 1200);
  }, [events]);

  return { probeKind, setProbeKind, payloadText, setPayloadText, runningProbe, copiedIndex, runProbe, copyOutput };
}

export type SandboxProbe = ReturnType<typeof useSandboxProbe>;
