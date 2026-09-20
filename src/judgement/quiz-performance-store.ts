/** Private raw quiz evidence. Only the completed durable action journal authorizes observations. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  canonicalUiAction, joinPerformanceObservation, objectiveCredit, quizItemSuccessQuestion,
  validateUiActionAgainstDocument, validateUiActionCorrelation, validateUiActionJournal, validateUiDocument,
  isSha256Hex,
  type PerformanceObservedOutcome, type PerformancePredictionReceipt, type UiAction, type UiDocument,
} from "../../packages/learner-contracts/src/index.js";
import { stateDir } from "../core/paths.js";
import { FileUiActionJournalStorage } from "../tui/ui/filesystem-journal.js";
import type { UiActionJournalStorage } from "../tui/ui/journal.js";
import { extractQuizBoostingFeatures, QUIZ_BOOSTING_TARGET, QUIZ_BOOSTING_FEATURE_SCHEMA } from "../../packages/learner-contracts/src/judgement/quiz-boosting-features.js";

/** A derived proxy, kept separate from the original model probability. */
export interface CliQuizFitProjection {
  source: "proxy";
  target: typeof QUIZ_BOOSTING_TARGET;
  featureSchema: typeof QUIZ_BOOSTING_FEATURE_SCHEMA;
  method: "shallow-tree" | "boosting";
  fitSha256: string;
  fileSha256: string;
  probability: number;
}

