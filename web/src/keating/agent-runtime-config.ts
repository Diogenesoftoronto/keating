export type KeatingAgentRuntimeMode = "browser-only" | "browser-nodepod" | "host" | "remote" | "cloud";
export type ServerAgentRuntimeMode = Exclude<KeatingAgentRuntimeMode, "browser-nodepod">;

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
  hostProjectAccess: boolean;
  localCommandExecution: boolean;
}

export interface KeatingAgentRuntimeConfig {
  mode: KeatingAgentRuntimeMode;
  label: string;
  executionEndpoint: string | null;
  cloudEndpoint: string | null;
  projectRoot: string | null;
  projectFilesEndpoint: string | null;
  localExecEndpoint: string | null;
  remote: KeatingRemoteAgentRuntimeConfig | null;
  capabilities: KeatingAgentRuntimeCapabilities;
  fallback: {
    localFirst: boolean;
    remoteAvailable: boolean;
    message: string;
  };
}

export interface AgentRuntimeConfigInput {
  mode: ServerAgentRuntimeMode;
  projectRoot?: string | null;
  localExecEnabled?: boolean;
  remote?: Partial<KeatingRemoteAgentRuntimeConfig> | null;
  cloudEndpoint?: string | null;
}

export const DEFAULT_CLOUD_ENDPOINT = "https://keating.help";

function projectFields(projectRoot: string | null, localExecEnabled: boolean) {
  return {
    projectRoot,
    projectFilesEndpoint: projectRoot ? "/api/project-files" : null,
    localExecEndpoint: projectRoot && localExecEnabled ? "/api/local-exec" : null,
  };
}

function remoteConfig(value: Partial<KeatingRemoteAgentRuntimeConfig> | null | undefined): KeatingRemoteAgentRuntimeConfig {
  return {
    provider: String(value?.provider || "microsandbox"),
    endpoint: value?.endpoint || null,
    region: value?.region || null,
    snapshot: value?.snapshot || null,
    cpu: value?.cpu || null,
    memory: value?.memory || null,
    disk: value?.disk || null,
  };
}

export function buildAgentRuntimeConfig(input: AgentRuntimeConfigInput): KeatingAgentRuntimeConfig {
  const projectRoot = input.projectRoot?.trim() || null;
  const localExecEnabled = Boolean(projectRoot && input.localExecEnabled);
  const project = projectFields(projectRoot, localExecEnabled);

  if (input.mode === "browser-only") {
    return {
      mode: "browser-only",
      label: "Browser-only agent",
      executionEndpoint: null,
      cloudEndpoint: null,
      ...project,
      remote: null,
      capabilities: {
        browserLocal: true,
        remoteSandbox: false,
        secureIsolation: false,
        nativeBinaries: false,
        serverBrokeredSecrets: false,
        durableCompute: false,
        hostProjectAccess: !!projectRoot,
        localCommandExecution: localExecEnabled,
      },
      fallback: {
        localFirst: true,
        remoteAvailable: false,
        message: "Run supported agent work in the browser. Secure isolation, native binaries, brokered secrets, durable compute, and public inbound networking require another runtime.",
      },
    };
  }

  if (input.mode === "host") {
    return {
      mode: "host",
      label: localExecEnabled ? "Host execution agent" : "Host execution unavailable",
      executionEndpoint: localExecEnabled ? "/api/agent-runtime/host" : null,
      cloudEndpoint: null,
      ...project,
      remote: null,
      capabilities: {
        browserLocal: true,
        remoteSandbox: false,
        secureIsolation: false,
        nativeBinaries: localExecEnabled,
        serverBrokeredSecrets: false,
        durableCompute: false,
        hostProjectAccess: !!projectRoot,
        localCommandExecution: localExecEnabled,
      },
      fallback: {
        localFirst: true,
        remoteAvailable: localExecEnabled,
        message: localExecEnabled
          ? "Host execution is enabled. Commands run directly on the serving machine inside the configured project root; this is not a security sandbox."
          : "Host execution requires --allow-local-exec and a configured project root.",
      },
    };
  }

  if (input.mode === "remote") {
    const remote = remoteConfig(input.remote);
    const available = !!remote.endpoint;
    return {
      mode: "remote",
      label: available ? "Remote sandbox agent" : "Remote sandbox unavailable",
      executionEndpoint: available ? "/api/agent-runtime/remote" : null,
      cloudEndpoint: null,
      ...project,
      remote,
      capabilities: {
        browserLocal: true,
        remoteSandbox: available,
        secureIsolation: available,
        nativeBinaries: available,
        serverBrokeredSecrets: available,
        durableCompute: available,
        hostProjectAccess: !!projectRoot,
        localCommandExecution: localExecEnabled,
      },
      fallback: {
        localFirst: true,
        remoteAvailable: available,
        message: available
          ? "Run browser-compatible work locally first. Route isolation, native binaries, brokered secrets, durable compute, and public networking to the configured remote sandbox."
          : "Remote mode was requested, but KEATING_WEB_REMOTE_ENDPOINT is not configured.",
      },
    };
  }

  return {
    mode: "cloud",
    label: "Keating Cloud agent",
    executionEndpoint: "/api/agent-runtime/remote",
    cloudEndpoint: input.cloudEndpoint || DEFAULT_CLOUD_ENDPOINT,
    ...project,
    remote: null,
    capabilities: {
      browserLocal: true,
      remoteSandbox: true,
      secureIsolation: true,
      nativeBinaries: true,
      serverBrokeredSecrets: true,
      durableCompute: true,
      hostProjectAccess: !!projectRoot,
      localCommandExecution: localExecEnabled,
    },
    fallback: {
      localFirst: true,
      remoteAvailable: true,
      message: "Run browser-compatible work locally first. Route remote-only work through the canonical Keating Cloud backend.",
    },
  };
}

export const DEFAULT_AGENT_RUNTIME_CONFIG = buildAgentRuntimeConfig({ mode: "browser-only" });

export function normalizeAgentRuntimeConfig(value: unknown): KeatingAgentRuntimeConfig {
  if (!value || typeof value !== "object") return DEFAULT_AGENT_RUNTIME_CONFIG;
  const raw = value as Partial<KeatingAgentRuntimeConfig>;
  const legacyHost = raw.mode === "remote" && raw.remote?.provider === "host";
  const mode: ServerAgentRuntimeMode = legacyHost || raw.mode === "host"
    ? "host"
    : raw.mode === "remote" || raw.mode === "cloud" || raw.mode === "browser-only"
      ? raw.mode
      : "browser-only";

  return buildAgentRuntimeConfig({
    mode,
    projectRoot: raw.projectRoot,
    localExecEnabled: mode === "host"
      ? Boolean(raw.executionEndpoint === "/api/agent-runtime/host" || raw.localExecEndpoint)
      : Boolean(raw.localExecEndpoint),
    remote: mode === "remote" ? raw.remote : null,
    cloudEndpoint: raw.cloudEndpoint,
  });
}
