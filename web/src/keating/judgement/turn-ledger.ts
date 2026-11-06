/**
 * One entry per tutor turn collecting every judgement made for it: draft-gate
 * checks, the completed-reply review, learning extraction and memory admission.
 * Entries exist while diagnostic capture or "Save judgements for review" is on.
 * Saved records hold no draft text; draft checks live in their receipts.
 */
import type { JudgementResponse, MemoryAdmissionDecision, TeachingDraftSnapshot } from "@keating/learner-contracts";
import { sanitizeDiagnosticText } from "../../lib/diagnostics";
import { createLocalSetting } from "../local-setting";
import { getJudgementDiagnostics, subscribeJudgementDiagnostics } from "./diagnostics";
import { projectTeachingDraftSnapshot } from "./draft-status";
import { turnRecordId, type TurnExtraction, type TurnJudgementRecord, type TurnMemoryDecision, type TurnReplyReview } from "./turn-records";

const saving = createLocalSetting<boolean>({ key: "keating:judgement-review-records:v1", event: "keating:judgement-review-records-changed", normalize: value => value === true || value === "true" });
export const turnJudgementSavingEnabled = () => saving.load();
export const setTurnJudgementSavingEnabled = (enabled: boolean) => saving.save(enabled);
export const subscribeTurnJudgementSaving = (listener: () => void) => saving.subscribe(() => listener());

export interface LedgerTurn extends Omit<TurnJudgementRecord, "id" | "assistantTimestamp"> {
  key: string;
  assistantTimestamp?: number;
  status: "running" | "completed" | "cancelled";
  draft?: TeachingDraftSnapshot;
}
type Sink = (record: TurnJudgementRecord) => Promise<void>;

const MAX_TURNS = 40;
let turns: readonly LedgerTurn[] = [];
let sequence = 0;
let sink: Sink | null = null;
let publishPending = false;
const listeners = new Set<() => void>();
const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const recording = () => getJudgementDiagnostics().enabled || turnJudgementSavingEnabled();
/** Exact passages stay only where the reviewer asked to keep them. */
const keepQuotes = () => turnJudgementSavingEnabled() || getJudgementDiagnostics().details;
const safe = (value: string, max = 160) => sanitizeDiagnosticText(value, max);

