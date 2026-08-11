import {
  validatePortableLearnerData,
  type LearnerQuestionCheck,
  type LearnerQuizResult,
  type PortableLearnerData,
} from "@keating/learner-contracts";

/** Matches the web learner-profile thresholds while keeping activity separate from performance. */
export const LEARNER_PROGRESS_THRESHOLDS = {
  needsReviewBelow: 0.45,
  strongMasteryAtLeast: 0.75,
  strongRetentionAtLeast: 0.65,
  strongConfidenceAtLeast: 0.35,
  confidenceWeightForFullScale: 5,
  quizWeight: 1.2,
  questionCheckWeight: 0.8,
  reviewBaseWeight: 0.3,
  reviewIntervalWeightCap: 0.7,
  reviewIntervalWeightDays: 21,
} as const;

export type LearnerTopicStatus = "insufficient" | "needs-review" | "developing" | "strong";

export interface LearnerGoalProgress {
  id: string;
  title: string;
  description: string;
  updatedAt: number;
  completedSteps: number;
  totalSteps: number;
  progress: number;
  /** The first unfinished step in the stored order, never a generated action. */
  nextIncompleteStep: {
    id: string;
    title: string;
    status: "not_started" | "in_progress";
    successCriteria: string[];
  } | null;
}

export interface RecentAssessedResult {
  id: string;
  kind: "question-check" | "quiz-result";
  score: number;
  createdAt: number;
}

export interface LearnerTopicProgress {
  topic: string;
  /** Evidence of activity only; it never contributes to mastery or retention. */
  activityCount: number;
  feedbackCount: number;
  lastActivityAt: number | null;
  /** Performance evidence only: scored question checks and normalized quiz results. */
  mastery: number | null;
  /** Recall evidence only: normalized card-review ratings. */
  retention: number | null;
  /** Bounded evidence weight, with its sources and count exposed below. */
  confidence: number;
  confidenceEvidenceWeight: number;
  evidenceCount: number;
  scoredEvidenceCount: number;
  reviewCount: number;
  pendingAssessmentCount: number;
  recentAssessedResult: RecentAssessedResult | null;
  status: LearnerTopicStatus;
}

export interface LearnerProgressDashboard {
  now: number;
  goals: LearnerGoalProgress[];
  topics: LearnerTopicProgress[];
  derivedStrengthTopics: string[];
  derivedWeaknessTopics: string[];
  /** Stored learner context is shown as such and is never reclassified as a derived score. */
  learnerRecordedContext: {
    topicsExplored: string[];
    strengths: string[];
    weaknesses: string[];
    sessionsCount: number;
    lastSessionAt: number | null;
  };
}

