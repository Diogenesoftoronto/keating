import {
  compareContractTimestamps,
  hasOnlyKeys,
  isBoundedArray,
  isBoundedString,
  isContractId,
  isContractTimestamp,
  isRecord,
} from "./validation.js";
import { MIN_EASE, type CardSrsState, validateCardSrsState } from "./srs.js";

export type ArtifactKind =
  | "note"
  | "explanation"
  | "study-plan"
  | "lesson-map"
  | "quiz"
  | "deck"
  | "image"
  | "animation"
  | "verification"
  | "document"
  | "other";

export type ArtifactFormat = "markdown" | "mermaid" | "quiz" | "openui" | "image" | "video" | "json" | "text";

export interface LearnerArtifact {
  id: string;
  kind: ArtifactKind;
  format: ArtifactFormat;
  title: string;
  createdAt: string;
  updatedAt: string;
  content?: string;
  sourceSessionId?: string;
  sourceMessageId?: string;
  /** An attachment is a reference, never local file bytes or a workspace path. */
  attachment?: {
    id: string;
    mimeType: string;
    sizeBytes: number;
    remoteUrl?: string;
  };
}

export type GoalStepStatus = "not_started" | "in_progress" | "done";

export interface LearnerGoal {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  steps: Array<{
    id: string;
    title: string;
    status: GoalStepStatus;
    successCriteria: string[];
  }>;
}

export interface LearnerQuestionCheck {
  id: string;
  topic: string;
  question: string;
  answer: string;
  createdAt: string;
  score?: number;
  grading: "auto" | "model" | "pending";
  misconception?: string;
  sessionId?: string;
}

export interface LearnerQuizResult {
  id: string;
  topic: string;
  createdAt: string;
  score: number;
  totalQuestions: number;
  answers: Record<string, string>;
  /** Aggregate score earned from partial-credit grading. */
  partialCreditPoints?: number;
  partialCredits?: Record<string, number>;
  /** Elapsed quiz and per-question time in milliseconds. */
  timing?: LearnerQuizTiming;
  flaggedQuestionIds?: string[];
  pendingGradeQuestionIds?: string[];
  skippedQuestionIds?: string[];
  sessionId?: string;
}

/** Dependency-free portable representation of quiz timing. */
export interface LearnerQuizTiming {
  totalMs: number;
  /** Only visited questions occur here; keys are stable question ids. */
  perQuestionMs: Record<string, number>;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  tags: string[];
  srs: CardSrsState;
}

export interface FlashcardDeck {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  cards: Flashcard[];
}

export interface CardReviewRecord {
  id: string;
  deckId: string;
  cardId: string;
  rating: 0 | 1 | 2 | 3;
  appliedIntervalDays: number;
  easeAfter: number;
  createdAt: string;
  sessionId?: string;
  /** Interval in effect immediately before this rating. */
  previousIntervalDays?: number;
  /** Canonical v2 outcome fields; legacy v1 records are marked rather than guessed. */
  nextDueAt?: string;
  repetitionsAfter?: number;
  lapsesAfter?: number;
  isLapse?: boolean;
  /** Set only by the explicit v1-to-v2 migration; it intentionally carries no schedule claim. */
  legacyScheduleUnknown?: true;
}

export type StudyPriority = "focus" | "maintain" | "low";
export type StudyPriorityTargetType = "deck" | "goal" | "topic" | "verification";

/** Explicit learner intent. It never changes evidence-based review scheduling. */
export interface StudyPriorityRecord {
  id: string;
  targetType: StudyPriorityTargetType;
  targetId: string;
  priority: StudyPriority;
  updatedAt: string;
}

