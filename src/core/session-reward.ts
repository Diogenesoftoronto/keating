/**
 * CLI equivalent of the web training-set join (`computeSessionRewardedTurns`
 * in `web/src/keating/reward.ts`).
 *
 * This is the pure join consumed by CLI export. Durable, source-bound events
 * live in learner-events.ts; this module itself performs no persistence. It
 * deliberately
 * mirroring the web join (same `joinedBy` provenance vocabulary, same
 * `FEEDBACK_WINDOW_MS`, same signal weights) without importing or changing
 * web code.
 *
 * Two honest narrowings, both structural:
 *
 * - Legacy state-only feedback and quiz records can use window joins when
 *   explicitly supplied. Production export supplies only source-bound events.
 * - Missing durable message identity or timing cannot establish a join.
 *
 * §0.1 evidence taxonomy: every row this module produces is a training-row
 * precursor with proxy provenance. Rows must never be written with
 * `source: "observed"` and must never flip `eligibleForPromotion` — see
 * `CLI_REWARDED_TURN_EVIDENCE_SOURCE` and the taxonomy test.
 */
import { summarizeQuizTimingMs, type QuizTimingSummary } from "../../packages/learner-contracts/src/judgement/assessment.js";
import { feedbackToOutcomeScore } from "./benchmark-real.js";
import { inferLearnerTurnSignal } from "./learner-turn-analysis.js";
import { resolveTopic } from "./topics.js";
import type { LearnerState, QuizResultRecord } from "./types.js";

/** Same window as web: feedback more than 10 minutes out is another turn's. */
export const CLI_FEEDBACK_WINDOW_MS = 10 * 60_000;
export const CLI_REWARD_NEUTRAL = 0.5;
/** Same blend as web `SIGNAL_WEIGHTS`; duplicated (not imported) so CLI never depends on the web bundle. */
export const CLI_SIGNAL_WEIGHTS = { explicit: 0.6, inferred: 0.15, quiz: 0.25 } as const;

/**
 * Proxy, always. A judgement-derived or feedback-joined row is never an
 * observation of learning and never promotes an evolution candidate.
 */
export const CLI_REWARDED_TURN_EVIDENCE_SOURCE = "proxy" as const;

export type CliJoinedBy = "messageId" | "timestampWindow" | "nextTurn" | "sessionId" | "topicWindow";

export interface CliRewardChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CliRewardMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

export interface CliRewardSourceSignal {
  score: number;
  joinedBy: CliJoinedBy;
  signal?: LearnerState["feedback"][number]["signal"];
  /** Numeric consumption of `LearnerQuizTiming.perQuestionMs`; prose never reaches a training row. */
  timing?: QuizTimingSummary;
  sourceId?: string;
  sourceMessageId?: string;
}

export interface CliRewardedTurn {
  sessionId: string;
  messageId?: string;
  topic: string;
  messageTimestamp?: number;
  context: CliRewardChatMessage[];
  completion: string;
  reward: number;
  signals: {
    explicit?: CliRewardSourceSignal;
    inferred?: CliRewardSourceSignal;
    quiz?: CliRewardSourceSignal;
  };
  scored: boolean;
  /** §0.1: always `"proxy"`; the type makes `"observed"` unrepresentable. */
  evidenceSource: typeof CLI_REWARDED_TURN_EVIDENCE_SOURCE;
}

export interface CliQuizWithTiming extends QuizResultRecord {
  sessionId?: string;
  messageId?: string;
  sourceId?: string;
  timing?: { totalMs?: number; perQuestionMs?: Record<string, number> };
}
export type CliFeedbackWithSource = LearnerState["feedback"][number] & {
  sessionId?: string; messageId?: string; sourceId?: string;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return CLI_REWARD_NEUTRAL;
  return Math.max(0, Math.min(1, value));
}

function weightedMean(entries: Array<{ score: number; weight: number }>): number | null {
  const present = entries.filter((entry) => Number.isFinite(entry.score));
  const total = present.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  return clamp01(present.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / total);
}

