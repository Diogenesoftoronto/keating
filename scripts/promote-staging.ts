#!/usr/bin/env bun
/** GitHub-free promotion of the exact source archive tested on staging.
 * Railway cron runs run-hosted once per hour; local commands use saved login.
 */
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const WAIT_MS = 8 * 60 * 60 * 1000;
const PROJECT = "314d5558-957b-4e19-9ae0-bc08c8b5cf78";
const SERVICE = "a3937c22-5298-4079-aa29-e009e7efbe61";
const STAGING = "65227e01-d875-4707-8467-e27165c820b8";
const PRODUCTION = "343e403a-fac6-4a18-a413-d3bfd5f758f1";
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
export type Candidate = { sha: string; branch: string; dirty: boolean; fingerprint: string; files: number; createdAt: string; verifiedAt?: string; promotionEligible: boolean; deploymentId: string; url: string; archivePath?: string; archiveSha256?: string };
export type PromotionReceipt = { at: string; deploymentId: string; candidate: Candidate; archivePath: string };
export type Queue = { version: 3; promoted: Record<string, PromotionReceipt>; completedRequests?: Record<string, string>; inflight?: { sha: string; operation: string; startedAt: string } };
export type Deployment = { id: string; status: string; createdAt: string };
export type Decision = { ready: boolean; reason: string };

export function promotionDecision(input: { queue: Queue; candidate: Candidate; deployment?: Deployment; live?: Partial<Candidate>; healthy: boolean; now: number; immediate?: boolean }): Decision {
  const { queue, candidate, deployment, live, healthy, now, immediate } = input;
  if (queue.inflight) return { ready: false, reason: `Unresolved promotion ${queue.inflight.operation}; inspect production before releasing its lease.` };
  if (!SHA.test(candidate.sha) || !DIGEST.test(candidate.fingerprint) || !candidate.branch || typeof candidate.deploymentId !== "string" || !candidate.deploymentId) return { ready: false, reason: "Invalid staging candidate identity." };
  if (candidate.dirty !== false || candidate.promotionEligible !== true) return { ready: false, reason: "Staging contains an uncommitted preview; production promotion is disabled." };
  if (!candidate.archivePath || !DIGEST.test(candidate.archiveSha256 ?? "")) return { ready: false, reason: "The clean candidate has no verified source archive." };
  if (queue.promoted[candidate.sha]) return { ready: false, reason: "This commit has already been promoted." };
  const verified = Date.parse(candidate.verifiedAt ?? "");
  const created = Date.parse(candidate.createdAt);
  const age = now - verified;
  if (!Number.isFinite(created) || !Number.isFinite(age) || age < 0 || verified < created) return { ready: false, reason: "Candidate verification timestamp is missing, invalid, or in the future." };
  if (!immediate && age < WAIT_MS) return { ready: false, reason: "The clean staging snapshot has not completed its eight-hour wait." };
  if (!deployment || deployment.id !== candidate.deploymentId || deployment.status !== "SUCCESS") return { ready: false, reason: "Latest staging deployment is not the recorded successful snapshot." };
  if (!live || live.sha !== candidate.sha || live.branch !== candidate.branch || live.fingerprint !== candidate.fingerprint || live.dirty !== false || live.promotionEligible !== true) return { ready: false, reason: "The live staging receipt does not match the clean candidate." };
  if (!healthy) return { ready: false, reason: "Staging health probe is not green." };
  return { ready: true, reason: "The clean staging commit is eligible for promotion." };
}

function command(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const result = spawnSync(args[0]!, args.slice(1), { cwd: options.cwd, env: options.env ?? process.env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args[0]} ${args[1]} failed (exit ${result.status}). ${(result.stderr ?? "").trim()}`);
  return result.stdout?.trim() ?? "";
}
export function readQueue(directory: string): Queue {
  const path = join(directory, "queue.json");
  if (!existsSync(path)) return { version: 3, promoted: {} };
  const queue = JSON.parse(readFileSync(path, "utf8")) as Queue;
  if (queue.version !== 3 || !queue.promoted || typeof queue.promoted !== "object") throw new Error("Unsupported promotion queue.");
  return queue;
}

/** An exclusive filesystem lock serializes queue writes, while inflight is a
 * persistent deployment lease. A crash never silently permits a second upload.
 */
export function mutateQueue(directory: string, change: (queue: Queue) => boolean): Queue {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "queue.lock");
  const deadline = Date.now() + 10_000;
  let acquired = false;
  while (!acquired && Date.now() < deadline) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); } finally { closeSync(fd); }
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  if (!acquired) throw new Error(`Promotion state is locked. Inspect ${lock}; remove a stale lock only after verifying its writer has stopped.`);
  const temporary = join(directory, `queue.${process.pid}.${randomUUID()}.tmp`);
  try {
    const queue = readQueue(directory);
    if (change(queue)) {
      writeFileSync(temporary, `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, join(directory, "queue.json"));
    }
    return queue;
  } finally {
    rmSync(temporary, { force: true });
    rmSync(lock, { force: true });
  }
}

function healthUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS healthcheck URL without credentials.");
  return url;
}
function readCandidate(path: string): Candidate {
  const candidate = JSON.parse(readFileSync(path, "utf8")) as Candidate;
  if (!candidate || typeof candidate !== "object") throw new Error("Invalid promotion candidate.");
  healthUrl(candidate.url);
  if (candidate.archivePath) candidate.archivePath = resolve(dirname(path), candidate.archivePath);
  return candidate;
}
export function verifyArchive(candidate: Candidate): string {
  if (!candidate.archivePath || !DIGEST.test(candidate.archiveSha256 ?? "")) throw new Error("Candidate source archive is missing.");
  const digest = createHash("sha256").update(readFileSync(candidate.archivePath)).digest("hex");
  if (digest !== candidate.archiveSha256) throw new Error("Candidate source archive checksum does not match.");
  return candidate.archivePath;
}
function railwayEnv(staging: boolean): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (staging) {
    delete env.RAILWAY_TOKEN;
    if (process.env.RAILWAY_STAGING_TOKEN) env.RAILWAY_TOKEN = process.env.RAILWAY_STAGING_TOKEN;
  }
  if (env.RAILWAY_TOKEN) delete env.RAILWAY_API_TOKEN;
  return env;
}
function target(staging: boolean): string[] {
  return ["--project", process.env.RAILWAY_PROJECT_ID || PROJECT, "--service", process.env.RAILWAY_WEB_SERVICE_ID || SERVICE, "--environment", staging ? STAGING : PRODUCTION];
}
function deployments(staging: boolean): Deployment[] {
  const rows = JSON.parse(command(["railway", "deployment", "list", ...target(staging), "--limit", "20", "--json"], { env: railwayEnv(staging) })) as Deployment[];
  if (!Array.isArray(rows)) throw new Error("Unexpected Railway deployment list.");
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
async function probe(value: string): Promise<boolean> {
  const url = healthUrl(value);
  try { return (await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" })).ok; }
  catch { return false; }
}
async function liveReceipt(value: string): Promise<Partial<Candidate> | undefined> {
  const url = new URL("/staging-build.json", healthUrl(value));
  url.searchParams.set("t", String(Date.now()));
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    return response.ok ? await response.json() as Partial<Candidate> : undefined;
  } catch { return undefined; }
}
async function inspect(candidate: Candidate, directory: string, immediate = false, ignoreOwnLease = false) {
  const stored = readQueue(directory);
  const queue = ignoreOwnLease ? { ...stored, inflight: undefined } : stored;
  const local = promotionDecision({ queue, candidate, healthy: false, now: Date.now(), immediate });
  // Ineligible previews and completed/leased candidates need no credentials.
  if (queue.inflight || candidate.dirty !== false || candidate.promotionEligible !== true || queue.promoted[candidate.sha] || !SHA.test(candidate.sha) || !DIGEST.test(candidate.fingerprint) || !candidate.archivePath || !DIGEST.test(candidate.archiveSha256 ?? "")) return { candidate, queue: stored, ...local };
  const deployment = deployments(true)[0];
  const [live, healthy] = await Promise.all([liveReceipt(candidate.url), probe(new URL("/chat", candidate.url).href)]);
  return { candidate, queue: stored, deployment, live, healthy, ...promotionDecision({ queue, candidate, deployment, live, healthy, now: Date.now(), immediate }) };
}
function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

async function promote(candidate: Candidate, directory: string, immediate: boolean, rollback = false, requestId?: string): Promise<void> {
  if (!rollback) {
    const state = await inspect(candidate, directory, immediate);
    if (!state.ready) throw new Error(state.reason);
  }
  const archivePath = verifyArchive(candidate);
  const productionUrl = process.env.PRODUCTION_URL || "https://keating.help/";
  healthUrl(productionUrl);
  const temporary = mkdtempSync(join(tmpdir(), "keating-promotion-"));
  const operation = randomUUID();
  let leased = false;
  let uploadStarted = false;
  try {
    // Snapshot archives contain ordinary files/directories, never links or
    // traversal paths. Do not permit archive extraction outside this directory.
    const names = command(["tar", "-tzf", archivePath]).split("\n");
    if (names.some(path => path.startsWith("/") || path.split("/").includes(".."))) throw new Error("Unsafe path in candidate archive.");
    const listing = command(["tar", "-tvzf", archivePath]).split("\n");
    if (listing.some(line => line && !["-", "d"].includes(line[0]!))) throw new Error("Candidate archive contains a link or special file.");
    command(["tar", "-xzf", archivePath, "-C", temporary, "--no-same-owner"]);
    const embedded = JSON.parse(readFileSync(join(temporary, "web/public/staging-build.json"), "utf8")) as Partial<Candidate>;
    if (embedded.sha !== candidate.sha || embedded.fingerprint !== candidate.fingerprint || embedded.branch !== candidate.branch || embedded.dirty !== false || embedded.promotionEligible !== true) throw new Error("Source archive receipt does not match the clean candidate.");
    mutateQueue(directory, queue => {
      if (queue.inflight) throw new Error(`Promotion ${queue.inflight.operation} already holds the lease.`);
      if (!rollback && queue.promoted[candidate.sha]) throw new Error("This commit was concurrently promoted.");
      queue.inflight = { sha: candidate.sha, operation, startedAt: new Date().toISOString() };
      return true;
    });
    leased = true;
    if (!rollback) {
      const state = await inspect(candidate, directory, immediate, true);
      if (!state.ready || state.queue.inflight?.operation !== operation) throw new Error(state.reason);
    }
    uploadStarted = true;
    const output = command(["railway", "up", temporary, "--path-as-root", ...target(false), "--detach", "--json", "--message", `keating-promote:${candidate.sha}:${operation}`], { cwd: temporary, env: railwayEnv(false) });
    const upload = output.split("\n").map(line => { try { return JSON.parse(line) as { deploymentId?: string }; } catch { return undefined; } }).find(row => row?.deploymentId);
    if (!upload?.deploymentId) throw new Error("Railway upload returned no deployment ID.");
    console.log(`Waiting for production deployment ${upload.deploymentId}.`);
    const deadline = Date.now() + 30 * 60 * 1000;
    let succeeded: Deployment | undefined;
    while (Date.now() < deadline) {
      const rows = deployments(false);
      const uploaded = rows.find(deployment => deployment.id === upload.deploymentId);
      if (uploaded && ["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(uploaded.status)) throw new Error(`Production deployment ${uploaded.id} is ${uploaded.status}.`);
      if (uploaded?.status === "SUCCESS") {
        if (rows[0]?.id !== uploaded.id) throw new Error("Another deployment superseded this promotion.");
        const [healthy, live] = await Promise.all([probe(productionUrl), liveReceipt(productionUrl)]);
        if (healthy && live?.sha === candidate.sha && live.fingerprint === candidate.fingerprint && live.branch === candidate.branch && live.dirty === false && live.promotionEligible === true) { succeeded = uploaded; break; }
      }
      await Bun.sleep(15_000);
    }
    if (!succeeded) throw new Error("Timed out waiting for this production deployment and its health probe.");
    const retained = join(directory, "archives", `${candidate.sha}-${candidate.archiveSha256}.tar.gz`);
    mkdirSync(dirname(retained), { recursive: true, mode: 0o700 });
    if (resolve(archivePath) !== resolve(retained)) copyFileSync(archivePath, retained);
    mutateQueue(directory, queue => {
      if (queue.inflight?.operation !== operation) throw new Error("Promotion lease changed unexpectedly.");
      queue.promoted[candidate.sha] = { at: new Date().toISOString(), deploymentId: succeeded!.id, candidate: { ...candidate, archivePath: retained }, archivePath: retained };
      if (requestId) (queue.completedRequests ??= {})[requestId] = new Date().toISOString();
      delete queue.inflight;
      return true;
    });
    leased = false;
    console.log(`Promoted ${candidate.sha}; production deployment ${succeeded.id} is SUCCESS and healthy.`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    if (leased && !uploadStarted) mutateQueue(directory, queue => { if (queue.inflight?.operation !== operation) return false; delete queue.inflight; return true; });
    else if (leased) console.error(`Lease ${operation} retained. Inspect production before release-lease --operation ${operation}.`);
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const [action, ...flags] = args;
  const hosted = action === "run-hosted";
  const directory = resolve(process.env.KEATING_PROMOTION_STATE_DIR || (hosted ? "/data" : ".keating/promotion"));
  const candidatePath = resolve(option(flags, "--candidate") || process.env.KEATING_PROMOTION_CANDIDATE || (hosted ? "/candidate/candidate.json" : ".keating/promotion-candidate/candidate.json"));
  if (action === "release-lease") {
    const operation = option(flags, "--operation");
    if (!operation) throw new Error("Inspect production first, then release-lease --operation <exact ID>.");
    mutateQueue(directory, queue => { if (queue.inflight?.operation !== operation) throw new Error("Lease operation does not match."); delete queue.inflight; return true; });
    console.log("Promotion lease released.");
    return 0;
  }
  const rollbackSha = option(flags, "--sha");
  if (rollbackSha) {
    if (action !== "promote" || !flags.includes("--now") || !SHA.test(rollbackSha)) throw new Error("Rollback requires promote --now --sha <full previously promoted SHA>.");
    const previous = readQueue(directory).promoted[rollbackSha];
    if (!previous) throw new Error("Rollback requires a commit previously promoted successfully in this state directory.");
    await promote({ ...previous.candidate, archivePath: previous.archivePath }, directory, true, true);
    return 0;
  }
  const candidate = readCandidate(candidatePath);
  if (hosted && process.env.KEATING_PROMOTION_REQUEST) {
    const request = JSON.parse(process.env.KEATING_PROMOTION_REQUEST) as { id?: string; action?: string; sha?: string };
    if (!request.id || !/^[a-zA-Z0-9-]{8,100}$/.test(request.id) || !SHA.test(request.sha ?? "") || !["promote", "rollback"].includes(request.action ?? "")) throw new Error("Invalid KEATING_PROMOTION_REQUEST; use {id: unique ID, action: promote|rollback, sha: full SHA}.");
    const queue = readQueue(directory);
    if (!queue.completedRequests?.[request.id]) {
      if (request.action === "promote" && request.sha !== candidate.sha) throw new Error("Immediate promotion request does not match the active candidate.");
      if (request.action === "promote" && queue.promoted[request.sha!]) {
        mutateQueue(directory, latest => {
          if (latest.inflight) throw new Error(`Promotion ${latest.inflight.operation} is still unresolved.`);
          (latest.completedRequests ??= {})[request.id!] = new Date().toISOString();
          return true;
        });
        console.log("Requested commit was already promoted; request consumed without another upload.");
        return 0;
      }
      if (!process.env.RAILWAY_TOKEN || !process.env.RAILWAY_STAGING_TOKEN) throw new Error("Hosted promotion requests require both Railway environment tokens.");
      if (request.action === "rollback") {
        const previous = queue.promoted[request.sha!];
        if (!previous) throw new Error("Requested rollback SHA was not previously promoted successfully.");
        await promote({ ...previous.candidate, archivePath: previous.archivePath }, directory, true, true, request.id);
      } else {
        await promote(candidate, directory, true, false, request.id);
      }
      return 0;
    }
  }
  if (hosted && candidate.dirty === false && candidate.promotionEligible === true && (!process.env.RAILWAY_TOKEN || !process.env.RAILWAY_STAGING_TOKEN)) throw new Error("Hosted clean promotion requires RAILWAY_TOKEN scoped to production and RAILWAY_STAGING_TOKEN scoped to staging. Local commands may use saved Railway login.");
  if (action === "status" || action === "check" || hosted) {
    const state = await inspect(candidate, directory);
    if (hosted) {
      console.log(state.reason);
      if (state.ready) await promote(candidate, directory, false);
      return 0;
    }
    console.log(JSON.stringify(state, null, 2));
    return action === "check" && !state.ready ? 2 : 0;
  }
  if (action === "promote") { await promote(candidate, directory, flags.includes("--now")); return 0; }
  throw new Error("Usage: promote-staging.ts run-hosted | check | status | promote [--now] [--sha previous-sha] | release-lease --operation id; optional --candidate path");
}

if (import.meta.main) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
