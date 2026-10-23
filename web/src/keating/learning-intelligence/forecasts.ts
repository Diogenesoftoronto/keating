import { forecastLearningSuccess, forecastLearningReview, isLearningForecastInterval, type LearningOutcomePoint } from "@keating/learner-contracts";
import type { CardReviewRecord, FlashcardDeck, QuestionCheckRecord } from "../storage";
import type { ExtractionRequest, ExtractionAnswer } from "./provider";

export interface LearningHistory {
  checks: readonly QuestionCheckRecord[];
  reviews: readonly CardReviewRecord[];
  decks: readonly FlashcardDeck[];
}
export interface LearningForecastTarget {
  id: string;
  label: string;
  measure: "graded-answer-score" | "self-reported-card-rating";
  observedCount: number;
  baseline: number | null;
  dueAt?: number;
  maximum: number;
}
export interface LearningForecastProposal extends LearningForecastTarget {
  status: "insufficient-history" | "unvalidated-model-proposal" | "abstained";
  p10?: number;
  median?: number;
  p90?: number;
}

/** Only saved, graded answers and actual review ratings enter a series. No model labels do. */
export function learningOutcomeHistory(history: LearningHistory, now: number): LearningOutcomePoint[] {
  return [
    ...history.checks.filter(row => row.grading !== "pending" && typeof row.score === "number" && Number.isFinite(row.score)
      && row.score >= 0 && row.score <= 1 && Number.isFinite(row.createdAt) && row.createdAt <= now)
      .map(row => ({ id: row.id, targetId: `topic:${row.topic}`, kind: "quiz" as const, at: new Date(row.createdAt).toISOString(), value: row.score! })),
    ...history.reviews.filter(row => Number.isInteger(row.rating) && row.rating >= 0 && row.rating <= 3 && Number.isFinite(row.createdAt) && row.createdAt <= now)
      .map(row => ({ id: row.id, targetId: `card:${row.deckId}:${row.cardId}`, kind: "card" as const, at: new Date(row.createdAt).toISOString(), value: row.rating })),
  ];
}

/** One next-assessment series and one next-scheduled-review series, never a mastery score. */
export function buildLearningForecastBatch(history: LearningHistory, now: number, sessionId?: string): {
  request: ExtractionRequest | null; targets: LearningForecastTarget[]; points: LearningOutcomePoint[];
} {
  const points = learningOutcomeHistory(history, now), iso = new Date(now).toISOString();
  const checks = history.checks.filter(row => row.grading !== "pending" && typeof row.score === "number" && row.createdAt <= now)
    .sort((a, b) => b.createdAt - a.createdAt);
  const topic = (sessionId ? checks.find(row => row.sessionId === sessionId) : undefined)?.topic ?? checks[0]?.topic;
  const targets: LearningForecastTarget[] = [];
  if (topic) {
    const baseline = forecastLearningSuccess(points, { targetId: `topic:${topic}`, kind: "quiz", now: iso });
    targets.push({ id: baseline.targetId, label: "Next graded answer", measure: "graded-answer-score", observedCount: baseline.observedCount,
      baseline: baseline.median, maximum: 1 });
  }
  const cards = history.decks.flatMap(deck => deck.cards.filter(card => Number.isFinite(card.srs.dueAt))
    .map(card => ({ deck, card, count: points.filter(point => point.targetId === `card:${deck.id}:${card.id}`).length })))
    .sort((a, b) => a.card.srs.dueAt - b.card.srs.dueAt || a.card.id.localeCompare(b.card.id));
  const next = cards[0];
  if (next) {
    const baseline = forecastLearningReview(points, { targetId: `card:${next.deck.id}:${next.card.id}`, now: iso,
      dueAt: new Date(next.card.srs.dueAt).toISOString() });
    targets.push({ id: baseline.targetId, label: "Recall at the next scheduled review", measure: "self-reported-card-rating",
      observedCount: baseline.observedCount, baseline: baseline.median, dueAt: next.card.srs.dueAt, maximum: 3 });
  }
  const fields: ExtractionRequest["fields"] = {}, series: unknown[] = [];
  targets.forEach((target, index) => {
    if (target.baseline === null) return;
    const observations = [...new Map(points.filter(point => point.targetId === target.id).map(point => [point.id, point])).values()]
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).slice(-32);
    const observedById = new Map(observations.map(row => [row.id, row]));
    const actualIntervals = target.measure === "self-reported-card-rating"
      ? [...new Map(history.reviews.filter(row => {
        const observed = observedById.get(row.id);
        return `card:${row.deckId}:${row.cardId}` === target.id && observed?.value === row.rating && Date.parse(observed.at) === row.createdAt;
      }).map(row => [row.id, row])).values()]
        .sort((a, b) => a.createdAt - b.createdAt).slice(-32)
        .map((row, index, rows) => ({ at: new Date(row.createdAt).toISOString(), rating: row.rating,
          elapsedDays: index > 0 ? (row.createdAt - rows[index - 1]!.createdAt) / 86_400_000 : null,
          scheduledIntervalDays: row.previousIntervalDays ?? null })) : undefined;
    series.push({ field: `series_${index}`, measure: target.measure, observations: observations.map(row => ({ at: row.at, value: row.value })),
      ...(actualIntervals ? { reviewIntervals: actualIntervals, nextReviewAt: new Date(Math.max(now, target.dueAt!)).toISOString() } : {}) });
    fields[`series_${index}`] = { type: "forecast", horizon: 1, interval: "step", min: 0, max: target.maximum,
      instructions: target.measure === "graded-answer-score"
        ? `Forecast the next saved graded answer fraction for series_${index}. Scores are 0 to 1. This is not long-term learner success or mastery.`
        : `Forecast the learner's next self-reported 0 to 3 recall rating at nextReviewAt for series_${index}, considering recorded review gaps. This is not an objective forgetting probability or a date of forgetting.` };
  });
  return { targets, points, request: series.length ? { state: JSON.stringify({ asOf: iso, series }), fields } : null };
}

export function readLearningForecasts(targets: readonly LearningForecastTarget[], answers?: Record<string, ExtractionAnswer>): LearningForecastProposal[] {
  return targets.map((target, index) => {
    if (target.baseline === null) return { ...target, status: "insufficient-history" };
    const answer = answers?.[`series_${index}`];
    const interval = answer && (answer.p_null === undefined || answer.p_null <= 0.5) && { p10: Array.isArray(answer.p10) ? answer.p10[0] : answer.p10,
      median: Array.isArray(answer.median) ? answer.median[0] : answer.median, p90: Array.isArray(answer.p90) ? answer.p90[0] : answer.p90 };
    return interval && isLearningForecastInterval(interval, 0, target.maximum)
      ? { ...target, ...interval, status: "unvalidated-model-proposal" }
      : { ...target, status: "abstained" };
  });
}
