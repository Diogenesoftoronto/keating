import { MergeConflictError } from "./envelope.js";
import {
  codePointCompare,
  compareContractTimestamps,
  hasOnlyKeys,
  isBoundedArray,
  isBoundedString,
  isContractId,
  isContractTimestamp,
  isRecord,
} from "./validation.js";

/**
 * Account-evolution contracts are account-relative. The Not Organic gateway
 * derives the account namespace from its authenticated product session; no
 * client payload carries or chooses an account ID.
 */

export type PedagogyArtifactKind =
  | "prompt-set"
  | "teacher-policy"
  | "fitness-definition"
  | "optimizer-strategy"
  | "source-bundle"
  | "evaluation-report"
  | "map-elites-archive";

export interface PedagogyArtifactRef {
  id: string;
  kind: PedagogyArtifactKind;
  digest: string;
  mediaType: string;
  sizeBytes: number;
}

export type LearnerEvidenceKind =
  | "observed"
  | "delayed-observed"
  | "explicit-feedback"
  | "retrospective"
  | "synthetic"
  | "heuristic";

export interface LearnerEvidenceRef {
  id: string;
  kind: LearnerEvidenceKind;
  digest: string;
  capturedAt: string;
  exposureCount: number;
  sizeBytes: number;
}

export type PedagogyTarget = "browser-nodepod" | "mobile-declarative" | "flue-node";

/** Compatibility is part of the signed/content-addressed manifest, never an out-of-band hint. */
export interface PedagogyCompatibility {
  agentApi: string;
  learnerContract: number;
  targets: PedagogyTarget[];
  minimumFlue?: string;
  mobileSdk?: string;
  requiredCapabilities: string[];
}

/** Exact immutable payload stored at the active revision manifest digest. */
export interface PedagogyRevisionManifest {
  id: string;
  parentId?: string;
  createdAt: string;
  artifacts: PedagogyArtifactRef[];
  compatibility: PedagogyCompatibility;
}

/** A manifest plus the digest of its exact serialized payload. */
export interface PedagogyRevisionRef extends PedagogyRevisionManifest {
  manifestDigest: string;
}

export type EvolutionOperation =
  | "evaluate"
  | "prompt-evolution"
  | "policy-evolution"
  | "optimizer-evolution"
  | "source-evolution";

export type EvolutionRuntimeKind =
  | "javascript"
  | "node"
  | "bun"
  | "deno"
  | "python"
  | "wasm"
  | "native"
  | "oci";
export type EvolutionIsolationClass = "worker" | "process" | "container" | "microvm" | "virtual-machine";

export interface EvolutionRuntimeRequirement {
  kind: EvolutionRuntimeKind;
  version: string;
  abi: string;
  entrypoint: string;
}

export interface EvolutionNetworkRequirement {
  mode: "none" | "allowlist";
  allowedHosts: string[];
}

export interface EvolutionFilesystemRequirement {
  mode: "ephemeral" | "workspace-snapshot";
  maximumWritableBytes: number;
}

/** The runner receives named broker capabilities, never account credentials. */
export interface EvolutionSecretRequirement {
  mode: "none" | "brokered";
  capabilities: string[];
}

export interface EvolutionResourceRequirement {
  cpuMillis: number;
  memoryMiB: number;
  diskMiB: number;
  wallTimeSeconds: number;
  maximumOutputBytes: number;
}

/** Capabilities required from any local, hosted, container, or VM adapter. */
export interface EvolutionRunnerRequirements {
  runtime: EvolutionRuntimeRequirement;
  minimumIsolation: EvolutionIsolationClass;
  network: EvolutionNetworkRequirement;
  filesystem: EvolutionFilesystemRequirement;
  secrets: EvolutionSecretRequirement;
  resources: EvolutionResourceRequirement;
}

/** Client request accepted only in an authenticated NotOrganicProductSession. */
export interface AccountEvolutionJobRequest {
  schemaVersion: 1;
  clientRequestId: string;
  requestedAt: string;
  operation: EvolutionOperation;
  baseRevision: PedagogyRevisionRef;
  evidence: LearnerEvidenceRef[];
  requirements: EvolutionRunnerRequirements;
}

