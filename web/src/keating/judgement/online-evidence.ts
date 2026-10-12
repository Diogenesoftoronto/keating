import { validatePortableLearnerData, type PortableLearnerData } from "@keating/learner-contracts";
import type { CardReviewRecord, FlashcardDeck, QuestionCheckRecord } from "../storage";

export interface WebOnlineEvidence { checks: QuestionCheckRecord[]; reviews: CardReviewRecord[]; decks: FlashcardDeck[] }

/** A local projection for numerical feature extraction, never an upload payload. */
export function webOnlineEvidence(evidence: WebOnlineEvidence, now: number): PortableLearnerData {
  const iso = (value: number) => new Date(value).toISOString();
  const data: PortableLearnerData = {
    generatedAt: iso(now), sessions: [], artifacts: [], goals: [], quizResults: [],
    studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
    questionChecks: evidence.checks.map(row => ({ id: row.id, topic: row.topic, question: row.question,
      answer: row.answer, createdAt: iso(row.createdAt), grading: row.grading,
      ...(row.score === undefined ? {} : { score: row.score }) })),
    decks: evidence.decks.map(deck => ({ id: deck.id, topic: deck.topic, title: deck.title,
      createdAt: iso(deck.createdAt), updatedAt: iso(deck.updatedAt),
      cards: deck.cards.map(card => ({ id: card.id, front: card.front, back: card.back, tags: card.tags ?? [],
        srs: { ease: card.srs.ease, intervalDays: card.srs.intervalDays, repetitions: card.srs.reps,
          lapses: card.srs.lapses, dueAt: iso(card.srs.dueAt), lastRating: card.srs.lastRating,
          lastReviewedAt: card.srs.lastReviewedAt ? iso(card.srs.lastReviewedAt) : null } })) })),
    cardReviews: evidence.reviews.filter(row => evidence.decks.some(deck => deck.id === row.deckId && deck.cards.some(card => card.id === row.cardId)))
      .map(row => ({ id: row.id, deckId: row.deckId, cardId: row.cardId, rating: row.rating,
        appliedIntervalDays: row.appliedIntervalDays, easeAfter: row.easeAfter, createdAt: iso(row.createdAt),
        ...(row.previousIntervalDays === undefined ? {} : { previousIntervalDays: row.previousIntervalDays }),
        ...(row.nextDueAt !== undefined && row.repetitionsAfter !== undefined && row.lapsesAfter !== undefined
          && row.previousIntervalDays !== undefined && row.isLapse !== undefined
          ? { nextDueAt: iso(row.nextDueAt), repetitionsAfter: row.repetitionsAfter, lapsesAfter: row.lapsesAfter, isLapse: row.isLapse }
          : { legacyScheduleUnknown: true as const }) })),
  };
  if (!validatePortableLearnerData(data)) throw new Error("Learning history cannot yet be verified for online predictions.");
  return data;
}