export interface CliQuizPredictionEnvelope {
  documentId: string;
  documentRevision: number;
  nodeId: string;
  sourceSha256: string;
  questionSha256: string;
  source: { document: UiDocument; history: unknown[]; asOf: number };
  prediction: PerformancePredictionReceipt;
  fitted?: CliQuizFitProjection;
}
export interface CliQuizPerformanceData {
  schemaVersion: 1;
  predictions: CliQuizPredictionEnvelope[];
  observations: Array<{ predictionId: string; outcome: PerformanceObservedOutcome; observed: 0 | 1 }>;
}
export interface CliQuizPreparedSubmission { attemptId: string; submittedAt: number; hints: string[]; predictionIds: string[] }
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 500;
const invalid = (): never => { throw new Error("quiz_performance_evidence_invalid"); };
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: unknown, expected: string[]): value is Record<string, unknown> => object(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256;

/** JSON-only canonical form; refuses lossy numbers, sparse arrays, cycles and non-data objects. */
export function cliQuizPerformanceCanonical(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (value: unknown, depth: number): string => {
    if (depth > 64) return invalid();
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : invalid();
    if (!object(value) && !Array.isArray(value)) return invalid();
    if (ancestors.has(value)) return invalid();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return `[${Array.from(value, child => encode(child, depth + 1)).join(",")}]`;
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return invalid();
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode(value[key], depth + 1)}`).join(",")}}`;
    } finally { ancestors.delete(value); }
  };
  return encode(value, 0);
}
export function cliQuizPerformanceDigest(value: unknown): string {
  return createHash("sha256").update(cliQuizPerformanceCanonical(value)).digest("hex");
}
const same = (a: unknown, b: unknown) => cliQuizPerformanceCanonical(a) === cliQuizPerformanceCanonical(b);
function quiz(document: UiDocument, nodeId: string) {
  const nodes = document.nodes.filter(node => node.id === nodeId);
  return nodes.length === 1 && nodes[0]?.type === "quiz" ? nodes[0] : null;
}
function predictionValid(row: CliQuizPredictionEnvelope, documentId: string, now: number): boolean {
  if (!keys(row, ["documentId", "documentRevision", "nodeId", "sourceSha256", "questionSha256", "source", "prediction", ...(row.fitted === undefined ? [] : ["fitted"])])
    || row.documentId !== documentId || !text(row.nodeId)
    || !keys(row.source, ["document", "history", "asOf"]) || !Array.isArray(row.source.history)
    || !validateUiDocument(row.source.document) || row.source.document.id !== documentId
    || row.source.document.revision !== row.documentRevision || row.source.document.lifecycle !== "ready"
    || !timestamp(row.source.asOf) || !object(row.prediction) || !timestamp(row.prediction.createdAt)
    || row.source.asOf > row.prediction.createdAt || row.prediction.createdAt > now) return false;
  const p = row.prediction;
  const node = quiz(row.source.document, row.nodeId);
  const items = node?.questions.filter(item => item.id === p.itemId);
  if (items?.length !== 1 || row.sourceSha256 !== cliQuizPerformanceDigest(row.source)
    || row.questionSha256 !== cliQuizPerformanceDigest(p.question) || p.itemSha256 !== cliQuizPerformanceDigest(items[0])
    || !same(p.question, quizItemSuccessQuestion(p.itemId)) || /fixture/iu.test(p.backend?.model ?? "")) return false;
  if (row.fitted !== undefined) {
    const f = row.fitted;
    if (!keys(f, ["source", "target", "featureSchema", "method", "fitSha256", "fileSha256", "probability"])
      || f.source !== "proxy" || f.target !== QUIZ_BOOSTING_TARGET || f.featureSchema !== QUIZ_BOOSTING_FEATURE_SCHEMA
      || !["shallow-tree", "boosting"].includes(f.method) || !isSha256Hex(f.fitSha256) || !isSha256Hex(f.fileSha256)
      || typeof f.probability !== "number" || !Number.isFinite(f.probability) || f.probability < 0 || f.probability > 1
      || !extractQuizBoostingFeatures(items[0]!, p.probability)) return false;
  }
  const checked = joinPerformanceObservation(p, { predictionId: p.id, attemptId: p.attemptId, itemId: p.itemId,
    itemSha256: p.itemSha256, submittedAt: p.createdAt + 1, correct: false, hintUsed: false, grading: "deterministic", sourceId: "validation-only" });
  return checked.status === "accepted";
}
function validateData(value: unknown, documentId: string, now: number): CliQuizPerformanceData {
  if (!keys(value, ["schemaVersion", "predictions", "observations"]) || value.schemaVersion !== 1
    || !Array.isArray(value.predictions) || !Array.isArray(value.observations)
    || value.predictions.length > MAX_ROWS || value.observations.length > MAX_ROWS) return invalid();
  const data = value as unknown as CliQuizPerformanceData;
  const ids = new Set<string>(); const items = new Set<string>(); const attempts = new Map<string, CliQuizPredictionEnvelope>();
  for (const row of data.predictions) {
    if (!predictionValid(row, documentId, now) || ids.has(row.prediction.id)) return invalid();
    const item = `${row.prediction.attemptId}:${row.prediction.itemId}`;
    const prior = attempts.get(row.prediction.attemptId);
    if (items.has(item) || (prior && (prior.sourceSha256 !== row.sourceSha256 || prior.nodeId !== row.nodeId
      || prior.prediction.createdAt !== row.prediction.createdAt || !same(prior.prediction.backend, row.prediction.backend)))) return invalid();
    ids.add(row.prediction.id); items.add(item); attempts.set(row.prediction.attemptId, row);
  }
  const observed = new Set<string>(); const sources = new Set<string>();
  for (const observation of data.observations) {
    if (!keys(observation, ["predictionId", "outcome", "observed"]) || observed.has(observation.predictionId)) return invalid();
    const prediction = data.predictions.find(row => row.prediction.id === observation.predictionId)?.prediction;
    const linked = joinPerformanceObservation(prediction, observation.outcome);
    if (linked.status !== "accepted" || linked.outcome.grading !== "deterministic" || linked.observed !== observation.observed
      || linked.outcome.submittedAt > now || sources.has(linked.outcome.sourceId)) return invalid();
    observed.add(observation.predictionId); sources.add(linked.outcome.sourceId);
  }
  return data;
}
function assertOwned(metadata: { uid: number; nlink?: number }): void {
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) throw new Error("quiz_performance_storage_owner_mismatch");
  if (metadata.nlink !== undefined && metadata.nlink !== 1) throw new Error("quiz_performance_storage_not_private");
}

