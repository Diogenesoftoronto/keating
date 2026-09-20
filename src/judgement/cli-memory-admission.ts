/** Optional background admission of exact Needle quotes; never part of the reply's critical path. */
import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { reviewMemoryCandidates, type MemoryAdmissionCandidate } from "../../packages/learner-contracts/src/judgement/memory-admission.js";
import type { CalibrationTable } from "../../packages/learner-contracts/src/judgement/projections.js";
import type { JudgementCaller } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { admitJudgedLearnerMemory, learnerMemoryDigest, loadLearnerMemory, type LearnerMemorySession } from "../core/learner-memory.js";
import { configDir, learnerMemoryPath, stateDir } from "../core/paths.js";
import type { NeedleMemoryResult } from "../retrieval/needle-memory.js";
import { loadNeedleConfig, needleModelIdentity } from "../retrieval/needle-runtime.js";
import { loadJudgementCalibrationArtifact } from "./calibration-artifact.js";
import { loadNotOrganicJudgementCredential, notOrganicJudgementEndpoint } from "./notorganic.js";
import { createCliJudgementBackend, JUDGEMENT_CALIBRATION_ENV, JUDGEMENT_MODEL_ENV, type CliJudgementOptions } from "./transport.js";

export const MEMORY_JUDGE_ENV = "KEATING_MEMORY_JUDGE";
export const MEMORY_CALIBRATION_FILE_ENV = "KEATING_MEMORY_CALIBRATION_FILE";
export const MEMORY_CALIBRATION_SHA256_ENV = "KEATING_MEMORY_CALIBRATION_FILE_SHA256";
const ENV_KEYS = [MEMORY_JUDGE_ENV, MEMORY_CALIBRATION_FILE_ENV, MEMORY_CALIBRATION_SHA256_ENV, JUDGEMENT_MODEL_ENV, JUDGEMENT_CALIBRATION_ENV] as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fileStamp(path: string): string {
  const value = lstatSync(path, { bigint: true });
  if (!value.isFile() || value.isSymbolicLink()) throw new Error("configuration-unavailable");
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");
}
export interface CliMemoryAdmissionStatus {
  phase: "idle" | "off" | "running" | "reviewed" | "saved" | "cancelled" | "unavailable";
  reason?: string; savedCount?: number; receiptPath?: string;
}
export interface CliMemoryAdmissionOptions {
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number; timeoutMs?: number;
  transport?: Pick<CliJudgementOptions, "fetch" | "loadCredential" | "retry" | "sleep">;
  /** Test boundaries; the production extension supplies only cwd. */
  calibration?: CalibrationTable;
  runtime?: () => { call: JudgementCaller; current: () => boolean } | null;
  needleCurrent?: (model: string) => Promise<boolean>;
}

function sessionSource(session: LearnerMemorySession) {
  const id = session.getSessionId();
  if (typeof id !== "string" || !id || id.length > 200) throw new Error("source-invalid");
  const messages = (session.getBranch() as readonly { type?: string; id?: unknown; message?: { role?: string; content?: unknown } }[])
    .filter(entry => entry.type === "message" && entry.message?.role === "user").slice(-64).map(entry => {
      const content = entry.message!.content;
      const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("\n") : "";
      if (typeof entry.id !== "string" || !entry.id || entry.id.length > 200 || text.length > 1_000_000) throw new Error("source-invalid");
      return { id: entry.id, text };
    });
  if (new Set(messages.map(message => message.id)).size !== messages.length) throw new Error("source-invalid");
  return { id, messages };
}

