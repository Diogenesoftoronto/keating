import {
  validateAccountEvolutionJobRequest,
  validateAccountEvolutionJobRecord,
  validateLearnerEvidenceRef,
  validatePedagogyRevisionManifest,
  validatePedagogyRevisionRef,
  type AccountEvolutionJobRequest,
  type AccountEvolutionJobRecord,
  type EvolutionOperation,
  type LearnerEvidenceRef,
  type PedagogyArtifactRef,
  type PedagogyArtifactKind,
  type PedagogyRevisionManifest,
  type PedagogyRevisionRef,
} from "@keating/learner-contracts";
import type * as ExpoCrypto from "expo-crypto";
import { activeDeviceSession, notOrganicAccountRequest } from "./client";
import { defaultNotOrganicAccountConfig, type NotOrganicAccountConfig } from "./contracts";
import { createDpopProof } from "./dpop";

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u;
const CAPABILITY = /^[A-Za-z][A-Za-z0-9]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)+$/u;
const SIGNATURE = /^[A-Za-z0-9_-]+$/u;
const MAX_ARTIFACT_BYTES = 67_108_864;

export type EvolutionArtifactKind =
  | "prompt"
  | "self_evolution_source"
  | "map_elites_configuration"
  | "map_elites_archive"
  | "policy"
  | "skill"
  | "runtime_bundle"
  | "evaluation_report"
  | "pedagogy_revision_manifest";

export interface EvolutionArtifactRef {
  digest: string;
  kind: EvolutionArtifactKind;
  media_type: string;
  size_bytes: number;
  schema_version: number;
}

export interface EvolutionMetric {
  objective: string;
  score: number;
  sample_count: number;
}

export interface LegacyEvolutionEvidenceCreate {
  project_id: string;
  candidate: EvolutionArtifactRef;
  evaluator: "learner_feedback" | "benchmark" | "holdout" | "human_review";
  evaluator_version: string;
  metrics: EvolutionMetric[];
  observed_at: number;
  trace?: EvolutionArtifactRef;
}

export interface EvolutionEvidence extends EvolutionEvidenceCreate {
  id: string;
  product: string;
  created_at: number;
}

export type EvolutionJobKind =
  | "evaluate"
  | "evolve_prompt"
  | "evolve_policy"
  | "evolve_source"
  | "build_runtime"
  | "validate_runtime";

export interface EvolutionJobBudget {
  cpu_millis?: number;
  wall_time_ms: number;
  memory_bytes: number;
  disk_bytes?: number;
  output_bytes: number;
}

export interface EvolutionJobCreate {
  idempotency_key: string;
  project_id: string;
  kind: EvolutionJobKind;
  inputs: EvolutionArtifactRef[];
  required_capabilities: string[];
  budget: EvolutionJobBudget;
}

export type EvolutionJobStatus = "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled";

export interface EvolutionResultAttestation {
  version: 1;
  job_id: string;
  result_digest: string;
  runner_key_id: string;
  issued_at: number;
  signature: string;
}

export interface EvolutionJob extends EvolutionJobCreate {
  id: string;
  product: string;
  status: EvolutionJobStatus;
  created_at: number;
  updated_at: number;
  attempts: number;
  outputs?: EvolutionArtifactRef[];
  attestation?: EvolutionResultAttestation;
  error_code?: string;
  source_request?: AccountEvolutionJobRequest;
}

export type EvolutionActiveSlot =
  | "prompt"
  | "self_evolution_source"
  | "map_elites_configuration"
  | "map_elites_archive"
  | "policy"
  | "skill"
  | "runtime_bundle";

export interface EvolutionActivePointer {
  project_id: string;
  slot: EvolutionActiveSlot;
  revision: number;
  artifact: EvolutionArtifactRef;
  updated_at: number;
}

export interface EvolutionActivePointerCompareAndSwap {
  project_id: string;
  slot: EvolutionActiveSlot;
  expected_revision: number;
  artifact: EvolutionArtifactRef;
}

export interface EvolutionActiveRevision {
  project_id: string;
  revision: number;
  manifest: EvolutionArtifactRef & { kind: "pedagogy_revision_manifest" };
  updated_at: number;
}

export interface EvolutionActiveRevisionCompareAndSwap {
  project_id: string;
  expected_revision: number;
  manifest: EvolutionArtifactRef & { kind: "pedagogy_revision_manifest" };
}

export interface KeatingEvolutionEvidenceCreate {
  projectId: string;
  candidate: EvolutionArtifactRef;
  evidence: LearnerEvidenceRef;
  trace?: EvolutionArtifactRef;
}

export interface EvolutionEvidenceCreate {
  project_id: string;
  candidate: EvolutionArtifactRef;
  payload:
    | { contract: "keating-learner-evidence-ref-v1"; evidence: LearnerEvidenceRef }
    | ({ contract: "notorganic-objective-metrics-v1" } & Omit<LegacyEvolutionEvidenceCreate, "project_id" | "candidate" | "trace">);
  trace?: EvolutionArtifactRef;
}

export interface AccountAuthenticatedArtifactRequest {
  (path: string, init?: RequestInit): Promise<Response>;
}

