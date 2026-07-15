import { isNodePodActive, NODEPOD_LOCAL_ENDPOINT } from "./nodepod-runtime";
import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  normalizeAgentRuntimeConfig,
  type KeatingAgentRuntimeConfig,
} from "./agent-runtime-config";

export * from "./agent-runtime-config";

let runtimeConfigPromise: Promise<KeatingAgentRuntimeConfig> | null = null;

export function shouldAutoBootNodePod(config: KeatingAgentRuntimeConfig): boolean {
  return config.mode === "browser-only";
}

export function shouldRouteExecutionToNodePod(config: KeatingAgentRuntimeConfig | null | undefined): boolean {
  return config?.mode === "browser-nodepod";
}

export function nodePodControlAction(
  config: KeatingAgentRuntimeConfig | null | undefined,
  nodePodActive: boolean,
): "stop" | "boot" | null {
  if (nodePodActive) return "stop";
  return config?.mode === "browser-only" ? "boot" : null;
}

export function applyNodePodRuntimeOverlay(
  config: KeatingAgentRuntimeConfig,
  nodePodActive: boolean,
): KeatingAgentRuntimeConfig {
  if (!nodePodActive || config.mode !== "browser-only") return config;

  return {
    ...config,
    mode: "browser-nodepod",
    label: "Browser + NodePod agent",
    executionEndpoint: NODEPOD_LOCAL_ENDPOINT,
    capabilities: {
      ...config.capabilities,
      remoteSandbox: true,
      secureIsolation: false,
      nativeBinaries: false,
    },
    fallback: {
      localFirst: true,
      remoteAvailable: true,
      message: "NodePod browser sandbox is active. Run filesystem, shell, and snapshot work locally. Secure isolation, native binaries, and server-brokered secrets still require a remote backend.",
    },
  };
}

export async function loadAgentRuntimeConfig(force = false): Promise<KeatingAgentRuntimeConfig> {
  if (runtimeConfigPromise && !force) return runtimeConfigPromise;
  runtimeConfigPromise = fetch("/api/agent-runtime/config", { headers: { accept: "application/json" } })
    .then((response) => response.ok ? response.json() : DEFAULT_AGENT_RUNTIME_CONFIG)
    .then(normalizeAgentRuntimeConfig)
    .then((config) => applyNodePodRuntimeOverlay(config, isNodePodActive()))
    .catch(() => DEFAULT_AGENT_RUNTIME_CONFIG);
  return runtimeConfigPromise;
}
