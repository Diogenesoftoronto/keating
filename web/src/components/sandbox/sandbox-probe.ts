/**
 * Diagnostics probe execution for the sandbox dialog: decides which backend a
 * probe runs against (config read, none, NodePod local, remote HTTP) and returns
 * the activity-log entry to record. Throws only for invalid payload JSON or
 * transport failures; callers record those as failed events.
 */
import type { KeatingAgentRuntimeConfig } from "../../keating/agent-runtime";
import { NODEPOD_LOCAL_ENDPOINT, nodePodExecute } from "../../keating/nodepod-runtime";
import { parseProbePayload, probeOutputOk } from "./sandbox-helpers";

export interface ProbeOutcome {
  operation: string;
  ok: boolean;
  output: unknown;
  /** The config read is logged without a duration; every other probe includes one. */
  timed: boolean;
}

export async function executeProbe(
  probeKind: string,
  payloadText: string,
  latestRuntime: KeatingAgentRuntimeConfig,
): Promise<ProbeOutcome> {
  if (probeKind === "config") {
    return { operation: "agent_runtime.config", ok: true, output: latestRuntime, timed: false };
  }
  const operation = `probe.${probeKind}`;

  if (latestRuntime.mode === "browser-only" || !latestRuntime.executionEndpoint) {
    return {
      operation,
      ok: false,
      output: {
        reason: "No execution endpoint is configured.",
        mode: latestRuntime.mode,
        fallback: latestRuntime.fallback,
      },
      timed: true,
    };
  }

  const payload = parseProbePayload(payloadText);

  if (latestRuntime.executionEndpoint === NODEPOD_LOCAL_ENDPOINT) {
    const output = await nodePodExecute(probeKind, payload);
    return { operation, ok: probeOutputOk(output), output, timed: true };
  }

  const response = await fetch(`${latestRuntime.executionEndpoint}/execute`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ operation: probeKind, payload }),
  });
  const body = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text();
  return { operation, ok: response.ok, output: body, timed: true };
}