export type EvolutionSyncState = "empty" | "up-to-date" | "evolving" | "attention";

export interface EvolutionSyncStatus {
  projectId: string;
  state: EvolutionSyncState;
  jobs: readonly EvolutionJob[];
  activeRevision: EvolutionActiveRevision | null;
  queuedJobs: number;
  runningJobs: number;
  failedJobs: number;
  latestUpdatedAt: number | null;
}

export interface MobilePedagogyCompatibilitySupport {
  agentApi: string;
  learnerContract: number;
  mobileSdk: string;
  capabilities: readonly string[];
}

export interface ActiveMobilePedagogyRevision {
  pointer: EvolutionActiveRevision;
  revision: PedagogyRevisionRef;
}

export class EvolutionProtocolError extends Error {
  readonly code = "evolution_protocol_error";
  constructor(message: string) {
    super(message);
    this.name = "EvolutionProtocolError";
  }
}

export class EvolutionContractMismatchError extends Error {
  readonly code = "evolution_contract_mismatch";
  readonly mismatches: readonly string[];
  constructor(mismatches: readonly string[]) {
    super(`Not Organic evolution transport cannot losslessly represent the canonical request:\n- ${mismatches.join("\n- ")}`);
    this.name = "EvolutionContractMismatchError";
    this.mismatches = Object.freeze([...mismatches]);
  }
}

export const CANONICAL_OPERATION_TO_PROVIDER = Object.freeze({
  evaluate: "evaluate",
  "prompt-evolution": "evolve_prompt",
  "policy-evolution": "evolve_policy",
  "optimizer-evolution": "evolve_policy",
  "source-evolution": "evolve_source",
} satisfies Partial<Record<EvolutionOperation, EvolutionJobKind>>);

export const CANONICAL_ARTIFACT_KIND_TO_PROVIDER = Object.freeze({
  "prompt-set": "prompt",
  "teacher-policy": "policy",
  "fitness-definition": "map_elites_configuration",
  "optimizer-strategy": "self_evolution_source",
  "source-bundle": "runtime_bundle",
  "evaluation-report": "evaluation_report",
  "map-elites-archive": "map_elites_archive",
} satisfies Partial<Record<PedagogyArtifactKind, EvolutionArtifactKind>>);

