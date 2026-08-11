import {
  applyReview,
  isDue,
  validateFlashcardDeck,
  validatePortableLearnerData,
  validateStudyPriorityRecord,
  type CardReviewRecord,
  type Flashcard,
  type FlashcardDeck,
  type PortableLearnerData,
  type SrsRating,
  type StudyPriority,
  type StudyPriorityRecord,
  type StudyPriorityTargetType,
} from "@keating/learner-contracts";
import type { LearnerProgressDashboard } from "./learner-progress";

const MS_PER_DAY = 86_400_000;

export type ComingUpTargetType = "deck" | "goal" | "verification" | "topic";

export interface ComingUpItem {
  id: string;
  targetId: string;
  targetType: ComingUpTargetType;
  priority: StudyPriority;
  prioritySource: "learner" | "recommended";
  title: string;
  /** A factual stored topic where one exists; labels never create mastery. */
  topic: string;
  description: string;
  dueCount: number;
  overdueCount: number;
  /** Only future cards contribute; a due card is never repeated as "next". */
  nextDueAt: string | null;
  estimatedMinutes: number;
  cardCount: number;
  createdAt: string;
}

export interface ComingUp {
  items: ComingUpItem[];
  lanes: Record<StudyPriority, ComingUpItem[]>;
  dueCardCount: number;
  overdueCardCount: number;
  estimatedMinutes: number;
  dueDeckIds: string[];
}

export interface ReviewQueueItem {
  deckId: string;
  deckTitle: string;
  deckTopic: string;
  card: Flashcard;
  dueAt: string;
  overdue: boolean;
}

export interface PortableReviewInput {
  reviewId: string;
  createdAt: string;
  sessionId?: string;
}

export interface PortableReviewResult {
  deck: FlashcardDeck;
  review: CardReviewRecord;
}

export interface StudyPriorityInput {
  id: string;
  targetType: StudyPriorityTargetType;
  targetId: string;
  priority: StudyPriority;
  updatedAt: string;
}

function time(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Study scheduling requires canonical timestamps.");
  return parsed;
}

