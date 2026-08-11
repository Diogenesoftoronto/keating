import {
  applyReview,
  dueAtAfterReview,
  type PortableLearnerData,
  type UiAnswer,
  type UiAction,
  type UiDocument,
  type UiDocumentNode,
  type UiQuestion,
  type UiQuestionGroupResponse,
  type UiStudyPlanItem,
} from "@keating/learner-contracts";
import { createDeckWithCards } from "./learner-decks";
import { appendQuestionChecks, appendQuizResult, recordCardReview } from "./learner-mutations";
import type { UiActionMutationResult } from "./learner-repository";

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${shortHash(parts.join(":"))}`;
}

function actionTarget(document: UiDocument, nodeId: string): { node: UiDocumentNode; question?: UiQuestion; questionPrompt?: string } {
  for (const node of document.nodes) {
    if (node.id === nodeId) return { node, questionPrompt: node.type === "question" ? node.prompt : undefined };
    if (node.type === "quiz" || node.type === "question-group") {
      const question = node.questions.find((candidate) => candidate.id === nodeId);
      if (question) return { node, question, questionPrompt: question.prompt };
    }
  }
  throw new Error(`OpenUI action target ${nodeId} is missing.`);
}

function nextDocument(
  source: UiDocument,
  now: string,
  update: (nodes: UiDocumentNode[]) => UiDocumentNode[] = (nodes) => nodes,
  lifecycle: UiDocument["lifecycle"] = "ready",
): UiDocument {
  return {
    ...source,
    revision: source.revision + 1,
    lifecycle,
    nodes: update(structuredClone(source.nodes)),
    updatedAt: now,
  };
}

function answerText(action: Extract<UiAction, { type: "submit-answer" | "choose-option" }>, document: UiDocument): string {
  if (action.type === "submit-answer") return serializeAnswer(action.answer);
  const target = actionTarget(document, action.nodeId);
  const question = target.node.type === "question" ? target.node : target.question;
  const labels = new Map(question?.choices?.map((choice) => [choice.id, choice.label]) ?? []);
  return action.optionIds.map((id) => labels.get(id) ?? id).join(", ");
}

function serializeAnswer(answer: UiAnswer): string {
  if (typeof answer === "string") return answer;
  if (answer.every((entry) => typeof entry === "string")) return answer.join(", ");
  return JSON.stringify(answer);
}

function updatePlanItem(items: readonly UiStudyPlanItem[], itemId: string, completed: boolean): UiStudyPlanItem[] {
  return items.map((item) => ({
    ...item,
    ...(item.id === itemId ? { status: completed ? "done" as const : "not_started" as const } : {}),
    ...(item.children ? { children: updatePlanItem(item.children, itemId, completed) } : {}),
  }));
}

function upsertArtifact(current: PortableLearnerData, artifact: PortableLearnerData["artifacts"][number]): PortableLearnerData {
  const exists = current.artifacts.some((candidate) => candidate.id === artifact.id);
  return {
    ...current,
    artifacts: exists
      ? current.artifacts.map((candidate) => candidate.id === artifact.id ? artifact : candidate)
      : [...current.artifacts, artifact],
  };
}

function autoGrade(question: UiQuestion, values: readonly string[], rows?: readonly { optionId: string }[]):
  | { grading: "auto"; score: number }
  | { grading: "pending" } {
  const expected = question.correctAnswers ?? (question.correctAnswer === undefined ? undefined : [question.correctAnswer]);
  if (expected?.length) {
    const normalize = (value: string) => value.trim().toLocaleLowerCase();
    const actual = new Set(values.map(normalize));
    const required = new Set(expected.map(normalize));
    return { grading: "auto", score: actual.size === required.size && [...actual].every((value) => required.has(value)) ? 1 : 0 };
  }
  if (question.correctMatches && rows) {
    return { grading: "auto", score: rows.every((row, index) => row.optionId === question.correctMatches?.[index]) ? 1 : 0 };
  }
  return { grading: "pending" };
}

function questionGroupAnswerText(response: UiQuestionGroupResponse, question: UiQuestion): string {
  switch (response.type) {
    case "text": return response.answer;
    case "choice": {
      const labels = new Map(question.choices?.map((choice) => [choice.id, choice.label]));
      const selected = response.optionIds.map((id) => labels.get(id) ?? id).join(", ");
      const text = response.text?.trim() ?? "";
      return selected && text ? `${selected}\n${text}` : selected || text;
    }
    case "blanks": return response.answers.join("\n");
    case "rows": {
      const labels = new Map(question.choices?.map((choice) => [choice.id, choice.label]));
      return response.rows.map((row) => `${row.item}: ${labels.get(row.optionId) ?? row.optionId}${row.reason ? ` — ${row.reason}` : ""}`).join("\n");
    }
  }
}

function autoGradeQuestionGroupResponse(response: UiQuestionGroupResponse, question: UiQuestion):
  | { grading: "auto"; score: number }
  | { grading: "pending" } {
  switch (response.type) {
    case "text": return autoGrade(question, [response.answer]);
    case "choice": return autoGrade(question, response.optionIds);
    case "blanks": return autoGrade(question, response.answers);
    case "rows": return autoGrade(question, response.rows.map((row) => row.optionId), response.rows);
  }
}

function reportedDeckReviewState(
  state: PortableLearnerData["decks"][number]["cards"][number]["srs"],
  rating: Extract<UiAction, { type: "complete-deck" }>["ratings"][number],
  now: string,
) {
  const next = applyReview(state, rating.rating, now).next;
  return {
    ...next,
    ease: rating.easeAfter,
    intervalDays: rating.appliedIntervalDays,
    dueAt: dueAtAfterReview(now, rating.rating, rating.appliedIntervalDays),
  };
}

function sameDeckReview(
  existing: PortableLearnerData["cardReviews"][number],
  desired: Pick<PortableLearnerData["cardReviews"][number], "id" | "deckId" | "cardId" | "rating" | "appliedIntervalDays" | "easeAfter">,
): boolean {
  return existing.id === desired.id
    && existing.deckId === desired.deckId
    && existing.cardId === desired.cardId
    && existing.rating === desired.rating
    && existing.appliedIntervalDays === desired.appliedIntervalDays
    && existing.easeAfter === desired.easeAfter;
}

/** Pure semantic adapter used inside UiActionStore's exclusive transaction. */
export function applyLocalUiAction(
  current: PortableLearnerData,
  action: UiAction,
  document: UiDocument,
  now: string,
  sessionId?: string,
): UiActionMutationResult {
  if (action.type === "submit-answer" || action.type === "choose-option") {
    const target = actionTarget(document, action.nodeId);
    const answer = answerText(action, document);
    const check = {
      id: stableId("ui-answer", document.id, action.idempotencyKey),
      topic: target.node.type === "quiz" ? target.node.title : "Interactive check",
      question: target.questionPrompt ?? "OpenUI question",
      answer,
      createdAt: now,
      grading: "pending" as const,
      ...(sessionId ? { sessionId } : {}),
    };
    const next = current.questionChecks.some((candidate) => candidate.id === check.id)
      ? current
      : { ...current, questionChecks: [...current.questionChecks, check] };
    return {
      data: next,
      // Per-question completion lives in the durable action journal. Keeping
      // the document ready prevents one answer from disabling sibling nodes.
      resultingDocument: nextDocument(document, now),
      message: "Answer saved on this device.",
    };
  }

  if (action.type === "submit-question-group") {
    const target = actionTarget(document, action.nodeId);
    if (target.node.type !== "question-group") throw new Error("Question-group action target is invalid.");
    const group = target.node;
    const responses = new Map(action.responses.map((response) => [response.questionId, response]));
    const checks = group.questions.map((question) => {
      const response = responses.get(question.id);
      if (!response) throw new Error(`Question-group response for ${question.id} is missing.`);
      return {
        id: stableId("ui-question-check", document.id, action.idempotencyKey, question.id),
        topic: group.topic?.trim() || question.header?.trim() || document.title?.trim() || `OpenUI ${document.id}`,
        question: question.prompt,
        answer: questionGroupAnswerText(response, question),
        ...autoGradeQuestionGroupResponse(response, question),
        createdAt: now,
        ...(sessionId ? { sessionId } : {}),
      };
    });
    return {
      data: appendQuestionChecks(current, checks, now),
      resultingDocument: nextDocument(document, now),
      message: "Question-group responses saved on this device.",
    };
  }

  if (action.type === "complete-quiz") {
    const target = actionTarget(document, action.nodeId);
    if (target.node.type !== "quiz") throw new Error("Quiz action target is invalid.");
    const result = {
      id: stableId("ui-quiz", document.id, action.resultId),
      topic: target.node.title,
      createdAt: now,
      score: action.score,
      totalQuestions: target.node.questions.length,
      answers: Object.fromEntries(action.answers.map((answer) => [answer.questionId, answer.answer])),
      partialCreditPoints: action.partialCreditPoints,
      partialCredits: { ...action.partialCredits },
      timing: { totalMs: action.timing.totalMs, perQuestionMs: { ...action.timing.perQuestionMs } },
      flaggedQuestionIds: [...action.flaggedQuestionIds],
      pendingGradeQuestionIds: [...action.pendingGradeQuestionIds],
      skippedQuestionIds: [...action.skippedQuestionIds],
      ...(sessionId ? { sessionId } : {}),
    };
    return {
      data: appendQuizResult(current, result, now),
      resultingDocument: nextDocument(document, now),
      message: "Quiz result saved on this device.",
    };
  }

  if (action.type === "complete-goal-step") {
    const target = actionTarget(document, action.nodeId);
    if (target.node.type !== "goal") throw new Error("Goal action target is invalid.");
    const goalId = stableId("ui-goal", document.id, target.node.id);
    const existing = current.goals.find((goal) => goal.id === goalId);
    const baseGoal = existing ?? {
      id: goalId,
      title: target.node.title,
      description: target.node.description ?? "",
      updatedAt: now,
      steps: target.node.steps.map((step) => ({
        id: stableId("ui-step", document.id, target.node.id, step.id),
        title: step.title,
        status: step.status,
        successCriteria: [...(step.successCriteria ?? [])],
      })),
    };
    const stepIndex = target.node.steps.findIndex((step) => step.id === action.stepId);
    if (stepIndex < 0) throw new Error("Goal step is missing.");
    const portableStepId = stableId("ui-step", document.id, target.node.id, action.stepId);
    const goal = {
      ...baseGoal,
      updatedAt: now,
      steps: baseGoal.steps.map((step) => step.id === portableStepId ? { ...step, status: "done" as const } : step),
    };
    const goals = existing
      ? current.goals.map((candidate) => candidate.id === goal.id ? goal : candidate)
      : [...current.goals, goal];
    const resultingDocument = nextDocument(document, now, (nodes) => nodes.map((node) => {
      if (node.type !== "goal" || node.id !== target.node.id) return node;
      const steps = node.steps.map((step) => step.id === action.stepId ? { ...step, status: "done" as const } : step);
      return { ...node, status: steps.every((step) => step.status === "done") ? "completed" as const : node.status, steps };
    }));
    return { data: { ...current, goals }, resultingDocument, message: "Goal progress saved." };
  }

  if (action.type === "complete-plan-item") {
    const target = actionTarget(document, action.nodeId);
    if (target.node.type !== "study-plan" || !target.node.items) throw new Error("Study-plan action target is invalid.");
    const items = updatePlanItem(target.node.items, action.itemId, action.completed);
    const updatedPlan = { ...target.node, items };
    const artifactId = stableId("ui-plan", document.id, target.node.id);
    const prior = current.artifacts.find((artifact) => artifact.id === artifactId);
    const artifact = {
      id: artifactId,
      kind: "study-plan" as const,
      format: "json" as const,
      title: target.node.title ?? "Study plan",
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      content: JSON.stringify(updatedPlan),
      ...(sessionId ? { sourceSessionId: sessionId } : {}),
    };
    const resultingDocument = nextDocument(document, now, (nodes) => nodes.map((node) => node.id === target.node.id ? updatedPlan : node));
    return {
      data: upsertArtifact(current, artifact),
      resultingDocument,
      message: "Study-plan progress saved.",
    };
  }

  if (action.type === "update-notes") {
    const target = actionTarget(document, action.nodeId);
    if (target.node.type !== "notes") throw new Error("Notes action target is invalid.");
    const artifactId = stableId("ui-note", document.id, target.node.id);
    const prior = current.artifacts.find((artifact) => artifact.id === artifactId);
    const artifact = {
      id: artifactId,
      kind: "note" as const,
      format: "markdown" as const,
      title: target.node.title,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      content: action.value,
      ...(sessionId ? { sourceSessionId: sessionId } : {}),
    };
    const resultingDocument = nextDocument(document, now, (nodes) => nodes.map((node) => node.id === target.node.id && node.type === "notes"
      ? { ...node, value: action.value }
      : node));
    return {
      data: upsertArtifact(current, artifact),
      resultingDocument,
      message: "Notes saved.",
    };
  }

  if (action.type === "rate-card") {
    const target = actionTarget(document, action.nodeId);
    if (target.node.type !== "deck") throw new Error("Deck action target is invalid.");
    const deckId = stableId("ui-deck", document.id, target.node.id);
    const cards = target.node.cards.map((card) => ({
      id: stableId("ui-card", document.id, target.node.id, card.id),
      front: card.front,
      back: card.back,
      tags: [...(card.tags ?? [])],
    }));
    const withDeck = current.decks.some((deck) => deck.id === deckId)
      ? current
      : createDeckWithCards(current, { id: deckId, title: target.node.title, topic: target.node.topic, createdAt: now, cards });
    const cardId = stableId("ui-card", document.id, target.node.id, action.cardId);
    const reviewed = recordCardReview(
      withDeck,
      deckId,
      cardId,
      action.rating,
      stableId("ui-review", document.id, action.idempotencyKey),
      now,
      sessionId,
    );
    return {
      data: reviewed.data,
      resultingDocument: nextDocument(document, now),
      message: "Card rating saved and the review schedule was updated.",
    };
  }

  if (action.type === "complete-deck") {
    const target = actionTarget(document, action.nodeId);
    if (target.node.type !== "deck") throw new Error("Deck completion target is invalid.");
    const deckId = stableId("ui-deck", document.id, target.node.id);
    const sourceCards = target.node.cards.map((card) => ({
      id: stableId("ui-card", document.id, target.node.id, card.id),
      front: card.front,
      back: card.back,
      tags: [...(card.tags ?? [])],
    }));
    const withDeck = current.decks.some((deck) => deck.id === deckId)
      ? current
      : createDeckWithCards(current, { id: deckId, title: target.node.title, topic: target.node.topic, createdAt: now, cards: sourceCards });
    const deck = withDeck.decks.find((candidate) => candidate.id === deckId);
    if (!deck) throw new Error("Deck completion could not resolve its learner deck.");
    const priorReviews = action.ratings.map((rating) => ({
      rating,
      cardId: stableId("ui-card", document.id, target.node.id, rating.cardId),
      reviewId: stableId("ui-review", document.id, action.idempotencyKey, rating.cardId),
    }));
    const existing = priorReviews.map(({ reviewId }) => withDeck.cardReviews.find((review) => review.id === reviewId));
    if (existing.some(Boolean)) {
      if (existing.some((review) => !review) || existing.some((review, index) => !review || !sameDeckReview(review, {
        id: priorReviews[index]!.reviewId,
        deckId,
        cardId: priorReviews[index]!.cardId,
        rating: priorReviews[index]!.rating.rating,
        appliedIntervalDays: priorReviews[index]!.rating.appliedIntervalDays,
        easeAfter: priorReviews[index]!.rating.easeAfter,
      }))) {
        throw new Error("Deck completion idempotency key conflicts with existing review evidence.");
      }
      return {
        data: withDeck,
        resultingDocument: nextDocument(document, now),
        message: "Deck review was already saved on this device.",
      };
    }
    const cardsById = new Map(deck.cards.map((card) => [card.id, card]));
    const scheduled = priorReviews.map(({ rating, cardId, reviewId }) => {
      const card = cardsById.get(cardId);
      if (!card) throw new Error(`Deck completion card ${rating.cardId} is missing.`);
      const next = reportedDeckReviewState(card.srs, rating, now);
      return {
        cardId,
        next,
        review: {
          id: reviewId,
          deckId,
          cardId,
          rating: rating.rating,
          appliedIntervalDays: rating.appliedIntervalDays,
          easeAfter: rating.easeAfter,
          previousIntervalDays: card.srs.intervalDays,
          nextDueAt: next.dueAt,
          repetitionsAfter: next.repetitions,
          lapsesAfter: next.lapses,
          isLapse: rating.rating === 0,
          createdAt: now,
          ...(sessionId ? { sessionId } : {}),
        },
      };
    });
    const nextByCardId = new Map(scheduled.map((entry) => [entry.cardId, entry.next]));
    const data: PortableLearnerData = {
      ...withDeck,
      generatedAt: now,
      decks: withDeck.decks.map((candidate) => candidate.id !== deckId ? candidate : {
        ...candidate,
        updatedAt: now,
        cards: candidate.cards.map((card) => nextByCardId.has(card.id) ? { ...card, srs: nextByCardId.get(card.id)! } : card),
      }),
      cardReviews: [...withDeck.cardReviews, ...scheduled.map((entry) => entry.review)],
    };
    return {
      data,
      resultingDocument: nextDocument(document, now),
      message: "Deck review saved and card schedules updated.",
    };
  }

  if (action.type === "save-artifact") {
    const target = actionTarget(document, action.nodeId);
    if (!(target.node.type === "study-plan" || target.node.type === "artifact"
      || target.node.type === "image" || target.node.type === "media")) {
      throw new Error("Artifact action target is invalid.");
    }
    const resource = target.node.resource;
    if (!resource) throw new Error("Structured study plans are saved through their progress controls.");
    const id = stableId("ui-artifact", document.id, target.node.id);
    const kind = target.node.type === "study-plan" ? "study-plan" as const
      : target.node.type === "image" ? "image" as const
        : target.node.type === "media" && target.node.kind === "animation" ? "animation" as const
          : target.node.type === "media" ? "document" as const : "other" as const;
    const format = resource.format === "markdown" ? "markdown" as const
      : target.node.type === "image" ? "image" as const
        : target.node.type === "media" && target.node.kind === "video" ? "video" as const
          : resource.format === "json" ? "json" as const : "text" as const;
    const artifact = {
      id,
      kind,
      format,
      title: resource.title,
      createdAt: now,
      updatedAt: now,
      content: resource.content ?? resource.uri ?? "",
      ...(sessionId ? { sourceSessionId: sessionId } : {}),
    };
    return {
      data: upsertArtifact(current, artifact),
      // The receipt marks this resource saved; sibling interactions must stay usable.
      resultingDocument: nextDocument(document, now),
      message: "Artifact saved to your library.",
    };
  }

  if (action.type === "retry") {
    return { data: current, resultingDocument: nextDocument(document, now), message: "Interaction is ready to try again." };
  }

  return {
    data: current,
    resultingDocument: nextDocument(document, now),
    message: "Handoff opened.",
  };
}

export function uiActionLearnerMessage(action: UiAction, document: UiDocument): string | null {
  if (action.type === "submit-answer" || action.type === "choose-option") {
    const target = actionTarget(document, action.nodeId);
    return `My answer to "${target.questionPrompt ?? "the check"}": ${answerText(action, document)}`;
  }
  if (action.type === "complete-goal-step") {
    const target = actionTarget(document, action.nodeId);
    const step = target.node.type === "goal" ? target.node.steps.find((candidate) => candidate.id === action.stepId) : undefined;
    return step ? `I completed the goal step: ${step.title}. What should I do next?` : null;
  }
  if (action.type === "submit-question-group") {
    const target = actionTarget(document, action.nodeId);
    return target.node.type === "question-group"
      ? `I completed the ${target.node.title ?? "question group"}. What should I work on next?`
      : null;
  }
  if (action.type === "complete-quiz") {
    const target = actionTarget(document, action.nodeId);
    return target.node.type === "quiz"
      ? `I completed the quiz "${target.node.title}". What should I review next?`
      : null;
  }
  if (action.type === "complete-deck") {
    const target = actionTarget(document, action.nodeId);
    return target.node.type === "deck"
      ? `I completed the ${target.node.title} deck. What should I study next?`
      : null;
  }
  return null;
}