type ArtifactFetch = typeof fetch;
type DigestBytes = (bytes: Uint8Array) => Promise<string>;
let artifactFetch: ArtifactFetch = globalThis.fetch.bind(globalThis);
const nativeDigestBytes: DigestBytes = async (bytes) => {
  const crypto = require("expo-crypto") as typeof ExpoCrypto;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.digest(crypto.CryptoDigestAlgorithm.SHA256, copy.buffer));
  return `sha256:${[...digest].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};
let digestBytes: DigestBytes = nativeDigestBytes;

export function setEvolutionArtifactFetchForTests(next: ArtifactFetch | null): void {
  artifactFetch = next ?? globalThis.fetch.bind(globalThis);
}

export function setEvolutionDigestForTests(next: DigestBytes | null): void {
  digestBytes = next ?? nativeDigestBytes;
}

export async function verifyEvolutionArtifactBytes(artifact: EvolutionArtifactRef, bytes: Uint8Array): Promise<void> {
  assertArtifact(artifact, "artifact");
  if (!(bytes instanceof Uint8Array)) throw new EvolutionProtocolError("Artifact bytes must be a Uint8Array.");
  if (bytes.byteLength !== artifact.size_bytes) {
    throw new EvolutionProtocolError(
      `Artifact size mismatch for ${artifact.digest}: expected ${artifact.size_bytes} bytes, received ${bytes.byteLength}.`,
    );
  }
  const actual = await digestBytes(bytes);
  if (actual !== artifact.digest) {
    throw new EvolutionProtocolError(`Artifact digest mismatch: expected ${artifact.digest}, received ${actual}.`);
  }
}

export async function registerEvolutionArtifact(
  input: Readonly<{ artifact: EvolutionArtifactRef; bytes: Uint8Array }>,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionArtifactRef> {
  assertArtifact(input.artifact, "artifact");
  await verifyEvolutionArtifactBytes(input.artifact, input.bytes);
  const registered = await notOrganicAccountRequest<unknown>(
    "/v1/evolution/artifacts",
    jsonRequest("POST", { artifact: input.artifact }),
    config,
  );
  const parsed = parseArtifact(registered, "artifact registration response");
  if (!sameArtifact(parsed, input.artifact)) {
    throw new EvolutionProtocolError("Not Organic returned artifact metadata different from the uploaded bytes.");
  }
  await createAccountArtifactRequest(config)(artifactContentPath(parsed.digest), {
    method: "PUT",
    headers: { "content-type": parsed.media_type },
    body: input.bytes.slice(),
  });
  return parsed;
}

export async function fetchEvolutionArtifactBytes(
  artifact: EvolutionArtifactRef,
  config = defaultNotOrganicAccountConfig(),
): Promise<Uint8Array> {
  assertArtifact(artifact, "artifact");
  const response = await createAccountArtifactRequest(config)(artifactContentPath(artifact.digest));
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verifyEvolutionArtifactBytes(artifact, bytes);
  return bytes.slice();
}

/** Fetch canonical revision content without leaking provider metadata into callers. */
export async function fetchPedagogyArtifactBytes(
  artifact: PedagogyArtifactRef,
  config = defaultNotOrganicAccountConfig(),
): Promise<Uint8Array> {
  const providerKind = CANONICAL_ARTIFACT_KIND_TO_PROVIDER[artifact.kind as keyof typeof CANONICAL_ARTIFACT_KIND_TO_PROVIDER];
  if (!providerKind) {
    throw new EvolutionProtocolError(`Mobile cannot materialize pedagogy artifact kind ${artifact.kind}.`);
  }
  return fetchEvolutionArtifactBytes({
    digest: artifact.digest,
    kind: providerKind,
    media_type: artifact.mediaType,
    size_bytes: artifact.sizeBytes,
    schema_version: 1,
  }, config);
}

export async function submitEvolutionEvidence(
  input: KeatingEvolutionEvidenceCreate,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionEvidence> {
  if (!validateLearnerEvidenceRef(input.evidence)) throw new EvolutionProtocolError("evidence is not a valid LearnerEvidenceRef.");
  const evidence: EvolutionEvidenceCreate = {
    project_id: input.projectId,
    candidate: input.candidate,
    payload: { contract: "keating-learner-evidence-ref-v1", evidence: input.evidence },
    ...(input.trace ? { trace: input.trace } : {}),
  };
  assertEvidenceCreate(evidence, "evidence");
  const response = await notOrganicAccountRequest<unknown>(
    "/v1/evolution/evidence",
    jsonRequest("POST", evidence),
    config,
  );
  return parseEvidence(response, "evidence response");
}

export async function submitLegacyObjectiveEvolutionEvidence(
  input: LegacyEvolutionEvidenceCreate,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionEvidence> {
  const evidence: EvolutionEvidenceCreate = {
    project_id: input.project_id,
    candidate: input.candidate,
    payload: {
      contract: "notorganic-objective-metrics-v1",
      evaluator: input.evaluator,
      evaluator_version: input.evaluator_version,
      metrics: input.metrics,
      observed_at: input.observed_at,
    },
    ...(input.trace ? { trace: input.trace } : {}),
  };
  assertEvidenceCreate(evidence, "legacy evidence");
  return parseEvidence(
    await notOrganicAccountRequest<unknown>(
      "/v1/evolution/evidence",
      jsonRequest("POST", evidence),
      config,
    ),
    "legacy evidence response",
  );
}

export async function createEvolutionJob(
  request: AccountEvolutionJobRequest,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionJob> {
  if (!validateAccountEvolutionJobRequest(request)) {
    throw new EvolutionContractMismatchError(["request is not a valid AccountEvolutionJobRequest"]);
  }
  const response = await notOrganicAccountRequest<unknown>(
    "/v1/evolution/jobs",
    jsonRequest("POST", mapCanonicalEvolutionJobRequest(request)),
    config,
  );
  const job = parseJob(response, "job response");
  if (!job.source_request || stableJson(job.source_request) !== stableJson(request)) {
    throw new EvolutionProtocolError("Not Organic did not preserve the exact canonical job request as source_request.");
  }
  return job;
}

export async function createLegacySchedulerEvolutionJob(
  request: EvolutionJobCreate,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionJob> {
  assertJobCreate(request, "job");
  const response = await notOrganicAccountRequest<unknown>(
    "/v1/evolution/jobs",
    jsonRequest("POST", { contract: "notorganic-scheduler-job-v1", request }),
    config,
  );
  return parseJob(response, "job response");
}

export async function listEvolutionJobs(
  limit = 50,
  config = defaultNotOrganicAccountConfig(),
): Promise<readonly EvolutionJob[]> {
  assertInteger(limit, 1, 100, "limit");
  const response = await notOrganicAccountRequest<unknown>(`/v1/evolution/jobs?limit=${limit}`, {}, config);
  if (!Array.isArray(response)) throw new EvolutionProtocolError("Evolution jobs response must be an array.");
  return Object.freeze(response.map((job, index) => parseJob(job, `jobs[${index}]`)));
}

export async function getEvolutionJob(
  jobId: string,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionJob> {
  assertIdentifier(jobId, "jobId");
  return parseJob(
    await notOrganicAccountRequest<unknown>(`/v1/evolution/jobs/${encodeURIComponent(jobId)}`, {}, config),
    "job response",
  );
}

export async function cancelEvolutionJob(
  jobId: string,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionJob> {
  assertIdentifier(jobId, "jobId");
  return parseJob(
    await notOrganicAccountRequest<unknown>(
      `/v1/evolution/jobs/${encodeURIComponent(jobId)}/cancel`,
      jsonRequest("POST", {}),
      config,
    ),
    "job cancellation response",
  );
}

export async function readLegacyActiveEvolutionPointer(
  projectId: string,
  slot: EvolutionActiveSlot,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionActivePointer | null> {
  assertProjectId(projectId, "projectId");
  assertActiveSlot(slot, "slot");
  const query = `project_id=${encodeURIComponent(projectId)}&slot=${encodeURIComponent(slot)}`;
  const response = await notOrganicAccountRequest<unknown>(`/v1/evolution/active?${query}`, {}, config);
  return response === null ? null : parseActivePointer(response, "active pointer response");
}

export async function compareAndSwapLegacyActiveEvolutionPointer(
  update: EvolutionActivePointerCompareAndSwap,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionActivePointer> {
  assertActiveUpdate(update, "active pointer update");
  return parseActivePointer(
    await notOrganicAccountRequest<unknown>("/v1/evolution/active", jsonRequest("PUT", update), config),
    "active pointer response",
  );
}

export async function readActiveEvolutionRevision(
  projectId: string,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionActiveRevision | null> {
  assertProjectId(projectId, "projectId");
  const response = await notOrganicAccountRequest<unknown>(
    `/v1/evolution/active-revision?project_id=${encodeURIComponent(projectId)}`,
    {},
    config,
  );
  return response === null ? null : parseActiveRevision(response, "active revision response");
}

export async function compareAndSwapActiveEvolutionRevision(
  update: EvolutionActiveRevisionCompareAndSwap,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionActiveRevision> {
  assertActiveRevisionUpdate(update, "active revision update");
  return parseActiveRevision(
    await notOrganicAccountRequest<unknown>("/v1/evolution/active-revision", jsonRequest("PUT", update), config),
    "active revision response",
  );
}

export async function loadActiveMobilePedagogyRevision(
  input: Readonly<{ projectId: string; support: MobilePedagogyCompatibilitySupport }>,
  config = defaultNotOrganicAccountConfig(),
): Promise<ActiveMobilePedagogyRevision | null> {
  const pointer = await readActiveEvolutionRevision(input.projectId, config);
  if (!pointer) return null;
  const bytes = await fetchEvolutionArtifactBytes(pointer.manifest, config);
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new EvolutionProtocolError("The active pedagogy revision manifest is not valid JSON.");
  }
  if (!validatePedagogyRevisionManifest(decoded)) {
    throw new EvolutionProtocolError("The active pedagogy revision manifest is not a valid PedagogyRevisionManifest.");
  }
  const revision: PedagogyRevisionRef = {
    ...(structuredClone(decoded) as PedagogyRevisionManifest),
    manifestDigest: pointer.manifest.digest,
  };
  if (!validatePedagogyRevisionRef(revision)) {
    throw new EvolutionProtocolError("The verified manifest could not form a valid PedagogyRevisionRef.");
  }
  assertMobileCompatibility(revision, input.support);
  return Object.freeze({ pointer, revision });
}

export async function loadEvolutionSyncStatus(
  input: Readonly<{ projectId: string; limit?: number }>,
  config = defaultNotOrganicAccountConfig(),
): Promise<EvolutionSyncStatus> {
  assertProjectId(input.projectId, "projectId");
  const [jobs, activeRevision] = await Promise.all([
    listEvolutionJobs(input.limit ?? 50, config),
    readActiveEvolutionRevision(input.projectId, config),
  ]);
  const projectJobs = jobs.filter((job) => job.project_id === input.projectId);
  const queuedJobs = projectJobs.filter((job) => job.status === "queued").length;
  const runningJobs = projectJobs.filter((job) => job.status === "leased" || job.status === "running").length;
  const failedJobs = projectJobs.filter((job) => job.status === "failed").length;
  const timestamps = [...projectJobs.map((job) => job.updated_at), ...(activeRevision ? [activeRevision.updated_at] : [])];
  const state: EvolutionSyncState = failedJobs > 0
    ? "attention"
    : queuedJobs + runningJobs > 0
      ? "evolving"
      : projectJobs.length === 0 && !activeRevision
        ? "empty"
        : "up-to-date";
  return Object.freeze({
    projectId: input.projectId,
    state,
    jobs: Object.freeze(projectJobs),
    activeRevision,
    queuedJobs,
    runningJobs,
    failedJobs,
    latestUpdatedAt: timestamps.length ? Math.max(...timestamps) : null,
  });
}

/** Returns a mismatch only for malformed canonical requests; valid fields are preserved verbatim. */
export function canonicalEvolutionJobTransportMismatches(request: AccountEvolutionJobRequest): readonly string[] {
  if (!validateAccountEvolutionJobRequest(request)) return Object.freeze(["request is not a valid AccountEvolutionJobRequest"]);
  return Object.freeze([]);
}

export function mapCanonicalEvolutionJobRequest(request: AccountEvolutionJobRequest): Readonly<{
  contract: "keating-account-evolution-job-v1";
  request: AccountEvolutionJobRequest;
}> {
  const mismatches = canonicalEvolutionJobTransportMismatches(request);
  if (mismatches.length) throw new EvolutionContractMismatchError(mismatches);
  return Object.freeze({ contract: "keating-account-evolution-job-v1", request: structuredClone(request) });
}

/**
 * The request is lossless, but the provider scheduler record is not an
 * AccountEvolutionJobRecord. Keep it provider-native until these fields exist.
 */
export function canonicalEvolutionJobRecordTransportMismatches(job: EvolutionJob): readonly string[] {
  const mismatches: string[] = [];
  if (!CANONICAL_ID.test(job.id)) mismatches.push("provider job id is not a canonical contract ID");
  if (!job.source_request) mismatches.push("source_request is absent, so the canonical request cannot be recovered");
  if (job.status === "leased") mismatches.push("provider status leased has no canonical job status");
  if (job.status !== "queued") {
    mismatches.push("provider jobs do not expose canonical startedAt, completedAt, or cancellationReason fields");
  }
  if (job.error_code) {
    mismatches.push("provider error_code does not include canonical failure message and retryable fields");
  }
  if (job.outputs || job.attestation) {
    mismatches.push(
      "provider outputs and runner signature do not contain canonical proposedRevision, consumedEvidence, or executor attestation fields",
    );
  }
  return Object.freeze(mismatches);
}

export function mapEvolutionJobToCanonicalRecord(job: EvolutionJob): AccountEvolutionJobRecord {
  const mismatches = canonicalEvolutionJobRecordTransportMismatches(job);
  if (mismatches.length) throw new EvolutionContractMismatchError(mismatches);
  const record: AccountEvolutionJobRecord = {
    schemaVersion: 1,
    id: job.id,
    request: structuredClone(job.source_request!),
    status: "queued",
    attempt: job.attempts,
    createdAt: new Date(job.created_at).toISOString(),
    updatedAt: new Date(job.updated_at).toISOString(),
  };
  if (!validateAccountEvolutionJobRecord(record)) {
    throw new EvolutionContractMismatchError([
      "provider queued job timestamps or attempt do not satisfy AccountEvolutionJobRecord invariants",
    ]);
  }
  return record;
}

function artifactContentPath(digest: string): string {
  return `/v1/evolution/artifacts/${encodeURIComponent(digest)}/content`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function assertMobileCompatibility(
  revision: PedagogyRevisionRef,
  support: MobilePedagogyCompatibilitySupport,
): void {
  const compatibility = revision.compatibility;
  if (!compatibility.targets.includes("mobile-declarative")) {
    throw new EvolutionProtocolError("The active pedagogy revision does not target mobile-declarative.");
  }
  if (compatibility.agentApi !== support.agentApi) {
    throw new EvolutionProtocolError(`Unsupported agent API ${compatibility.agentApi}; mobile supports ${support.agentApi}.`);
  }
  if (compatibility.learnerContract !== support.learnerContract) {
    throw new EvolutionProtocolError(
      `Unsupported learner contract ${compatibility.learnerContract}; mobile supports ${support.learnerContract}.`,
    );
  }
  if (compatibility.mobileSdk !== undefined && compatibility.mobileSdk !== support.mobileSdk) {
    throw new EvolutionProtocolError(`Unsupported mobile SDK ${compatibility.mobileSdk}; mobile provides ${support.mobileSdk}.`);
  }
  const available = new Set(support.capabilities);
  const missing = compatibility.requiredCapabilities.filter((capability) => !available.has(capability));
  if (missing.length) {
    throw new EvolutionProtocolError(`Mobile is missing required pedagogy capabilities: ${missing.join(", ")}.`);
  }
}

function createAccountArtifactRequest(config: NotOrganicAccountConfig): AccountAuthenticatedArtifactRequest {
  return async (path, init = {}) => {
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new EvolutionProtocolError("Artifact-plane requests must use a same-issuer absolute path.");
    }
    const session = await activeDeviceSession(config);
    const url = `${config.issuer}${path}`;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("authorization", `DPoP ${session.accessToken}`);
    headers.set("dpop", await createDpopProof({ url, method, boundToken: session.accessToken }));
    const response = await artifactFetch(url, { ...init, method, headers });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new EvolutionProtocolError(body?.error?.message ?? `Artifact plane request failed (${response.status}).`);
    }
    return response;
  };
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required = allowed): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => key in value);
}

function assertInteger(value: unknown, minimum: number, maximum: number, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new EvolutionProtocolError(`${path} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function assertIdentifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new EvolutionProtocolError(`${path} is invalid.`);
}