function feedbackTime(entry: LearnerState["feedback"][number]): number | null {
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function quizTime(quiz: QuizResultRecord): number | null {
  const parsed = Date.parse(quiz.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Join one CLI session's messages, feedback, and quiz results into rewarded
 * turns. Messages come from the session JSON file; feedback and quizzes come
 * from `LearnerState`. Pure: no disk, no clock, no network.
 */
export function computeCliRewardedTurns({
  sessionId,
  topic,
  messages,
  feedback,
  quizResults,
}: {
  sessionId: string;
  topic?: string;
  messages: CliRewardMessage[];
  feedback: ReadonlyArray<CliFeedbackWithSource>;
  quizResults: ReadonlyArray<CliQuizWithTiming>;
}): CliRewardedTurn[] {
  const topicFallback = topic?.trim() || "general";
  const turns: CliRewardedTurn[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.content.trim()) continue;
    const prior = messages.slice(0, index).map((entry): CliRewardChatMessage => ({
      role: entry.role,
      content: entry.content,
    }));
    turns.push({
      sessionId,
      messageId: message.id,
      topic: topicFallback,
      messageTimestamp: message.timestamp,
      context: prior,
      completion: message.content,
      reward: CLI_REWARD_NEUTRAL,
      signals: {},
      scored: false,
      evidenceSource: CLI_REWARDED_TURN_EVIDENCE_SOURCE,
    });
  }

  const usedFeedback = new Set<number>();
  for (const turn of turns) {
    const explicit = findExplicitSignal(turn, messages, feedback, usedFeedback);
    if (explicit) turn.signals.explicit = explicit;
    if (!explicit) {
      const inferred = findInferredSignal(turn, messages, topicFallback);
      if (inferred) turn.signals.inferred = inferred;
    }
    const quiz = findQuizSignal(turn, messages, quizResults, topicFallback);
    if (quiz) turn.signals.quiz = quiz;
    const base = weightedMean([
      ...(turn.signals.explicit
        ? [{ score: turn.signals.explicit.score, weight: CLI_SIGNAL_WEIGHTS.explicit }]
        : []),
      ...(turn.signals.inferred
        ? [{ score: turn.signals.inferred.score, weight: CLI_SIGNAL_WEIGHTS.inferred }]
        : []),
      ...(turn.signals.quiz ? [{ score: turn.signals.quiz.score, weight: CLI_SIGNAL_WEIGHTS.quiz }] : []),
    ]);
    if (base === null) {
      turn.reward = CLI_REWARD_NEUTRAL;
      turn.scored = false;
    } else {
      turn.reward = base;
      turn.scored = true;
    }
  }

  return turns;
}

function findExplicitSignal(
  turn: CliRewardedTurn,
  messages: CliRewardMessage[],
  feedback: ReadonlyArray<CliFeedbackWithSource>,
  usedFeedback: Set<number>,
): CliRewardSourceSignal | null {
  if (typeof turn.messageTimestamp !== "number") return null;
  const nextUser = messages.find(
    (message) =>
      message.role === "user" &&
      typeof message.timestamp === "number" &&
      message.timestamp > turn.messageTimestamp!,
  );
  const end = Math.min(nextUser?.timestamp ?? Infinity, turn.messageTimestamp + CLI_FEEDBACK_WINDOW_MS);
  let winner: { index: number; distance: number } | null = null;
  for (let index = 0; index < feedback.length; index += 1) {
    const entry = feedback[index];
    if (usedFeedback.has(index)) continue;
    if (entry.sessionId !== undefined && entry.sessionId !== turn.sessionId) continue;
    if (entry.messageId !== undefined && entry.messageId !== turn.messageId) continue;
    const createdAt = feedbackTime(entry);
    if (createdAt === null || createdAt < turn.messageTimestamp! || createdAt >= end) continue;
    const distance = Math.abs(createdAt - turn.messageTimestamp!);
    if (!winner || distance < winner.distance) winner = { index, distance };
  }
  if (!winner) return null;
  usedFeedback.add(winner.index);
  const entry = feedback[winner.index];
  return {
    score: feedbackToOutcomeScore(entry.signal),
    joinedBy: entry.messageId ? "messageId" : "timestampWindow",
    signal: entry.signal,
    sourceId: entry.sourceId,
  };
}

function findInferredSignal(
  turn: CliRewardedTurn,
  messages: CliRewardMessage[],
  topicFallback: string,
): CliRewardSourceSignal | null {
  if (typeof turn.messageTimestamp !== "number") return null;
  const nextUser = turn.messageId !== undefined
    ? messages[messages.findIndex(message => message.id === turn.messageId) + 1]
    : messages.find(
    (message) =>
      message.role === "user" &&
      typeof message.timestamp === "number" &&
      message.timestamp > turn.messageTimestamp!,
  );
  if (!nextUser || nextUser.role !== "user" || typeof nextUser.timestamp !== "number"
    || nextUser.timestamp <= turn.messageTimestamp || nextUser.timestamp >= turn.messageTimestamp + CLI_FEEDBACK_WINDOW_MS) return null;
  const inferred = inferLearnerTurnSignal(nextUser.content, topicFallback);
  if (!inferred) return null;
  return {
    score: feedbackToOutcomeScore(inferred.signal),
    joinedBy: "nextTurn",
    signal: inferred.signal,
    sourceMessageId: nextUser.id,
  };
}

function findQuizSignal(
  turn: CliRewardedTurn,
  messages: CliRewardMessage[],
  quizResults: ReadonlyArray<CliQuizWithTiming>,
  topicFallback: string,
): CliRewardSourceSignal | null {
  if (typeof turn.messageTimestamp !== "number") return null;
  const fallbackSlug = resolveTopic(topicFallback).slug;
  const candidates = quizResults.filter((record) => {
    if (record.sessionId !== undefined && record.sessionId !== turn.sessionId) return false;
    if (record.messageId !== undefined && record.messageId !== turn.messageId) return false;
    const createdAt = quizTime(record);
    if (createdAt === null || createdAt < turn.messageTimestamp!) return false;
    if (createdAt >= turn.messageTimestamp! + CLI_FEEDBACK_WINDOW_MS) return false;
    if (!record.messageId && resolveTopic(record.topic).slug !== fallbackSlug) return false;
    const laterAssistant = messages.find(
      (message) =>
        message.role === "assistant" &&
        typeof message.timestamp === "number" &&
        message.timestamp > turn.messageTimestamp! &&
        message.timestamp <= createdAt,
    );
    return !laterAssistant;
  });
  candidates.sort((a, b) => quizTime(b)! - quizTime(a)!);
  const winner = candidates[0];
  if (!winner) return null;
  return {
    score: clamp01(winner.score),
    joinedBy: winner.messageId ? "messageId" : "topicWindow",
    timing: summarizeQuizTimingMs(winner.timing?.perQuestionMs),
    sourceId: winner.sourceId,
  };
}
