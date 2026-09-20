import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadJudgementCalibrationArtifact } from "./calibration-artifact.js";
import { reviewStudyCandidates, type ReadinessReview, type StudyCandidate } from "../../shared/pedagogy/readiness-review.js";
import type { CalibrationTable } from "../../packages/learner-contracts/src/judgement/projections.js";
import { benchmarkTopics, resolveTopic } from "../core/topics.js";
import { learnerStatePath, stateDir, engagementPolicyPath } from "../core/paths.js";
import { loadLearnerState } from "../core/learner-state.js";
import type { TopicEngagement, LearnerState } from "../core/types.js";
import type { CliQuizSubmission, CliQuizFinalReview } from "../core/quiz-grading.js";
import { createCliJudgementBackend, JUDGEMENT_MODEL_ENV, JUDGEMENT_CALIBRATION_ENV, type CliJudgementOptions } from "./transport.js";

export interface CliReadinessOptions {
  env?: Readonly<Record<string, string | undefined>>;
  transport?: Pick<CliJudgementOptions, "fetch" | "loadCredential" | "now" | "retry" | "sleep">;
  calibration?: CalibrationTable;
  signal?: AbortSignal;
}
export interface CliReadinessReceipt extends ReadinessReview {
  inputSha256: string; receiptPath: string; stale: boolean;
  calibrationArtifact: { status: "not-configured" | "loaded" | "invalid" | "injected"; sha256: string | null };
  historyScope: "Up to six most recent saved quizzes per candidate and its prerequisites; complete answer text within that window.";
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const HISTORY_SCOPE = "Up to six most recent saved quizzes per candidate and its prerequisites; complete answer text within that window." as const;
export const READINESS_CALIBRATION_FILE_ENV = "KEATING_READINESS_CALIBRATION_FILE";
export const READINESS_CALIBRATION_FILE_SHA256_ENV = "KEATING_READINESS_CALIBRATION_FILE_SHA256";

async function candidateInputs(state: LearnerState, directory: string, due: readonly TopicEngagement[]): Promise<StudyCandidate[]> {
  const known = new Map(benchmarkTopics().map(topic => [topic.slug, topic]));
  const covered = new Set(state.coveredTopics.filter(topic => topic.sessionCount > 0).map(topic => resolveTopic(topic.slug).slug));
  let names: string[];
  try { names = (await readdir(join(directory, "quiz-submissions"))).filter(name => /^quiz-[a-z0-9-]{8,90}\.json$/.test(name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; names = []; }
  if (names.length > 1000) throw new Error("readiness_history_limit");
  const records: { submission: CliQuizSubmission; review: CliQuizFinalReview | null }[] = [];
  for (const name of names) {
    const source = await readFile(join(directory, "quiz-submissions", name), "utf8");
    if (Buffer.byteLength(source) > 200_000) throw new Error("readiness_history_limit");
    const submission = JSON.parse(source) as CliQuizSubmission;
    if (submission.schemaVersion !== 1 || `${submission.id}.json` !== name || !Array.isArray(submission.quiz?.questions)
      || !submission.answers || !submission.objectiveResults || !Number.isFinite(Date.parse(submission.createdAt))) throw new Error("readiness_history_invalid");
    const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
    const ids = submission.quiz.questions.map(question => question?.id);
    if (typeof submission.quiz.slug !== "string" || !submission.quiz.slug.trim() || ids.length > 100 || new Set(ids).size !== ids.length
      || submission.quiz.questions.some(question => !question || typeof question.id !== "string" || !question.id || typeof question.question !== "string")
      || !plain(submission.answers) || !plain(submission.objectiveResults)
      || Object.entries(submission.answers).some(([id, value]) => !ids.includes(id) || typeof value !== "string")
      || Object.entries(submission.objectiveResults).some(([id, value]) => !ids.includes(id) || typeof value !== "boolean")) throw new Error("readiness_history_invalid");
    let review: CliQuizFinalReview | null = null;
    try {
      const text = await readFile(join(directory, "quiz-submissions", `${name}.review.json`), "utf8");
      if (Buffer.byteLength(text) > 200_000) throw new Error("readiness_history_limit");
      review = JSON.parse(text);
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (review && (review.schemaVersion !== 1 || review.source !== "explicit-review" || !plain(review.grades)
      || Object.entries(review.grades).some(([id, grade]) => !ids.includes(id) || !plain(grade) || !["correct", "incorrect", "partial"].includes(String(grade.verdict))))) throw new Error("readiness_history_invalid");
    records.push({ submission, review });
  }
  records.sort((a, b) => Date.parse(b.submission.createdAt) - Date.parse(a.submission.createdAt) || a.submission.id.localeCompare(b.submission.id));
  return due.map(topic => {
    const canonicalSlug = resolveTopic(topic.slug).slug;
    const definition = known.get(canonicalSlug);
    const prerequisites = (definition?.prerequisites ?? []).map(name => ({ id: resolveTopic(name).slug, covered: covered.has(resolveTopic(name).slug) }));
    const relevant = new Set([canonicalSlug, ...prerequisites.map(item => item.id)]);
    const selected = records.filter(record => relevant.has(resolveTopic(record.submission.quiz.slug).slug)).slice(0, 6);
    const work = selected.flatMap(({ submission, review }) => submission.quiz.questions.flatMap(question => {
      const answer = submission.answers[question.id];
      if (typeof answer !== "string" || !answer.trim()) return [];
      const result: StudyCandidate["work"][number]["result"] = typeof submission.objectiveResults[question.id] === "boolean" ? submission.objectiveResults[question.id] ? "correct" : "incorrect"
        : review?.grades[question.id]?.verdict ?? "pending";
      return [{ question: question.question, answer, result }];
    }));
    return { id: topic.slug, title: topic.title, requirements: [...(definition?.formalCore ?? []), ...(definition?.exercises ?? [])],
      due: topic.isDue, covered: covered.has(canonicalSlug), prerequisiteGraphKnown: !!definition, prerequisites, work };
  });
}

/** Only explicit due --readiness / tool readiness requests call this account-opted-in path. */
export async function reviewCliDueTopics(cwd: string, due: readonly TopicEngagement[], options: CliReadinessOptions = {}): Promise<CliReadinessReceipt> {
  const directory = stateDir(cwd), sourcePath = learnerStatePath(cwd), policyPath = engagementPolicyPath(cwd);
  const env = { ...(options.env ?? process.env) };
  let calibration = options.calibration;
  let calibrationArtifact: CliReadinessReceipt["calibrationArtifact"] = {
    status: calibration ? "injected" : "not-configured", sha256: null,
  };
  const calibrationFile = env[READINESS_CALIBRATION_FILE_ENV];
  const calibrationPin = env[READINESS_CALIBRATION_FILE_SHA256_ENV];
  // Explicit file configuration wins over dependency injection. A broken pin
  // must not silently fall back to a different calibration or model estimate.
  if (calibrationFile !== undefined || calibrationPin !== undefined) {
    try {
      if (!calibrationFile?.trim() || !calibrationPin) throw new Error("invalid_calibration_config");
      const loaded = await loadJudgementCalibrationArtifact(resolve(cwd, calibrationFile), calibrationPin);
      calibration = loaded.table;
      calibrationArtifact = { status: "loaded", sha256: loaded.sha256 };
    } catch {
      calibration = undefined;
      calibrationArtifact = { status: "invalid", sha256: null };
    }
  }
  async function sources() {
    const state = await loadLearnerState(sourcePath);
    let policy: string | null = null;
    try { policy = await readFile(policyPath, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const inputs = await candidateInputs(state, directory, due);
    return { inputs, fingerprint: digest({ inputs, state, policy }) };
  }
  let inputs: StudyCandidate[] = [];
  let usable = calibrationArtifact.status !== "invalid";
  let inputSha256 = digest(null);
  try { const captured = await sources(); inputs = captured.inputs; inputSha256 = captured.fingerprint; } catch { usable = false; }
  let call = null;
  if (usable && env.KEATING_READINESS_JUDGE === "notorganic") {
    try { call = createCliJudgementBackend({ ...options.transport, cwd, env: {
      [JUDGEMENT_MODEL_ENV]: env[JUDGEMENT_MODEL_ENV], [JUDGEMENT_CALIBRATION_ENV]: env[JUDGEMENT_CALIBRATION_ENV],
    } })?.call ?? null; } catch { /* Missing account leaves this review unavailable. */ }
  }
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let result = await reviewStudyCandidates(inputs, call, calibration, signal);
  if (!usable) result = { ...result, status: "unavailable" };
  let stale = false;
  try { stale = stateDir(cwd) !== directory || (await sources()).fingerprint !== inputSha256; }
  catch { stale = true; }
  if (calibrationArtifact.status === "loaded") {
    try { await loadJudgementCalibrationArtifact(resolve(cwd, calibrationFile!), calibrationPin!); }
    catch { stale = true; calibrationArtifact = { ...calibrationArtifact, status: "invalid" }; }
  }
  if (stale) result = { ...result, status: "unavailable", selectedId: null };
  if (signal.aborted) result = { ...result, status: "cancelled", selectedId: null };
  const receiptPath = join(directory, "readiness-reviews", `${randomUUID()}.json`);
  const receipt: CliReadinessReceipt = { ...result, inputSha256, receiptPath, stale, calibrationArtifact, historyScope: HISTORY_SCOPE };
  await mkdir(join(directory, "readiness-reviews"), { recursive: true, mode: 0o700 });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  if (signal.aborted && receipt.status !== "cancelled") {
    receipt.status = "cancelled";
    receipt.selectedId = null;
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  }
  return receipt;
}

export function readinessReviewMarkdown(receipt: CliReadinessReceipt): string {
  const lines = ["", "## Readiness review", "", `Status: ${receipt.stale ? "stale source; review discarded" : receipt.status}. This is a model proxy, not measured mastery.`,
    "Due dates and the ordinary review order are unchanged.", HISTORY_SCOPE, ""];
  if (receipt.calibrationArtifact.status === "invalid") lines.push("Configured calibration could not be verified; no recommendation was applied.", "");
  for (const blocked of receipt.blocked) lines.push(`- ${blocked.id}: ${blocked.reason}.`);
  if (!receipt.stale && receipt.status !== "cancelled") for (const estimate of receipt.estimates) lines.push(`- ${estimate.id}: readiness estimate ${estimate.probability.toFixed(3)} (${estimate.backend.model}; ${estimate.backend.calibrationSha256 ? "calibration identity attached" : "uncalibrated"}).`);
  if (receipt.selectedId) lines.push(`Recommended next review: ${receipt.selectedId}.`);
  else lines.push("No calibrated next-review recommendation. Continue teaching or choose a review manually.");
  lines.push(`Private receipt: ${receipt.receiptPath}`, "");
  return lines.join("\n");
}
