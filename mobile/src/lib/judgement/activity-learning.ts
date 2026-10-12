import { objectiveCredit, type PortableLearnerData, type UiAction, type UiDocument, type UiQuestion,
  type UiQuestionGroupResponse, type UiActionJournal } from "@keating/learner-contracts";
import type { ActivityBoundary, ActivityObjectiveOutcome } from "../../../../packages/learner-contracts/src/judgement/activity-learning";
import type { ChatSession } from "../types";

/** Any published assistant reply closes earlier activity attribution, even when learning is off. */
export function mobileActivityBoundaries(sessions: readonly ChatSession[]): ActivityBoundary[] {
  return sessions.flatMap(session => session.messages.flatMap(message => {
    if (message.role !== "assistant") return [];
    const events = message.agentEvents ?? [];
    const visible = events.filter(event => event.type === "text-delta" || event.type === "ui-document" || event.type === "tool-result");
    if (!message.content.trim() && !visible.length) return [];
    // A later streamed reply already intervenes when its first visible event is published.
    const createdAt = visible.length ? Date.parse(visible[0]!.occurredAt) : message.createdAt;
    return Number.isSafeInteger(createdAt) && createdAt > 0 ? [{ sessionId: session.id, createdAt }] : [];
  })); // The shared engine rejects >20,000; never hide an intervening boundary by truncating.
}

/** A real, unattempted current source can receive prose help without inventing a new activity. */
export async function mobileUnansweredActivityDocument(session: ChatSession | undefined,
  prior: Pick<PortableLearnerData, "questionChecks" | "quizResults">,
  journal: (documentId: string) => Promise<UiActionJournal>): Promise<UiDocument | null> {
  const events = session?.messages.flatMap(message => message.role === "assistant" ? message.agentEvents ?? [] : []) ?? [];
  const event = events.findLast(event => event.type === "ui-document");
  if (!event || event.type !== "ui-document") return null;
  const document = event.document;
  if (document.lifecycle !== "ready") return null;
  const assessable = document.nodes.filter(node => node.type === "question" || node.type === "question-group" || node.type === "quiz");
  if (assessable.length !== 1) return null;
  const node = assessable[0]!;
  const questions = node.type === "question" ? [node] : node.type === "quiz" || node.type === "question-group" ? node.questions : [];
  if (!questions.length || questions.length > 20 || questions.some(question => objectiveCredit(question, question.correctAnswer ?? question.correctAnswers?.join(",") ?? "") === undefined
    || prior.questionChecks.some(check => check.question.trim().toLocaleLowerCase() === question.prompt.trim().toLocaleLowerCase())
    || prior.quizResults.some(quiz => Object.hasOwn(quiz.answers, question.id)))) return null;
  const saved = await journal(document.id);
  // Even a pending or failed submission makes first-attempt status uncertain.
  if (saved.receipts.length) return null;
  return structuredClone(document);
}

function groupAnswer(response: UiQuestionGroupResponse): string | null {
  switch (response.type) {
    case "text": return response.answer;
    case "choice": return response.text?.trim() ? null : response.optionIds.join(",");
    case "blanks": return response.answers.join(",");
    case "order": return response.items.join(",");
    case "rows": return null; // Matrix semantics are not the shared objective quiz scorer.
  }
}
const hash = async (value: string) => {
  const crypto = await import("expo-crypto");
  return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, value);
};
/** Recompute from actual submitted work; supplied totals and model grades never become labels. */
export async function mobileActivityOutcomes(action: UiAction, document: UiDocument, sessionId: string, createdAt: number,
  prior: Pick<PortableLearnerData, "questionChecks" | "quizResults">,
  sha256: (value: string) => Promise<string> = hash): Promise<ActivityObjectiveOutcome[]> {
  if (!("nodeId" in action)) return [];
  const entries: { question: UiQuestion; answer: string | null; nodeId: string; skipped?: boolean }[] = [];
  const node = document.nodes.find(candidate => candidate.id === action.nodeId);
  if (action.type === "complete-quiz" && node?.type === "quiz") {
    for (const question of node.questions) {
      const answer = action.answers.find(row => row.questionId === question.id);
      if (answer) entries.push({ question, answer: answer.answer, nodeId: node.id,
        skipped: action.skippedQuestionIds.includes(question.id) || action.pendingGradeQuestionIds.includes(question.id) });
    }
  } else if (action.type === "submit-question-group" && node?.type === "question-group") {
    for (const question of node.questions) {
      const response = action.responses.find(row => row.questionId === question.id);
      if (response) entries.push({ question, answer: groupAnswer(response), nodeId: node.id });
    }
  } else if (action.type === "submit-answer" || action.type === "choose-option") {
    const owner = node ?? document.nodes.find(candidate => (candidate.type === "quiz" || candidate.type === "question-group") && candidate.questions.some(question => question.id === action.nodeId));
    const question = owner?.type === "question" ? owner : owner?.type === "quiz" || owner?.type === "question-group" ? owner.questions.find(question => question.id === action.nodeId) : undefined;
    if (owner && question) entries.push({ question, nodeId: owner.id, answer: action.type === "choose-option" ? action.optionIds.join(",")
      : typeof action.answer === "string" ? action.answer : action.answer.every(value => typeof value === "string") ? action.answer.join(",") : null });
  }
  return Promise.all(entries.map(async ({ question, answer, nodeId, skipped }) => {
    const normalized = question.prompt.trim().toLocaleLowerCase();
    // Prompt identity catches retries even when a generated document gives the same item a new node ID.
    const questionKey = await sha256(normalized);
    const repeat = prior.questionChecks.some(check => check.question.trim().toLocaleLowerCase() === normalized)
      || prior.quizResults.some(quiz => Object.hasOwn(quiz.answers, question.id));
    const score = skipped || !answer?.trim() ? undefined : objectiveCredit(question, answer);
    return { id: `${document.id}:${action.idempotencyKey}:${question.id}`, sessionId, createdAt, questionKey,
      grading: score === undefined ? "pending" as const : "auto" as const, ...(score === undefined ? {} : { score }),
      attemptStatus: repeat ? "repeat" as const : "first-recorded" as const,
      source: { documentId: document.id, revision: document.revision, nodeId, questionId: question.id } };
  }));
}
