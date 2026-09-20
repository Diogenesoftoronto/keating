/** Completed terminal practice history; never a no-hint calibration label. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { canonicalUiAction, objectiveCredit, validateUiActionAgainstDocument, validateUiActionCorrelation,
  validateUiDocument, type UiAction, type UiDocument } from "../../packages/learner-contracts/src/index.js";
import { stateDir } from "../core/paths.js";
import { resolveTopic } from "../core/topics.js";
import { FileUiActionJournalStorage } from "../tui/ui/filesystem-journal.js";
import { cliQuizPerformanceCanonical as canonical, cliQuizPerformanceDigest as digest } from "./quiz-performance-store.js";

export interface CliCommittedQuizHistoryRow {
  id: string; assessedAt: number; question: string; answer: string; correct: boolean; source: string;
}
interface Evidence {
  action: Extract<UiAction, { type: "complete-quiz" }>; sourceDocument: UiDocument;
  sourceSha256: string; actionSha256: string; createdAt: string; updatedAt: string;
}
interface HistoryFile { schemaVersion: 1; documentId: string; records: Evidence[] }
const MAX_BYTES = 2 * 1024 * 1024;
const fail = (): never => { throw new Error("quiz_history_invalid"); };
function owned(stat: { uid: number; nlink?: number }) {
  if ((process.getuid && stat.uid !== process.getuid()) || (stat.nlink !== undefined && stat.nlink !== 1)) fail();
}
function valid(record: Evidence, documentId: string): boolean {
  return !!record && record.action?.type === "complete-quiz" && validateUiDocument(record.sourceDocument)
    && record.sourceDocument.id === documentId && record.sourceDocument.lifecycle === "ready"
    && validateUiActionAgainstDocument(record.action, record.sourceDocument)
    && record.sourceSha256 === digest(record.sourceDocument) && record.actionSha256 === digest(record.action)
    && Number.isFinite(Date.parse(record.createdAt)) && Number.isFinite(Date.parse(record.updatedAt))
    && Date.parse(record.createdAt) <= Date.parse(record.updatedAt);
}
function rows(record: Evidence): CliCommittedQuizHistoryRow[] {
  const node = record.sourceDocument.nodes.find(node => node.id === record.action.nodeId);
  if (node?.type !== "quiz") return [];
  return record.action.answers.flatMap(answer => {
    const question = node.questions.find(question => question.id === answer.questionId);
    if (!question || question.mathProblem || !answer.answer.trim()
      || record.action.pendingGradeQuestionIds.includes(question.id) || record.action.skippedQuestionIds.includes(question.id)) return [];
    if (!question.kind || !["choice", "multiple_choice", "multi_select", "true_false", "dropdown"].includes(question.kind)
      || !question.choices?.length || (question.multiSelect && question.kind !== "multi_select")) return [];
    const expected = question.kind === "multi_select" ? question.correctAnswers ?? [] : [question.correctAnswer ?? question.correctAnswers?.[0] ?? ""];
    if (!expected.length || !expected.every(answer => question.choices!.some(choice => choice.id === answer))
      || objectiveCredit(question, expected.join(",")) !== 1) return [];
    const credit = objectiveCredit(question, answer.answer);
    if (credit !== 0 && credit !== 1) return [];
    return [{ id: `${record.actionSha256}:${question.id}`, assessedAt: Date.parse(record.updatedAt),
      question: question.prompt.slice(0, 2000), answer: answer.answer.slice(0, 2000), correct: credit === 1,
      source: "completed-tui-objective-history; hints and outside help unknown; excerpts limited to 2000 characters" }];
  });
}
class Files {
  readonly cwd: string;
  readonly directory: string;
  readonly journal: FileUiActionJournalStorage;
  constructor(cwd: string) {
    this.cwd = resolve(cwd); this.directory = join(stateDir(this.cwd), "tui-quiz-history");
    this.journal = new FileUiActionJournalStorage(this.cwd);
  }
  current() { if (join(stateDir(this.cwd), "tui-quiz-history") !== this.directory) fail(); }
  async ensure(create: boolean): Promise<boolean> {
    const parts = relative(this.cwd, this.directory).split(sep);
    if (parts.some(part => !part || part === "..")) return fail();
    let path = this.cwd;
    for (const part of parts) {
      path = join(path, part);
      if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
      const stat = await lstat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (!stat) return false;
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
      owned({ uid: stat.uid });
    }
    if (create && process.platform !== "win32") await chmod(this.directory, 0o700);
    return true;
  }
  path(id: string) { return join(this.directory, `${digest(id)}.json`); }
  async read(path: string): Promise<HistoryFile | undefined> {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(error => {
      if (error.code === "ENOENT") return undefined; throw error;
    });
    if (!handle) return undefined;
    try {
      const stat = await handle.stat(); owned(stat);
      if (!stat.isFile() || stat.size > MAX_BYTES) fail();
      const raw = await handle.readFile("utf8"); if (Buffer.byteLength(raw) > MAX_BYTES) fail();
      const file = JSON.parse(raw) as HistoryFile;
      if (!file || file.schemaVersion !== 1 || typeof file.documentId !== "string" || this.path(file.documentId) !== path
        || !Array.isArray(file.records) || file.records.length > 500
        || file.records.some(record => !valid(record, file.documentId))
        || new Set(file.records.map(record => record.actionSha256)).size !== file.records.length) fail();
      return file;
    } finally { await handle.close(); }
  }
  async committed(record: Evidence): Promise<boolean> {
    const journal = await this.journal.load(record.action.documentId);
    const receipt = journal?.receipts.find(receipt => receipt.action.idempotencyKey === record.action.idempotencyKey);
    return !!receipt && receipt.state === "completed" && receipt.result?.status === "completed"
      && receipt.actionFingerprint === canonicalUiAction(record.action) && canonicalUiAction(receipt.action) === canonicalUiAction(record.action)
      && receipt.createdAt === record.createdAt && receipt.updatedAt === record.updatedAt
      && validateUiActionCorrelation(record.action, receipt.result, record.sourceDocument);
  }
  async write(file: HistoryFile) {
    const payload = canonical(file); if (Buffer.byteLength(payload) > MAX_BYTES || file.records.length > 500) fail();
    this.current();
    const temporary = join(this.directory, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      await handle.writeFile(payload); await handle.sync(); await handle.close(); this.current();
      await rename(temporary, this.path(file.documentId));
      const directory = await open(this.directory, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
}

/** Call after dispatch releases its lock, whether or not an estimate was requested. */
export async function saveCommittedTuiQuizHistory(cwd: string, action: UiAction, sourceDocument: UiDocument): Promise<number> {
  if (action.type !== "complete-quiz" || !validateUiDocument(sourceDocument)
    || sourceDocument.lifecycle !== "ready" || !validateUiActionAgainstDocument(action, sourceDocument)) return 0;
  const files = new Files(cwd);
  const source = structuredClone(sourceDocument); const input = structuredClone(action);
  await files.ensure(true);
  return files.journal.withDocumentLock(input.documentId, async () => {
    files.current();
    const journal = await files.journal.load(input.documentId);
    const receipt = journal?.receipts.find(receipt => receipt.action.idempotencyKey === input.idempotencyKey);
    if (!receipt) return 0;
    const record: Evidence = { action: input, sourceDocument: source, sourceSha256: digest(source), actionSha256: digest(input),
      createdAt: receipt.createdAt, updatedAt: receipt.updatedAt };
    if (!valid(record, input.documentId) || Date.parse(record.updatedAt) > Date.now() || !await files.committed(record)) return 0;
    const count = rows(record).length; if (!count) return 0;
    const file = await files.read(files.path(input.documentId)) ?? { schemaVersion: 1, documentId: input.documentId, records: [] };
    const prior = file.records.find(prior => prior.actionSha256 === record.actionSha256);
    if (prior) { if (canonical(prior) !== canonical(record)) fail(); return 0; }
    file.records.push(record); await files.write(file); return count;
  });
}