async function writeReceipt(cwd: string, directory: string, id: string, receipt: unknown, current: () => boolean): Promise<string> {
  const parts = relative(cwd, directory).split(sep);
  if (parts.some(part => !part || part === "..")) throw new Error("receipt-path-invalid");
  let parent = cwd;
  for (const part of parts) {
    parent = join(parent, part);
    const created = await mkdir(parent, { mode: 0o700 }).then(() => true).catch(error => { if (error.code !== "EEXIST") throw error; return false; });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error("receipt-path-invalid");
    if (created) {
      const ancestor = await open(dirname(parent), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { await ancestor.sync(); } finally { await ancestor.close(); }
    }
  }
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(text) > 200_000 || !current()) throw new Error("receipt-invalid");
  const path = join(directory, `${id}.json`), temporary = join(directory, `.${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await handle.writeFile(text); await handle.sync(); await handle.close();
    if (!current()) throw new Error("source-changed");
    await rename(temporary, path);
    const parentHandle = await open(directory, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { await parentHandle.sync(); } finally { await parentHandle.close(); }
  } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  return path;
}

export function createCliMemoryAdmissionController(workspace: string, options: CliMemoryAdmissionOptions = {}) {
  const cwd = resolve(workspace), now = options.now ?? Date.now;
  let generation = 0, disposed = false;
  let controller: AbortController | undefined;
  let pending: Promise<void> = Promise.resolve();
  let status: CliMemoryAdmissionStatus = { phase: "idle" };
  // An uncooperative underlying request keeps its lease even when the review times out.
  const calls = new Set<Promise<unknown>>();
  const env = options.env ?? process.env;
  const configuration = () => JSON.stringify(ENV_KEYS.map(key => [key, env[key] ?? null]));
  const reset = () => { generation++; controller?.abort(); controller = undefined; status = { phase: "cancelled" }; };

  async function run(result: NeedleMemoryResult, session: LearnerMemorySession, epoch: number, abort: AbortController): Promise<void> {
    const memoryPath = learnerMemoryPath(cwd), directory = join(stateDir(cwd), "memory-admission-reviews");
    const config = configuration();
    const source = sessionSource(session), sourceIdentity = hash(JSON.stringify(source));
    const basicCurrent = () => !disposed && generation === epoch && !abort.signal.aborted && configuration() === config
      && learnerMemoryPath(cwd) === memoryPath && join(stateDir(cwd), "memory-admission-reviews") === directory
      && hash(JSON.stringify(sessionSource(session))) === sourceIdentity;
    let backendCurrent: () => boolean = () => false;
    let calibrationCurrent: () => boolean = () => true;
    let needleUnchanged: () => boolean = () => true;
    const current = () => { try { return basicCurrent() && backendCurrent() && calibrationCurrent() && needleUnchanged(); } catch { return false; } };
    const timer = setTimeout(() => abort.abort(), Math.min(120_000, Math.max(1, options.timeoutMs ?? 30_000)));
    try {
      if (!basicCurrent()) return;
      const candidates: MemoryAdmissionCandidate[] = [];
      for (const proposal of result.proposals.slice(0, 4)) {
        const p = proposal.provenance;
        const message = source.messages.find(message => message.id === p.messageId);
        if (p.sessionId !== source.id || !message || message.text.length > 4000 || hash(proposal.evidence) !== proposal.quoteSha256
          || !Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end) || p.start < 0
          || p.end - p.start !== proposal.evidence.length || message.text.slice(p.start, p.end) !== proposal.evidence
          || proposal.evidence.length < 3 || proposal.evidence.length > 240) continue;
        const id = hash(JSON.stringify([source.id, p.messageId, p.start, p.end, proposal.quoteSha256]));
        if (!candidates.some(candidate => candidate.id === id)) candidates.push({ id, evidence: proposal.evidence,
          sessionId: source.id, messageId: p.messageId, start: p.start, end: p.end, message: message.text });
      }
      if (!candidates.length) { status = { phase: "unavailable", reason: "no-grounded-candidates" }; return; }
      const needlePath = join(configDir(cwd), "needle-runtime.json");
      let needleStamp: string | undefined;
      const needleCurrent = options.needleCurrent ?? (async (model: string) => {
        needleStamp ??= fileStamp(needlePath);
        needleUnchanged = () => join(configDir(cwd), "needle-runtime.json") === needlePath && fileStamp(needlePath) === needleStamp;
        const config = await loadNeedleConfig(cwd); return needleUnchanged() && !!config && needleModelIdentity(config) === model;
      });
      if (!await needleCurrent(result.model) || !basicCurrent()) return;
      const memory = await loadLearnerMemory(cwd);
      const expectedMemorySha256 = learnerMemoryDigest(memory);
      let calibration = options.calibration ? structuredClone(options.calibration) : undefined;
      let calibrationPin: string | null = null;
      const file = env[MEMORY_CALIBRATION_FILE_ENV], pin = env[MEMORY_CALIBRATION_SHA256_ENV];
      if (file !== undefined || pin !== undefined) {
        if (!file?.trim() || !pin) throw new Error("calibration-unavailable");
        const path = resolve(cwd, file);
        const before = fileStamp(path);
        const loaded = await loadJudgementCalibrationArtifact(path, pin);
        calibrationCurrent = () => fileStamp(path) === before;
        if (!calibrationCurrent()) throw new Error("calibration-changed");
        calibration = loaded.table; calibrationPin = loaded.sha256;
      }
      let backend = options.runtime?.();
      if (!options.runtime) {
        const load = options.transport?.loadCredential ?? loadNotOrganicJudgementCredential;
        const credential = load(cwd);
        if (!credential || !notOrganicJudgementEndpoint(credential, now())) throw new Error("judgement-unavailable");
        const identity = JSON.stringify(credential);
        const accountBackend = createCliJudgementBackend({ ...options.transport, cwd, credential, now,
          env: { [JUDGEMENT_MODEL_ENV]: env[JUDGEMENT_MODEL_ENV], [JUDGEMENT_CALIBRATION_ENV]: env[JUDGEMENT_CALIBRATION_ENV] } });
        backend = accountBackend && { call: accountBackend.call, current: () => {
          const credential = load(cwd);
          return !!credential && JSON.stringify(credential) === identity && !!notOrganicJudgementEndpoint(credential, now());
        } };
      }
      if (!backend) throw new Error("judgement-unavailable");
      backendCurrent = backend.current;
      if (!current()) return;
      const call: JudgementCaller = (request, signal) => {
        const requestPromise = Promise.resolve().then(() => {
          if (!current()) throw new Error("source-changed");
          return backend!.call(request, signal);
        });
        calls.add(requestPromise);
        void requestPromise.finally(() => calls.delete(requestPromise)).catch(() => {});
        return requestPromise;
      };
      const decisions = await reviewMemoryCandidates(candidates, call, calibration, abort.signal);
      if (!current() || !await needleCurrent(result.model) || !current()) return;
      if (file && pin && (await loadJudgementCalibrationArtifact(resolve(cwd, file), pin)).sha256 !== calibrationPin) return;
      const id = randomUUID();
      const receipt = { schemaVersion: 1, source: "proxy", id, createdAt: now(), sourceSha256: sourceIdentity,
        memorySha256: expectedMemorySha256, needleModel: result.model, calibrationFileSha256: calibrationPin, decisions };
      const receiptPath = await writeReceipt(cwd, directory, id, receipt, current);
      if (!current()) return;
      const admitted = calibration ? await admitJudgedLearnerMemory(cwd, decisions, session,
        { calibration, expectedMemorySha256, isCurrent: current, now }) : { saved: [], evictedIds: [], skipped: decisions.length };
      if (!current()) return;
      status = { phase: admitted.saved.length ? "saved" : "reviewed", savedCount: admitted.saved.length, receiptPath };
      // The earlier review receipt already exists if this outcome annotation fails.
      await writeReceipt(cwd, directory, id, { ...receipt, outcome: { savedIds: admitted.saved.map(fact => fact.id), evictedIds: admitted.evictedIds, skipped: admitted.skipped } }, current)
        .catch(() => {});
    } catch {
      if (generation === epoch && !disposed) status = { phase: abort.signal.aborted ? "cancelled" : "unavailable", reason: abort.signal.aborted ? "cancelled" : "review-unavailable" };
    } finally {
      clearTimeout(timer);
      if (generation === epoch && status.phase === "running") status = { phase: "cancelled", reason: "source-changed" };
    }
  }
  return {
    enqueue(result: NeedleMemoryResult, session: LearnerMemorySession): void {
      if (disposed) return;
      reset();
      if (env[MEMORY_JUDGE_ENV] !== "notorganic") { status = { phase: "off" }; return; }
      if (calls.size) { status = { phase: "unavailable", reason: "review-busy" }; return; }
      controller = new AbortController(); status = { phase: "running" };
      const epoch = generation, abort = controller;
      // Attach rejection handling immediately; a background error cannot become an unhandled reply failure.
      pending = run(structuredClone(result), session, epoch, abort).catch(() => {
        if (generation === epoch && !disposed) status = { phase: "unavailable", reason: "source-invalid" };
      });
    },
    reset,
    dispose() { reset(); disposed = true; },
    status(): Readonly<CliMemoryAdmissionStatus> { return { ...status }; },
    settled(): Promise<void> { return pending; },
  };
}
