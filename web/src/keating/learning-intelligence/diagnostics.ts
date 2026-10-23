import type { LearningEvidenceAnchor } from "@keating/learner-contracts";
import { getJudgementDiagnostics, subscribeJudgementDiagnostics } from "../judgement/diagnostics";
import { sanitizeDiagnosticText } from "../../lib/diagnostics";

export interface LearningDiagnosticForecast {
  target: string; probability?: number; baseline?: number; horizonHours?: number; status?: string;
  p10?: number; median?: number; p90?: number; observedCount?: number; dueAt?: number;
}
export interface LearningDiagnosticInput {
  kind: "extraction" | "forecast" | "memory";
  status: "completed" | "unavailable" | "failed" | "abstained";
  sessionId: string; model?: string; elapsedMs?: number; reasons: readonly string[];
  evidence?: readonly LearningEvidenceAnchor[]; forecast?: readonly LearningDiagnosticForecast[];
}
export interface LearningDiagnostic extends LearningDiagnosticInput { id: string; createdAt: number }
let events: readonly LearningDiagnostic[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
const safe = (value: string, max = 160) => sanitizeDiagnosticText(value, max);
const identifier = (value: string) => /^[a-zA-Z0-9_.:/-]{1,200}$/.test(value) ? value : "[private identifier]";
function publish(next: readonly LearningDiagnostic[]) { events = next; for (const listener of listeners) listener(); }
export const getLearningDiagnostics = () => {
  const state = getJudgementDiagnostics();
  if (events.length && (!state.enabled || !state.details && events.some(event => event.evidence?.length))) events = [];
  return events;
};
export function subscribeLearningDiagnostics(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function clearLearningDiagnostics() { if (events.length) publish([]); }
/** Deleted or edited source text must not remain as a clickable captured passage. */
export function discardLearningDiagnosticAnchor(anchor: LearningEvidenceAnchor) {
  publish(events.map(event => {
    const remaining = event.evidence?.filter(item => !(item.sessionId === anchor.sessionId && item.messageId === anchor.messageId && item.sourceHash === anchor.sourceHash));
    return remaining?.length !== event.evidence?.length ? { ...event, evidence: remaining, reasons: [...event.reasons, "An original passage changed or was removed. Its captured source link was cleared."].slice(-12) } : event;
  }));
}
subscribeJudgementDiagnostics(() => {
  const current = getJudgementDiagnostics();
  if (!current.enabled || !current.details && events.some(event => event.evidence?.length)) clearLearningDiagnostics();
});
/** The optional detail buffer never retains anchors or quotes while previews are off. */
export function recordLearningDiagnostic(input: LearningDiagnosticInput): void {
  const capture = getJudgementDiagnostics();
  if (!capture.enabled) return;
  const forecast = input.forecast?.slice(0, 12).map(row => ({
    target: safe(row.target), ...(row.status ? { status: safe(row.status) } : {}),
    ...Object.fromEntries(Object.entries(row).filter(([key, value]) => key !== "target" && key !== "status" && typeof value === "number" && Number.isFinite(value))),
  }));
  publish([...events, {
    id: `learning-${++sequence}`, createdAt: Date.now(), kind: input.kind, status: input.status,
    sessionId: identifier(input.sessionId), ...(input.model ? { model: safe(input.model) } : {}),
    ...(Number.isFinite(input.elapsedMs) ? { elapsedMs: Math.max(0, input.elapsedMs!) } : {}),
    reasons: input.reasons.slice(0, 12).map(reason => safe(reason, 240)),
    ...(forecast ? { forecast } : {}),
    ...(capture.details && input.evidence ? { evidence: input.evidence.slice(0, 12).filter(anchor => anchor.quote.length <= 4000).map(anchor => ({ ...anchor })) } : {}),
  }].slice(-40));
}