function assertProjectId(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) throw new EvolutionProtocolError(`${path} is invalid.`);
}

function assertArtifact(value: unknown, path: string): asserts value is EvolutionArtifactRef {
  if (!isRecord(value) || !exactKeys(value, ["digest", "kind", "media_type", "size_bytes", "schema_version"])) {
    throw new EvolutionProtocolError(`${path} must be an exact evolution artifact reference.`);
  }
  if (typeof value.digest !== "string" || !DIGEST.test(value.digest)) throw new EvolutionProtocolError(`${path}.digest is invalid.`);
  if (!ARTIFACT_KINDS.has(value.kind as EvolutionArtifactKind)) throw new EvolutionProtocolError(`${path}.kind is invalid.`);
  if (typeof value.media_type !== "string" || value.media_type.length > 193 || !MEDIA_TYPE.test(value.media_type)) {
    throw new EvolutionProtocolError(`${path}.media_type is invalid.`);
  }
  assertInteger(value.size_bytes, 1, MAX_ARTIFACT_BYTES, `${path}.size_bytes`);
  assertInteger(value.schema_version, 1, 1_000, `${path}.schema_version`);
}

function parseArtifact(value: unknown, path: string): EvolutionArtifactRef {
  assertArtifact(value, path);
  return cloneArtifact(value);
}

