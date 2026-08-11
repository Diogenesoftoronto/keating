import type { UiAction, UiActionJournal, UiDocument } from "@keating/learner-contracts";

/** Return the newest durable document snapshot produced by a completed action. */
export function latestUiDocument(
  journal: UiActionJournal,
  source: UiDocument,
): UiDocument {
  const latest = [...journal.receipts]
    .reverse()
    .find((receipt) => receipt.state === "completed" && receipt.result?.resultingDocument)
    ?.result?.resultingDocument;
  return latest && latest.revision >= source.revision ? latest : source;
}

/** Completed actions are UI state: restoring them prevents a quiz from appearing unanswered. */
export function completedUiActions(journal: UiActionJournal): UiAction[] {
  return journal.receipts
    .filter((receipt) => receipt.state === "completed" && receipt.result?.status === "completed")
    .map((receipt) => receipt.action);
}

export function completedQuestionAction(
  actions: readonly UiAction[],
  questionId: string,
): Extract<UiAction, { type: "submit-answer" | "choose-option" }> | undefined {
  return [...actions].reverse().find((action): action is Extract<UiAction, { type: "submit-answer" | "choose-option" }> =>
    (action.type === "submit-answer" || action.type === "choose-option") && action.nodeId === questionId);
}

/** The group node, rather than individual questions, owns a submitted form receipt. */
export function completedQuestionGroupAction(
  actions: readonly UiAction[],
  nodeId: string,
): Extract<UiAction, { type: "submit-question-group" }> | undefined {
  return [...actions].reverse().find((action): action is Extract<UiAction, { type: "submit-question-group" }> =>
    action.type === "submit-question-group" && action.nodeId === nodeId);
}

/** Find the response for one form question from its aggregate group completion. */
export function completedQuestionGroupResponse(
  actions: readonly UiAction[],
  nodeId: string,
  questionId: string,
): Extract<UiAction, { type: "submit-question-group" }>["responses"][number] | undefined {
  return completedQuestionGroupAction(actions, nodeId)?.responses.find((response) => response.questionId === questionId);
}

export function completedQuizAction(
  actions: readonly UiAction[],
  nodeId: string,
): Extract<UiAction, { type: "complete-quiz" }> | undefined {
  return [...actions].reverse().find((action): action is Extract<UiAction, { type: "complete-quiz" }> =>
    action.type === "complete-quiz" && action.nodeId === nodeId);
}

export function completedDeckAction(
  actions: readonly UiAction[],
  nodeId: string,
): Extract<UiAction, { type: "complete-deck" }> | undefined {
  return [...actions].reverse().find((action): action is Extract<UiAction, { type: "complete-deck" }> =>
    action.type === "complete-deck" && action.nodeId === nodeId);
}

export function completedNodeAction(
  actions: readonly UiAction[],
  nodeId: string,
  type: "save-artifact" | "open-handoff" | "submit-question-group" | "complete-quiz" | "complete-deck",
): boolean {
  return actions.some((action) => action.type === type && action.nodeId === nodeId);
}

export function reviewedDeckCardIds(actions: readonly UiAction[], nodeId: string): ReadonlySet<string> {
  return new Set(actions.flatMap((action) => {
    if (action.type === "rate-card") return action.nodeId === nodeId ? [action.cardId] : [];
    if (action.type === "complete-deck") return action.nodeId === nodeId ? action.ratings.map((rating) => rating.cardId) : [];
    return [];
  }));
}
