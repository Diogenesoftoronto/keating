export type KeatingAgentRuntimeMode = "browser-only" | "browser-nodepod" | "remote" | "cloud";

export interface KeatingRemoteAgentRuntimeConfig {
  provider: string;
  endpoint: string | null;
  region: string | null;
  snapshot: string | null;
  cpu: string | null;
  memory: string | null;
  disk: string | null;
}

export interface KeatingAgentRuntimeCapabilities {
  browserLocal: boolean;
  remoteSandbox: boolean;
  secureIsolation: boolean;
  nativeBinaries: boolean;
  serverBrokeredSecrets: boolean;
  durableCompute: boolean;
}

export interface KeatingAgentRuntimeConfig {
  mode: KeatingAgentRuntimeMode;
  label: string;
  executionEndpoint: string | null;
  cloudEndpoint: string | null;
  remote: KeatingRemoteAgentRuntimeConfig | null;
  capabilities: KeatingAgentRuntimeCapabilities;
  fallback: {
    localFirst: boolean;
    remoteAvailable: boolean;
    message: string;
  };
}

const DEFAULT_CLOUD_ENDPOINT = "https://keating.help";

export const DEFAULT_AGENT_RUNTIME_CONFIG: KeatingAgentRuntimeConfig = {
  mode: "browser-only",
  label: "Browser-only agent",
  executionEndpoint: null,
  cloudEndpoint: null,
  remote: null,
  capabilities: {
    browserLocal: true,
    remoteSandbox: false,
    secureIsolation: false,
    nativeBinaries: false,
    serverBrokeredSecrets: false,
    durableCompute: false,
  },
  fallback: {
    localFirst: true,
    remoteAvailable: false,
    message: "Run supported agent work in the browser. Surface a fallback error for secure isolation, native binaries, brokered secrets, durable compute, or public inbound networking.",
  },
};

let runtimeConfigPromise: Promise<KeatingAgentRuntimeConfig> | null = null;

export function normalizeAgentRuntimeConfig(value: unknown): KeatingAgentRuntimeConfig {
  if (!value || typeof value !== "object") return DEFAULT_AGENT_RUNTIME_CONFIG;
  const raw = value as Partial<KeatingAgentRuntimeConfig>;
  const mode = raw.mode === "remote" || raw.mode === "cloud" || raw.mode === "browser-only"
    ? raw.mode
    : "browser-only";

  if (mode === "browser-only") return DEFAULT_AGENT_RUNTIME_CONFIG;

  const remote = raw.remote && typeof raw.remote === "object"
    ? {
        provider: String(raw.remote.provider || "microsandbox"),
        endpoint: raw.remote.endpoint || null,
        region: raw.remote.region || null,
        snapshot: raw.remote.snapshot || null,
        cpu: raw.remote.cpu || null,
        memory: raw.remote.memory || null,
        disk: raw.remote.disk || null,
      }
    : null;

  if (mode === "remote") {
    return {
      mode,
      label: "Remote microVM agent",
      executionEndpoint: "/api/agent-runtime/remote",
      cloudEndpoint: null,
      remote: remote ?? {
        provider: "microsandbox",
        endpoint: null,
        region: null,
        snapshot: null,
        cpu: null,
        memory: null,
        disk: null,
      },
      capabilities: {
        browserLocal: true,
        remoteSandbox: true,
        secureIsolation: true,
        nativeBinaries: true,
        serverBrokeredSecrets: true,
        durableCompute: true,
      },
      fallback: {
        localFirst: true,
        remoteAvailable: true,
        message: "Run browser-compatible work locally first. Route secure isolation, native binaries, brokered secrets, durable compute, and public networking to the configured remote sandbox.",
      },
    };
  }

  return {
    mode,
    label: "Keating Cloud agent",
    executionEndpoint: "/api/agent-runtime/remote",
    cloudEndpoint: raw.cloudEndpoint || DEFAULT_CLOUD_ENDPOINT,
    remote: null,
    capabilities: {
      browserLocal: true,
      remoteSandbox: true,
      secureIsolation: true,
      nativeBinaries: true,
      serverBrokeredSecrets: true,
      durableCompute: true,
    },
    fallback: {
      localFirst: true,
      remoteAvailable: true,
      message: "Run browser-compatible work locally first. Route remote-only work through the canonical Keating Cloud backend.",
    },
  };
}

export async function loadAgentRuntimeConfig(force = false): Promise<KeatingAgentRuntimeConfig> {
  if (runtimeConfigPromise && !force) return runtimeConfigPromise;
  runtimeConfigPromise = fetch("/api/agent-runtime/config", { headers: { accept: "application/json" } })
    .then((response) => response.ok ? response.json() : DEFAULT_AGENT_RUNTIME_CONFIG)
    .then(normalizeAgentRuntimeConfig)
    .then(async (config) => {
      // Overlay NodePod browser sandbox when locally active
      const { isNodePodActive, NODEPOD_LOCAL_ENDPOINT } = await import("./nodepod-runtime");
      if (isNodePodActive()) {
        return {
          ...config,
          mode: "browser-nodepod" as KeatingAgentRuntimeMode,
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
      return config;
    })
    .catch(() => DEFAULT_AGENT_RUNTIME_CONFIG);
  return runtimeConfigPromise;
}