function cloneArtifact(value: EvolutionArtifactRef): EvolutionArtifactRef {
  return { ...value };
}

function sameArtifact(left: EvolutionArtifactRef, right: EvolutionArtifactRef): boolean {
  return left.digest === right.digest && left.kind === right.kind && left.media_type === right.media_type
    && left.size_bytes === right.size_bytes && left.schema_version === right.schema_version;
}

function assertMetric(value: unknown, path: string): asserts value is EvolutionMetric {
  if (!isRecord(value) || !exactKeys(value, ["objective", "score", "sample_count"])) {
    throw new EvolutionProtocolError(`${path} must be an exact evolution metric.`);
  }
  assertIdentifier(value.objective, `${path}.objective`);
  if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) {
    throw new EvolutionProtocolError(`${path}.score must be from 0 to 1.`);
  }
  assertInteger(value.sample_count, 1, 1_000_000, `${path}.sample_count`);
}

function assertEvidenceCreate(value: unknown, path: string): asserts value is EvolutionEvidenceCreate {
  if (!isRecord(value) || !exactKeys(
    value,
    ["project_id", "candidate", "payload", "trace"],
    ["project_id", "candidate", "payload"],
  )) throw new EvolutionProtocolError(`${path} must be an exact evolution evidence request.`);
  assertProjectId(value.project_id, `${path}.project_id`);
  assertArtifact(value.candidate, `${path}.candidate`);
  if (!isRecord(value.payload) || typeof value.payload.contract !== "string") {
    throw new EvolutionProtocolError(`${path}.payload is invalid.`);
  }
  if (value.payload.contract === "keating-learner-evidence-ref-v1") {
    if (!exactKeys(value.payload, ["contract", "evidence"]) || !validateLearnerEvidenceRef(value.payload.evidence)) {
      throw new EvolutionProtocolError(`${path}.payload.evidence is not a valid LearnerEvidenceRef.`);
    }
  } else if (value.payload.contract === "notorganic-objective-metrics-v1") {
    if (!exactKeys(value.payload, ["contract", "evaluator", "evaluator_version", "metrics", "observed_at"])) {
      throw new EvolutionProtocolError(`${path}.payload must be an exact legacy objective-metrics payload.`);
    }
    if (!EVALUATORS.has(value.payload.evaluator as LegacyEvolutionEvidenceCreate["evaluator"])) {
      throw new EvolutionProtocolError(`${path}.payload.evaluator is invalid.`);
    }
    assertIdentifier(value.payload.evaluator_version, `${path}.payload.evaluator_version`);
    if (!Array.isArray(value.payload.metrics) || value.payload.metrics.length < 1 || value.payload.metrics.length > 64) {
      throw new EvolutionProtocolError(`${path}.payload.metrics must contain 1 to 64 entries.`);
    }
    value.payload.metrics.forEach((metric, index) => assertMetric(metric, `${path}.payload.metrics[${index}]`));
    const objectives = value.payload.metrics.map((metric) => metric.objective);
    if (new Set(objectives).size !== objectives.length) {
      throw new EvolutionProtocolError(`${path}.payload.metrics objectives must be unique.`);
    }
    assertInteger(value.payload.observed_at, 0, Number.MAX_SAFE_INTEGER, `${path}.payload.observed_at`);
  } else {
    throw new EvolutionProtocolError(`${path}.payload.contract is unsupported.`);
  }
  if (value.trace !== undefined) assertArtifact(value.trace, `${path}.trace`);
}

