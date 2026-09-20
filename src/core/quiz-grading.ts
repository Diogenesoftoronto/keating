/** Durable CLI quiz submissions, independent proxy proposals, and immutable explicit reviews. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Quiz } from "./quiz.js";
import type { CliGradingReceipt } from "../judgement/cli-grading.js";
import { stateDir } from "./paths.js";

export interface CliQuizSubmission {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly quiz: Omit<Quiz, "answerKey"> & { answerKey: Record<string, string> };
  readonly answers: Readonly<Record<string, string>>;
  readonly objectiveResults: Readonly<Record<string, boolean>>;
  readonly pendingMathIds: readonly string[];
}
export interface CliQuizFinalReview {
  readonly schemaVersion: 1;
  readonly reviewedAt: string;
  readonly source: "explicit-review";
  readonly grades: Readonly<Record<string, { verdict: "correct" | "incorrect" | "partial"; note?: string }>>;
  readonly score: { correct: number; total: number };
}
export function cliQuizRecordPath(cwd: string, id: string): string {
  if (!/^quiz-[a-z0-9-]{8,90}$/.test(id)) throw new Error("invalid_quiz_result_id");
  return join(stateDir(cwd), "quiz-submissions", `${id}.json`);
}
async function writeOnce(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}
export async function saveCliQuizSubmission(cwd: string, input: {
  id: string; quiz: Quiz; answers: Readonly<Record<string, string>>;
  objectiveResults: Readonly<Record<string, boolean>>; pendingMathIds: readonly string[];
}): Promise<string> {
  const path = cliQuizRecordPath(cwd, input.id);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const submission: CliQuizSubmission = { schemaVersion: 1, id: input.id, createdAt: new Date().toISOString(),
    quiz: { ...input.quiz, answerKey: Object.fromEntries(input.quiz.answerKey) }, answers: { ...input.answers },
    objectiveResults: { ...input.objectiveResults }, pendingMathIds: [...input.pendingMathIds] };
  await writeOnce(path, submission);
  return path;
}
export async function saveCliQuizProposal(cwd: string, id: string, receipt: CliGradingReceipt): Promise<void> {
  await writeOnce(`${cliQuizRecordPath(cwd, id)}.proposal.json`, receipt);
}
export async function loadCliQuizRecord(cwd: string, id: string): Promise<{
  submission: CliQuizSubmission; proposal: CliGradingReceipt | null; review: CliQuizFinalReview | null;
} | null> {
  const path = cliQuizRecordPath(cwd, id);
  async function read<T>(file: string): Promise<T | null> {
    try { return JSON.parse(await readFile(file, "utf8")) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("quiz_record_unreadable"); }
  }
  const submission = await read<CliQuizSubmission>(path);
  if (!submission) return null;
  if (submission.schemaVersion !== 1 || submission.id !== id || !submission.quiz || !Array.isArray(submission.quiz.questions)
    || !submission.answers || !submission.objectiveResults) throw new Error("quiz_record_invalid");
  return { submission, proposal: await read<CliGradingReceipt>(`${path}.proposal.json`), review: await read<CliQuizFinalReview>(`${path}.review.json`) };
}
/** Only the caller's explicit review is final; exact results cannot be overwritten. */
export async function finalizeCliQuizReview(cwd: string, id: string, grades: CliQuizFinalReview["grades"]): Promise<CliQuizFinalReview> {
  const record = await loadCliQuizRecord(cwd, id);
  if (!record) throw new Error("quiz_record_missing");
  if (record.review) return record.review;
  const exact = { ...record.submission.objectiveResults };
  for (const grade of record.proposal?.grades ?? []) if (grade.grading === "auto") exact[grade.id] = grade.credit === 1;
  const pending = record.submission.quiz.questions.filter((question) => !Object.hasOwn(exact, question.id));
  if (Object.keys(grades).length !== pending.length || pending.some((question) => !grades[question.id]
    || !["correct", "incorrect", "partial"].includes(grades[question.id]!.verdict))) throw new Error("quiz_review_incomplete_or_overrides_exact");
  const correct = Object.values(exact).filter(Boolean).length + Object.values(grades).reduce((sum, grade) => sum + (grade.verdict === "correct" ? 1 : grade.verdict === "partial" ? 0.5 : 0), 0);
  const review: CliQuizFinalReview = { schemaVersion: 1, reviewedAt: new Date().toISOString(), source: "explicit-review", grades: Object.fromEntries(Object.entries(grades).map(([id, grade]) => [id, record.submission.pendingMathIds.includes(id) ? { ...grade, note: `Not independently checked. ${grade.note ?? "Explicit reviewer verdict."}` } : grade])),
    score: { correct, total: Object.keys(exact).length + pending.length } };
  await writeOnce(`${cliQuizRecordPath(cwd, id)}.review.json`, review);
  return review;
}