function normalizedTopic(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function priorityMap(records: readonly StudyPriorityRecord[]): Map<string, StudyPriorityRecord> {
  return new Map(records.map((record) => [`${record.targetType}:${record.targetId}`, record]));
}

function laneFor(
  priorities: Map<string, StudyPriorityRecord>,
  targetType: ComingUpTargetType,
  targetId: string,
  topic: string,
  recommended: StudyPriority,
): Pick<ComingUpItem, "priority" | "prioritySource"> {
  const exact = priorities.get(`${targetType}:${targetId}`);
  // A topic-level choice applies to factual work in that topic only when the
  // learner has not made a more specific deck/goal/verification choice.
  const topicChoice = priorities.get(`topic:${topic}`);
  const saved = exact ?? topicChoice;
  return saved ? { priority: saved.priority, prioritySource: "learner" } : { priority: recommended, prioritySource: "recommended" };
}

function compareUrgency(left: ComingUpItem, right: ComingUpItem): number {
  const leftNext = left.nextDueAt ? time(left.nextDueAt) : Number.POSITIVE_INFINITY;
  const rightNext = right.nextDueAt ? time(right.nextDueAt) : Number.POSITIVE_INFINITY;
  return right.overdueCount - left.overdueCount
    || right.dueCount - left.dueCount
    || leftNext - rightNext
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

function deckItem(deck: FlashcardDeck, priorities: Map<string, StudyPriorityRecord>, nowIso: string): ComingUpItem {
  const now = time(nowIso);
  const due = deck.cards.filter((card) => isDue(card.srs, nowIso));
  const overdue = due.filter((card) => time(card.srs.dueAt) < now - MS_PER_DAY);
  const futureDueAt = deck.cards
    .map((card) => card.srs.dueAt)
    .filter((dueAt) => time(dueAt) > now)
    .sort()[0] ?? null;
  return {
    id: `deck:${deck.id}`,
    targetId: deck.id,
    targetType: "deck",
    ...laneFor(priorities, "deck", deck.id, deck.topic, due.length > 0 ? "focus" : "maintain"),
    title: deck.title,
    topic: deck.topic,
    description: "Spaced-repetition deck",
    dueCount: due.length,
    overdueCount: overdue.length,
    nextDueAt: futureDueAt,
    estimatedMinutes: due.length > 0 ? Math.max(1, Math.ceil(due.length * 1.25)) : 0,
    cardCount: deck.cards.length,
    createdAt: deck.createdAt,
  };
}

function topicForLabel(label: string, progress: LearnerProgressDashboard): string {
  const key = normalizedTopic(label);
  return progress.topics.find((topic) => normalizedTopic(topic.topic) === key)?.topic ?? label;
}

/**
 * A conservative mobile Coming Up projection. It only uses portable records:
 * deck scheduling, incomplete goals, saved verification artifacts, and topics
 * with assessed evidence marked needs-review. It never derives a task from
 * activity, session titles, or an unassessed quiz.
 */
export function buildComingUp(
  data: PortableLearnerData,
  progress: LearnerProgressDashboard,
  nowIso: string,
): ComingUp {
  if (!validatePortableLearnerData(data)) throw new Error("Cannot build Coming Up from invalid portable learner data.");
  const now = time(nowIso);
  if (progress.now !== now) throw new Error("Coming Up requires progress calculated with the same supplied clock.");
  const priorities = priorityMap(data.studyPriorities);
  const items: ComingUpItem[] = data.decks.map((deck) => deckItem(deck, priorities, nowIso));
  const coveredTopics = new Set(data.decks.map((deck) => normalizedTopic(deck.topic)));

  for (const goal of data.goals.filter((candidate) => candidate.steps.some((step) => step.status !== "done"))) {
    // Goals do not carry an arbitrary hidden topic. Exact label matching is the
    // only conservative way to avoid duplicating an assessed-topic item.
    const topic = topicForLabel(goal.title, progress);
    coveredTopics.add(normalizedTopic(topic));
    const completed = goal.steps.filter((step) => step.status === "done").length;
    items.push({
      id: `goal:${goal.id}`,
      targetId: goal.id,
      targetType: "goal",
      ...laneFor(priorities, "goal", goal.id, topic, completed > 0 ? "focus" : "maintain"),
      title: goal.title,
      topic,
      description: goal.steps.find((step) => step.status !== "done")?.title ?? goal.description,
      dueCount: 0,
      overdueCount: 0,
      nextDueAt: null,
      estimatedMinutes: 5,
      cardCount: 0,
      createdAt: goal.updatedAt,
    });
  }

  for (const artifact of data.artifacts.filter((candidate) => candidate.kind === "verification")) {
    const topic = topicForLabel(artifact.title, progress);
    coveredTopics.add(normalizedTopic(topic));
    items.push({
      id: `verification:${artifact.id}`,
      targetId: artifact.id,
      targetType: "verification",
      ...laneFor(priorities, "verification", artifact.id, topic, "maintain"),
      title: artifact.title,
      topic,
      description: artifact.content?.trim().split("\n").find(Boolean)?.replace(/^[-*\d.)\s]+/, "") || "Saved verification",
      dueCount: 0,
      overdueCount: 0,
      nextDueAt: null,
      estimatedMinutes: 5,
      cardCount: 0,
      createdAt: artifact.createdAt,
    });
  }

  for (const topic of progress.topics.filter((candidate) => candidate.status === "needs-review")) {
    if (coveredTopics.has(normalizedTopic(topic.topic))) continue;
    items.push({
      id: `topic:${topic.topic}`,
      targetId: topic.topic,
      targetType: "topic",
      ...laneFor(priorities, "topic", topic.topic, topic.topic, "focus"),
      title: topic.topic,
      topic: topic.topic,
      description: "Needs a fresh retrieval check",
      dueCount: 0,
      overdueCount: 0,
      nextDueAt: null,
      estimatedMinutes: 8,
      cardCount: 0,
      createdAt: new Date(now).toISOString(),
    });
  }

  const sorted = [...items].sort(compareUrgency);
  const lanes: ComingUp["lanes"] = { focus: [], maintain: [], low: [] };
  for (const item of sorted) lanes[item.priority].push(item);
  const rank: Record<StudyPriority, number> = { focus: 0, maintain: 1, low: 2 };
  const dueDeckIds = sorted
    .filter((item) => item.targetType === "deck" && item.dueCount > 0)
    .sort((left, right) => rank[left.priority] - rank[right.priority] || compareUrgency(left, right))
    .map((item) => item.targetId);

  return {
    items: sorted,
    lanes,
    dueCardCount: sorted.reduce((total, item) => total + item.dueCount, 0),
    overdueCardCount: sorted.reduce((total, item) => total + item.overdueCount, 0),
    estimatedMinutes: sorted.reduce((total, item) => total + item.estimatedMinutes, 0),
    dueDeckIds,
  };
}

/** Globally stable due-card order, optionally limited to one or more deck ids. */
export function buildReviewQueue(
  data: PortableLearnerData,
  nowIso: string,
  deckIds?: readonly string[],
): ReviewQueueItem[] {
  if (!validatePortableLearnerData(data)) throw new Error("Cannot build a review queue from invalid portable learner data.");
  const now = time(nowIso);
  const allowed = deckIds ? new Set(deckIds) : null;
  return data.decks
    .filter((deck) => !allowed || allowed.has(deck.id))
    .flatMap((deck) => deck.cards.filter((card) => isDue(card.srs, nowIso)).map((card) => ({
      deckId: deck.id,
      deckTitle: deck.title,
      deckTopic: deck.topic,
      card: structuredClone(card),
      dueAt: card.srs.dueAt,
      overdue: time(card.srs.dueAt) < now - MS_PER_DAY,
    })))
    .sort((left, right) => time(left.dueAt) - time(right.dueAt)
      || left.card.id.localeCompare(right.card.id)
      || left.deckId.localeCompare(right.deckId));
}

/**
 * Applies one grade using the canonical v2 scheduler. The original deck stays
 * untouched; the only changed values in the returned deck are its updatedAt
 * and the rated card's SRS state.
 */
export function applyPortableCardReview(
  deck: FlashcardDeck,
  cardId: string,
  rating: SrsRating,
  input: PortableReviewInput,
): PortableReviewResult {
  if (!validateFlashcardDeck(deck)) throw new Error("Cannot review an invalid portable deck.");
  if (time(input.createdAt) < time(deck.createdAt)) throw new Error("A card review cannot predate its deck.");
  const card = deck.cards.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error("The requested review card is not in this deck.");
  const outcome = applyReview(card.srs, rating, input.createdAt);
  const review: CardReviewRecord = {
    id: input.reviewId,
    deckId: deck.id,
    cardId,
    rating,
    appliedIntervalDays: outcome.appliedIntervalDays,
    easeAfter: outcome.next.ease,
    createdAt: input.createdAt,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    previousIntervalDays: card.srs.intervalDays,
    nextDueAt: outcome.next.dueAt,
    repetitionsAfter: outcome.next.repetitions,
    lapsesAfter: outcome.next.lapses,
    isLapse: outcome.isLapse,
  };
  const updated: FlashcardDeck = {
    ...deck,
    updatedAt: input.createdAt,
    cards: deck.cards.map((candidate) => candidate.id === cardId
      ? { ...candidate, srs: outcome.next }
      : structuredClone(candidate)),
  };
  if (!validateFlashcardDeck(updated)) throw new Error("Card review produced an invalid portable deck.");
  return { deck: updated, review };
}

/** Builds one canonical priority record. Full target-reference validation occurs with its PortableLearnerData owner. */
export function createStudyPriority(input: StudyPriorityInput): StudyPriorityRecord {
  const record: StudyPriorityRecord = { ...input };
  if (!validateStudyPriorityRecord(record)) throw new Error("Cannot create an invalid study priority.");
  return record;
}
