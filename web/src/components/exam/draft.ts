import {
  UI_CONTRACT_VERSION,
  validateUiAction,
  type UiQuestionGroupResponse,
} from "@keating/learner-contracts";
import type { ExamClock, ExamCompletion, ExamNode } from "./attempt";

export interface ExamDraft {
  version: 1;
  signature: string;
  clock: ExamClock;
  index: number;
  reviewing: boolean;
  responses: Record<string, UiQuestionGroupResponse>;
  ready: Record<string, boolean>;
  flagged: string[];
  pending?: ExamCompletion;
}

export function examDraftKey(
  documentId: string | undefined,
  nodeId: string,
): string | undefined {
  return documentId
    ? `keating:exam:${encodeURIComponent(documentId)}:${encodeURIComponent(nodeId)}`
    : undefined;
}

export function readExamDraft(
  key: string | undefined,
  node: ExamNode,
): ExamDraft | undefined {
  if (!key) return undefined;
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return undefined;
    const draft = raw as ExamDraft;
    if (
      draft.version !== 1 ||
      draft.signature !== JSON.stringify(node) ||
      !draft.clock ||
      !draft.responses ||
      !draft.ready ||
      !Array.isArray(draft.flagged)
    )
      return undefined;
    const ids = new Set(node.questions.map((question) => question.id));
    const clock = draft.clock;
    if (
      ![clock.startedAt, clock.deadlineAt, clock.enteredAt].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      clock.deadlineAt <= clock.startedAt ||
      clock.enteredAt < clock.startedAt ||
      clock.enteredAt > clock.deadlineAt ||
      !clock.perQuestionMs
    )
      return undefined;
    if (
      clock.activeQuestionId !== undefined &&
      !ids.has(clock.activeQuestionId)
    )
      return undefined;
    if (
      !Number.isInteger(draft.index) ||
      draft.index < 0 ||
      draft.index >= node.questions.length ||
      typeof draft.reviewing !== "boolean"
    )
      return undefined;
    if (
      Object.entries(clock.perQuestionMs).some(
        ([id, value]) =>
          !ids.has(id) || !Number.isSafeInteger(value) || value < 0,
      ) ||
      Object.entries(draft.ready).some(
        ([id, value]) => !ids.has(id) || typeof value !== "boolean",
      ) ||
      draft.flagged.some((id) => !ids.has(id))
    )
      return undefined;
    const base = {
      schemaVersion: UI_CONTRACT_VERSION,
      documentId: "exam-draft",
      documentRevision: 1,
      nodeId: node.id,
      idempotencyKey: "exam-draft",
    };
    const responses = Object.values(draft.responses);
    if (
      Object.entries(draft.responses).some(
        ([id, response]) => !ids.has(id) || response?.questionId !== id,
      ) ||
      (responses.length > 0 &&
        !validateUiAction({
          ...base,
          type: "submit-question-group",
          responses,
        }))
    )
      return undefined;
    if (draft.pending && !validateUiAction({ ...base, ...draft.pending }))
      return undefined;
    return draft;
  } catch {
    return undefined;
  }
}

export function saveExamDraft(
  key: string | undefined,
  draft: ExamDraft,
): boolean {
  if (!key) return true;
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
