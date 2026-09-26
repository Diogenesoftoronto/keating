import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mutateQueue, promotionDecision, readQueue, verifyArchive, WAIT_MS, type Candidate, type Queue, type Deployment } from "../scripts/promote-staging.js";

const head = "a".repeat(40);
const now = Date.parse("2026-09-24T12:00:00Z");
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
function directory() { const path = mkdtempSync(join(tmpdir(), "promotion-test-")); temporary.push(path); return path; }
function fixture() {
  const candidate: Candidate = { sha: head, branch: "work/current", dirty: false, fingerprint: "b".repeat(64), files: 10, createdAt: new Date(now - WAIT_MS - 60_000).toISOString(), verifiedAt: new Date(now - WAIT_MS).toISOString(), promotionEligible: true, deploymentId: "staging-1", url: "https://staging.example.test", archivePath: "/candidate/source.tar.gz", archiveSha256: "c".repeat(64) };
  const queue: Queue = { version: 3, promoted: {} };
  const deployment: Deployment = { id: candidate.deploymentId, status: "SUCCESS", createdAt: candidate.createdAt };
  return { queue, candidate, deployment, live: { ...candidate }, healthy: true, now };
}

describe("hosted staging promotion gates", () => {
  test("waits eight hours and promotes at the boundary", () => {
    const input = fixture();
    expect(promotionDecision({ ...input, now: now - 1 }).ready).toBe(false);
    expect(promotionDecision(input).ready).toBe(true);
  });
  test("a newer deployment supersedes an older candidate even when both are healthy", () => {
    const input = fixture();
    input.deployment.id = "newer-dirty-upload";
    expect(promotionDecision(input).ready).toBe(false);
  });
  test("dirty previews and implicit eligibility never promote", () => {
    for (const values of [{ dirty: true, promotionEligible: false }, { dirty: false, promotionEligible: false }, { dirty: true, promotionEligible: true }]) {
      const input = fixture();
      Object.assign(input.candidate, values);
      expect(promotionDecision(input).ready).toBe(false);
    }
  });
  test("live snapshot identity must match SHA, branch, fingerprint, and clean status", () => {
    for (const values of [{ sha: "d".repeat(40) }, { branch: "other" }, { fingerprint: "e".repeat(64) }, { dirty: true }, { promotionEligible: false }]) {
      const input = fixture();
      Object.assign(input.live, values);
      expect(promotionDecision(input).ready).toBe(false);
    }
  });
  test("--now bypasses age only", () => {
    const input = { ...fixture(), immediate: true, now: now - WAIT_MS + 1 };
    expect(promotionDecision(input).ready).toBe(true);
    expect(promotionDecision({ ...input, healthy: false }).ready).toBe(false);
    input.deployment.status = "BUILDING";
    expect(promotionDecision(input).ready).toBe(false);
  });
  test("completed promotions are idempotent and unresolved uploads block all candidates", () => {
    const input = fixture();
    input.queue.promoted[head] = { at: new Date(now).toISOString(), deploymentId: "production-1", candidate: input.candidate, archivePath: "/data/source.tar.gz" };
    expect(promotionDecision(input).ready).toBe(false);
    input.queue.promoted = {};
    input.queue.inflight = { sha: "f".repeat(40), operation: "lease", startedAt: new Date(now).toISOString() };
    expect(promotionDecision(input).ready).toBe(false);
  });
  test("invalid identity, missing archive and future timestamps fail closed even with --now", () => {
    for (const values of [{ sha: "short" }, { fingerprint: "bad" }, { archiveSha256: "bad" }, { archivePath: undefined }, { createdAt: "bad date" }, { verifiedAt: undefined }, { verifiedAt: "bad date" }, { verifiedAt: new Date(now + 1).toISOString() }, { verifiedAt: new Date(now - WAIT_MS - 120_000).toISOString() }]) {
      const input = { ...fixture(), immediate: true };
      Object.assign(input.candidate, values);
      expect(promotionDecision(input).ready).toBe(false);
    }
  });
});

