import type { JudgementBackendKey, JudgementCaller, JudgementOutcome, JudgementRequest, JudgementResponse } from "@keating/learner-contracts";
import { sanitizeDiagnosticText } from "../../lib/diagnostics";

export interface JudgementDiagnosticContext {
  /** Curated application label, never learner text. */
  origin: string;
  sessionId?: string;
  replyId?: string;
  application?: string;
}
export interface DiagnosticQuestion {
  id: string; type: string; options: number; details?: string;
  probabilities?: readonly { label: string; value: number }[];
  value?: number; confidence?: number; selected?: string;
}
export interface JudgementDiagnostic {
  id: string; origin: string; sessionId?: string; replyId?: string;
  status: "queued" | "running" | "completed" | "failed" | "abstained";
  startedAt: number; elapsedMs?: number; backend?: string; model?: string;
  calibration?: string | null; questions: readonly DiagnosticQuestion[];
  answerSource?: { backend: string; model: string; calibration: string | null };
  reasons: readonly string[]; application?: string;
  usage?: { inputTokens: number; outputTokens: number };
  evidence?: string;
}
export interface DiagnosticReply { id: string; sessionId: string; status: "streaming" | "completed" | "cancelled" }
interface Snapshot {
  enabled: boolean; details: boolean; reviewReplies: boolean; reviewLiveTranscripts: boolean;
  events: readonly JudgementDiagnostic[]; replies: readonly DiagnosticReply[];
}
let snapshot: Snapshot = { enabled: false, details: false, reviewReplies: false, reviewLiveTranscripts: false, events: [], replies: [] };
let sequence = 0;
const listeners = new Set<() => void>();
const cancellations = new Set<() => void>();
const liveCancellations = new Set<() => void>();
let pending = false;
const safe = (value: string, max = 160) => sanitizeDiagnosticText(value, max);
const identifier = (value: string) => /^[a-zA-Z0-9_.:/-]{1,160}$/.test(value) ? safe(value) : "[private identifier]";
function preview(value: unknown, maximum: number) {
  try { return safe(typeof value === "string" ? value : JSON.stringify(value), maximum); }
  catch { return "[preview unavailable]"; }
}
function publish(next: Snapshot) {
  snapshot = next;
  if (!pending) { pending = true; queueMicrotask(() => { pending = false; for (const listener of listeners) listener(); }); }
}
export const getJudgementDiagnostics = () => snapshot;
export function subscribeJudgementDiagnostics(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function onJudgementDiagnosticsDisabled(cancel: () => void) { cancellations.add(cancel); return () => { cancellations.delete(cancel); }; }
export function onLiveTranscriptReviewDisabled(cancel: () => void) { liveCancellations.add(cancel); return () => { liveCancellations.delete(cancel); }; }
export function configureJudgementDiagnostics(settings: Partial<Pick<Snapshot, "enabled" | "details" | "reviewReplies" | "reviewLiveTranscripts">>) {
  const next = { ...snapshot, ...settings };
  if (!next.enabled || !next.reviewReplies) for (const cancel of cancellations) cancel();
  if (!next.enabled || !next.reviewLiveTranscripts) for (const cancel of liveCancellations) cancel();
  // Disabling capture erases all captured data; revoking previews erases their history too.
  if (!next.enabled || (snapshot.details && !next.details)) { next.events = []; next.replies = []; }
  publish(next);
}
export function clearJudgementDiagnostics() { publish({ ...snapshot, events: [], replies: [] }); }
export function beginDiagnosticReply(sessionId: string): string | undefined {
  if (!snapshot.enabled) return undefined;
  const id = `reply-${++sequence}`;
  publish({ ...snapshot, replies: [...snapshot.replies, { id, sessionId: identifier(sessionId), status: "streaming" as const }].slice(-20) });
  return id;
}
export function endDiagnosticReply(id: string | undefined, cancelled = false) {
  publish({ ...snapshot, replies: snapshot.replies.map(reply => reply.id === id ? { ...reply, status: cancelled ? "cancelled" : "completed" } : reply) });
}
export function beginJudgementDiagnostic(request: JudgementRequest, context: JudgementDiagnosticContext = { origin: "judgement" }): string | undefined {
  if (!snapshot.enabled) return undefined;
  const id = `judgement-${++sequence}`;
  const event: JudgementDiagnostic = {
    id, origin: identifier(context.origin), status: "queued", startedAt: Date.now(), reasons: [],
    ...(context.sessionId ? { sessionId: identifier(context.sessionId) } : {}),
    ...(context.replyId ? { replyId: identifier(context.replyId) } : {}),
    ...(context.application ? { application: safe(context.application) } : {}),
    questions: Object.entries(request.questions).slice(0, 64).map(([key, question]) => ({
      id: identifier(key), type: question.type,
      options: question.type === "noul" ? 2 : Object.keys(question.criteria).length,
      ...(snapshot.details ? { details: preview({ instructions: question.instructions, criteria: question.criteria }, 2400) } : {}),
    })),
    ...(snapshot.details ? { evidence: preview(request.state, 1600) } : {}),
  };
  publish({ ...snapshot, events: [...snapshot.events, event].slice(-60) });
  return id;
}
function update(id: string | undefined, change: (event: JudgementDiagnostic) => JudgementDiagnostic) {
  if (!id || !snapshot.enabled) return;
  publish({ ...snapshot, events: snapshot.events.map(event => event.id === id && (event.status === "queued" || event.status === "running") ? change(event) : event) });
}
export function noteJudgementDispatch(id: string | undefined, backend: JudgementBackendKey, reason: string) {
  update(id, event => ({ ...event, status: "running", backend: backend.backend, model: safe(backend.model), calibration: backend.calibrationSha256,
    reasons: [...event.reasons, safe(reason)].slice(-12) }));
}
export function noteJudgementReason(id: string | undefined, reason: string) {
  update(id, event => ({ ...event, reasons: [...event.reasons, safe(reason)].slice(-12) }));
}
export function noteJudgementAnswer(id: string | undefined, response: JudgementResponse) {
  update(id, event => ({ ...event, backend: response.backend.backend, model: safe(response.backend.model), calibration: response.backend.calibrationSha256,
    answerSource: { backend: response.backend.backend, model: safe(response.backend.model), calibration: response.backend.calibrationSha256 },
    usage: response.usage ? { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens } : undefined,
    questions: event.questions.map(question => {
      const { probabilities: _probabilities, value: _value, confidence: _confidence, selected: _selected, ...base } = question;
      const answer = response.answers[question.id];
      if (!answer) return base;
      if (answer.type === "noul") return { ...base, value: answer.noul };
      return { ...base, confidence: answer.confidence,
        ...(answer.type === "score" ? { value: answer.score } : { selected: snapshot.details ? safe(answer.choice) : `option ${Object.keys(answer.probabilities).indexOf(answer.choice) + 1}` }),
        probabilities: Object.entries(answer.probabilities).slice(0, 255).map(([label, value], index) => ({ label: snapshot.details ? safe(label) : `option ${index + 1}`, value })),
      };
    }),
  }));
}
export function finishJudgementDiagnostic(id: string | undefined, outcome: JudgementOutcome, abstained = false) {
  if (outcome.ok) noteJudgementAnswer(id, outcome.response);
  update(id, event => {
    return { ...event, status: outcome.ok ? "completed" : abstained ? "abstained" : "failed", elapsedMs: Math.max(0, Date.now() - event.startedAt),
      ...(!outcome.ok ? { reasons: [...event.reasons, outcome.error.code].slice(-12) } : {}),
    };
  });
}
// Operation callers record their own selection/fallback lifecycle. Runtime wrappers
// cover calibrated router calls without recording the same request twice.
const operationRequests = new WeakMap<JudgementRequest, number>();
export function markDiagnosticOperation(request: JudgementRequest) { operationRequests.set(request, (operationRequests.get(request) ?? 0) + 1); }
export function unmarkDiagnosticOperation(request: JudgementRequest) {
  const count = operationRequests.get(request) ?? 0;
  if (count <= 1) operationRequests.delete(request); else operationRequests.set(request, count - 1);
}
export function observeJudgementCaller(call: JudgementCaller, key: JudgementBackendKey): JudgementCaller {
  return async (request, signal) => {
    if (operationRequests.has(request) || !snapshot.enabled) return call(request, signal);
    const id = beginJudgementDiagnostic(request, { origin: "calibrated-router", application: "Application decision is owned by the caller." });
    noteJudgementDispatch(id, key, "Router dispatched this backend.");
    const cancel = () => finishJudgementDiagnostic(id, { ok: false, error: { code: "cancelled", retryable: false } });
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const outcome = await call(request, signal);
      if (signal?.aborted) cancel(); else finishJudgementDiagnostic(id, outcome);
      return outcome;
    } catch (error) {
      finishJudgementDiagnostic(id, { ok: false, error: { code: "backend-unavailable", retryable: false } });
      throw error;
    } finally { signal?.removeEventListener("abort", cancel); }
  };
}
