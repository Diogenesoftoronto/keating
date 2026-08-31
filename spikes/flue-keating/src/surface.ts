import type { SandboxRequirement } from "@keating/browser-agent-runtime";

export type AgentExecutionSurface = "browser-local" | "mobile-remote" | "hosted";

export interface KeatingAgentInitialData {
  evolutionNamespace: string;
  surface: AgentExecutionSurface;
  model: string;
  mcp?: { url: string; toolAllowlist: string[] };
}

export interface KeatingSurfaceManifest {
  runtime: "flue-2";
  storageAuthority: "local" | "notorganic";
  execution: {
    surface: AgentExecutionSurface;
    requirements: SandboxRequirement;
    mayLeaveDevice: boolean;
  };
  portableState: Array<"prompts" | "evolution-code" | "map-elites-parameters" | "learner-evidence">;
  credentialsPersistedInAgentState: false;
}

export function manifestForSurface(
  surface: AgentExecutionSurface,
  signedIn: boolean
): KeatingSurfaceManifest {
  const browserLocal = surface === "browser-local";
  return {
    runtime: "flue-2",
    storageAuthority: signedIn ? "notorganic" : "local",
    execution: {
      surface,
      requirements: browserLocal
        ? { filesystem: true, process: true }
        : { secureIsolation: true, filesystem: true, process: true, outboundNetwork: true },
      mayLeaveDevice: !browserLocal,
    },
    portableState: ["prompts", "evolution-code", "map-elites-parameters", "learner-evidence"],
    credentialsPersistedInAgentState: false,
  };
}