test("source checksum detects any archive mutation", () => {
  const path = join(directory(), "source.tar.gz");
  writeFileSync(path, "immutable source archive");
  const candidate = { ...fixture().candidate, archivePath: path, archiveSha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
  expect(verifyArchive(candidate)).toBe(path);
  writeFileSync(path, "replaced source archive");
  expect(() => verifyArchive(candidate)).toThrow(/checksum/);
});

test("concurrent local queue writers preserve every receipt with atomic files", async () => {
  const state = directory();
  const module = fileURLToPath(new URL("../scripts/promote-staging.ts", import.meta.url));
  const script = join(state, "writer.ts");
  writeFileSync(script, `import { mutateQueue } from ${JSON.stringify(module)};\nconst [directory, key] = process.argv.slice(2);\nmutateQueue(directory, queue => { queue.promoted[key] = { at: key, deploymentId: key, candidate: {}, archivePath: key }; return true; });\n`);
  await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const child = Bun.spawn([process.execPath, script, state, `writer-${index}`], { stdout: "pipe", stderr: "pipe" });
    const error = await new Response(child.stderr).text();
    expect(await child.exited, error).toBe(0);
  }));
  expect(Object.keys(readQueue(state).promoted).sort()).toEqual(Array.from({ length: 6 }, (_, index) => `writer-${index}`));
  expect(JSON.parse(readFileSync(join(state, "queue.json"), "utf8")).version).toBe(3);
});

test("lease acquisition excludes other promoters and survives subsequent candidate records", () => {
  const state = directory();
  mutateQueue(state, queue => { queue.inflight = { sha: head, operation: "first", startedAt: new Date(now).toISOString() }; return true; });
  expect(() => mutateQueue(state, queue => { if (queue.inflight) throw new Error("already leased"); return false; })).toThrow(/already leased/);
  expect(readQueue(state).inflight?.operation).toBe("first");
});

test("dirty hosted candidate exits safely without Git, tokens, or Railway executable", async () => {
  const base = directory();
  const state = join(base, "state");
  const candidate = join(base, "candidate.json");
  const source = fixture().candidate;
  writeFileSync(candidate, JSON.stringify({ ...source, dirty: true, promotionEligible: false, archivePath: undefined, archiveSha256: undefined }));
  const module = fileURLToPath(new URL("../scripts/promote-staging.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, module, "run-hosted"], { cwd: base, env: { PATH: "/nonexistent", KEATING_PROMOTION_CANDIDATE: candidate, KEATING_PROMOTION_STATE_DIR: state }, stdout: "pipe", stderr: "pipe" });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, error).toBe(0);
  expect(out).toContain("uncommitted preview");
});

test("clean hosted candidate fails clearly before CLI execution when credentials are missing", async () => {
  const base = directory();
  const candidate = join(base, "candidate.json");
  writeFileSync(candidate, JSON.stringify(fixture().candidate));
  const module = fileURLToPath(new URL("../scripts/promote-staging.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, module, "run-hosted"], { cwd: base, env: { PATH: "/nonexistent", KEATING_PROMOTION_CANDIDATE: candidate, KEATING_PROMOTION_STATE_DIR: join(base, "state") }, stdout: "pipe", stderr: "pipe" });
  const [error, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(1);
  expect(error).toContain("RAILWAY_STAGING_TOKEN");
  expect(error).not.toContain("ENOENT");
});

test("an immediate request for an already promoted commit is consumed once without another upload", async () => {
  const base = directory();
  const state = join(base, "state");
  const candidatePath = join(base, "candidate.json");
  const candidate = fixture().candidate;
  writeFileSync(candidatePath, JSON.stringify(candidate));
  mutateQueue(state, queue => { queue.promoted[head] = { at: new Date(now).toISOString(), deploymentId: "production-existing", candidate, archivePath: "/missing/archive" }; return true; });
  const module = fileURLToPath(new URL("../scripts/promote-staging.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, module, "run-hosted"], { cwd: base, env: { PATH: "/nonexistent", KEATING_PROMOTION_CANDIDATE: candidatePath, KEATING_PROMOTION_STATE_DIR: state, KEATING_PROMOTION_REQUEST: JSON.stringify({ id: "manual-request-001", action: "promote", sha: head }) }, stdout: "pipe", stderr: "pipe" });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code, error).toBe(0);
  expect(out).toContain("without another upload");
  expect(readQueue(state).completedRequests?.["manual-request-001"]).toBeDefined();
  expect(readQueue(state).promoted[head]?.deploymentId).toBe("production-existing");
});
