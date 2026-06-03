import { unsupportedCapability } from "./errors";
import type {
  AgentSandbox,
  CapabilityDecision,
  SandboxRequirement,
  SandboxRoute,
} from "./types";

export function checkCapabilities(
  sandbox: AgentSandbox,
  requirement: SandboxRequirement = {}
): CapabilityDecision {
  const missing: Array<keyof SandboxRequirement> = [];
  const caps = sandbox.capabilities;

  if (requirement.secureIsolation && !caps.secureIsolation) missing.push("secureIsolation");
  if (requirement.nativeBinaries && !caps.nativeBinaries) missing.push("nativeBinaries");
  if (requirement.filesystem && !caps.filesystem) missing.push("filesystem");
  if (requirement.process && !caps.process) missing.push("process");
  if (requirement.sessions && !caps.sessions) missing.push("sessions");
  if (requirement.preview && !caps.preview) missing.push("preview");
  if (requirement.snapshots && !caps.snapshots) missing.push("snapshots");
  if (requirement.packageInstall && !caps.packageInstall) missing.push("packageInstall");
  if (requirement.outboundNetwork && caps.outboundNetwork !== true) missing.push("outboundNetwork");
  if (requirement.inboundNetwork && !caps.inboundNetwork) missing.push("inboundNetwork");
  if (requirement.secrets && caps.secrets !== requirement.secrets) missing.push("secrets");

  return { ok: missing.length === 0, missing };
}

export function selectSandbox(
  sandboxes: AgentSandbox[],
  requirement: SandboxRequirement = {}
): SandboxRoute {
  for (const sandbox of sandboxes) {
    const decision = checkCapabilities(sandbox, requirement);
    if (decision.ok) return { sandbox, decision };
  }

  if (sandboxes.length === 0) {
    throw unsupportedCapability(undefined, Object.keys(requirement) as Array<keyof SandboxRequirement>);
  }

  const local = sandboxes.find((sandbox) => sandbox.capabilities.browserLocal) ?? sandboxes[0]!;
  const decision = checkCapabilities(local, requirement);
  throw unsupportedCapability(
    local.kind,
    decision.missing,
    "Attach a remote Daytona/microsandbox adapter or relax the operation requirement."
  );
}

export async function withSandboxFallback<T>(
  local: AgentSandbox,
  remote: AgentSandbox | undefined,
  requirement: SandboxRequirement,
  operation: (sandbox: AgentSandbox) => Promise<T>
): Promise<{ sandbox: AgentSandbox; value: T; fallback: boolean }> {
  const localDecision = checkCapabilities(local, requirement);
  if (localDecision.ok) {
    return { sandbox: local, value: await operation(local), fallback: false };
  }
  if (!remote) {
    throw unsupportedCapability(
      local.kind,
      localDecision.missing,
      "No remote fallback sandbox is configured for this operation."
    );
  }
  const remoteDecision = checkCapabilities(remote, requirement);
  if (!remoteDecision.ok) {
    throw unsupportedCapability(remote.kind, remoteDecision.missing);
  }
  return { sandbox: remote, value: await operation(remote), fallback: true };
}