/** Prior completed practice only. Original commit time is never refreshed on replay. */
export async function loadCommittedTuiQuizHistory(cwd: string, title: string, asOf: number): Promise<CliCommittedQuizHistoryRow[]> {
  if (!Number.isSafeInteger(asOf) || asOf < 0) return fail();
  const files = new Files(cwd); if (!await files.ensure(false)) return [];
  const names = (await readdir(files.directory)).filter(name => /^[a-f0-9]{64}\.json$/u.test(name));
  if (names.length > 1000) fail();
  const selected: CliCommittedQuizHistoryRow[] = []; const topic = resolveTopic(title).slug;
  let bytes = 0;
  for (const name of names) {
    const path = join(files.directory, name); const stat = await lstat(path);
    bytes += stat.size; if (bytes > 8 * MAX_BYTES) fail();
    const initial = await files.read(path); if (!initial) continue;
    await files.journal.withDocumentLock(initial.documentId, async () => {
      files.current(); const file = await files.read(path); if (!file) return;
      for (const record of file.records) {
        const assessedAt = Date.parse(record.updatedAt);
        if (assessedAt >= asOf || assessedAt < asOf - 90 * 86_400_000) continue;
        const node = record.sourceDocument.nodes.find(node => node.id === record.action.nodeId);
        if (node?.type !== "quiz" || resolveTopic(node.title).slug !== topic) continue;
        if (!await files.committed(record)) fail();
        selected.push(...rows(record));
      }
    });
  }
  files.current();
  return selected.sort((a, b) => b.assessedAt - a.assessedAt || a.id.localeCompare(b.id)).slice(0, 12);
}
