import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AccountEvolutionJobRequest, LearnerEvidenceRef } from "@keating/learner-contracts";
import { setAccountFetchForTests } from "../src/lib/notorganic-account/client";
import { saveDeviceSession, setAccountCredentialStoreForTests } from "../src/lib/notorganic-account/credentials";
import { setAccountCryptoAdapterForTests } from "../src/lib/notorganic-account/crypto";
import { setDeviceKeyAdapterForTests } from "../src/lib/notorganic-account/dpop";
import {
  EvolutionContractMismatchError,
  EvolutionProtocolError,
  cancelEvolutionJob,
  canonicalEvolutionJobTransportMismatches,
  canonicalEvolutionJobRecordTransportMismatches,
  compareAndSwapActiveEvolutionRevision,
  compareAndSwapLegacyActiveEvolutionPointer,
  createEvolutionJob,
  createLegacySchedulerEvolutionJob,
  fetchEvolutionArtifactBytes,
  getEvolutionJob,
  listEvolutionJobs,
  loadActiveMobilePedagogyRevision,
  loadEvolutionSyncStatus,
  mapCanonicalEvolutionJobRequest,
  mapEvolutionJobToCanonicalRecord,
  readActiveEvolutionRevision,
  readLegacyActiveEvolutionPointer,
  registerEvolutionArtifact,
  setEvolutionArtifactFetchForTests,
  setEvolutionDigestForTests,
  submitEvolutionEvidence,
  type EvolutionActivePointer,
  type EvolutionActiveRevision,
  type EvolutionArtifactRef,
  type EvolutionJob,
  type EvolutionJobCreate,
} from "../src/lib/notorganic-account/evolution";
import type { NotOrganicAccountConfig } from "../src/lib/notorganic-account/contracts";

const config: NotOrganicAccountConfig = {
  issuer: "https://gateway.test",
  authorizationUrl: "https://identity.test/authorize",
  clientId: "https://keating.help/mobile",
  redirectUri: "keating:///notorganic/callback",
  scope: "evolution:read evolution:write evolution:execute",
};
const digest = `sha256:${"a".repeat(64)}`;
const artifact: EvolutionArtifactRef = { digest, kind: "prompt", media_type: "application/json", size_bytes: 3, schema_version: 1 };
const manifest: EvolutionArtifactRef & { kind: "pedagogy_revision_manifest" } = { ...artifact, kind: "pedagogy_revision_manifest" };
const legacyJobCreate: EvolutionJobCreate = {
  idempotency_key: "mobile-request-1",
  project_id: "keating-account",
  kind: "evolve_prompt",
  inputs: [artifact],
  required_capabilities: ["runtime:javascript"],
  budget: { cpu_millis: 10_000, wall_time_ms: 30_000, memory_bytes: 134_217_728, disk_bytes: 67_108_864, output_bytes: 1_048_576 },
};
const evidenceRef: LearnerEvidenceRef = {
  id: "evidence-1",
  kind: "observed",
  digest: `sha256:${"d".repeat(64)}`,
  capturedAt: "2026-08-31T11:30:00.000Z",
  exposureCount: 4,
  sizeBytes: 128,
};
const canonicalRequest: AccountEvolutionJobRequest = {
  schemaVersion: 1,
  clientRequestId: "request-1",
  requestedAt: "2026-08-31T12:00:00.000Z",
  operation: "prompt-evolution",
  baseRevision: {
    id: "revision-1",
    createdAt: "2026-08-31T11:00:00.000Z",
    manifestDigest: `sha256:${"c".repeat(64)}`,
    artifacts: [{ id: "prompt-1", kind: "prompt-set", digest, mediaType: "application/json", sizeBytes: 3 }],
    compatibility: {
      agentApi: "keating-agent-v1",
      learnerContract: 1,
      targets: ["browser-nodepod", "mobile-declarative", "flue-node"],
      minimumFlue: "2.0.3",
      mobileSdk: "1",
      requiredCapabilities: ["runtime-javascript"],
    },
  },
  evidence: [evidenceRef],
  requirements: {
    runtime: { kind: "javascript", version: "es2022", abi: "keating-v1", entrypoint: "agent.js" },
    minimumIsolation: "worker",
    network: { mode: "none", allowedHosts: [] },
    filesystem: { mode: "ephemeral", maximumWritableBytes: 1_048_576 },
    secrets: { mode: "none", capabilities: [] },
    resources: { cpuMillis: 10_000, memoryMiB: 128, diskMiB: 64, wallTimeSeconds: 30, maximumOutputBytes: 1_048_576 },
  },
};