interface TopicAccumulator {
  topic: string;
  activityCount: number;
  feedbackCount: number;
  lastActivityAt: number | null;
  masteryEvidence: Array<{ score: number; weight: number; result: RecentAssessedResult }>;
  reviewEvidence: Array<{ score: number; weight: number; createdAt: number }>;
  pendingAssessmentCount: number;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Portable learner data contains an unrepresentable timestamp: ${value}`);
  return parsed;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function weightedMean(evidence: ReadonlyArray<{ score: number; weight: number }>): number | null {
  const weight = evidence.reduce((total, item) => total + item.weight, 0);
  if (!(weight > 0)) return null;
  return clamp01(evidence.reduce((total, item) => total + item.score * item.weight, 0) / weight);
}

function topicKey(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function compareTopics(left: LearnerTopicProgress, right: LearnerTopicProgress): number {
  const leftLatest = Math.max(
    left.lastActivityAt ?? Number.NEGATIVE_INFINITY,
    left.recentAssessedResult?.createdAt ?? Number.NEGATIVE_INFINITY,
  );
  const rightLatest = Math.max(
    right.lastActivityAt ?? Number.NEGATIVE_INFINITY,
    right.recentAssessedResult?.createdAt ?? Number.NEGATIVE_INFINITY,
  );
  return rightLatest - leftLatest || left.topic.localeCompare(right.topic);
}

function statusFor(mastery: number | null, retention: number | null, confidence: number): LearnerTopicStatus {
  if (mastery === null) return "insufficient";
  if (mastery < LEARNER_PROGRESS_THRESHOLDS.needsReviewBelow
    || (retention !== null && retention < LEARNER_PROGRESS_THRESHOLDS.needsReviewBelow)) return "needs-review";
  if (confidence >= LEARNER_PROGRESS_THRESHOLDS.strongConfidenceAtLeast
    && mastery >= LEARNER_PROGRESS_THRESHOLDS.strongMasteryAtLeast
    && (retention === null || retention >= LEARNER_PROGRESS_THRESHOLDS.strongRetentionAtLeast)) return "strong";
  return "developing";
}

function checkResult(check: LearnerQuestionCheck): RecentAssessedResult | null {
  if (check.score === undefined) return null;
  return { id: check.id, kind: "question-check", score: clamp01(check.score), createdAt: timestamp(check.createdAt) };
}

function quizResult(quiz: LearnerQuizResult): RecentAssessedResult | null {
  const pending = new Set(quiz.pendingGradeQuestionIds ?? []);
  let score: number;
  if (pending.size > 0) {
    // A mixed quiz may carry provisional heuristic credit for open-ended
    // answers. Only objective/non-pending question credit is mastery evidence.
    const assessed = Object.entries(quiz.partialCredits ?? {})
      .filter(([questionId]) => !pending.has(questionId));
    if (assessed.length === 0) return null;
    score = assessed.reduce((total, [, credit]) => total + credit, 0) / assessed.length;
  } else {
    score = quiz.score / quiz.totalQuestions;
  }
  return {
    id: quiz.id,
    kind: "quiz-result",
    score: clamp01(score),
    createdAt: timestamp(quiz.createdAt),
  };
}

function latestResult(results: readonly RecentAssessedResult[]): RecentAssessedResult | null {
  return [...results].sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))[0] ?? null;
}

/**
 * Creates a deterministic, evidence-labelled dashboard projection.
 *
 * It deliberately does not use session titles, topic activity, explicit
 * feedback, or recorded strengths/weaknesses as a performance score.
 */
export function buildLearnerProgress(data: PortableLearnerData, now: number): LearnerProgressDashboard {
  if (!validatePortableLearnerData(data)) throw new Error("Cannot project invalid portable learner data.");
  if (!Number.isFinite(now)) throw new Error("Learner progress requires a finite supplied clock.");

  const byTopic = new Map<string, TopicAccumulator>();
  const getTopic = (label: string): TopicAccumulator => {
    const normalized = topicKey(label);
    const existing = byTopic.get(normalized);
    if (existing) return existing;
    const next: TopicAccumulator = {
      topic: label.trim().replace(/\s+/g, " "),
      activityCount: 0,
      feedbackCount: 0,
      lastActivityAt: null,
      masteryEvidence: [],
      reviewEvidence: [],
      pendingAssessmentCount: 0,
    };
    byTopic.set(normalized, next);
    return next;
  };

  // Topic evidence is exposure/activity only. It establishes a dashboard row,
  // but cannot add a score, confidence weight, mastery, or retention value.
  for (const evidence of data.topicEvidence) {
    const topic = getTopic(evidence.topic);
    topic.activityCount += 1;
    topic.lastActivityAt = Math.max(topic.lastActivityAt ?? Number.NEGATIVE_INFINITY, timestamp(evidence.createdAt));
  }
  for (const topic of data.learnerProfile.topicsExplored) getTopic(topic);

  for (const check of data.questionChecks) {
    const topic = getTopic(check.topic);
    const result = checkResult(check);
    if (!result) {
      topic.pendingAssessmentCount += 1;
      continue;
    }
    topic.masteryEvidence.push({ score: result.score, weight: LEARNER_PROGRESS_THRESHOLDS.questionCheckWeight, result });
  }
  for (const quiz of data.quizResults) {
    const topic = getTopic(quiz.topic);
    const result = quizResult(quiz);
    if (result) {
      topic.masteryEvidence.push({ score: result.score, weight: LEARNER_PROGRESS_THRESHOLDS.quizWeight, result });
    }
    if ((quiz.pendingGradeQuestionIds?.length ?? 0) > 0) topic.pendingAssessmentCount += 1;
  }

  const deckTopics = new Map(data.decks.map((deck) => [deck.id, deck.topic]));
  for (const review of data.cardReviews) {
    const deckTopic = deckTopics.get(review.deckId);
    // The contract validator already guarantees deck/card references. Keep this
    // guard so a future loosened import cannot manufacture an unknown topic.
    if (!deckTopic) continue;
    const intervalWeight = Math.min(
      LEARNER_PROGRESS_THRESHOLDS.reviewIntervalWeightCap,
      Math.max(0, review.appliedIntervalDays) / LEARNER_PROGRESS_THRESHOLDS.reviewIntervalWeightDays,
    );
    getTopic(deckTopic).reviewEvidence.push({
      score: review.rating / 3,
      weight: LEARNER_PROGRESS_THRESHOLDS.reviewBaseWeight + intervalWeight,
      createdAt: timestamp(review.createdAt),
    });
  }

  // Reactions are explicitly visible, but lack a portable topic field and are
  // never translated into performance. They cannot manufacture topic rows.
  for (const feedback of data.feedbackEvents) {
    const session = data.sessions.find((candidate) => candidate.id === feedback.sessionId);
    const evidence = data.topicEvidence.find((candidate) => candidate.reference?.kind === "session"
      && candidate.reference.id === session?.id);
    if (evidence) getTopic(evidence.topic).feedbackCount += 1;
  }

  const topics = [...byTopic.values()].map((entry): LearnerTopicProgress => {
    const mastery = weightedMean(entry.masteryEvidence);
    const retention = weightedMean(entry.reviewEvidence);
    const confidenceEvidenceWeight = entry.masteryEvidence.reduce((total, item) => total + item.weight, 0)
      + entry.reviewEvidence.reduce((total, item) => total + item.weight, 0);
    const confidence = clamp01(confidenceEvidenceWeight / LEARNER_PROGRESS_THRESHOLDS.confidenceWeightForFullScale);
    const recentAssessedResult = latestResult(entry.masteryEvidence.map((item) => item.result));
    return {
      topic: entry.topic,
      activityCount: entry.activityCount,
      feedbackCount: entry.feedbackCount,
      lastActivityAt: entry.lastActivityAt,
      mastery,
      retention,
      confidence,
      confidenceEvidenceWeight,
      evidenceCount: entry.masteryEvidence.length + entry.reviewEvidence.length,
      scoredEvidenceCount: entry.masteryEvidence.length,
      reviewCount: entry.reviewEvidence.length,
      pendingAssessmentCount: entry.pendingAssessmentCount,
      recentAssessedResult,
      status: statusFor(mastery, retention, confidence),
    };
  }).sort(compareTopics);

  const goals = data.goals.map((goal): LearnerGoalProgress => {
    const completedSteps = goal.steps.filter((step) => step.status === "done").length;
    const totalSteps = goal.steps.length;
    const next = goal.steps.find((step) => step.status !== "done") ?? null;
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      updatedAt: timestamp(goal.updatedAt),
      completedSteps,
      totalSteps,
      progress: totalSteps === 0 ? 0 : completedSteps / totalSteps,
      nextIncompleteStep: next && next.status !== "done" ? {
        id: next.id,
        title: next.title,
        status: next.status,
        successCriteria: [...next.successCriteria],
      } : null,
    };
  });

  return {
    now,
    goals,
    topics,
    derivedStrengthTopics: topics.filter((topic) => topic.status === "strong").map((topic) => topic.topic),
    derivedWeaknessTopics: topics.filter((topic) => topic.status === "needs-review").map((topic) => topic.topic),
    learnerRecordedContext: {
      topicsExplored: [...data.learnerProfile.topicsExplored],
      strengths: [...data.learnerProfile.strengths],
      weaknesses: [...data.learnerProfile.weaknesses],
      sessionsCount: data.learnerProfile.sessionsCount,
      lastSessionAt: data.learnerProfile.lastSessionAt ? timestamp(data.learnerProfile.lastSessionAt) : null,
    },
  };
}