function parseEvidence(value: unknown, path: string): EvolutionEvidence {
  if (!isRecord(value) || !exactKeys(
    value,
    ["project_id", "candidate", "payload", "trace", "id", "product", "created_at"],
    ["project_id", "candidate", "payload", "id", "product", "created_at"],
  )) throw new EvolutionProtocolError(`${path} must be an exact evolution evidence record.`);
  const create = { ...value };
  delete create.id;
  delete create.product;
  delete create.created_at;
  assertEvidenceCreate(create, path);
  assertIdentifier(value.id, `${path}.id`);
  assertIdentifier(value.product, `${path}.product`);
  assertInteger(value.created_at, 0, Number.MAX_SAFE_INTEGER, `${path}.created_at`);
  return value as unknown as EvolutionEvidence;
}

function assertJobCreate(value: unknown, path: string): asserts value is EvolutionJobCreate {
  if (!isRecord(value) || !exactKeys(value, ["idempotency_key", "project_id", "kind", "inputs", "required_capabilities", "budget"])) {
    throw new EvolutionProtocolError(`${path} must be an exact evolution job request.`);
  }
  if (typeof value.idempotency_key !== "string" || !/^[A-Za-z0-9._:-]+$/u.test(value.idempotency_key)
    || value.idempotency_key.length > 128) throw new EvolutionProtocolError(`${path}.idempotency_key is invalid.`);
  assertProjectId(value.project_id, `${path}.project_id`);
  if (!JOB_KINDS.has(value.kind as EvolutionJobKind)) throw new EvolutionProtocolError(`${path}.kind is invalid.`);
  if (!Array.isArray(value.inputs) || value.inputs.length < 1 || value.inputs.length > 32) {
    throw new EvolutionProtocolError(`${path}.inputs must contain 1 to 32 artifacts.`);
  }
  value.inputs.forEach((artifact, index) => assertArtifact(artifact, `${path}.inputs[${index}]`));
  const digests = value.inputs.map((artifact) => artifact.digest);
  if (new Set(digests).size !== digests.length) throw new EvolutionProtocolError(`${path}.inputs digests must be unique.`);
  if (!Array.isArray(value.required_capabilities) || value.required_capabilities.length > 32
    || !value.required_capabilities.every((capability) => typeof capability === "string" && capability.length <= 128 && CAPABILITY.test(capability))
    || new Set(value.required_capabilities).size !== value.required_capabilities.length) {
    throw new EvolutionProtocolError(`${path}.required_capabilities is invalid.`);
  }
  if (!isRecord(value.budget) || !exactKeys(
    value.budget,
    ["cpu_millis", "wall_time_ms", "memory_bytes", "disk_bytes", "output_bytes"],
    ["wall_time_ms", "memory_bytes", "output_bytes"],
  )) {
    throw new EvolutionProtocolError(`${path}.budget must be exact.`);
  }
  if (value.budget.cpu_millis !== undefined) assertInteger(value.budget.cpu_millis, 1, 86_400_000, `${path}.budget.cpu_millis`);
  assertInteger(value.budget.wall_time_ms, 1, 86_400_000, `${path}.budget.wall_time_ms`);
  assertInteger(value.budget.memory_bytes, 1, 68_719_476_736, `${path}.budget.memory_bytes`);
  if (value.budget.disk_bytes !== undefined) assertInteger(value.budget.disk_bytes, 1, 1_099_511_627_776, `${path}.budget.disk_bytes`);
  assertInteger(value.budget.output_bytes, 1, MAX_ARTIFACT_BYTES, `${path}.budget.output_bytes`);
}