/** Provider-neutral proof of the adapter and isolated runtime that executed a job. */
export interface EvolutionExecutorAttestation {
  adapterId: string;
  adapterVersion: string;
  isolation: EvolutionIsolationClass;
  imageDigest?: string;
  runtimeDigest: string;
  executedAt: string;
}

export interface AccountEvolutionJobResult {
  resultDigest: string;
  proposedRevision: PedagogyRevisionRef;
  consumedEvidence: LearnerEvidenceRef[];
  attestation: EvolutionExecutorAttestation;
}

export type AccountEvolutionJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AccountEvolutionJobFailure {
  code: "execution-failed" | "resource-limit" | "validation-failed" | "runner-unavailable";
  message: string;
  retryable: boolean;
}

/** Durable account-relative job record; its storage namespace supplies account identity. */
export interface AccountEvolutionJobRecord {
  schemaVersion: 1;
  id: string;
  request: AccountEvolutionJobRequest;
  status: AccountEvolutionJobStatus;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: AccountEvolutionJobResult;
  failure?: AccountEvolutionJobFailure;
  cancellationReason?: string;
}

export interface ActivePedagogyPointer {
  schemaVersion: 1;
  revision: PedagogyRevisionRef;
  generation: number;
  activatedAt: string;
  activationId: string;
  sourceJobId: string;
}

export interface ExpectedActivePedagogy {
  revisionId: string;
  manifestDigest: string;
  generation: number;
}

/** Compare-and-swap activation request scoped by the authenticated account session. */
export interface PedagogyActivationRequest {
  schemaVersion: 1;
  clientRequestId: string;
  requestedAt: string;
  revision: PedagogyRevisionRef;
  sourceJobId: string;
  expectedActive: ExpectedActivePedagogy | null;
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/;
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/;

const MAX_ARTIFACT_BYTES = 67_108_864;
const MAX_EVIDENCE_BYTES = 16_777_216;
const MAX_ARTIFACTS = 64;
const MAX_EVIDENCE_REFS = 512;
const MAX_ALLOWED_HOSTS = 32;

const ARTIFACT_KINDS = new Set<PedagogyArtifactKind>([
  "prompt-set", "teacher-policy", "fitness-definition", "optimizer-strategy",
  "source-bundle", "evaluation-report", "map-elites-archive",
]);
const EVIDENCE_KINDS = new Set<LearnerEvidenceKind>([
  "observed", "delayed-observed", "explicit-feedback", "retrospective", "synthetic", "heuristic",
]);
const PEDAGOGY_TARGETS = new Set<PedagogyTarget>([
  "browser-nodepod", "mobile-declarative", "flue-node",
]);
const OPERATIONS = new Set<EvolutionOperation>([
  "evaluate", "prompt-evolution", "policy-evolution", "optimizer-evolution", "source-evolution",
]);
const RUNTIMES = new Set<EvolutionRuntimeKind>([
  "javascript", "node", "bun", "deno", "python", "wasm", "native", "oci",
]);
const ISOLATION_CLASSES = new Set<EvolutionIsolationClass>([
  "worker", "process", "container", "microvm", "virtual-machine",
]);
const JOB_STATUSES = new Set<AccountEvolutionJobStatus>(["queued", "running", "succeeded", "failed", "cancelled"]);
const FAILURE_CODES = new Set<AccountEvolutionJobFailure["code"]>([
  "execution-failed", "resource-limit", "validation-failed", "runner-unavailable",
]);

const ARTIFACT_KEYS = new Set(["id", "kind", "digest", "mediaType", "sizeBytes"]);
const EVIDENCE_KEYS = new Set(["id", "kind", "digest", "capturedAt", "exposureCount", "sizeBytes"]);
const COMPATIBILITY_KEYS = new Set([
  "agentApi", "learnerContract", "targets", "minimumFlue", "mobileSdk", "requiredCapabilities",
]);
const REVISION_MANIFEST_KEYS = new Set(["id", "parentId", "createdAt", "artifacts", "compatibility"]);
const REVISION_KEYS = new Set(["id", "parentId", "createdAt", "manifestDigest", "artifacts", "compatibility"]);
const RUNTIME_KEYS = new Set(["kind", "version", "abi", "entrypoint"]);
const NETWORK_KEYS = new Set(["mode", "allowedHosts"]);
const FILESYSTEM_KEYS = new Set(["mode", "maximumWritableBytes"]);
const SECRET_KEYS = new Set(["mode", "capabilities"]);
const RESOURCE_KEYS = new Set(["cpuMillis", "memoryMiB", "diskMiB", "wallTimeSeconds", "maximumOutputBytes"]);
const REQUIREMENTS_KEYS = new Set(["runtime", "minimumIsolation", "network", "filesystem", "secrets", "resources"]);
const JOB_REQUEST_KEYS = new Set([
  "schemaVersion", "clientRequestId", "requestedAt", "operation", "baseRevision", "evidence", "requirements",
]);
const ATTESTATION_KEYS = new Set([
  "adapterId", "adapterVersion", "isolation", "imageDigest", "runtimeDigest", "executedAt",
]);
const RESULT_KEYS = new Set(["resultDigest", "proposedRevision", "consumedEvidence", "attestation"]);
const FAILURE_KEYS = new Set(["code", "message", "retryable"]);
const JOB_RECORD_KEYS = new Set([
  "schemaVersion", "id", "request", "status", "attempt", "createdAt", "updatedAt", "startedAt", "completedAt",
  "result", "failure", "cancellationReason",
]);
const POINTER_KEYS = new Set([
  "schemaVersion", "revision", "generation", "activatedAt", "activationId", "sourceJobId",
]);
const EXPECTED_ACTIVE_KEYS = new Set(["revisionId", "manifestDigest", "generation"]);
const ACTIVATION_REQUEST_KEYS = new Set([
  "schemaVersion", "clientRequestId", "requestedAt", "revision", "sourceJobId", "expectedActive",
]);

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isAllowedHost(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 253 || !HOST_PATTERN.test(value)) return false;
  const portText = value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : undefined;
  return portText === undefined || (Number(portText) >= 1 && Number(portText) <= 65_535);
}

