/**
 * Mobile parity join for the web training-set builder
 * (`computeSessionRewardedTurns` in `web/src/keating/reward.ts`).
 *
 * The SQLite `learner_records` table already persists the outcome channels —
 * `quiz_result`, `card_review`, `question_check`, `topic_evidence` — plus
 * `session` transcripts and `feedback_event` reactions via
 * `LearnerRecordStore`. This module shapes them into the same `RewardedTurn`
 * shape the web builder emits: one row per assistant turn, a weighted reward,
 * and `joinedBy` provenance inside a 10-minute `FEEDBACK_WINDOW_MS`.
 *
 * Channel mapping:
 *
 * - turns: assistant messages across all portable sessions.
 * - explicit: `feedback_event` by `messageId`, else by timestamp window.
 * - inferred: absent explicit feedback, the first later-timestamp user message
 *   in the same session, using the shared browser classifier and score mapping.
 * - quiz: first `quiz_result` in window wins; otherwise the newest in-window
 *   `card_review` (rating/3) for a deck on the turn's topic; otherwise the
 *   newest scored `question_check` on the turn's topic. One quiz slot, the
 *   way the web builder has one — the fallback order is documented, not
 *   averaged, so a grade never dilutes into a lapse.
 * - topic: `topic_evidence` never scores. When an evidence row references the
 *   joined record id, the turn takes the evidence topic.
 *
 * - `perQuestionMs` is consumed numerically via `summarizeQuizTimingMs`,
 *   never as prose.
 *
 * §0.1 evidence taxonomy: every row carries `evidenceSource: "proxy"`.
 * Joined rows are never `source: "observed"` and never touch
 * `eligibleForPromotion` — the join only reads benchmark/evolution history,
 * it never writes it.
 */
import {
  summarizeQuizTimingMs,
  type QuizTimingSummary,
} from "@keating/learner-contracts";
import { classifyLearnerTurnSignal } from "../../../shared/pedagogy/learner-turn-signal";
import { feedbackToOutcomeScore, type OutcomeSignal } from "../../../shared/pedagogy/benchmark-real";
import type {
  CardReviewRecord,
  FlashcardDeck,
  LearnerFeedbackEvent,
  LearnerQuestionCheck,
  LearnerQuizResult,
  LearnerSession,
  PortableLearnerData,
  TopicEvidence,
} from "@keating/learner-contracts";

/** Same window as web `FEEDBACK_WINDOW_MS`: feedback more than 10 minutes out is another turn's. */
export const MOBILE_FEEDBACK_WINDOW_MS = 10 * 60_000;
export const MOBILE_REWARD_NEUTRAL = 0.5;
/** Same blend as web `SIGNAL_WEIGHTS`; duplicated (not imported) so mobile never depends on the web bundle. */
export const MOBILE_SIGNAL_WEIGHTS = { explicit: 0.6, inferred: 0.15, quiz: 0.25 } as const;

/**
 * Proxy, always. A joined training row is never an observation of learning
 * and never promotes an evolution candidate.
 */
export const MOBILE_REWARDED_TURN_EVIDENCE_SOURCE = "proxy" as const;

export type MobileJoinedBy = "messageId" | "timestampWindow" | "nextTurn" | "sessionId" | "topicWindow";

export interface MobileRewardChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface MobileRewardSourceSignal {
  score: number;
  joinedBy: MobileJoinedBy;
  feedbackId?: string;
  quizResultId?: string;
  cardReviewId?: string;
  questionCheckId?: string;
  signal?: OutcomeSignal;
  /** Exact next user message in this rewarded turn's session; no copied learner text. */
  sourceMessageId?: string;
  /** Numeric consumption of `LearnerQuizTiming.perQuestionMs`; prose never reaches a training row. */
  timing?: QuizTimingSummary;
}

