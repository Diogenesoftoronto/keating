/**
 * Delivery of learner turns that the learner did not type into the composer:
 * quiz results, question-form answers, remediation/reframe requests and
 * OpenUI responses.
 *
 * Every such turn is a `PendingLearnerResponse`: it carries the session it was
 * submitted in and a stable submission id (`receiptId`), and is retained in
 * that session's conversation store (the same record canonical OpenUI receipts
 * use) until the conversation admits it. A delivery moves through:
 *   queued    – waiting for its own session to be active and idle;
 *   sending   – handed to that session's send path; one at a time;
 *   delivered – admitted to the saved transcript (or settled locally), firing
 *               the settle callback exactly once.
 * A turn is never sent into another session: it waits, in memory and in its
 * session's store, until that session is active again. While save-before-
 * switch runs for a session, `pauseLearnerDelivery` holds its deliveries.
 */
import type { PendingLearnerResponse } from "../../keating/event-store";
import type { ConversationRuntime } from "../../keating/integration/conversation-runtime";

/** Sends one turn's text; calls `onAdmitted` once the turn is durable. Resolves false when refused. */
export type DeliverySend = (serialized: string, onAdmitted: () => void) => Promise<boolean>;

export type DeliveryAdmission = "duplicate" | "queued";

export class LearnerDeliveryQueue {
  private readonly queued: PendingLearnerResponse[] = [];
  private readonly sending = new Set<string>();
  private readonly delivered = new Set<string>();

  /** True when this submission id is queued, sending, or already delivered here. */
  knows(receiptId: string): boolean {
    return this.sending.has(receiptId)
      || this.delivered.has(receiptId)
      || this.queued.some((item) => item.receiptId === receiptId);
  }

  admit(response: PendingLearnerResponse): DeliveryAdmission {
    if (this.knows(response.receiptId)) return "duplicate";
    this.queued.push(response);
    return "queued";
  }

  /**
   * The oldest queued turn of `sessionId`, removed from the queue, or nothing
   * while another delivery is in flight. Other sessions' turns stay queued.
   */
  next(sessionId: string): PendingLearnerResponse | undefined {
    if (this.sending.size > 0) return undefined;
    const index = this.queued.findIndex((item) => item.sessionId === sessionId);
    if (index < 0) return undefined;
    return this.queued.splice(index, 1)[0];
  }

  queuedFor(sessionId: string): number {
    return this.queued.filter((item) => item.sessionId === sessionId).length;
  }

  /** Delivers one turn. A refused send goes back to the front of the queue. */
  async deliver(
    response: PendingLearnerResponse,
    send: DeliverySend,
    onSettled: () => void,
  ): Promise<"delivered" | "refused"> {
    this.sending.add(response.receiptId);
    let settled = false;
    const settle = () => { if (!settled) { settled = true; onSettled(); } };
    try {
      const sent = await send(response.serialized, settle);
      if (!sent) {
        this.queued.unshift(response);
        return "refused";
      }
      // Local-only outcomes (unsupported attachment errors) never reach admission.
      settle();
      this.delivered.add(response.receiptId);
      return "delivered";
    } finally {
      this.sending.delete(response.receiptId);
    }
  }
}

let lastSubmissionMs = 0;
let submissionSequence = 0;

/** Identity a submission's serialized envelope can embed. */
export interface SubmissionIdentity {
  sessionMessageId: string;
  submittedAt: string;
}

/**
 * A new learner submission for `sessionId`. `createdAt` strictly increases
 * within the page, so the store's createdAt order is submission order.
 */
