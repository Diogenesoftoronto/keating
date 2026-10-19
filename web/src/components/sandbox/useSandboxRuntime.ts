/**
 * Runtime configuration state for the sandbox dialog: the loaded agent runtime
 * config, connection error, NodePod active flag and instance info, with the
 * refresh that re-reads them.
 */
import { useCallback, useState } from "react";
import { loadAgentRuntimeConfig, type KeatingAgentRuntimeConfig } from "../../keating/agent-runtime";
import { getSnapshotLog, isNodePodActive, nodePodInfo } from "../../keating/nodepod-runtime";
import { isDesktopNativeRuntime } from "../../lib/desktop-native";

export function useSandboxRuntime() {
  const [runtime, setRuntime] = useState<KeatingAgentRuntimeConfig | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [nodePodActive, setNodePodActive] = useState(false);
  const [nodePodInfoState, setNodePodInfoState] = useState<Awaited<ReturnType<typeof nodePodInfo>> | null>(null);

  const refreshConfig = useCallback(async () => {
    try {
      const config = await loadAgentRuntimeConfig(true);
      setRuntimeError("");
      setRuntime(config);
      if (isDesktopNativeRuntime(config)) { setNodePodActive(false); return; }
      const active = isNodePodActive();
      setNodePodActive(active);
      if (active || getSnapshotLog().length > 0) {
        const info = await nodePodInfo().catch(() => null);
        setNodePodInfoState(info);
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "The workspace could not connect.");
    }
  }, []);

  return {
    runtime,
    setRuntime,
    runtimeError,
    nodePodActive,
    setNodePodActive,
    nodePodInfoState,
    setNodePodInfoState,
    refreshConfig,
  };
}