export function validatePedagogyArtifactRef(value: unknown): value is PedagogyArtifactRef {
  if (!isRecord(value) || !hasOnlyKeys(value, ARTIFACT_KEYS)) return false;
  return isContractId(value.id)
    && ARTIFACT_KINDS.has(value.kind as PedagogyArtifactKind)
    && isDigest(value.digest)
    && typeof value.mediaType === "string"
    && MEDIA_TYPE_PATTERN.test(value.mediaType)
    && isIntegerInRange(value.sizeBytes, 1, MAX_ARTIFACT_BYTES);
}

export function validateLearnerEvidenceRef(value: unknown): value is LearnerEvidenceRef {
  if (!isRecord(value) || !hasOnlyKeys(value, EVIDENCE_KEYS)) return false;
  return isContractId(value.id)
    && EVIDENCE_KINDS.has(value.kind as LearnerEvidenceKind)
    && isDigest(value.digest)
    && isContractTimestamp(value.capturedAt)
    && isIntegerInRange(value.exposureCount, 1, 1_000_000)
    && isIntegerInRange(value.sizeBytes, 1, MAX_EVIDENCE_BYTES);
}

function validatePedagogyRevisionFields(value: Record<string, unknown>): boolean {
  if (
    !isContractId(value.id)
    || (value.parentId !== undefined && (!isContractId(value.parentId) || value.parentId === value.id))
    || !isContractTimestamp(value.createdAt)
    || !isBoundedArray(value.artifacts, MAX_ARTIFACTS)
    || value.artifacts.length === 0
    || !value.artifacts.every(validatePedagogyArtifactRef)
    || !validatePedagogyCompatibility(value.compatibility)
  ) return false;
  const artifacts = value.artifacts as PedagogyArtifactRef[];
  const ids = artifacts.map((artifact) => artifact.id);
  const digests = artifacts.map((artifact) => artifact.digest);
  return new Set(ids).size === ids.length && new Set(digests).size === digests.length;
}

export function validatePedagogyRevisionManifest(value: unknown): value is PedagogyRevisionManifest {
  return isRecord(value)
    && hasOnlyKeys(value, REVISION_MANIFEST_KEYS)
    && validatePedagogyRevisionFields(value);
}

export function validatePedagogyRevisionRef(value: unknown): value is PedagogyRevisionRef {
  if (!isRecord(value) || !hasOnlyKeys(value, REVISION_KEYS)
    || !isContractId(value.id)
    || !isDigest(value.manifestDigest)) return false;
  return validatePedagogyRevisionFields(value);
}