function parseJob(value: unknown, path: string): EvolutionJob {
  if (!isRecord(value) || !exactKeys(
    value,
    ["idempotency_key", "project_id", "kind", "inputs", "required_capabilities", "budget", "id", "product", "status", "created_at", "updated_at", "attempts", "outputs", "attestation", "error_code", "source_request"],
    ["idempotency_key", "project_id", "kind", "inputs", "required_capabilities", "budget", "id", "product", "status", "created_at", "updated_at", "attempts"],
  )) throw new EvolutionProtocolError(`${path} must be an exact evolution job record.`);
  const create = { ...value };
  for (const key of ["id", "product", "status", "created_at", "updated_at", "attempts", "outputs", "attestation", "error_code", "source_request"]) delete create[key];
  assertJobCreate(create, path);
  assertIdentifier(value.id, `${path}.id`);
  assertIdentifier(value.product, `${path}.product`);
  if (!JOB_STATUSES.has(value.status as EvolutionJobStatus)) throw new EvolutionProtocolError(`${path}.status is invalid.`);
  assertInteger(value.created_at, 0, Number.MAX_SAFE_INTEGER, `${path}.created_at`);
  assertInteger(value.updated_at, value.created_at, Number.MAX_SAFE_INTEGER, `${path}.updated_at`);
  assertInteger(value.attempts, 0, 100, `${path}.attempts`);
  if (value.outputs !== undefined) {
    if (!Array.isArray(value.outputs) || value.outputs.length > 32) throw new EvolutionProtocolError(`${path}.outputs is invalid.`);
    value.outputs.forEach((artifact, index) => assertArtifact(artifact, `${path}.outputs[${index}]`));
  }
  if (value.attestation !== undefined) assertAttestation(value.attestation, `${path}.attestation`);
  if (value.error_code !== undefined) assertIdentifier(value.error_code, `${path}.error_code`);
  if (value.source_request !== undefined && !validateAccountEvolutionJobRequest(value.source_request)) {
    throw new EvolutionProtocolError(`${path}.source_request is not a valid AccountEvolutionJobRequest.`);
  }
  return value as unknown as EvolutionJob;
}