export interface MobileRewardedTurn {
  sessionId: string;
  messageId: string;
  topic: string;
  messageTimestamp?: number;
  context: MobileRewardChatMessage[];
  completion: string;
  reward: number | null;
  signals: {
    explicit?: MobileRewardSourceSignal;
    inferred?: MobileRewardSourceSignal;
    quiz?: MobileRewardSourceSignal;
  };
  scored: boolean;
  /** §0.1: always `"proxy"`; the type makes `"observed"` unrepresentable. */
  evidenceSource: typeof MOBILE_REWARDED_TURN_EVIDENCE_SOURCE;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return MOBILE_REWARD_NEUTRAL;
  return Math.max(0, Math.min(1, value));
}

function weightedMean(entries: Array<{ score: number; weight: number }>): number | null {
  const present = entries.filter((entry) => Number.isFinite(entry.score));
  const total = present.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  return clamp01(present.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / total);
}

function timeOf(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function quizScore(record: LearnerQuizResult): number {
  if (typeof record.partialCreditPoints === "number") {
    return clamp01(record.partialCreditPoints / Math.max(1, record.totalQuestions));
  }
  return clamp01(record.score / Math.max(1, record.totalQuestions));
}

function feedbackScore(rating: LearnerFeedbackEvent["rating"]): number {
  return rating === "helpful" ? 0.85 : 0.15;
}

function deckTopicById(decks: readonly FlashcardDeck[]): Map<string, string> {
  return new Map(decks.map((deck) => [deck.id, deck.topic]));
}

function topicMatches(recordTopic: string, turnTopic: string): boolean {
  return recordTopic.trim().toLowerCase() === turnTopic.trim().toLowerCase();
}

/**
 * Join portable learner records into rewarded turns. Pure: reads one
 * `PortableLearnerData` snapshot (as returned by `LearnerRecordStore`),
 * no disk, no clock, no network.
 */
export function computeMobileRewardedTurns(data: PortableLearnerData, options: { includeContext?: boolean } = {}): MobileRewardedTurn[] {
  const turns: MobileRewardedTurn[] = [];
  const assistantIds: Array<string | undefined> = [];
  const deckTopics = deckTopicById(data.decks);

  for (const session of data.sessions) {
    const topicFallback = session.title.trim() || "general";
    const relevant = session.messages.filter(
      (message) => message.role === "user" || message.role === "assistant",
    );
    for (let index = 0; index < relevant.length; index += 1) {
      const message = relevant[index];
      if (message.role !== "assistant" || !message.content.trim()) continue;
      const prior = options.includeContext === false ? [] : relevant.slice(0, index).map((entry): MobileRewardChatMessage => ({
        role: entry.role as "user" | "assistant",
        content: entry.content,
      }));
      turns.push({
        sessionId: session.id,
        messageId: message.id,
        topic: topicFallback,
        messageTimestamp: timeOf(message.createdAt) ?? undefined,
        context: prior,
        completion: message.content,
        reward: null,
        signals: {},
        scored: false,
        evidenceSource: MOBILE_REWARDED_TURN_EVIDENCE_SOURCE,
      });
      assistantIds.push(message.id);
    }
  }

  const usedFeedback = new Set<string>();
  turns.forEach((turn, turnIndex) => {
    const explicit = findExplicitSignal(turn, assistantIds[turnIndex], data, usedFeedback);
    if (explicit) turn.signals.explicit = explicit;
    else {
      const inferred = findInferredSignal(turn, data.sessions);
      if (inferred) turn.signals.inferred = inferred;
    }
    const quiz = findQuizSignal(turn, data, deckTopics);
    if (quiz) {
      turn.signals.quiz = quiz.signal;
      if (quiz.evidenceTopic) turn.topic = quiz.evidenceTopic;
    }
    const base = weightedMean([
      ...(turn.signals.explicit
        ? [{ score: turn.signals.explicit.score, weight: MOBILE_SIGNAL_WEIGHTS.explicit }]
        : []),
      ...(turn.signals.inferred ? [{ score: turn.signals.inferred.score, weight: MOBILE_SIGNAL_WEIGHTS.inferred }] : []),
      ...(turn.signals.quiz ? [{ score: turn.signals.quiz.score, weight: MOBILE_SIGNAL_WEIGHTS.quiz }] : []),
    ]);
    if (base === null) {
      turn.reward = null;
      turn.scored = false;
    } else {
      turn.reward = base;
      turn.scored = true;
    }
  });

  return turns;
}

/** Matches web next-turn selection exactly: the first user row with a later timestamp,
 * within the same session. No keyword scan past an unclassified next user message.
 */
function findInferredSignal(turn: MobileRewardedTurn, sessions: readonly LearnerSession[]): MobileRewardSourceSignal | null {
  if (typeof turn.messageTimestamp !== "number") return null;
  const session = sessions.find(session => session.id === turn.sessionId);
  const nextUser = session?.messages.find(message => {
    const timestamp = timeOf(message.createdAt);
    return message.role === "user" && timestamp !== null && timestamp > turn.messageTimestamp!;
  });
  if (!nextUser) return null;
  const signal = classifyLearnerTurnSignal(nextUser.content);
  return signal ? { score: feedbackToOutcomeScore(signal), joinedBy: "nextTurn", signal, sourceMessageId: nextUser.id } : null;
}

function findExplicitSignal(
  turn: MobileRewardedTurn,
  assistantId: string | undefined,
  data: PortableLearnerData,
  usedFeedback: Set<string>,
): MobileRewardSourceSignal | null {
  // A revised reaction supersedes its earlier value, independent of row order.
  const events = [...data.feedbackEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  for (const event of events) {
    if (usedFeedback.has(event.id) || event.sessionId !== turn.sessionId) continue;
    if (assistantId !== undefined && event.messageId === assistantId) {
      usedFeedback.add(event.id);
      return { score: feedbackScore(event.rating), joinedBy: "messageId", feedbackId: event.id };
    }
  }

  if (typeof turn.messageTimestamp !== "number") return null;
  const session = data.sessions.find(session => session.id === turn.sessionId);
  const nextAssistantTime = session?.messages.filter(message => message.role === "assistant")
    .map(message => timeOf(message.createdAt)).filter((time): time is number => time !== null && time > turn.messageTimestamp!)
    .sort((a, b) => a - b)[0];
  const candidates = events
    .filter((event) => {
      if (usedFeedback.has(event.id) || event.sessionId !== turn.sessionId) return false;
      // A known message binding must never be reassigned by the fallback join.
      if (session?.messages.some(message => message.id === event.messageId)) return false;
      const createdAt = timeOf(event.createdAt);
      return (
        createdAt !== null &&
        createdAt >= turn.messageTimestamp! &&
        (nextAssistantTime === undefined || createdAt < nextAssistantTime) &&
        createdAt < turn.messageTimestamp! + MOBILE_FEEDBACK_WINDOW_MS
      );
    })
    .sort((a, b) => Math.abs(timeOf(a.createdAt)! - turn.messageTimestamp!) - Math.abs(timeOf(b.createdAt)! - turn.messageTimestamp!));
  const winner = candidates[0];
  if (!winner) return null;
  usedFeedback.add(winner.id);
  return { score: feedbackScore(winner.rating), joinedBy: "timestampWindow", feedbackId: winner.id };
}

function evidenceTopicFor(data: PortableLearnerData, referenceId: string): string | null {
  const evidence: TopicEvidence | undefined = data.topicEvidence.find(
    (entry) => entry.reference?.id === referenceId,
  );
  return evidence ? evidence.topic : null;
}

function findQuizSignal(
  turn: MobileRewardedTurn,
  data: PortableLearnerData,
  deckTopics: Map<string, string>,
): { signal: MobileRewardSourceSignal; evidenceTopic?: string } | null {
  if (typeof turn.messageTimestamp !== "number") return null;
  const windowEnd = turn.messageTimestamp + MOBILE_FEEDBACK_WINDOW_MS;
  const session = data.sessions.find(session => session.id === turn.sessionId);
  const nextAssistantTime = session?.messages.filter(message => message.role === "assistant")
    .map(message => timeOf(message.createdAt)).filter((time): time is number => time !== null && time > turn.messageTimestamp!)
    .sort((a, b) => a - b)[0];
  const inWindow = (createdAt: string): boolean => {
    const parsed = timeOf(createdAt);
    return parsed !== null && parsed >= turn.messageTimestamp! && parsed < windowEnd
      && (nextAssistantTime === undefined || parsed < nextAssistantTime);
  };
  const unboundTopicMatches = (topic: string, createdAt: string): boolean => {
    if (!topicMatches(topic, turn.topic)) return false;
    const eventTime = timeOf(createdAt);
    if (eventTime === null) return false;
    // Legacy outcomes have no session id. Overlapping same-topic sessions are ambiguous.
    const possibleSessions = data.sessions.filter(candidate => topicMatches(candidate.title.trim() || "general", topic)
      && candidate.messages.some(message => {
        const timestamp = timeOf(message.createdAt);
        return message.role === "assistant" && timestamp !== null && timestamp <= eventTime
          && eventTime < timestamp + MOBILE_FEEDBACK_WINDOW_MS;
      }));
    return possibleSessions.length === 1 && possibleSessions[0].id === turn.sessionId;
  };

  const quiz = data.quizResults
    .filter((record) => {
      if (record.pendingGradeQuestionIds?.length || !Number.isFinite(record.score)
        || !Number.isFinite(record.totalQuestions) || record.totalQuestions <= 0
        || (record.partialCreditPoints !== undefined && !Number.isFinite(record.partialCreditPoints))) return false;
      if (!inWindow(record.createdAt)) return false;
      if (record.sessionId) return record.sessionId === turn.sessionId;
      return unboundTopicMatches(record.topic, record.createdAt);
    })
    .sort((a, b) => timeOf(b.createdAt)! - timeOf(a.createdAt)!)[0];
  if (quiz) {
    return {
      signal: {
        score: quizScore(quiz),
        joinedBy: quiz.sessionId ? "sessionId" : "topicWindow",
        quizResultId: quiz.id,
        timing: summarizeQuizTimingMs(quiz.timing?.perQuestionMs),
      },
      evidenceTopic: evidenceTopicFor(data, quiz.id) ?? undefined,
    };
  }

  const review = data.cardReviews
    .filter((record) => {
      if (!inWindow(record.createdAt)) return false;
      if (record.sessionId) return record.sessionId === turn.sessionId;
      const topic = deckTopics.get(record.deckId);
      return topic !== undefined && unboundTopicMatches(topic, record.createdAt);
    })
    .sort((a, b) => timeOf(b.createdAt)! - timeOf(a.createdAt)!)[0];
  if (review) {
    return {
      signal: {
        score: clamp01(review.rating / 3),
        joinedBy: review.sessionId ? "sessionId" : "topicWindow",
        cardReviewId: review.id,
      },
      evidenceTopic: evidenceTopicFor(data, review.id) ?? undefined,
    };
  }

  const check: LearnerQuestionCheck | undefined = data.questionChecks
    .filter((record) => {
      if (typeof record.score !== "number" || !Number.isFinite(record.score)) return false;
      if (record.grading !== "auto" && record.grading !== "model") return false;
      if (!inWindow(record.createdAt)) return false;
      if (record.sessionId) return record.sessionId === turn.sessionId;
      return unboundTopicMatches(record.topic, record.createdAt);
    })
    .sort((a, b) => timeOf(b.createdAt)! - timeOf(a.createdAt)!)[0];
  if (check) {
    return {
      signal: {
        score: clamp01(check.score!),
        joinedBy: check.sessionId ? "sessionId" : "topicWindow",
        questionCheckId: check.id,
      },
      evidenceTopic: evidenceTopicFor(data, check.id) ?? undefined,
    };
  }

  return null;
}

/** Sessions underpin the turn list; kept explicit so callers pass whole snapshots, not fragments. */
export type { LearnerSession };
