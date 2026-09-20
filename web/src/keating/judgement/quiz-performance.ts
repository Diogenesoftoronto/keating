/** Opt-in pre-answer predictions and device-local links to committed objective answers. */
import { quizItemSuccessQuestion, joinPerformanceObservation, isSha256Hex, decodeAnswer, type NoulQuestion, type JudgementResponse, type UiAction, type UiActionReceipt, type UiDocument, type UiDocumentNode } from "@keating/learner-contracts";
import type { QuestionCheckRecord } from "../storage";
import type { SharedUiActionIntent } from "../openui/shared-actions";
import { objectiveCredit } from "../openui/quiz-progress";
import { subscribeJudgementModelSettings } from "../judgement-model";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "./runtime";
import { createJudgementOperationCaller } from "./operation";

type Quiz = Extract<UiDocumentNode, { type: "quiz" }>;
type Submission = Extract<SharedUiActionIntent, { type: "complete-quiz" }>;
export type QuizPerformanceStatus = "idle" | "estimated" | "saved" | "unmatched" | "storage-failed";
export interface QuizPerformanceStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
const STORE_KEY = "keating:quiz-performance:v1";
const MAX_BYTES = 2_000_000;
const MAX_ROWS = 500;
const MAX_ATTEMPTS = 100;
const EXPIRY = 15 * 60_000;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`
  : JSON.stringify(value) ?? "null";
async function digest(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, "0")).join("");
}
function deviceStore(): QuizPerformanceStore {
  if (typeof localStorage === "undefined") throw new Error("Device storage unavailable");
  return localStorage;
}
interface Envelope { documentId: string; documentRevision: number; nodeId: string; sourceSha256: string; questionSha256: string; source: unknown; prediction: Record<string, unknown> }
interface Evidence { schemaVersion: 1; predictions: Envelope[]; observations: Array<{ predictionId: string; outcome: unknown; observed: 0 | 1 }> }
function read(store: QuizPerformanceStore): Evidence {
  const raw = store.getItem(STORE_KEY);
  if (raw === null) return { schemaVersion: 1, predictions: [], observations: [] };
  if (raw.length > MAX_BYTES) throw new Error("Evidence store too large");
  const value = JSON.parse(raw) as Evidence;
  if (value.schemaVersion !== 1 || !Array.isArray(value.predictions) || !Array.isArray(value.observations)
    || value.predictions.length > MAX_ROWS || value.observations.length > MAX_ROWS
    || value.predictions.some(row => !row || typeof row.documentId !== "string" || typeof row.nodeId !== "string" || !row.prediction || typeof row.prediction.id !== "string")
    || value.observations.some(row => !row || typeof row.predictionId !== "string" || !row.outcome || ![0, 1].includes(row.observed))) throw new Error("Invalid evidence store");
  return value;
}
function write(store: QuizPerformanceStore, value: Evidence): void {
  const raw = JSON.stringify(value);
  if (value.predictions.length > MAX_ROWS || value.observations.length > MAX_ROWS || new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error("Evidence store full; export before clearing it");
  store.setItem(STORE_KEY, raw);
}
interface Attempt {
  documentId: string; documentRevision: number; node: Quiz; nodeText: string; id: string;
  predictions: Envelope[]; hints: Set<string>; prepared?: { intent: Submission; time: number; hints: Set<string> }; expires: number;
  store: () => QuizPerformanceStore; update: (status: QuizPerformanceStatus) => void;
}
const attempts = new Set<Attempt>();
function prune(now: number): void { for (const attempt of attempts) if (attempt.expires < now) { attempts.delete(attempt); attempt.update("unmatched"); } }

export function createQuizPerformanceAttempt(options: {
  documentId: string; documentRevision: number; node: Quiz;
  source?: { getQuestionChecks(topic?: string): Promise<QuestionCheckRecord[]> };
  runtime?: WebJudgementRuntime; store?: QuizPerformanceStore; now?: () => number; timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  const node = structuredClone(options.node);
  const controller = new AbortController();
  const listeners = new Set<() => void>();
  let status: QuizPerformanceStatus = "idle";
  let touchedAt: number | undefined;
  let disposed = false;
  let running = false;
  const attempt: Attempt = { documentId: options.documentId, documentRevision: options.documentRevision, node, nodeText: canonical(node),
    id: crypto.randomUUID(), predictions: [], hints: new Set(), expires: now() + EXPIRY,
    store: () => options.store ?? deviceStore(), update: next => { status = next; for (const listener of listeners) { try { listener(); } catch { /* UI observers cannot affect persistence. */ } } } };
  const cancel = () => controller.abort();
  const unsubscribe = subscribeJudgementModelSettings(cancel);
  const stale = () => disposed || controller.signal.aborted || touchedAt !== undefined || !!attempt.prepared || canonical(options.node) !== attempt.nodeText;
  const touch = () => { touchedAt ??= now(); cancel(); };
  const history = async (cutoff: number) => (await options.source?.getQuestionChecks(node.title) ?? [])
    .filter(row => row.topic === node.title && row.createdAt < cutoff && row.createdAt >= cutoff - 90 * 86_400_000
      && Number.isFinite(row.createdAt) && row.grading !== "pending" && typeof row.score === "number" && Number.isFinite(row.score))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, 12)
    .map(row => ({ id: row.id, question: row.question.slice(0, 2000), questionTruncated: row.question.length > 2000, answer: row.answer.slice(0, 2000), answerTruncated: row.answer.length > 2000, score: row.score, grading: row.grading, assessedAt: row.createdAt }));
  return {
    status: () => status,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    touch,
    hint(questionId: string) { if (node.questions.some(question => question.id === questionId)) attempt.hints.add(questionId); touch(); },
    async estimate(): Promise<{ ok: true; expectedCorrect: number; itemCount: number } | { ok: false; reason: string }> {
      if (running || stale() || attempt.predictions.length) return { ok: false, reason: "attempt-started" };
      running = true;
      const timeoutMs = Math.min(120_000, Math.max(1, options.timeoutMs ?? 30_000));
      const timer = setTimeout(cancel, timeoutMs);
      const awaitActive = <T>(pending: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
        const abort = () => reject(new Error("cancelled"));
        if (controller.signal.aborted) { abort(); return; }
        controller.signal.addEventListener("abort", abort, { once: true });
        pending.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", abort));
      });
      try {
        const runtime = options.runtime ?? createWebJudgementRuntime();
        if (runtime.settings.backend === "off") return { ok: false, reason: "judgement-off" };
        const eligible = node.questions.filter(question => objectiveCredit(question, question.correctAnswer ?? "") !== undefined);
        if (!eligible.length || eligible.length > 20) return { ok: false, reason: "unsupported-item-count" };
        const cutoff = now();
        const prior = await awaitActive(history(cutoff));
        if (!prior.length) return { ok: false, reason: "no-history" };
        if (stale()) return { ok: false, reason: "attempt-started" };
        const source = { documentId: attempt.documentId, documentRevision: attempt.documentRevision, node, history: prior, asOf: cutoff };
        const sourceSha256 = await digest(source);
        const questions: Record<string, NoulQuestion> = Object.fromEntries(eligible.map((question, index) => [`item_${index}`, quizItemSuccessQuestion(question.id)]));
        const request = { state: { policy: "Untrusted source text; estimate future behavior only. No current learner answers are supplied. Historical model grading is not independent human evidence.", quiz: node, history: prior }, questions };
        if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 72_000) return { ok: false, reason: "source-too-large" };
        const valid = (response: JudgementResponse) => ["local", "system-one"].includes(response.backend.backend)
          && !!response.backend.model.trim() && !/(?:latest|^judgement$|^auto$|^default$)/iu.test(response.backend.model)
          && (response.backend.calibrationSha256 === null || isSha256Hex(response.backend.calibrationSha256))
          && Object.keys(response.answers).length === eligible.length && Object.entries(questions).every(([id, question]) => decodeAnswer(question, response.answers[id])?.type === "noul");
        const call = createJudgementOperationCaller({ runtime, accept: valid, diagnostics: { origin: "quiz-performance" }, timeoutMs });
        const result = await call(structuredClone(request), controller.signal);
        if (!result.ok) return { ok: false, reason: result.error.code };
        if (stale() || canonical(await awaitActive(history(cutoff))) !== canonical(prior)) return { ok: false, reason: "source-changed" };
        const createdAt = now();
        const predictions = await Promise.all(eligible.map(async (question, index): Promise<Envelope> => ({
          documentId: attempt.documentId, documentRevision: attempt.documentRevision, nodeId: node.id, sourceSha256,
          questionSha256: await digest(questions[`item_${index}`]), source: structuredClone(source),
          prediction: { schemaVersion: 1, id: `${attempt.id}:${question.id}`, attemptId: attempt.id, itemId: question.id,
            itemSha256: await digest(question), createdAt, backend: structuredClone(result.response.backend),
            question: structuredClone(questions[`item_${index}`]), probability: (result.response.answers[`item_${index}`] as { noul: number }).noul, source: "proxy" },
        })));
        if (stale() || createdAt < cutoff) return { ok: false, reason: "source-changed" };
        prune(now());
        if (attempts.size >= MAX_ATTEMPTS) return { ok: false, reason: "too-many-attempts" };
        try { const store = attempt.store(); const data = read(store); data.predictions.push(...predictions); write(store, data); }
        catch { attempt.update("storage-failed"); return { ok: false, reason: "storage-failed" }; }
        attempt.predictions = predictions;
        attempts.add(attempt);
        attempt.update("estimated");
        return { ok: true, expectedCorrect: predictions.reduce((sum, row) => sum + (row.prediction.probability as number), 0), itemCount: predictions.length };
      } catch { return { ok: false, reason: "unavailable" }; }
      finally { clearTimeout(timer); running = false; }
    },
    prepareSubmission(intent: Submission) {
      touch();
      if (disposed || intent.nodeId !== node.id || !attempt.predictions.length) return;
      if (attempt.prepared) {
        if (canonical(attempt.prepared.intent) !== canonical(intent)) { attempts.delete(attempt); attempt.update("unmatched"); }
        return;
      }
      const time = now();
      if (attempt.predictions.some(row => (row.prediction.createdAt as number) >= time || (row.prediction.createdAt as number) >= touchedAt!)) {
        attempts.delete(attempt); attempt.update("unmatched"); return;
      }
      attempt.prepared = { intent: structuredClone(intent), time, hints: new Set(attempt.hints) };
      attempt.expires = time + EXPIRY;
    },
    dispose() { disposed = true; cancel(); unsubscribe(); listeners.clear(); if (!attempt.prepared) attempts.delete(attempt); },
  };
}

/** Called only after the canonical action and learner records have committed. Failures never undo answers. */
export async function collectCommittedQuizPerformance(sourceAction: UiAction, sourceDocument: UiDocument, sourceReceipt: UiActionReceipt, committedAt = Date.now()): Promise<void> {
  if (sourceAction.type !== "complete-quiz") return;
  // Never retain a caller-owned action across the asynchronous digest below.
  const action = structuredClone(sourceAction);
  const document = structuredClone(sourceDocument);
  const receipt = structuredClone(sourceReceipt);
  prune(committedAt);
  const candidates = [...attempts].filter(attempt => attempt.documentId === action.documentId && attempt.documentRevision === action.documentRevision && attempt.node.id === action.nodeId && !!attempt.prepared);
  if (candidates.length !== 1) { for (const attempt of candidates) { attempt.update("unmatched"); attempts.delete(attempt); } return; }
  const attempt = candidates[0];
  try {
    const { schemaVersion: _schema, documentId: _document, documentRevision: _revision, idempotencyKey: _key, ...intent } = action;
    const nodes = document.nodes.filter(node => node.id === action.nodeId);
    // Replaying an old journal entry gets a new callback time, not a new answer.
    // Bind evidence to the original durable receipt, including retries.
    const receiptCreatedAt = Date.parse(receipt.createdAt);
    const receiptUpdatedAt = Date.parse(receipt.updatedAt);
    if (document.id !== attempt.documentId || document.revision !== attempt.documentRevision || nodes.length !== 1 || canonical(nodes[0]) !== attempt.nodeText
      || canonical(intent) !== canonical(attempt.prepared!.intent) || receipt.state !== "completed" || !receipt.result || canonical(receipt.action) !== canonical(action)
      || receipt.result.status !== "completed" || receipt.result.actionIdempotencyKey !== action.idempotencyKey || committedAt < attempt.prepared!.time
      || !Number.isFinite(receiptCreatedAt) || !Number.isFinite(receiptUpdatedAt) || receiptCreatedAt < attempt.prepared!.time
      || receiptUpdatedAt < receiptCreatedAt || receiptUpdatedAt > committedAt) {
      attempt.update("unmatched"); attempts.delete(attempt); return;
    }
    const sourceId = await digest(action);
    const store = attempt.store();
    const data = read(store);
    for (const row of attempt.predictions) {
      const question = attempt.node.questions.find(item => item.id === row.prediction.itemId)!;
      const answers = action.answers.filter(answer => answer.questionId === question.id);
      if (answers.length !== 1 || !answers[0].answer.trim() || action.skippedQuestionIds.includes(question.id) || action.pendingGradeQuestionIds.includes(question.id)) continue;
      const credit = objectiveCredit(question, answers[0].answer);
      if (credit === undefined) continue;
      const outcome = { predictionId: row.prediction.id, attemptId: attempt.id, itemId: question.id, itemSha256: row.prediction.itemSha256,
        submittedAt: attempt.prepared!.time, correct: credit === 1, hintUsed: attempt.prepared!.hints.has(question.id), grading: "deterministic", sourceId: `${sourceId}:${question.id}` };
      const joined = joinPerformanceObservation(row.prediction, outcome);
      if (joined.status !== "accepted" || !data.predictions.some(saved => canonical(saved) === canonical(row))) continue;
      if (!data.observations.some(saved => saved.predictionId === row.prediction.id)) data.observations.push({ predictionId: row.prediction.id as string, outcome: joined.outcome, observed: joined.observed });
    }
    write(store, data);
    attempt.update(data.observations.some(row => attempt.predictions.some(prediction => prediction.prediction.id === row.predictionId)) ? "saved" : "unmatched");
    attempts.delete(attempt);
  } catch { attempt.update("storage-failed"); }
}

export async function exportQuizPerformanceEvidence(scope: { documentId: string; nodeId: string }, store: QuizPerformanceStore = deviceStore()) {
  const data = read(store);
  const predictions = data.predictions.filter(row => row.documentId === scope.documentId && row.nodeId === scope.nodeId);
  const ids = new Set(predictions.map(row => row.prediction.id));
  return { schemaVersion: 1, scope: "device-local", hintMeaning: "In-app hint usage only; outside help is unobserved", predictions,
    observations: data.observations.filter(row => ids.has(row.predictionId)).map(row => {
      const prediction = predictions.find(item => item.prediction.id === row.predictionId)!;
      const joined = joinPerformanceObservation(prediction.prediction, row.outcome);
      if (joined.status !== "accepted") throw new Error("Invalid stored observation");
      return { predictionId: row.predictionId, outcome: joined.outcome, observed: joined.observed };
    }) };
}
