import { describe, expect, test } from "bun:test";
import {
  MergeConflictError,
  applyPedagogyActivation,
  validateAccountEvolutionJobRecord,
  validateAccountEvolutionJobRequest,
  validateAccountEvolutionJobResult,
  validateActivePedagogyPointer,
  validateEvolutionExecutorAttestation,
  validateEvolutionRunnerRequirements,
  validateLearnerEvidenceRef,
  validatePedagogyActivationRequest,
  validatePedagogyArtifactRef,
  validatePedagogyRevisionRef,
  type AccountEvolutionJobRecord,
  type AccountEvolutionJobRequest,
  type AccountEvolutionJobResult,
  type ActivePedagogyPointer,
  type LearnerEvidenceRef,
  type PedagogyActivationRequest,
  type PedagogyRevisionRef,
} from "../src/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function revision(id = "revision-1", parentId?: string, createdAt = "2026-08-30T12:00:00.000Z"): PedagogyRevisionRef {
  return {
    id,
    ...(parentId === undefined ? {} : { parentId }),
    createdAt,
    manifestDigest: digest(id === "revision-1" ? "a" : "b"),
    artifacts: [{
      id: `${id}-prompts`,
      kind: "prompt-set",
      digest: digest(id === "revision-1" ? "c" : "d"),
      mediaType: "application/json",
      sizeBytes: 4096,
    }],
  };
}

function evidence(): LearnerEvidenceRef {
  return {
    id: "evidence-1",
    kind: "delayed-observed",
    digest: digest("e"),
    capturedAt: "2026-08-30T12:01:00.000Z",
    exposureCount: 8,
    sizeBytes: 2048,
  };
}

function request(): AccountEvolutionJobRequest {
  return {
    schemaVersion: 1,
    clientRequestId: "request-1",
    requestedAt: "2026-08-30T12:02:00.000Z",
    operation: "prompt-evolution",
    baseRevision: revision(),
    evidence: [evidence()],
    requirements: {
      runtime: { kind: "bun", version: "1.2", abi: "keating-evolution-v1", entrypoint: "src/run.ts" },
      minimumIsolation: "microvm",
      network: { mode: "allowlist", allowedHosts: ["api.notorganic.info:443"] },
      filesystem: { mode: "workspace-snapshot", maximumWritableBytes: 268_435_456 },
      secrets: { mode: "brokered", capabilities: ["model-inference"] },
      resources: {
        cpuMillis: 120_000,
        memoryMiB: 1024,
        diskMiB: 4096,
        wallTimeSeconds: 300,
        maximumOutputBytes: 4_194_304,
      },
    },
  };
}

function result(): AccountEvolutionJobResult {
  return {
    resultDigest: digest("f"),
    proposedRevision: revision("revision-2", "revision-1", "2026-08-30T12:04:00.000Z"),
    consumedEvidence: [evidence()],
    attestation: {
      adapterId: "configured-microvm",
      adapterVersion: "2.1.0",
      isolation: "microvm",
      imageDigest: digest("1"),
      runtimeDigest: digest("2"),
      executedAt: "2026-08-30T12:04:30.000Z",
    },
  };
}

function succeededRecord(): AccountEvolutionJobRecord {
  return {
    schemaVersion: 1,
    id: "job-1",
    request: request(),
    status: "succeeded",
    attempt: 1,
    createdAt: "2026-08-30T12:02:01.000Z",
    updatedAt: "2026-08-30T12:05:00.000Z",
    startedAt: "2026-08-30T12:03:00.000Z",
    completedAt: "2026-08-30T12:05:00.000Z",
    result: result(),
  };
}