function publish(next: readonly LedgerTurn[]) {
  turns = next;
  if (publishPending) return;
  publishPending = true;
  queueMicrotask(() => { publishPending = false; for (const listener of listeners) listener(); });
}
export const getTurnLedger = () => turns;
export function subscribeTurnLedger(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function clearTurnLedger() { dirty.clear(); publish([]); }
/** The storage owner registers where saved records go; the ledger never imports storage. */
export function setTurnJudgementSink(next: Sink | null) { sink = next; }

subscribeJudgementDiagnostics(() => { if (!recording() && turns.length) clearTurnLedger(); });
subscribeTurnJudgementSaving(() => { if (!recording() && turns.length) clearTurnLedger(); });

function toRecord(turn: LedgerTurn): TurnJudgementRecord | null {
  if (turn.assistantTimestamp === undefined) return null;
  const { key: _key, status: _status, draft: _draft, ...rest } = turn;
  return { ...structuredClone(rest), id: turnRecordId(turn.sessionId, turn.assistantTimestamp), assistantTimestamp: turn.assistantTimestamp };
}
function flush() {
  flushTimer = undefined;
  if (!sink || !turnJudgementSavingEnabled()) { dirty.clear(); return; }
  for (const key of [...dirty]) {
    dirty.delete(key);
    const turn = turns.find(row => row.key === key);
    const record = turn && toRecord(turn);
    // Saving is diagnostic; a failed write never affects the conversation.
    if (record) void sink(record).catch(() => {});
  }
}
function schedule(key: string) {
  if (!turnJudgementSavingEnabled()) return;
  dirty.add(key);
  flushTimer ??= setTimeout(flush, 250);
}
function change(key: string | undefined, update: (turn: LedgerTurn) => LedgerTurn) {
  if (!key) return;
  let changed = false;
  const next = turns.map(turn => { if (turn.key !== key) return turn; changed = true; return { ...update(turn), updatedAt: Date.now() }; });
  if (!changed) return;
  publish(next);
  schedule(key);
}
const latest = (sessionId: string, match: (turn: LedgerTurn) => boolean = () => true) =>
  [...turns].reverse().find(turn => turn.sessionId === sessionId && match(turn));
const openTurn = (sessionId: string) => latest(sessionId, turn => turn.assistantTimestamp === undefined && turn.status === "running");

type Message = { role?: unknown; timestamp?: unknown; stopReason?: unknown };
const timestampOf = (message: Message | undefined) => typeof message?.timestamp === "number" ? message.timestamp : undefined;
const isLearner = (message: Message) => message.role === "user" || message.role === "user-with-attachments";

/** A turn begins when the agent starts answering the latest learner message. */
export function beginTurn(sessionId: string, messages: readonly unknown[]) {
  if (!recording()) return;
  const learner = [...messages as Message[]].reverse().find(isLearner);
  const now = Date.now();
  const previous = openTurn(sessionId);
  const turn: LedgerTurn = { key: `turn-${++sequence}`, sessionId, status: "running", createdAt: now, updatedAt: now, extraction: [], memory: [],
    ...(timestampOf(learner) !== undefined ? { learnerTimestamp: timestampOf(learner) } : {}) };
  publish([...turns.map(row => row === previous ? { ...row, status: "cancelled" as const } : row), turn].slice(-MAX_TURNS));
}
export function finishTurn(sessionId: string, messages: readonly unknown[]) {
  const turn = openTurn(sessionId) ?? latest(sessionId, row => row.status === "running");
  if (!turn) return;
  const rows = messages as Message[];
  const learnerIndex = turn.learnerTimestamp === undefined ? -1 : rows.findIndex(row => isLearner(row) && row.timestamp === turn.learnerTimestamp);
  const assistant = rows.slice(learnerIndex + 1).reverse().find(row => row.role === "assistant");
  const cancelled = !assistant || assistant.stopReason === "aborted" || assistant.stopReason === "error";
  change(turn.key, row => ({ ...row, status: cancelled ? "cancelled" : "completed",
    ...(row.assistantTimestamp === undefined && timestampOf(assistant) !== undefined ? { assistantTimestamp: timestampOf(assistant) } : {}) }));
}
export function noteTurnDraft(sessionId: string, snapshot: TeachingDraftSnapshot) {
  const turn = openTurn(sessionId);
  if (!turn) return;
  const draft = projectTeachingDraftSnapshot(snapshot);
  change(turn.key, row => ({ ...row, draft }));
}
/** The draft gate publishes the assistant timestamp before the agent ends. */
export function noteTurnReceipt(sessionId: string, messageTimestamp: number, snapshot: TeachingDraftSnapshot) {
  const turn = openTurn(sessionId) ?? latest(sessionId, row => row.assistantTimestamp === messageTimestamp);
  if (!turn) return;
  const draft = projectTeachingDraftSnapshot(snapshot);
  change(turn.key, row => ({ ...row, draft, assistantTimestamp: messageTimestamp }));
}
export function noteTurnReplyReview(sessionId: string, assistantTimestamp: number | undefined, response: JudgementResponse, calibrated: boolean) {
  const turn = latest(sessionId, row => assistantTimestamp === undefined || row.assistantTimestamp === assistantTimestamp);
  if (!turn) return;
  const review: TurnReplyReview = { backend: response.backend.backend, model: safe(response.backend.model), calibrated,
    answers: Object.entries(response.answers).flatMap(([id, answer]) => answer.type === "choice" ? [{
      id: safe(id, 40), choice: safe(answer.choice, 80), confidence: answer.confidence,
      probabilities: Object.entries(answer.probabilities).slice(0, 24).map(([label, value]) => ({ label: safe(label, 80), value })),
    }] : []) };
  change(turn.key, row => ({ ...row, replyReview: review }));
}
/** Extraction reads the turn's learner or tutor message after the reply. */
export function noteTurnExtraction(sessionId: string, messageTimestamp: number | undefined, extraction: TurnExtraction) {
  if (messageTimestamp === undefined) return;
  const turn = latest(sessionId, row => extraction.role === "tutor" ? row.assistantTimestamp === messageTimestamp : row.learnerTimestamp === messageTimestamp);
  if (!turn) return;
  const quotes = keepQuotes();
  const entry: TurnExtraction = { ...extraction,
    ...(extraction.model ? { model: safe(extraction.model) } : {}),
    reasons: extraction.reasons.slice(0, 12).map(reason => safe(reason, 240)),
    items: extraction.items.slice(0, 12).map(({ quote, ...item }) => ({ ...item, ...(quotes && quote !== undefined ? { quote: quote.slice(0, 4000) } : {}) })) };
  change(turn.key, row => ({ ...row, extraction: [...row.extraction.filter(item => item.role !== extraction.role), entry] }));
}
/** Admission runs after the reply; decisions belong to the session's latest turn. */
export function noteTurnMemoryDecisions(sessionId: string, decisions: readonly MemoryAdmissionDecision[], scope: string, committed: boolean) {
  const turn = latest(sessionId);
  if (!turn || !decisions.length) return;
  const quotes = keepQuotes();
  const rows: TurnMemoryDecision[] = decisions.slice(0, 8).map(decision => ({
    candidate: quotes ? structuredClone(decision.candidate) : { ...decision.candidate, evidence: "", message: "" },
    accepted: decision.accepted, reason: decision.reason, category: decision.category, probability: decision.probability,
    threshold: decision.thresholds.worth?.actAtOrAbove ?? null,
    backend: decision.backend ? safe(`${decision.backend.backend}/${decision.backend.model}`) : null,
    scope, committed,
  }));
  change(turn.key, row => ({ ...row, memory: [...row.memory.filter(item => !rows.some(next => next.candidate.id === item.candidate.id)), ...rows].slice(-16) }));
}
