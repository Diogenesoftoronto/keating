import type { LearnerSurface } from "./ui.js";
import { hasOnlyKeys, isBoundedArray, isBoundedString, isContractId, isContractTimestamp, isRecord } from "./validation.js";

export type CapabilityId =
  | "streaming-chat"
  | "provider-settings"
  | "sessions"
  | "artifacts"
  | "learner-review"
  | "courses"
  | "share"
  | "voice"
  | "live-media"
  | "workspace";

export interface CapabilityManifestEntry {
  id: CapabilityId;
  available: boolean;
  surface: LearnerSurface;
  /** A missing capability must tell the learner where their in-progress work goes. */
  handoff?: { target: LearnerSurface; reason: string };
  recovery?: "retry" | "settings" | "sign-in" | "handoff";
}

export interface CapabilityManifest {
  schemaVersion: 1;
  generatedAt: string;
  entries: CapabilityManifestEntry[];
}

export type WorkspaceOperation = "read" | "execute" | "patch" | "snapshot" | "rollback";
export type WorkspaceConnectionState = "unconfigured" | "sign-in-required" | "connecting" | "ready" | "error";
export type WorkspaceRecoveryKind = "settings" | "sign-in" | "retry" | "handoff";

export interface WorkspaceRuntimeIdentity {
  id: string;
  label: string;
  revision: string;
}

export interface WorkspaceCapabilityRecovery {
  kind: WorkspaceRecoveryKind;
  reason: string;
  target?: LearnerSurface;
}

/**
 * Secret-free runtime truth for agent workspace exposure. This is deliberately
 * separate from portable learner data: revisions and adapter availability are
 * ephemeral execution facts, not learning records.
 */
export interface WorkspaceRuntimeCapability {
  schemaVersion: 1;
  generatedAt: string;
  surface: LearnerSurface;
  state: WorkspaceConnectionState;
  operations: readonly WorkspaceOperation[];
  workspace?: WorkspaceRuntimeIdentity;
  recovery?: WorkspaceCapabilityRecovery;
}

const CAPABILITY_IDS = new Set<CapabilityId>(["streaming-chat", "provider-settings", "sessions", "artifacts", "learner-review", "courses", "share", "voice", "live-media", "workspace"]);
const SURFACES = new Set<LearnerSurface>(["web", "desktop", "mobile", "terminal"]);
const RECOVERIES = new Set<NonNullable<CapabilityManifestEntry["recovery"]>>(["retry", "settings", "sign-in", "handoff"]);
const MANIFEST_KEYS = new Set(["schemaVersion", "generatedAt", "entries"]);
const ENTRY_KEYS = new Set(["id", "available", "surface", "handoff", "recovery"]);
const HANDOFF_KEYS = new Set(["target", "reason"]);
const WORKSPACE_OPERATIONS = new Set<WorkspaceOperation>(["read", "execute", "patch", "snapshot", "rollback"]);
const WORKSPACE_STATES = new Set<WorkspaceConnectionState>(["unconfigured", "sign-in-required", "connecting", "ready", "error"]);
const WORKSPACE_RECOVERIES = new Set<WorkspaceRecoveryKind>(["settings", "sign-in", "retry", "handoff"]);
const WORKSPACE_CAPABILITY_KEYS = new Set(["schemaVersion", "generatedAt", "surface", "state", "operations", "workspace", "recovery"]);
const WORKSPACE_IDENTITY_KEYS = new Set(["id", "label", "revision"]);
const WORKSPACE_RECOVERY_KEYS = new Set(["kind", "reason", "target"]);

export function validateCapabilityManifest(value: unknown): value is CapabilityManifest {
  if (!isRecord(value) || !hasOnlyKeys(value, MANIFEST_KEYS) || value.schemaVersion !== 1 || !isContractTimestamp(value.generatedAt)
    || !Array.isArray(value.entries) || !isBoundedArray(value.entries, CAPABILITY_IDS.size) || value.entries.length !== CAPABILITY_IDS.size) return false;
  const ids = new Set<string>();
  const validEntries = value.entries.every((entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ENTRY_KEYS) || !CAPABILITY_IDS.has(entry.id as CapabilityId) || ids.has(entry.id as string)
      || typeof entry.available !== "boolean" || !SURFACES.has(entry.surface as LearnerSurface)
      || (entry.recovery !== undefined && !RECOVERIES.has(entry.recovery as NonNullable<CapabilityManifestEntry["recovery"]>))) return false;
    ids.add(entry.id as string);
    if (entry.available) return entry.recovery === undefined && entry.handoff === undefined;
    if (entry.recovery === "handoff") {
      if (!isRecord(entry.handoff) || !hasOnlyKeys(entry.handoff, HANDOFF_KEYS)) return false;
      return SURFACES.has(entry.handoff.target as LearnerSurface) && entry.handoff.target !== entry.surface
        && isBoundedString(entry.handoff.reason, 1024, false);
    }
    return entry.recovery !== undefined && entry.recovery !== "handoff" && entry.handoff === undefined;
  });
  return validEntries && ids.size === CAPABILITY_IDS.size;
}

export function validateWorkspaceRuntimeCapability(value: unknown): value is WorkspaceRuntimeCapability {
  if (!isRecord(value) || !hasOnlyKeys(value, WORKSPACE_CAPABILITY_KEYS) || value.schemaVersion !== 1
    || !isContractTimestamp(value.generatedAt) || !SURFACES.has(value.surface as LearnerSurface)
    || !WORKSPACE_STATES.has(value.state as WorkspaceConnectionState)
    || !isBoundedArray(value.operations, WORKSPACE_OPERATIONS.size)
    || !value.operations.every((operation) => WORKSPACE_OPERATIONS.has(operation as WorkspaceOperation))
    || new Set(value.operations).size !== value.operations.length) return false;

  if (value.state === "ready") {
    if (value.operations.length === 0 || value.recovery !== undefined || !isRecord(value.workspace)
      || !hasOnlyKeys(value.workspace, WORKSPACE_IDENTITY_KEYS)) return false;
    return isContractId(value.workspace.id) && isBoundedString(value.workspace.label, 256, false)
      && isContractId(value.workspace.revision);
  }

  if (value.operations.length !== 0 || value.workspace !== undefined || !isRecord(value.recovery)
    || !hasOnlyKeys(value.recovery, WORKSPACE_RECOVERY_KEYS)
    || !WORKSPACE_RECOVERIES.has(value.recovery.kind as WorkspaceRecoveryKind)
    || !isBoundedString(value.recovery.reason, 1024, false)) return false;
  if (value.recovery.kind === "handoff") {
    return SURFACES.has(value.recovery.target as LearnerSurface) && value.recovery.target !== value.surface;
  }
  return value.recovery.target === undefined;
}

/** A source mutation is offered only when it can be snapshotted and rolled back. */
export function workspaceCanMutate(capability: WorkspaceRuntimeCapability): boolean {
  if (!validateWorkspaceRuntimeCapability(capability) || capability.state !== "ready") return false;
  const operations = new Set(capability.operations);
  return operations.has("patch") && operations.has("snapshot") && operations.has("rollback");
}
