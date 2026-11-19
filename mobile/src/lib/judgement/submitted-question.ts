import {
  canonicalUiAction, validateUiActionAgainstDocument, validateUiActionReceipt,
  type LearnerQuestionCheck, type PortableLearnerData, type TeachingPolicyTurn, type UiAction, type UiActionJournal, type UiDocument,
} from "@keating/learner-contracts";
import type { ProviderToolDefinition, ProviderToolResult } from "../provider-client";
import { mobileToolIdempotencyKey, type MobileToolExecutionContext, type MobileToolExecutionResult } from "../mobile-tools";
import { nativeQuestionRecordsForAction, uiActionLearnerMessage } from "../ui-action-mutations";
import type { ChatMessage } from "../types";
import { isMobileSemanticQuestion } from "./grading";

export const NATIVE_GRADE_TOOL = "grade_question_checks";

export const nativeGradeDefinition: ProviderToolDefinition = {
  name: NATIVE_GRADE_TOOL,
  description: "Grade the one submitted, pending comprehension answer. Match its exact topic and question. A learner’s personal preference or choice of lesson cannot receive a grade.",
  parameters: {
    type: "object", additionalProperties: false, required: ["topic", "results"],
    properties: {
      topic: { type: "string" },
      results: { type: "array", minItems: 1, maxItems: 1, items: {
        type: "object", additionalProperties: false, required: ["question", "verdict"],
        properties: { question: { type: "string" }, verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
          misconception: { type: "string", maxLength: 500 } },
      } },
    },
  },
};

/** The renderer supplies this message ID only after a committed native Question action. It survives retry and reload. */
export function nativeQuestionTurnId(sessionId: string | undefined, action: UiAction): string | undefined {
  if (!sessionId || (action.type !== "choose-option" && action.type !== "submit-answer" && action.type !== "submit-question-group")) return;
  return formDocumentPrefix(sessionId, action.documentId) + mobileToolIdempotencyKey(sessionId, action.documentId, action.type, {
    action: canonicalUiAction(action),
  });
}

function formDocumentPrefix(sessionId: string, documentId: string): string {
  return "question-" + mobileToolIdempotencyKey(sessionId, documentId, "form", {}) + "-";
}

export async function submittedNativeQuestion(
  sessionId: string | undefined, messages: readonly ChatMessage[], data: PortableLearnerData,
  journal?: (documentId: string) => Promise<UiActionJournal>,
  sessionMessages: readonly ChatMessage[] = messages,
): Promise<LearnerQuestionCheck | undefined> {
  const latest = messages.at(-1);
  if (!sessionId || !journal || latest?.role !== "user" || !latest.id.startsWith("question-tool-")) return;
  const submittedAt = sessionMessages.findIndex(message => message.id === latest.id);
  if (submittedAt < 0 || sessionMessages[submittedAt]?.role !== "user" || sessionMessages[submittedAt]?.content !== latest.content
    || sessionMessages.findLastIndex(message => message.id === latest.id) !== submittedAt) return;
  const documents = new Map<string, UiDocument>();
  for (const message of sessionMessages.slice(0, submittedAt)) {
    if (message.role !== "assistant" || message.agentEvents?.at(-1)?.type !== "completed") continue;
    for (const event of message.agentEvents ?? []) {
      if (event.type === "ui-document" && latest.id.startsWith(formDocumentPrefix(sessionId, event.document.id))) documents.set(event.document.id, event.document);
    }
  }
  const matches: LearnerQuestionCheck[] = [];
  for (const base of documents.values()) {
    const saved = await journal(base.id).catch(() => null);
    if (!saved || saved.documentId !== base.id) continue;
    for (const receipt of saved.receipts) {
      const action = receipt.action;
      if (action.type !== "choose-option" && action.type !== "submit-answer" && action.type !== "submit-question-group") continue;
      if (!validateUiActionReceipt(receipt) || receipt.state !== "completed" || Date.parse(receipt.createdAt) > latest.createdAt
        || receipt.actionFingerprint !== canonicalUiAction(action) || nativeQuestionTurnId(sessionId, action) !== latest.id) continue;
      // A previous action on a sibling node may already have advanced the document.
      const document = action.documentRevision === base.revision ? base : saved.receipts.find(record =>
        record.state === "completed" && record.result?.resultingDocument?.revision === action.documentRevision)?.result?.resultingDocument;
      if (!document || document.id !== base.id || !validateUiActionAgainstDocument(action, document)
        || uiActionLearnerMessage(action, document) !== latest.content) continue;
      const node = document.nodes.find(entry => entry.id === action.nodeId);
      const question = node?.type === "question" ? node : node?.type === "question-group" && node.questions.length === 1 ? node.questions[0] : null;
      if (!question || question.mathProblem || question.correctAnswer || question.correctAnswers?.length
        || question.correctMatches?.length || isMobileSemanticQuestion(question)) continue;
      const expected = nativeQuestionRecordsForAction(action, document, receipt.createdAt, sessionId);
      if (expected.length !== 1) continue;
      const record: LearnerQuestionCheck | undefined = data.questionChecks.find(item => item.id === expected[0]!.id);
      if (record && record.sessionId === sessionId && record.grading === "pending" && record.score === undefined
        && record.question === expected[0]!.question && record.answer === expected[0]!.answer && record.topic === expected[0]!.topic
        && record.createdAt === receipt.createdAt && record.answer.trim() && record.answer.length <= 1000 && record.question.length <= 1000) matches.push(record);
    }
  }
  const [match] = matches;
  if (matches.length !== 1 || !match || data.questionChecks.filter(check => check.sessionId === sessionId && check.grading === "pending"
    && check.topic === match.topic && check.question === match.question).length !== 1) return;
  return match;
}