function memoryCredentials() {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    deleteItem: async (key: string) => { values.delete(key); },
  };
}

function job(status: EvolutionJob["status"] = "queued", updatedAt = 1_000, source?: AccountEvolutionJobRequest): EvolutionJob {
  return {
    ...legacyJobCreate,
    id: "job:mobile-1",
    product: "keating",
    status,
    created_at: 900,
    updated_at: updatedAt,
    attempts: status === "queued" ? 0 : 1,
    ...(status === "failed" ? { error_code: "runner_failed" } : {}),
    ...(source ? { source_request: source } : {}),
  };
}
const legacyPointer = (revision = 1): EvolutionActivePointer => ({ project_id: "keating-account", slot: "prompt", revision, artifact, updated_at: 1_100 });
const activeRevision = (revision = 1): EvolutionActiveRevision => ({ project_id: "keating-account", revision, manifest, updated_at: 1_150 });

async function sha256Digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return `sha256:${[...hash].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

beforeEach(async () => {
  setAccountCredentialStoreForTests(memoryCredentials());
  setAccountCryptoAdapterForTests({
    randomBytes: async (length) => new Uint8Array(length).fill(5),
    sha256Base64: async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64"),
  });
  setDeviceKeyAdapterForTests({
    getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }),
    signAsync: async () => "device-signature",
    deleteKeyAsync: async () => {},
  });
  setEvolutionDigestForTests(async () => digest);
  await saveDeviceSession({ accessToken: "mobile-access", accessExpiresAt: Date.now() + 60_000, refreshToken: "mobile-refresh", refreshExpiresAt: Date.now() + 120_000, scope: config.scope, accountId: "did:plc:learner" });
});

afterEach(() => {
  setAccountCredentialStoreForTests(null);
  setAccountCryptoAdapterForTests(null);
  setDeviceKeyAdapterForTests(null);
  setAccountFetchForTests(null);
  setEvolutionArtifactFetchForTests(null);
  setEvolutionDigestForTests(null);
});

describe("Not Organic mobile evolution transport", () => {
  test("DPoP-authenticates canonical jobs, evidence, whole revisions, and explicit legacy APIs", async () => {
    const calls: Array<{ path: string; method: string; authorization: string | null; dpop: string | null }> = [];
    const rawCalls: typeof calls = [];
    setEvolutionArtifactFetchForTests((async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      rawCalls.push({ path: `${url.pathname}${url.search}`, method: init?.method ?? "GET", authorization: headers.get("authorization"), dpop: headers.get("dpop") });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch);
    setAccountFetchForTests((async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({ path: `${url.pathname}${url.search}`, method, authorization: headers.get("authorization"), dpop: headers.get("dpop") });
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, any> : null;
      if (url.pathname === "/v1/evolution/artifacts") return Response.json(body!.artifact);
      if (url.pathname === "/v1/evolution/evidence") return Response.json({ ...body, id: "evidence:1", product: "keating", created_at: 950 });
      if (url.pathname === "/v1/evolution/jobs" && method === "POST") return Response.json(body!.contract === "keating-account-evolution-job-v1" ? job("queued", 1_000, body!.request) : job());
      if (url.pathname === "/v1/evolution/jobs" && method === "GET") return Response.json([job()]);
      if (url.pathname.endsWith("/cancel")) return Response.json(job("cancelled", 1_200));
      if (url.pathname.startsWith("/v1/evolution/jobs/")) return Response.json(job("running", 1_050));
      if (url.pathname === "/v1/evolution/active-revision" && method === "PUT") return Response.json(activeRevision(2));
      if (url.pathname === "/v1/evolution/active-revision") return Response.json(activeRevision());
      if (url.pathname === "/v1/evolution/active" && method === "PUT") return Response.json(legacyPointer(2));
      if (url.pathname === "/v1/evolution/active") return Response.json(legacyPointer());
      return Response.json({ error: { message: "unexpected route" } }, { status: 404 });
    }) as typeof fetch);

    expect(await registerEvolutionArtifact({ artifact, bytes: new Uint8Array([1, 2, 3]) }, config)).toEqual(artifact);
    expect((await submitEvolutionEvidence({ projectId: "keating-account", candidate: artifact, evidence: evidenceRef }, config)).id).toBe("evidence:1");
    expect((await createEvolutionJob(canonicalRequest, config)).source_request).toEqual(canonicalRequest);
    expect((await createLegacySchedulerEvolutionJob(legacyJobCreate, config)).status).toBe("queued");
    expect(await listEvolutionJobs(25, config)).toHaveLength(1);
    expect((await getEvolutionJob("job:mobile-1", config)).status).toBe("running");
    expect((await cancelEvolutionJob("job:mobile-1", config)).status).toBe("cancelled");
    expect((await readLegacyActiveEvolutionPointer("keating-account", "prompt", config))?.revision).toBe(1);
    expect((await compareAndSwapLegacyActiveEvolutionPointer({ project_id: "keating-account", slot: "prompt", expected_revision: 1, artifact }, config)).revision).toBe(2);
    expect((await readActiveEvolutionRevision("keating-account", config))?.manifest).toEqual(manifest);
    expect((await compareAndSwapActiveEvolutionRevision({ project_id: "keating-account", expected_revision: 1, manifest }, config)).revision).toBe(2);

    expect(calls.map(({ path, method }) => [method, path])).toEqual([
      ["POST", "/v1/evolution/artifacts"], ["POST", "/v1/evolution/evidence"],
      ["POST", "/v1/evolution/jobs"], ["POST", "/v1/evolution/jobs"],
      ["GET", "/v1/evolution/jobs?limit=25"], ["GET", "/v1/evolution/jobs/job%3Amobile-1"],
      ["POST", "/v1/evolution/jobs/job%3Amobile-1/cancel"],
      ["GET", "/v1/evolution/active?project_id=keating-account&slot=prompt"], ["PUT", "/v1/evolution/active"],
      ["GET", "/v1/evolution/active-revision?project_id=keating-account"], ["PUT", "/v1/evolution/active-revision"],
    ]);
    expect(rawCalls.map(({ path, method }) => [method, path])).toEqual([["PUT", `/v1/evolution/artifacts/${encodeURIComponent(digest)}/content`]]);
    expect([...calls, ...rawCalls].every(({ authorization, dpop }) => authorization === "DPoP mobile-access" && dpop?.split(".").length === 3)).toBe(true);
  });

  test("uses provider blob paths and verifies bytes in both directions", async () => {
    const rawPaths: string[] = [];
    setAccountFetchForTests((async (_input, init) => Response.json(JSON.parse(String(init?.body)).artifact)) as typeof fetch);
    setEvolutionArtifactFetchForTests((async (input, init) => {
      rawPaths.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch);
    await registerEvolutionArtifact({ artifact, bytes: new Uint8Array([1, 2, 3]) }, config);
    expect(await fetchEvolutionArtifactBytes(artifact, config)).toEqual(new Uint8Array([1, 2, 3]));
    expect(rawPaths).toEqual([
      `PUT /v1/evolution/artifacts/${encodeURIComponent(digest)}/content`,
      `GET /v1/evolution/artifacts/${encodeURIComponent(digest)}/content`,
    ]);
    setEvolutionDigestForTests(async () => `sha256:${"b".repeat(64)}`);
    await expect(fetchEvolutionArtifactBytes(artifact, config)).rejects.toThrow("Artifact digest mismatch");
    await expect(registerEvolutionArtifact({ artifact, bytes: new Uint8Array([1, 2]) }, config)).rejects.toThrow("Artifact size mismatch");
  });

  test("rejects provider drift instead of accepting unknown response fields", async () => {
    setAccountFetchForTests((async () => Response.json({ ...job(), runner_secret: "must-not-pass" })) as typeof fetch);
    await expect(getEvolutionJob("job:mobile-1", config)).rejects.toBeInstanceOf(EvolutionProtocolError);
    await expect(getEvolutionJob("job:mobile-1", config)).rejects.toThrow("exact evolution job record");
  });

  test("provides whole-revision sync status for account UI", async () => {
    setAccountFetchForTests((async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/evolution/jobs") return Response.json([job("failed", 1_300), { ...job("queued", 1_200), id: "job:mobile-2" }, { ...job(), id: "job:other", project_id: "other" }]);
      return Response.json(activeRevision());
    }) as typeof fetch);
    const status = await loadEvolutionSyncStatus({ projectId: "keating-account" }, config);
    expect(status).toMatchObject({ projectId: "keating-account", state: "attention", queuedJobs: 1, runningJobs: 0, failedJobs: 1, latestUpdatedAt: 1_300 });
    expect(status.jobs.map(({ id }) => id)).toEqual(["job:mobile-1", "job:mobile-2"]);
    expect(status.activeRevision?.manifest).toEqual(manifest);
  });

  test("loads only verified manifests compatible with mobile declarative capabilities", async () => {
    const { manifestDigest: _discardedSelfReference, ...manifestPayload } = canonicalRequest.baseRevision;
    const bytes = new TextEncoder().encode(JSON.stringify(manifestPayload));
    const verifiedDigest = await sha256Digest(bytes);
    const manifestArtifact = { ...manifest, digest: verifiedDigest, size_bytes: bytes.byteLength };
    setEvolutionDigestForTests(sha256Digest);
    setAccountFetchForTests((async () => Response.json({ ...activeRevision(), manifest: manifestArtifact })) as typeof fetch);
    setEvolutionArtifactFetchForTests((async () => new Response(bytes.slice())) as typeof fetch);

    const active = await loadActiveMobilePedagogyRevision({
      projectId: "keating-account",
      support: {
        agentApi: "keating-agent-v1",
        learnerContract: 1,
        mobileSdk: "1",
        capabilities: ["runtime-javascript"],
      },
    }, config);
    expect(active?.revision).toEqual({ ...manifestPayload, manifestDigest: verifiedDigest });

    await expect(loadActiveMobilePedagogyRevision({
      projectId: "keating-account",
      support: { agentApi: "keating-agent-v1", learnerContract: 1, mobileSdk: "1", capabilities: [] },
    }, config)).rejects.toThrow("missing required pedagogy capabilities");
  });
});

describe("canonical account-evolution compatibility", () => {
  test("sends the exact canonical request and fails closed only when malformed", () => {
    expect(canonicalEvolutionJobTransportMismatches(canonicalRequest)).toEqual([]);
    const envelope = mapCanonicalEvolutionJobRequest(canonicalRequest);
    expect(envelope).toEqual({ contract: "keating-account-evolution-job-v1", request: canonicalRequest });
    expect(envelope.request).not.toBe(canonicalRequest);
    expect(() => mapCanonicalEvolutionJobRequest({ ...canonicalRequest, schemaVersion: 2 } as unknown as AccountEvolutionJobRequest)).toThrow(EvolutionContractMismatchError);
  });

  test("maps a lossless queued record and rejects provider-only lifecycle shapes", () => {
    const createdAt = Date.parse("2026-08-31T12:00:01.000Z");
    const queued = { ...job("queued", createdAt, canonicalRequest), id: "job-mobile-1", created_at: createdAt, updated_at: createdAt };
    expect(mapEvolutionJobToCanonicalRecord(queued)).toMatchObject({
      schemaVersion: 1,
      id: "job-mobile-1",
      request: canonicalRequest,
      status: "queued",
      attempt: 0,
      createdAt: "2026-08-31T12:00:01.000Z",
    });
    const leased = { ...queued, status: "leased" as const, attempts: 1 };
    expect(canonicalEvolutionJobRecordTransportMismatches(leased)).toContain(
      "provider status leased has no canonical job status",
    );
    expect(() => mapEvolutionJobToCanonicalRecord(leased)).toThrow(EvolutionContractMismatchError);
    expect(canonicalEvolutionJobRecordTransportMismatches(job("queued", createdAt, canonicalRequest))).toContain(
      "provider job id is not a canonical contract ID",
    );
  });
});