export function validatePedagogyCompatibility(value: unknown): value is PedagogyCompatibility {
  if (!isRecord(value) || !hasOnlyKeys(value, COMPATIBILITY_KEYS)
    || !isContractId(value.agentApi)
    || !isIntegerInRange(value.learnerContract, 1, 1_000)
    || !isBoundedArray(value.targets, 3) || value.targets.length === 0
    || !value.targets.every((target) => PEDAGOGY_TARGETS.has(target as PedagogyTarget))
    || new Set(value.targets).size !== value.targets.length
    || (value.minimumFlue !== undefined && !isBoundedString(value.minimumFlue, 64, false))
    || (value.mobileSdk !== undefined && !isBoundedString(value.mobileSdk, 64, false))
    || !isBoundedArray(value.requiredCapabilities, 64)
    || !value.requiredCapabilities.every(isContractId)
    || new Set(value.requiredCapabilities).size !== value.requiredCapabilities.length) return false;
  return true;
}

export function validateEvolutionRunnerRequirements(value: unknown): value is EvolutionRunnerRequirements {
  if (!isRecord(value) || !hasOnlyKeys(value, REQUIREMENTS_KEYS)
    || !isRecord(value.runtime) || !hasOnlyKeys(value.runtime, RUNTIME_KEYS)
    || !RUNTIMES.has(value.runtime.kind as EvolutionRuntimeKind)
    || !isBoundedString(value.runtime.version, 64, false)
    || !isContractId(value.runtime.abi)
    || !isBoundedString(value.runtime.entrypoint, 512, false)
    || value.runtime.entrypoint.startsWith("/") || value.runtime.entrypoint.includes("..")
    || !ISOLATION_CLASSES.has(value.minimumIsolation as EvolutionIsolationClass)
    || !isRecord(value.network) || !hasOnlyKeys(value.network, NETWORK_KEYS)
    || (value.network.mode !== "none" && value.network.mode !== "allowlist")
    || !isBoundedArray(value.network.allowedHosts, MAX_ALLOWED_HOSTS)
    || !value.network.allowedHosts.every(isAllowedHost)
    || new Set(value.network.allowedHosts).size !== value.network.allowedHosts.length
    || (value.network.mode === "none" && value.network.allowedHosts.length !== 0)
    || (value.network.mode === "allowlist" && value.network.allowedHosts.length === 0)
    || !isRecord(value.filesystem) || !hasOnlyKeys(value.filesystem, FILESYSTEM_KEYS)
    || (value.filesystem.mode !== "ephemeral" && value.filesystem.mode !== "workspace-snapshot")
    || !isIntegerInRange(value.filesystem.maximumWritableBytes, 1, 1_073_741_824)
    || !isRecord(value.secrets) || !hasOnlyKeys(value.secrets, SECRET_KEYS)
    || (value.secrets.mode !== "none" && value.secrets.mode !== "brokered")
    || !isBoundedArray(value.secrets.capabilities, 32)
    || !value.secrets.capabilities.every(isContractId)
    || new Set(value.secrets.capabilities).size !== value.secrets.capabilities.length
    || (value.secrets.mode === "none" && value.secrets.capabilities.length !== 0)
    || (value.secrets.mode === "brokered" && value.secrets.capabilities.length === 0)
    || !isRecord(value.resources) || !hasOnlyKeys(value.resources, RESOURCE_KEYS)) return false;
  return isIntegerInRange(value.resources.cpuMillis, 1, 86_400_000)
    && isIntegerInRange(value.resources.memoryMiB, 16, 65_536)
    && isIntegerInRange(value.resources.diskMiB, 16, 1_048_576)
    && isIntegerInRange(value.resources.wallTimeSeconds, 1, 86_400)
    && isIntegerInRange(value.resources.maximumOutputBytes, 1, 67_108_864);
}

export function validateAccountEvolutionJobRequest(value: unknown): value is AccountEvolutionJobRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, JOB_REQUEST_KEYS) || value.schemaVersion !== 1
    || !isContractId(value.clientRequestId) || !isContractTimestamp(value.requestedAt)
    || !OPERATIONS.has(value.operation as EvolutionOperation)
    || !validatePedagogyRevisionRef(value.baseRevision)
    || !isBoundedArray(value.evidence, MAX_EVIDENCE_REFS)
    || !value.evidence.every(validateLearnerEvidenceRef)
    || !validateEvolutionRunnerRequirements(value.requirements)) return false;
  const ids = value.evidence.map((evidence) => evidence.id);
  const digests = value.evidence.map((evidence) => evidence.digest);
  return new Set(ids).size === ids.length && new Set(digests).size === digests.length;
}

