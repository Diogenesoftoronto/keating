import type { PortableLearnerData, UiActionJournal } from "@keating/learner-contracts";
import type { ChatMessage } from "../types";
import { extractUiDocuments, scopeUiDocument } from "../ui-document-wire";

/** Bind the released native Question, its original tutor text and its action journal to this learner turn. */
export async function previousFeedbackQuestion(sessionId: string | undefined, messages: readonly ChatMessage[], latest: number,
  data: PortableLearnerData, journal?: (documentId: string) => Promise<UiActionJournal>) {
  const previous = messages[latest - 1];
  if (!sessionId || !journal || latest !== messages.length - 1 || previous?.role !== "assistant"
    || messages[latest - 2]?.role !== "user" || messages.filter(message => message.id === previous.id).length !== 1) return null;
  const events = previous.agentEvents ?? [];
  const displayed = events.filter(event => event.type === "ui-document");
  if (events.at(-1)?.type !== "completed" || displayed.length !== 1
    || events.some(event => ["tool-call", "tool-result", "error", "cancelled", "artifact-emitted"].includes(event.type))) return null;
  const document = displayed[0]!.document;
  const node = document.nodes[0];
  if (document.lifecycle !== "ready" || !node || document.nodes.length !== 1) return null;
  const question = node.type === "question" ? node : node.type === "question-group" && node.questions.length === 1 ? node.questions[0] : null;
  if (!question || question.rubric || question.correctAnswer || question.correctAnswers?.length
    || data.questionChecks.some(check => (!check.sessionId || check.sessionId === sessionId) && check.question.trim() === question.prompt.trim())
    || data.quizResults.some(quiz => Object.hasOwn(quiz.answers, question.id))) return null;
  const text = events.filter(event => event.type === "text-delta").map(event => event.text).join("");
  const parsed = extractUiDocuments(text);
  const source = parsed.documents[0];
  if (parsed.errors.length || parsed.content !== previous.content.trim() || parsed.documents.length !== 1 || !source) return null;
  const scoped = scopeUiDocument(source, `${sessionId}:${previous.id}:0`);
  if (scoped.id !== document.id || scoped.revision !== document.revision
    || JSON.stringify(scoped.nodes) !== JSON.stringify(document.nodes)) return null;
  const saved = await journal(document.id).catch(() => null);
  if (!saved || saved.documentId !== document.id || saved.receipts.length) return null;
  return { document, text, link: { assistantTurnIndex: latest - 1, documentId: document.id, nodeId: node.id } };
}