export interface LearnerProfile {
  topicsExplored: string[];
  strengths: string[];
  weaknesses: string[];
  lastSessionAt?: string;
  sessionsCount: number;
}

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  "note", "explanation", "study-plan", "lesson-map", "quiz", "deck", "image", "animation", "verification", "document", "other",
]);
const ARTIFACT_FORMATS = new Set<ArtifactFormat>(["markdown", "mermaid", "quiz", "openui", "image", "video", "json", "text"]);
const GOAL_STEP_STATUSES = new Set<GoalStepStatus>(["not_started", "in_progress", "done"]);
const ARTIFACT_KEYS = new Set(["id", "kind", "format", "title", "createdAt", "updatedAt", "content", "sourceSessionId", "sourceMessageId", "attachment"]);
const ATTACHMENT_KEYS = new Set(["id", "mimeType", "sizeBytes", "remoteUrl"]);
const GOAL_KEYS = new Set(["id", "title", "description", "updatedAt", "steps"]);
const GOAL_STEP_KEYS = new Set(["id", "title", "status", "successCriteria"]);
const QUESTION_CHECK_KEYS = new Set(["id", "topic", "question", "answer", "createdAt", "score", "grading", "misconception", "sessionId"]);
const QUIZ_RESULT_KEYS = new Set(["id", "topic", "createdAt", "score", "totalQuestions", "answers", "partialCreditPoints", "partialCredits", "timing", "flaggedQuestionIds", "pendingGradeQuestionIds", "skippedQuestionIds", "sessionId"]);
const QUIZ_TIMING_KEYS = new Set(["totalMs", "perQuestionMs"]);
const DECK_KEYS = new Set(["id", "title", "topic", "createdAt", "updatedAt", "cards"]);
const FLASHCARD_KEYS = new Set(["id", "front", "back", "tags", "srs"]);
const CARD_REVIEW_KEYS = new Set(["id", "deckId", "cardId", "rating", "appliedIntervalDays", "easeAfter", "createdAt", "sessionId", "previousIntervalDays", "nextDueAt", "repetitionsAfter", "lapsesAfter", "isLapse", "legacyScheduleUnknown"]);
const STUDY_PRIORITY_KEYS = new Set(["id", "targetType", "targetId", "priority", "updatedAt"]);
const PROFILE_KEYS = new Set(["topicsExplored", "strengths", "weaknesses", "lastSessionAt", "sessionsCount"]);
const MAX_CONTENT_LENGTH = 1_048_576;
const MAX_TEXT_LENGTH = 16_384;
const MAX_TITLE_LENGTH = 512;
const MAX_STEPS = 128;
const MAX_CARDS = 512;
const MAX_TAGS = 64;
const MAX_QUIZ_QUESTIONS = 512;
const MAX_ATTACHMENT_BYTES = 100_000_000;

function hasOrderedTimestamps(createdAt: unknown, updatedAt: unknown): boolean {
  return isContractTimestamp(createdAt) && isContractTimestamp(updatedAt)
    && compareContractTimestamps(updatedAt, createdAt) >= 0;
}