export function validateEvolutionExecutorAttestation(value: unknown): value is EvolutionExecutorAttestation {
  if (!isRecord(value) || !hasOnlyKeys(value, ATTESTATION_KEYS)) return false;
  return isContractId(value.adapterId)
    && isBoundedString(value.adapterVersion, 64, false)
    && ISOLATION_CLASSES.has(value.isolation as EvolutionIsolationClass)
    && (value.imageDigest === undefined || isDigest(value.imageDigest))
    && isDigest(value.runtimeDigest)
    && isContractTimestamp(value.executedAt);
}

export function validateAccountEvolutionJobResult(value: unknown): value is AccountEvolutionJobResult {
  if (!isRecord(value) || !hasOnlyKeys(value, RESULT_KEYS)
    || !isDigest(value.resultDigest)
    || !validatePedagogyRevisionRef(value.proposedRevision)
    || !isBoundedArray(value.consumedEvidence, MAX_EVIDENCE_REFS)
    || !value.consumedEvidence.every(validateLearnerEvidenceRef)
    || !validateEvolutionExecutorAttestation(value.attestation)) return false;
  const ids = value.consumedEvidence.map((evidence) => evidence.id);
  return new Set(ids).size === ids.length;
}

function validateFailure(value: unknown): value is AccountEvolutionJobFailure {
  return isRecord(value) && hasOnlyKeys(value, FAILURE_KEYS)
    && FAILURE_CODES.has(value.code as AccountEvolutionJobFailure["code"])
    && isBoundedString(value.message, 4096, false)
    && typeof value.retryable === "boolean";
}

function sameEvidenceRef(left: LearnerEvidenceRef, right: LearnerEvidenceRef): boolean {
  return left.id === right.id && left.digest === right.digest && left.kind === right.kind
    && left.capturedAt === right.capturedAt && left.exposureCount === right.exposureCount
    && left.sizeBytes === right.sizeBytes;
}

export function validateAccountEvolutionJobRecord(value: unknown): value is AccountEvolutionJobRecord {
  if (!isRecord(value) || !hasOnlyKeys(value, JOB_RECORD_KEYS) || value.schemaVersion !== 1
    || !isContractId(value.id) || !validateAccountEvolutionJobRequest(value.request)
    || !JOB_STATUSES.has(value.status as AccountEvolutionJobStatus)
    || !isIntegerInRange(value.attempt, 0, 100)
    || !isContractTimestamp(value.createdAt) || !isContractTimestamp(value.updatedAt)
    || compareContractTimestamps(value.createdAt, value.updatedAt) > 0
    || compareContractTimestamps(value.request.requestedAt, value.createdAt) > 0
    || (value.startedAt !== undefined && (!isContractTimestamp(value.startedAt)
      || compareContractTimestamps(value.createdAt, value.startedAt) > 0
      || compareContractTimestamps(value.startedAt, value.updatedAt) > 0))
    || (value.completedAt !== undefined && (!isContractTimestamp(value.completedAt)
      || compareContractTimestamps(value.createdAt, value.completedAt) > 0
      || compareContractTimestamps(value.completedAt, value.updatedAt) > 0))
    || (value.startedAt !== undefined && value.completedAt !== undefined
      && compareContractTimestamps(value.startedAt, value.completedAt) > 0)) return false;

  const request = value.request as AccountEvolutionJobRequest;

  if (value.status === "queued") {
    return value.attempt === 0 && value.startedAt === undefined && value.completedAt === undefined
      && value.result === undefined && value.failure === undefined && value.cancellationReason === undefined;
  }
  if (value.status === "running") {
    return value.attempt >= 1 && value.startedAt !== undefined && value.completedAt === undefined
      && value.result === undefined && value.failure === undefined && value.cancellationReason === undefined;
  }
  if (value.status === "cancelled") {
    return value.completedAt !== undefined
      && ((value.attempt === 0 && value.startedAt === undefined) || (value.attempt >= 1 && value.startedAt !== undefined))
      && value.result === undefined && value.failure === undefined
      && isBoundedString(value.cancellationReason, 1024, false);
  }
  if (value.status === "failed") {
    return value.attempt >= 1 && value.startedAt !== undefined && value.completedAt !== undefined
      && value.result === undefined && validateFailure(value.failure) && value.cancellationReason === undefined;
  }
  if (value.attempt < 1 || value.startedAt === undefined || value.completedAt === undefined
    || !validateAccountEvolutionJobResult(value.result) || value.failure !== undefined
    || value.cancellationReason !== undefined
    || compareContractTimestamps(value.startedAt, value.result.attestation.executedAt) > 0
    || compareContractTimestamps(value.result.attestation.executedAt, value.completedAt) > 0
    || value.result.proposedRevision.parentId !== request.baseRevision.id
    || compareContractTimestamps(value.result.proposedRevision.createdAt, value.startedAt) < 0
    || compareContractTimestamps(value.result.proposedRevision.createdAt, value.completedAt) > 0
    || value.result.consumedEvidence.some((consumed) =>
      !request.evidence.some((provided) => sameEvidenceRef(consumed, provided)))) return false;
  return true;
}