export function learnerSubmission({
  sessionId,
  serialized,
  submissionId,
  now = Date.now,
}: {
  sessionId: string;
  /** The turn's text, or a builder given the submission's stable identity. */
  serialized: string | ((identity: SubmissionIdentity) => string);
  /** A stable id the source already has (for example a quiz result id). */
  submissionId?: string;
  now?: () => number;
}): PendingLearnerResponse {
  const createdMs = Math.max(now(), lastSubmissionMs + 1);
  lastSubmissionMs = createdMs;
  submissionSequence += 1;
  const receiptId = submissionId
    ?? `learner-submission-${createdMs.toString(36)}-${submissionSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date(createdMs).toISOString();
  const sessionMessageId = `learner:${receiptId}`;
  return {
    version: 1,
    sessionId,
    receiptId,
    uiActionId: receiptId,
    sessionMessageId,
    serialized: typeof serialized === "string" ? serialized : serialized({ sessionMessageId, submittedAt: createdAt }),
    createdAt,
  };
}

/** Submission id of a finished quiz run; a repeated submit of the same run is a duplicate. */
export function quizSubmissionId(resultId: string): string {
  return `quiz-result:${resultId}`;
}

/** Visible text of each user turn, to recognise responses already admitted. */
export function transcriptUserTexts(
  messages: readonly { role: string; content?: unknown }[],
): Set<string> {
  return new Set(messages.flatMap((message) => {
    if (message.role !== "user") return [];
    const content = message.content as string | Array<{ type: string; text?: string }>;
    return [typeof content === "string" ? content
      : content.filter((part) => part.type === "text").map((part) => part.text).join("\n")];
  }));
}

/** Receipt id the conversation runtime assigns to a canonical OpenUI action. */
export function canonicalActionReceiptId(action: { documentId: string; idempotencyKey: string }): string {
  return `${action.documentId}-${action.idempotencyKey}`;
}

// ─── Save-before-switch coordination ───────────────────────────────────────

const pausedSessions = new Map<string, number>();
const pauseListeners = new Set<() => void>();

/**
 * Holds deliveries into `sessionId` until the returned release is called.
 * Navigation holds the outgoing session while it saves, so a queued turn can
 * never start a reply that the switch would then cancel. Holds nest.
 */
export function pauseLearnerDelivery(sessionId: string): () => void {
  pausedSessions.set(sessionId, (pausedSessions.get(sessionId) ?? 0) + 1);
  pauseListeners.forEach((listener) => listener());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (pausedSessions.get(sessionId) ?? 1) - 1;
    if (count > 0) pausedSessions.set(sessionId, count);
    else pausedSessions.delete(sessionId);
    pauseListeners.forEach((listener) => listener());
  };
}

export function learnerDeliveryPaused(sessionId: string | undefined): boolean {
  return sessionId !== undefined && pausedSessions.has(sessionId);
}

export function subscribeLearnerDeliveryPauses(listener: () => void): () => void {
  pauseListeners.add(listener);
  return () => { pauseListeners.delete(listener); };
}

// ─── Durable retention ─────────────────────────────────────────────────────

/** Window event asking the session's conversation store to retain a submission. */
export const RETAIN_LEARNER_RESPONSE_EVENT = "keating:learner-response-retain";

export interface RetainLearnerResponseDetail {
  response: PendingLearnerResponse;
  /** Set by the store handler once the response is written. */
  retained?: boolean;
}

/**
 * Retains `response` in its session's conversation store, as OpenUI actions
 * are persisted through `keating:openui-action`. Returns false when no store
 * is listening; the submission is then delivered from memory only.
 */
export function retainLearnerResponse(response: PendingLearnerResponse): boolean {
  if (typeof window === "undefined") return false;
  const detail: RetainLearnerResponseDetail = { response };
  window.dispatchEvent(new CustomEvent(RETAIN_LEARNER_RESPONSE_EVENT, { detail }));
  return detail.retained === true;
}

/**
 * The store side of `retainLearnerResponse`: writes each retained submission
 * into its own session's conversation store. Re-retaining a submission id is
 * a no-op in the store.
 */
export function createLearnerResponseRetainer(
  runtimeFor: (sessionId: string) => ConversationRuntime | null,
): (event: Event) => void {
  return (event) => {
    const detail = (event as CustomEvent<RetainLearnerResponseDetail>).detail;
    if (!detail?.response) return;
    const { sessionId, ...response } = detail.response;
    const runtime = runtimeFor(sessionId);
    if (!runtime) return;
    runtime.putPendingLearnerResponse(response);
    detail.retained = true;
  };
}