export class CliQuizPerformanceStore {
  private readonly directory: string;
  private readonly cwd: string;
  constructor(cwd: string, private readonly journal: UiActionJournalStorage = new FileUiActionJournalStorage(cwd),
    private readonly now: () => number = Date.now) {
    this.cwd = resolve(cwd); this.directory = join(stateDir(this.cwd), "quiz-performance");
  }
  private path(documentId: string) { return join(this.directory, `${cliQuizPerformanceDigest(documentId)}.json`); }
  private async ensureDirectory(): Promise<void> {
    const parts = relative(this.cwd, this.directory).split(sep);
    if (parts.some(part => !part || part === "..")) throw new Error("quiz_performance_storage_path_invalid");
    let path = this.cwd;
    for (const part of parts) {
      path = join(path, part);
      await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("quiz_performance_storage_path_invalid");
      assertOwned({ uid: metadata.uid });
    }
    if (process.platform !== "win32") await chmod(this.directory, 0o700);
  }
  private async locked<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    if (!text(documentId) || !this.journal.withDocumentLock) throw new Error("quiz_performance_document_lock_required");
    await this.ensureDirectory();
    return this.journal.withDocumentLock(documentId, operation);
  }
  private async load(documentId: string): Promise<CliQuizPerformanceData> {
    const path = this.path(documentId);
    let handle;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("quiz_performance_storage_path_invalid");
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, predictions: [], observations: [] };
      throw error;
    }
    try {
      const metadata = await handle.stat(); assertOwned(metadata);
      if (!metadata.isFile() || metadata.size > MAX_BYTES) throw new Error("quiz_performance_storage_limit");
      if (process.platform !== "win32") await handle.chmod(0o600);
      const raw = await handle.readFile("utf8");
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error("quiz_performance_storage_limit");
      return validateData(JSON.parse(raw), documentId, this.now());
    } finally { await handle.close(); }
  }
  private async write(documentId: string, data: CliQuizPerformanceData): Promise<void> {
    validateData(data, documentId, this.now());
    const payload = cliQuizPerformanceCanonical(data);
    if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error("quiz_performance_storage_limit");
    const target = this.path(documentId);
    const metadata = await lstat(target).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (metadata) {
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("quiz_performance_storage_path_invalid");
      assertOwned(metadata);
    }
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(payload, "utf8"); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, target);
      const directory = await open(this.directory, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  async read(documentId: string): Promise<CliQuizPerformanceData> { return this.locked(documentId, () => this.load(documentId)); }
  async savePredictions(rows: CliQuizPredictionEnvelope[]): Promise<void> {
    if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return invalid();
    const incoming = JSON.parse(cliQuizPerformanceCanonical(rows)) as CliQuizPredictionEnvelope[];
    const documentId = incoming[0]!.documentId;
    await this.locked(documentId, async () => {
      const data = await this.load(documentId);
      const journal = await this.journal.load(documentId);
      if (journal && (!validateUiActionJournal(journal) || journal.documentId !== documentId)) return invalid();
      for (const row of incoming) {
        if (!predictionValid(row, documentId, this.now())) return invalid();
        const prior = data.predictions.find(saved => saved.prediction.id === row.prediction.id);
        if (prior) { if (!same(prior, row)) return invalid(); continue; }
        // Any started completion means a fresh estimate can no longer be pre-answer for this source.
        if (journal?.receipts.some(receipt => receipt.action.type === "complete-quiz" && receipt.action.nodeId === row.nodeId
          && receipt.action.documentRevision === row.documentRevision)) throw new Error("quiz_performance_attempt_already_started");
        data.predictions.push(row);
      }
      await this.write(documentId, data);
    });
  }
  /** Call after dispatch has returned and released the same journal's document lock. */
  async linkCommitted(action: UiAction, document: UiDocument, prepared: CliQuizPreparedSubmission): Promise<number> {
    const snapshot = JSON.parse(cliQuizPerformanceCanonical({ action, document, prepared })) as { action: UiAction; document: UiDocument; prepared: CliQuizPreparedSubmission };
    ({ action, document, prepared } = snapshot);
    if (action.type !== "complete-quiz" || !validateUiActionAgainstDocument(action, document)
      || !keys(prepared, ["attemptId", "submittedAt", "hints", "predictionIds"]) || !text(prepared.attemptId)
      || !timestamp(prepared.submittedAt) || prepared.submittedAt > this.now()
      || !Array.isArray(prepared.hints) || !Array.isArray(prepared.predictionIds) || !prepared.predictionIds.length
      || prepared.predictionIds.length > MAX_ROWS || !prepared.predictionIds.every(text)
      || new Set(prepared.predictionIds).size !== prepared.predictionIds.length || new Set(prepared.hints).size !== prepared.hints.length) return 0;
    const completion = action;
    const node = quiz(document, completion.nodeId);
    if (!node || !prepared.hints.every(id => typeof id === "string" && node.questions.some(item => item.id === id))) return 0;
    return this.locked(completion.documentId, async () => {
      const journal = await this.journal.load(completion.documentId);
      if (!journal || !validateUiActionJournal(journal) || journal.documentId !== completion.documentId) return 0;
      const receipt = journal.receipts.find(row => row.action.idempotencyKey === completion.idempotencyKey);
      if (!receipt || receipt.state !== "completed" || !receipt.result || receipt.result.status !== "completed"
        || receipt.actionFingerprint !== canonicalUiAction(completion) || !same(receipt.action, completion)
        || !validateUiActionCorrelation(completion, receipt.result, document)
        || Date.parse(receipt.createdAt) < prepared.submittedAt || Date.parse(receipt.updatedAt) < Date.parse(receipt.createdAt)
        || Date.parse(receipt.updatedAt) > this.now()) return 0;
      const data = await this.load(completion.documentId);
      const rows = prepared.predictionIds.map(id => data.predictions.find(row => row.prediction.id === id));
      if (rows.some(row => !row || row.prediction.attemptId !== prepared.attemptId || row.nodeId !== completion.nodeId
        || row.documentRevision !== document.revision || !same(row.source.document, document)
        || row.prediction.createdAt >= prepared.submittedAt)) return 0;
      const sourceId = cliQuizPerformanceDigest(completion);
      let count = 0;
      for (const row of rows as CliQuizPredictionEnvelope[]) {
        const p = row.prediction;
        if (data.observations.some(existing => existing.predictionId === p.id || existing.outcome.sourceId === `${sourceId}:${p.itemId}`)) continue;
        const item = node.questions.find(item => item.id === p.itemId)!;
        const answer = completion.answers.find(answer => answer.questionId === p.itemId)?.answer;
        if (!answer?.trim() || completion.skippedQuestionIds.includes(p.itemId) || completion.pendingGradeQuestionIds.includes(p.itemId)) continue;
        const credit = objectiveCredit(item, answer);
        if (credit === undefined || !Number.isFinite(credit)) continue;
        const outcome: PerformanceObservedOutcome = { predictionId: p.id, attemptId: p.attemptId, itemId: p.itemId,
          itemSha256: p.itemSha256, submittedAt: prepared.submittedAt, correct: credit === 1,
          hintUsed: prepared.hints.includes(p.itemId), grading: "deterministic", sourceId: `${sourceId}:${p.itemId}` };
        const linked = joinPerformanceObservation(p, outcome);
        if (linked.status !== "accepted") continue;
        data.observations.push({ predictionId: p.id, outcome: linked.outcome, observed: linked.observed }); count++;
      }
      if (count) await this.write(completion.documentId, data);
      return count;
    });
  }
}