export function validateActivePedagogyPointer(value: unknown): value is ActivePedagogyPointer {
  if (!isRecord(value) || !hasOnlyKeys(value, POINTER_KEYS) || value.schemaVersion !== 1
    || !validatePedagogyRevisionRef(value.revision)
    || !isIntegerInRange(value.generation, 1, Number.MAX_SAFE_INTEGER)
    || !isContractTimestamp(value.activatedAt)
    || !isContractId(value.activationId) || !isContractId(value.sourceJobId)) return false;
  return compareContractTimestamps(value.revision.createdAt, value.activatedAt) <= 0;
}

function validateExpectedActive(value: unknown): value is ExpectedActivePedagogy {
  return isRecord(value) && hasOnlyKeys(value, EXPECTED_ACTIVE_KEYS)
    && isContractId(value.revisionId) && isDigest(value.manifestDigest)
    && isIntegerInRange(value.generation, 1, Number.MAX_SAFE_INTEGER);
}

export function validatePedagogyActivationRequest(value: unknown): value is PedagogyActivationRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ACTIVATION_REQUEST_KEYS) || value.schemaVersion !== 1
    || !isContractId(value.clientRequestId) || !isContractTimestamp(value.requestedAt)
    || !validatePedagogyRevisionRef(value.revision) || !isContractId(value.sourceJobId)
    || (value.expectedActive !== null && !validateExpectedActive(value.expectedActive))) return false;
  return compareContractTimestamps(value.revision.createdAt, value.requestedAt) <= 0;
}

/** Applies an account-relative activation only when the expected pointer still matches. */
export function applyPedagogyActivation(
  current: ActivePedagogyPointer | null,
  request: PedagogyActivationRequest,
  activatedAt: string,
): ActivePedagogyPointer {
  if ((current !== null && !validateActivePedagogyPointer(current))
    || !validatePedagogyActivationRequest(request) || !isContractTimestamp(activatedAt)
    || compareContractTimestamps(request.requestedAt, activatedAt) > 0) {
    throw new MergeConflictError("Cannot activate malformed account pedagogy state.");
  }
  if (current === null) {
    if (request.expectedActive !== null) {
      throw new MergeConflictError("Active pedagogy compare-and-swap failed: no revision is active.");
    }
  } else {
    const expected = request.expectedActive;
    if (expected === null || expected.revisionId !== current.revision.id
      || expected.manifestDigest !== current.revision.manifestDigest
      || expected.generation !== current.generation) {
      throw new MergeConflictError("Active pedagogy compare-and-swap failed: the expected revision is stale.");
    }
  }
  return {
    schemaVersion: 1,
    revision: structuredClone(request.revision),
    generation: (current?.generation ?? 0) + 1,
    activatedAt,
    activationId: request.clientRequestId,
    sourceJobId: request.sourceJobId,
  };
}

/** Stable ordering for account-relative job listings. */
export function compareAccountEvolutionJobs(left: AccountEvolutionJobRecord, right: AccountEvolutionJobRecord): number {
  return compareContractTimestamps(left.createdAt, right.createdAt) || codePointCompare(left.id, right.id);
}