function assertAttestation(value: unknown, path: string): asserts value is EvolutionResultAttestation {
  if (!isRecord(value) || !exactKeys(value, ["version", "job_id", "result_digest", "runner_key_id", "issued_at", "signature"])) {
    throw new EvolutionProtocolError(`${path} must be an exact evolution attestation.`);
  }
  if (value.version !== 1) throw new EvolutionProtocolError(`${path}.version must be 1.`);
  assertIdentifier(value.job_id, `${path}.job_id`);
  if (typeof value.result_digest !== "string" || !DIGEST.test(value.result_digest)) throw new EvolutionProtocolError(`${path}.result_digest is invalid.`);
  assertIdentifier(value.runner_key_id, `${path}.runner_key_id`);
  assertInteger(value.issued_at, 0, Number.MAX_SAFE_INTEGER, `${path}.issued_at`);
  if (typeof value.signature !== "string" || value.signature.length > 8_192 || !SIGNATURE.test(value.signature)) {
    throw new EvolutionProtocolError(`${path}.signature is invalid.`);
  }
}

function assertActiveSlot(value: unknown, path: string): asserts value is EvolutionActiveSlot {
  if (!ACTIVE_SLOT_SET.has(value as EvolutionActiveSlot)) throw new EvolutionProtocolError(`${path} is invalid.`);
}

function assertActiveUpdate(value: unknown, path: string): asserts value is EvolutionActivePointerCompareAndSwap {
  if (!isRecord(value) || !exactKeys(value, ["project_id", "slot", "expected_revision", "artifact"])) {
    throw new EvolutionProtocolError(`${path} must be an exact compare-and-swap request.`);
  }
  assertProjectId(value.project_id, `${path}.project_id`);
  assertActiveSlot(value.slot, `${path}.slot`);
  assertInteger(value.expected_revision, 0, Number.MAX_SAFE_INTEGER, `${path}.expected_revision`);
  assertArtifact(value.artifact, `${path}.artifact`);
}

function parseActivePointer(value: unknown, path: string): EvolutionActivePointer {
  if (!isRecord(value) || !exactKeys(value, ["project_id", "slot", "revision", "artifact", "updated_at"])) {
    throw new EvolutionProtocolError(`${path} must be an exact active pointer.`);
  }
  assertProjectId(value.project_id, `${path}.project_id`);
  assertActiveSlot(value.slot, `${path}.slot`);
  assertInteger(value.revision, 0, Number.MAX_SAFE_INTEGER, `${path}.revision`);
  assertArtifact(value.artifact, `${path}.artifact`);
  assertInteger(value.updated_at, 0, Number.MAX_SAFE_INTEGER, `${path}.updated_at`);
  return value as unknown as EvolutionActivePointer;
}

function assertActiveRevisionUpdate(value: unknown, path: string): asserts value is EvolutionActiveRevisionCompareAndSwap {
  if (!isRecord(value) || !exactKeys(value, ["project_id", "expected_revision", "manifest"])) {
    throw new EvolutionProtocolError(`${path} must be an exact whole-revision compare-and-swap request.`);
  }
  assertProjectId(value.project_id, `${path}.project_id`);
  assertInteger(value.expected_revision, 0, Number.MAX_SAFE_INTEGER, `${path}.expected_revision`);
  assertArtifact(value.manifest, `${path}.manifest`);
  if (value.manifest.kind !== "pedagogy_revision_manifest") {
    throw new EvolutionProtocolError(`${path}.manifest must have kind pedagogy_revision_manifest.`);
  }
}

function parseActiveRevision(value: unknown, path: string): EvolutionActiveRevision {
  if (!isRecord(value) || !exactKeys(value, ["project_id", "revision", "manifest", "updated_at"])) {
    throw new EvolutionProtocolError(`${path} must be an exact whole active revision.`);
  }
  assertProjectId(value.project_id, `${path}.project_id`);
  assertInteger(value.revision, 0, Number.MAX_SAFE_INTEGER, `${path}.revision`);
  assertArtifact(value.manifest, `${path}.manifest`);
  if (value.manifest.kind !== "pedagogy_revision_manifest") {
    throw new EvolutionProtocolError(`${path}.manifest must have kind pedagogy_revision_manifest.`);
  }
  assertInteger(value.updated_at, 0, Number.MAX_SAFE_INTEGER, `${path}.updated_at`);
  return value as unknown as EvolutionActiveRevision;
}

const ARTIFACT_KINDS = new Set<EvolutionArtifactKind>([
  "prompt", "self_evolution_source", "map_elites_configuration", "map_elites_archive",
  "policy", "skill", "runtime_bundle", "evaluation_report", "pedagogy_revision_manifest",
]);
const EVALUATORS = new Set<LegacyEvolutionEvidenceCreate["evaluator"]>([
  "learner_feedback", "benchmark", "holdout", "human_review",
]);
const JOB_KINDS = new Set<EvolutionJobKind>([
  "evaluate", "evolve_prompt", "evolve_policy", "evolve_source", "build_runtime", "validate_runtime",
]);
const JOB_STATUSES = new Set<EvolutionJobStatus>(["queued", "leased", "running", "succeeded", "failed", "cancelled"]);
const ACTIVE_SLOTS = Object.freeze([
  "prompt", "self_evolution_source", "map_elites_configuration", "map_elites_archive",
  "policy", "skill", "runtime_bundle",
] as const satisfies readonly EvolutionActiveSlot[]);
const ACTIVE_SLOT_SET = new Set<EvolutionActiveSlot>(ACTIVE_SLOTS);