function hasSafeRemoteUrl(value: unknown): value is string {
  if (!isBoundedString(value, 4096, false)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function validateLearnerArtifact(value: unknown): value is LearnerArtifact {
  if (!hasOnlyKeys(value, ARTIFACT_KEYS)) return false;
  const artifact = value as Partial<LearnerArtifact>;
  if (!isContractId(artifact.id) || !ARTIFACT_KINDS.has(artifact.kind as ArtifactKind)
    || !ARTIFACT_FORMATS.has(artifact.format as ArtifactFormat)
    || !isBoundedString(artifact.title, MAX_TITLE_LENGTH, false) || !hasOrderedTimestamps(artifact.createdAt, artifact.updatedAt)
    || (artifact.content !== undefined && !isBoundedString(artifact.content, MAX_CONTENT_LENGTH))
    || (artifact.sourceSessionId !== undefined && !isContractId(artifact.sourceSessionId))
    || (artifact.sourceMessageId !== undefined && !isContractId(artifact.sourceMessageId))) return false;
  if (artifact.attachment === undefined) return true;
  const attachment = artifact.attachment;
  return hasOnlyKeys(attachment, ATTACHMENT_KEYS) && isContractId(attachment.id)
    && isBoundedString(attachment.mimeType, 256, false)
    && typeof attachment.sizeBytes === "number" && Number.isSafeInteger(attachment.sizeBytes)
    && attachment.sizeBytes >= 0 && attachment.sizeBytes <= MAX_ATTACHMENT_BYTES
    && (attachment.remoteUrl === undefined || hasSafeRemoteUrl(attachment.remoteUrl));
}

export function validateLearnerGoal(value: unknown): value is LearnerGoal {
  if (!hasOnlyKeys(value, GOAL_KEYS)) return false;
  const goal = value as Partial<LearnerGoal>;
  if (!isContractId(goal.id) || !isBoundedString(goal.title, MAX_TITLE_LENGTH, false) || !isBoundedString(goal.description, MAX_TEXT_LENGTH)
    || !isContractTimestamp(goal.updatedAt) || !isBoundedArray(goal.steps, MAX_STEPS)) return false;
  const ids = new Set<string>();
  return goal.steps.every((step) => {
    if (!hasOnlyKeys(step, GOAL_STEP_KEYS) || ids.has(step.id) || !isContractId(step.id)
      || !isBoundedString(step.title, MAX_TITLE_LENGTH, false) || !GOAL_STEP_STATUSES.has(step.status)
      || !isBoundedArray(step.successCriteria, MAX_TAGS) || !step.successCriteria.every((criterion) => isBoundedString(criterion, MAX_TEXT_LENGTH))) return false;
    ids.add(step.id);
    return true;
  });
}

export function validateLearnerQuestionCheck(value: unknown): value is LearnerQuestionCheck {
  if (!hasOnlyKeys(value, QUESTION_CHECK_KEYS)) return false;
  const check = value as Partial<LearnerQuestionCheck>;
  return isContractId(check.id) && isBoundedString(check.topic, MAX_TITLE_LENGTH, false) && isBoundedString(check.question, MAX_TEXT_LENGTH)
    && isBoundedString(check.answer, MAX_TEXT_LENGTH) && isContractTimestamp(check.createdAt)
    && (check.score === undefined || (typeof check.score === "number" && Number.isFinite(check.score) && check.score >= 0 && check.score <= 1))
    && (check.grading === "auto" || check.grading === "model" || check.grading === "pending")
    && (check.misconception === undefined || isBoundedString(check.misconception, MAX_TEXT_LENGTH))
    && (check.sessionId === undefined || isContractId(check.sessionId));
}

export function validateLearnerQuizResult(value: unknown): value is LearnerQuizResult {
  if (!hasOnlyKeys(value, QUIZ_RESULT_KEYS)) return false;
  const quiz = value as Partial<LearnerQuizResult>;
  if (!isContractId(quiz.id) || !isBoundedString(quiz.topic, MAX_TITLE_LENGTH, false) || !isContractTimestamp(quiz.createdAt)
    || typeof quiz.totalQuestions !== "number" || !Number.isSafeInteger(quiz.totalQuestions) || quiz.totalQuestions < 1 || quiz.totalQuestions > MAX_QUIZ_QUESTIONS
    || typeof quiz.score !== "number" || !Number.isFinite(quiz.score) || quiz.score < 0 || quiz.score > quiz.totalQuestions
    || !isRecord(quiz.answers) || Object.keys(quiz.answers).length > quiz.totalQuestions || !Object.keys(quiz.answers).every(isContractId)
    || !Object.values(quiz.answers).every((answer) => isBoundedString(answer, MAX_TEXT_LENGTH))) return false;
  if (quiz.partialCredits !== undefined && (!isRecord(quiz.partialCredits)
    || Object.keys(quiz.partialCredits).length > quiz.totalQuestions || !Object.keys(quiz.partialCredits).every(isContractId)
    || !Object.values(quiz.partialCredits).every((credit) =>
      typeof credit === "number" && Number.isFinite(credit) && credit >= 0 && credit <= 1))) return false;
  return (quiz.partialCreditPoints === undefined || (typeof quiz.partialCreditPoints === "number"
    && Number.isFinite(quiz.partialCreditPoints) && quiz.partialCreditPoints >= 0 && quiz.partialCreditPoints <= quiz.totalQuestions))
    && (quiz.timing === undefined || validateLearnerQuizTiming(quiz.timing, quiz.totalQuestions))
    && (quiz.flaggedQuestionIds === undefined || validateQuizQuestionIds(quiz.flaggedQuestionIds, quiz.totalQuestions))
    && (quiz.pendingGradeQuestionIds === undefined || validateQuizQuestionIds(quiz.pendingGradeQuestionIds, quiz.totalQuestions))
    && (quiz.skippedQuestionIds === undefined || validateQuizQuestionIds(quiz.skippedQuestionIds, quiz.totalQuestions))
    && (quiz.sessionId === undefined || isContractId(quiz.sessionId));
}

function validateQuizQuestionIds(value: unknown, totalQuestions: number): value is string[] {
  return isBoundedArray(value, totalQuestions)
    && new Set(value).size === value.length && value.every(isContractId);
}

function validateLearnerQuizTiming(value: unknown, totalQuestions: number): value is LearnerQuizTiming {
  if (!hasOnlyKeys(value, QUIZ_TIMING_KEYS)) return false;
  const timing = value as Partial<LearnerQuizTiming>;
  return typeof timing.totalMs === "number" && Number.isSafeInteger(timing.totalMs) && timing.totalMs >= 0
    && isRecord(timing.perQuestionMs) && Object.keys(timing.perQuestionMs).length <= totalQuestions
    && Object.entries(timing.perQuestionMs).every(([questionId, elapsed]) => isContractId(questionId)
      && typeof elapsed === "number" && Number.isSafeInteger(elapsed) && elapsed >= 0);
}

export function validateFlashcardDeck(value: unknown): value is FlashcardDeck {
  if (!hasOnlyKeys(value, DECK_KEYS)) return false;
  const deck = value as Partial<FlashcardDeck>;
  if (!isContractId(deck.id) || !isBoundedString(deck.title, MAX_TITLE_LENGTH, false) || !isBoundedString(deck.topic, MAX_TITLE_LENGTH, false)
    || !hasOrderedTimestamps(deck.createdAt, deck.updatedAt) || !isBoundedArray(deck.cards, MAX_CARDS)) return false;
  const ids = new Set<string>();
  return deck.cards.every((card) => {
    if (!hasOnlyKeys(card, FLASHCARD_KEYS) || !isContractId(card.id) || ids.has(card.id)
      || !isBoundedString(card.front, MAX_TEXT_LENGTH) || !isBoundedString(card.back, MAX_TEXT_LENGTH)
      || !isBoundedArray(card.tags, MAX_TAGS) || !card.tags.every((tag) => isBoundedString(tag, 256, false))
      || !validateCardSrsState(card.srs)) return false;
    ids.add(card.id);
    return true;
  });
}

export function validateCardReviewRecord(value: unknown): value is CardReviewRecord {
  if (!hasOnlyKeys(value, CARD_REVIEW_KEYS)) return false;
  const review = value as Partial<CardReviewRecord>;
  if (!isContractId(review.id) || !isContractId(review.deckId) || !isContractId(review.cardId)
    || (review.rating !== 0 && review.rating !== 1 && review.rating !== 2 && review.rating !== 3)
    || typeof review.appliedIntervalDays !== "number" || !Number.isSafeInteger(review.appliedIntervalDays) || review.appliedIntervalDays < 0
    || typeof review.easeAfter !== "number" || !Number.isFinite(review.easeAfter) || review.easeAfter < MIN_EASE
    || !isContractTimestamp(review.createdAt)
    || (review.sessionId !== undefined && !isContractId(review.sessionId))) return false;
  if (review.previousIntervalDays !== undefined
    && (typeof review.previousIntervalDays !== "number" || !Number.isFinite(review.previousIntervalDays) || review.previousIntervalDays < 0)) return false;
  if (review.legacyScheduleUnknown === true) {
    return review.nextDueAt === undefined && review.repetitionsAfter === undefined
      && review.lapsesAfter === undefined && review.isLapse === undefined;
  }
  if (review.legacyScheduleUnknown !== undefined) return false;
  return typeof review.previousIntervalDays === "number"
    && typeof review.nextDueAt === "string" && isContractTimestamp(review.nextDueAt)
    && typeof review.repetitionsAfter === "number" && Number.isSafeInteger(review.repetitionsAfter) && review.repetitionsAfter >= 0
    && typeof review.lapsesAfter === "number" && Number.isSafeInteger(review.lapsesAfter) && review.lapsesAfter >= 0
    && typeof review.isLapse === "boolean" && review.isLapse === (review.rating === 0)
    && (review.rating === 0 ? review.appliedIntervalDays === 0 && review.repetitionsAfter === 0 : review.appliedIntervalDays >= 1 && review.repetitionsAfter >= 1);
}

export function validateStudyPriorityRecord(value: unknown): value is StudyPriorityRecord {
  if (!hasOnlyKeys(value, STUDY_PRIORITY_KEYS)) return false;
  const priority = value as Partial<StudyPriorityRecord>;
  if (!isContractId(priority.id)
    || (priority.targetType !== "deck" && priority.targetType !== "goal" && priority.targetType !== "topic" && priority.targetType !== "verification")
    || (priority.priority !== "focus" && priority.priority !== "maintain" && priority.priority !== "low")
    || !isContractTimestamp(priority.updatedAt)) return false;
  return priority.targetType === "topic"
    ? isBoundedString(priority.targetId, MAX_TITLE_LENGTH, false)
    : isContractId(priority.targetId);
}

export function validateLearnerProfile(value: unknown): value is LearnerProfile {
  if (!hasOnlyKeys(value, PROFILE_KEYS)) return false;
  const profile = value as Partial<LearnerProfile>;
  return isBoundedArray(profile.topicsExplored, MAX_QUIZ_QUESTIONS) && profile.topicsExplored.every((value) => isBoundedString(value, MAX_TITLE_LENGTH, false))
    && isBoundedArray(profile.strengths, MAX_QUIZ_QUESTIONS) && profile.strengths.every((value) => isBoundedString(value, MAX_TEXT_LENGTH, false))
    && isBoundedArray(profile.weaknesses, MAX_QUIZ_QUESTIONS) && profile.weaknesses.every((value) => isBoundedString(value, MAX_TEXT_LENGTH, false))
    && typeof profile.sessionsCount === "number" && Number.isSafeInteger(profile.sessionsCount) && profile.sessionsCount >= 0
    && (profile.lastSessionAt === undefined || isContractTimestamp(profile.lastSessionAt));
}
