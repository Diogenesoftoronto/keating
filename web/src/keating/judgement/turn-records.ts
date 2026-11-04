/**
 * What was judged for one tutor turn, and the reviewer's corrections to it.
 * Records are device-local review data. Labels never change a released reply
 * or a recorded grade; only memory overrides change later tutor context.
 */
import type { LearningExtractionKind, MemoryAdmissionCandidate, MemoryAdmissionReason } from "@keating/learner-contracts";

export interface TurnExtractionItem {
  kind: LearningExtractionKind;
  messageId: string;
  start: number;
  end: number;
  /** Exact source passage; present only while saving for review or redacted details are on. */
  quote?: string;
}
export interface TurnExtraction {
  /** Which message of the turn was read. */
  role: "learner" | "tutor";
  status: "completed" | "abstained" | "failed" | "unavailable";
  model?: string;
  elapsedMs?: number;
  items: TurnExtractionItem[];
  reasons: string[];
}
export interface TurnMemoryDecision {
  candidate: MemoryAdmissionCandidate;
  accepted: boolean;
  reason: MemoryAdmissionReason;
  category: string | null;
  /** Raw P(worth remembering), not learner truth. */
  probability: number | null;
  /** Calibrated act-at-or-above threshold for the worth question. */
  threshold: number | null;
  backend: string | null;
  /** Memory account the decision was committed under. */
  scope: string;
  committed: boolean;
}
export interface TurnReplyReviewAnswer {
  id: string;
  choice: string;
  confidence: number;
  probabilities: { label: string; value: number }[];
}
export interface TurnReplyReview {
  backend: string;
  model: string;
  calibrated: boolean;
  answers: TurnReplyReviewAnswer[];
}
export interface TurnJudgementRecord {
  /** `${sessionId}:${assistantTimestamp}`, the same key as the draft receipt. */
  id: string;
  sessionId: string;
  assistantTimestamp: number;
  learnerTimestamp?: number;
  createdAt: number;
  updatedAt: number;
  replyReview?: TurnReplyReview;
  extraction: TurnExtraction[];
  memory: TurnMemoryDecision[];
}

export type DraftCheckVerdict = "violation" | "no-violation";
export type MemoryVerdict = "admit" | "reject";
export type JudgementLabelTarget =
  | { kind: "draft-check"; attempt: number; checkId: string }
  | { kind: "memory-admission"; candidateId: string; scope: string };
export interface JudgementLabelRecord {
  id: string;
  sessionId: string;
  assistantTimestamp: number;
  target: JudgementLabelTarget;
  /** What the judgement model said, frozen when the label was made. */
  model: { status?: string; probability: number | null; category?: string | null; accepted?: boolean; judge?: string | null };
  verdict: DraftCheckVerdict | MemoryVerdict;
  /** Reviewer category for an admitted memory. */
  category?: string;
  note?: string;
  /** Whether the label changed what later turns see. */
  effect: "none" | "applied" | "pending-account" | "failed";
  /** Candidate kept with a memory label so an admission can be applied later. */
  candidate?: MemoryAdmissionCandidate;
  createdAt: number;
  updatedAt: number;
}

export const turnRecordId = (sessionId: string, assistantTimestamp: number) => `${sessionId}:${assistantTimestamp}`;
export function judgementLabelId(sessionId: string, assistantTimestamp: number, target: JudgementLabelTarget): string {
  return target.kind === "draft-check"
    ? `${sessionId}:${assistantTimestamp}:check:${target.attempt}:${target.checkId}`
    : `${sessionId}:${assistantTimestamp}:memory:${target.candidateId}`;
}