interface QuestionGradeProposal {
  check: LearnerQuestionCheck;
  verdict: "correct" | "partial" | "incorrect";
  score: number;
  misconception?: string;
}
export interface NativeQuestionGrade extends QuestionGradeProposal {
  turnId: string;
  current?: () => boolean;
}

/** Both the authorized tool result and the committed row must refer to the current learner's same submission. */
export function nativeGradeFeedback(grade: NativeQuestionGrade, callId: string, sessionId: string | undefined, turnId: string | undefined,
  latestResults: readonly ProviderToolResult[], checks: readonly LearnerQuestionCheck[]): TeachingPolicyTurn["confirmedQuestionGrade"] {
  if (grade.turnId !== turnId || grade.check.sessionId !== sessionId || grade.current?.() === false || latestResults.length !== 1) return;
  const result = latestResults[0]!;
  const { check, verdict, score } = grade;
  const output = result.output;
  if (result.isError || result.callId !== callId || result.name !== NATIVE_GRADE_TOOL || output.ok !== true
    || output.questionCheckId !== check.id || output.topic !== check.topic || output.question !== check.question
    || output.score !== score || output.verdict !== verdict) return;
  const stored = checks.find(row => row.id === check.id);
  if (stored?.grading !== "model" || stored.sessionId !== sessionId || stored.createdAt !== check.createdAt || stored.topic !== check.topic
    || stored.question !== check.question || stored.answer !== check.answer || stored.score !== score) return;
  return { topic: stored.topic, question: stored.question, answer: stored.answer, verdict, score };
}

export function nativeQuestionGrade(check: LearnerQuestionCheck | undefined, value: unknown): QuestionGradeProposal | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const args = value as Record<string, unknown>;
  if (!check || check.grading !== "pending" || check.score !== undefined || args.topic !== check.topic
    || Object.keys(args).some(key => key !== "topic" && key !== "results") || !Array.isArray(args.results) || args.results.length !== 1) return;
  const item = args.results[0];
  if (!item || typeof item !== "object" || Object.keys(item).some(key => !["question", "verdict", "misconception"].includes(key))
    || item.question !== check.question || !["correct", "partial", "incorrect"].includes(item.verdict)
    || (item.misconception !== undefined && (typeof item.misconception !== "string" || item.misconception.length > 500))) return;
  return { check, verdict: item.verdict, score: item.verdict === "correct" ? 1 : item.verdict === "partial" ? 0.5 : 0,
    ...(item.misconception?.trim() ? { misconception: item.misconception.trim() } : {}) };
}

/** Produces a provider result only for the exact proposal that was released; persistence runs before provider continuation. */
export function nativeReviewedGradeResult(approved: NativeQuestionGrade | undefined, args: string | Readonly<Record<string, unknown>>,
  context: MobileToolExecutionContext): MobileToolExecutionResult {
  const grade = typeof args === "string" ? undefined : nativeQuestionGrade(approved?.check, args);
  if (!approved || !grade || grade.verdict !== approved.verdict || grade.misconception !== approved.misconception
    || approved.check.sessionId !== context.sessionId || approved.turnId !== context.messageId
    || context.signal?.aborted || approved.current?.() === false) {
    return { ok: false, toolName: NATIVE_GRADE_TOOL, idempotencyKey: context.idempotencyKey, code: "invalid_arguments",
      message: "No reviewed grade matches the submitted answer for this turn.", retryable: false, effects: [] };
  }
  return { ok: true, toolName: NATIVE_GRADE_TOOL, idempotencyKey: context.idempotencyKey,
    output: { questionCheckId: grade.check.id, topic: grade.check.topic, question: grade.check.question, verdict: grade.verdict,
      score: grade.score, message: "Recorded one graded diagnostic check." }, effects: [] };
}