describe("Not Organic account evolution contracts", () => {
  test("accepts immutable content-addressed revision, artifact, and evidence references", () => {
    const base = revision();
    expect(validatePedagogyArtifactRef(base.artifacts[0])).toBe(true);
    expect(validatePedagogyRevisionRef(base)).toBe(true);
    expect(validateLearnerEvidenceRef(evidence())).toBe(true);

    expect(validatePedagogyArtifactRef({ ...base.artifacts[0], digest: "sha256:nope" })).toBe(false);
    expect(validatePedagogyArtifactRef({ ...base.artifacts[0], sizeBytes: 67_108_865 })).toBe(false);
    expect(validateLearnerEvidenceRef({ ...evidence(), capturedAt: "yesterday" })).toBe(false);
    expect(validateLearnerEvidenceRef({ ...evidence(), exposureCount: 0 })).toBe(false);
    expect(validatePedagogyRevisionRef({ ...base, artifacts: [...base.artifacts, base.artifacts[0]] })).toBe(false);
    expect(validatePedagogyRevisionRef({ ...base, parentId: base.id })).toBe(false);
  });

  test("keeps runner requirements capability-based and rejects vendor extensions", () => {
    const requirements = request().requirements;
    expect(validateEvolutionRunnerRequirements(requirements)).toBe(true);
    expect(validateEvolutionRunnerRequirements({ ...requirements, cloudflareNamespace: "runner" })).toBe(false);
    expect(validateEvolutionRunnerRequirements({ ...requirements, flyMachineId: "machine" })).toBe(false);
    expect(validateEvolutionRunnerRequirements({
      ...requirements,
      network: { mode: "none", allowedHosts: ["api.notorganic.info"] },
    })).toBe(false);
    expect(validateEvolutionRunnerRequirements({
      ...requirements,
      runtime: { ...requirements.runtime, entrypoint: "../escape.ts" },
    })).toBe(false);
    expect(validateEvolutionRunnerRequirements({
      ...requirements,
      resources: { ...requirements.resources, wallTimeSeconds: 86_401 },
    })).toBe(false);
    expect(validateEvolutionRunnerRequirements({
      ...requirements,
      secrets: { mode: "none", capabilities: ["model-inference"] },
    })).toBe(false);
    expect(validateEvolutionRunnerRequirements({
      ...requirements,
      secrets: { mode: "brokered", capabilities: ["model-inference", "model-inference"] },
    })).toBe(false);
    expect(validateEvolutionRunnerRequirements({
      ...requirements,
      runtime: { ...requirements.runtime, kind: "python" },
      minimumIsolation: "worker",
    })).toBe(true);
  });

  test("never accepts client-selected account identity or unknown vendor fields", () => {
    const valid = request();
    expect(validateAccountEvolutionJobRequest(valid)).toBe(true);
    expect(validateAccountEvolutionJobRequest({ ...valid, accountId: "attacker-account" })).toBe(false);
    expect(validateAccountEvolutionJobRequest({ ...valid, provider: "some-vendor" })).toBe(false);
    expect(validateAccountEvolutionJobRequest({
      ...valid,
      baseRevision: { ...valid.baseRevision, accountId: "attacker-account" },
    })).toBe(false);
    expect(validateAccountEvolutionJobRequest({
      ...valid,
      evidence: [{ ...valid.evidence[0], vendorMetadata: {} }],
    })).toBe(false);
  });

  test("validates neutral executor attestations and successful results", () => {
    const completed = result();
    expect(validateEvolutionExecutorAttestation(completed.attestation)).toBe(true);
    expect(validateAccountEvolutionJobResult(completed)).toBe(true);
    expect(validateEvolutionExecutorAttestation({
      ...completed.attestation,
      cloudflareSandboxId: "sandbox-1",
    })).toBe(false);
    expect(validateEvolutionExecutorAttestation({
      ...completed.attestation,
      runtimeDigest: "sha256:ABC",
    })).toBe(false);
  });

  test("enforces durable status, timestamp, parent, and evidence combinations", () => {
    const queued: AccountEvolutionJobRecord = {
      schemaVersion: 1,
      id: "job-queued",
      request: request(),
      status: "queued",
      attempt: 0,
      createdAt: "2026-08-30T12:02:01.000Z",
      updatedAt: "2026-08-30T12:02:01.000Z",
    };
    expect(validateAccountEvolutionJobRecord(queued)).toBe(true);
    expect(validateAccountEvolutionJobRecord(succeededRecord())).toBe(true);
    expect(validateAccountEvolutionJobRecord({ ...queued, result: result() })).toBe(false);
    expect(validateAccountEvolutionJobRecord({ ...succeededRecord(), failure: {
      code: "execution-failed", message: "Failed too.", retryable: true,
    } })).toBe(false);
    expect(validateAccountEvolutionJobRecord({
      ...succeededRecord(),
      completedAt: "2026-08-30T12:02:30.000Z",
    })).toBe(false);
    expect(validateAccountEvolutionJobRecord({
      ...succeededRecord(),
      result: { ...result(), proposedRevision: revision("revision-2", "wrong-parent", "2026-08-30T12:04:00.000Z") },
    })).toBe(false);
    expect(validateAccountEvolutionJobRecord({
      ...succeededRecord(),
      result: { ...result(), consumedEvidence: [{ ...evidence(), digest: digest("9") }] },
    })).toBe(false);

    const failed: AccountEvolutionJobRecord = {
      ...queued,
      status: "failed",
      attempt: 1,
      startedAt: "2026-08-30T12:03:00.000Z",
      completedAt: "2026-08-30T12:04:00.000Z",
      updatedAt: "2026-08-30T12:04:00.000Z",
      failure: { code: "resource-limit", message: "Memory ceiling reached.", retryable: true },
    };
    expect(validateAccountEvolutionJobRecord(failed)).toBe(true);
    expect(validateAccountEvolutionJobRecord({ ...failed, result: result() })).toBe(false);

    expect(validateAccountEvolutionJobRecord({
      ...queued,
      status: "cancelled",
      completedAt: "2026-08-30T12:03:00.000Z",
      updatedAt: "2026-08-30T12:03:00.000Z",
      cancellationReason: "Learner cancelled the queued job.",
    })).toBe(true);
  });

  test("activates revisions with account-relative compare-and-swap semantics", () => {
    const activation: PedagogyActivationRequest = {
      schemaVersion: 1,
      clientRequestId: "activation-1",
      requestedAt: "2026-08-30T12:06:00.000Z",
      revision: result().proposedRevision,
      sourceJobId: "job-1",
      expectedActive: null,
    };
    expect(validatePedagogyActivationRequest(activation)).toBe(true);
    expect(validatePedagogyActivationRequest({ ...activation, accountId: "account-1" })).toBe(false);

    const first = applyPedagogyActivation(null, activation, "2026-08-30T12:06:01.000Z");
    expect(validateActivePedagogyPointer(first)).toBe(true);
    expect(first.generation).toBe(1);
    expect(first.revision.id).toBe("revision-2");

    const nextRevision = revision("revision-3", "revision-2", "2026-08-30T12:07:00.000Z");
    const nextRequest: PedagogyActivationRequest = {
      ...activation,
      clientRequestId: "activation-2",
      requestedAt: "2026-08-30T12:08:00.000Z",
      revision: nextRevision,
      sourceJobId: "job-2",
      expectedActive: {
        revisionId: first.revision.id,
        manifestDigest: first.revision.manifestDigest,
        generation: first.generation,
      },
    };
    const second = applyPedagogyActivation(first, nextRequest, "2026-08-30T12:08:01.000Z");
    expect(second.generation).toBe(2);

    expect(() => applyPedagogyActivation(first, {
      ...nextRequest,
      expectedActive: { ...nextRequest.expectedActive!, generation: 0 },
    }, "2026-08-30T12:08:01.000Z")).toThrow(MergeConflictError);
    expect(() => applyPedagogyActivation(null, {
      ...activation,
      expectedActive: { revisionId: "missing", manifestDigest: digest("0"), generation: 1 },
    }, "2026-08-30T12:08:01.000Z")).toThrow(MergeConflictError);
  });

  test("active pointer validation fails closed on unknown identity fields", () => {
    const pointer: ActivePedagogyPointer = {
      schemaVersion: 1,
      revision: result().proposedRevision,
      generation: 1,
      activatedAt: "2026-08-30T12:06:01.000Z",
      activationId: "activation-1",
      sourceJobId: "job-1",
    };
    expect(validateActivePedagogyPointer(pointer)).toBe(true);
    expect(validateActivePedagogyPointer({ ...pointer, accountId: "account-1" })).toBe(false);
  });
});
