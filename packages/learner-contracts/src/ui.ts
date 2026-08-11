import { codePointCompare, compareContractTimestamps, hasOnlyKeys, isContractId, isContractTimestamp, isRecord } from "./validation.js";

export const UI_CONTRACT_VERSION = 1 as const;
export const UI_ACTION_JOURNAL_KIND = "keating-ui-action-journal" as const;

export type LearnerSurface = "web" | "desktop" | "mobile" | "terminal";
export type DocumentLifecycle = "draft" | "streaming" | "ready" | "submitted" | "completed" | "failed" | "cancelled";
export type UiDocumentRetention = "ephemeral" | "resumable" | "workspace";
export type UiGoalStepStatus = "not_started" | "in_progress" | "done";
export type UiArtifactFormat = "markdown" | "text" | "json" | "uri";
export type UiQuestionType = "choice" | "text" | "blanks" | "classification" | "matching"
  | "multiple_choice" | "multi_select" | "true_false" | "fill_in" | "short_answer"
  | "transfer" | "slider" | "dropdown";
export type UiQuestionLevel = "recall" | "comprehension" | "application" | "analysis" | "transfer";

export interface UiOption {
  id: string;
  label: string;
}

export interface UiRowAnswer {
  item: string;
  optionId: string;
  reason?: string;
}

export type UiAnswer = string | string[] | UiRowAnswer[];

/**
 * An answer to one member of a grouped question form.  The discriminant keeps
 * source-form interaction semantics intact: a choice can carry both stable
 * option ids and its permitted free-text addendum, while rows retain their
 * per-item mapping and justification.
 */
export type UiQuestionGroupResponse =
  | { questionId: string; type: "text"; answer: string }
  | { questionId: string; type: "choice"; optionIds: string[]; text?: string }
  | { questionId: string; type: "blanks"; answers: string[] }
  | { questionId: string; type: "rows"; rows: UiRowAnswer[] };

/** A source quiz uses strings for its typed responses, in question order. */
export interface UiQuizResponse {
  questionId: string;
  answer: string;
}

export interface UiQuizTiming {
  totalMs: number;
  /** Only visited questions occur here; keys are stable source question ids. */
  perQuestionMs: Record<string, number>;
}

/** The per-card SRS outcome exposed by the browser flashcard review surface. */
export interface UiDeckRating {
  cardId: string;
  rating: 0 | 1 | 2 | 3;
  appliedIntervalDays: number;
  easeAfter: number;
}

export interface UiDeckCompletionSummary {
  reviewed: number;
  lapses: number;
}

export interface UiQuestion {
  id: string;
  prompt: string;
  kind?: UiQuestionType;
  header?: string;
  choices?: UiOption[];
  items?: string[];
  blanks?: Array<{ placeholder?: string; hint?: string }>;
  hint?: string;
  allowText?: boolean;
  multiSelect?: boolean;
  requireReasons?: boolean;
  itemLabel?: string;
  choiceLabel?: string;
  reasonLabel?: string;
  uniqueMatches?: boolean;
  correctMatches?: string[];
  level?: UiQuestionLevel;
  correctAnswer?: string;
  correctAnswers?: string[];
  explanation?: string;
  rubric?: string;
  timeLimit?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface UiGoalStep {
  id: string;
  title: string;
  status: UiGoalStepStatus;
  successCriteria?: string[];
}

export interface UiDeckCard {
  id: string;
  front: string;
  back: string;
  tags?: string[];
}

/** A resource is inline so no surface needs an unresolvable artifact lookup. */
export interface UiArtifactResource {
  id: string;
  title: string;
  format: UiArtifactFormat;
  content?: string;
  uri?: string;
  mimeType?: string;
}

export interface UiStudyPlanItem {
  id: string;
  title: string;
  detail?: string;
  dependsOn?: string[];
  estimatedMinutes?: number;
  outcomes?: string[];
  status?: "not_started" | "in_progress" | "done";
  children?: UiStudyPlanItem[];
}

export interface UiStudyPlanLink {
  planId: string;
  title: string;
  relation?: "prerequisite" | "follow-up" | "related";
  detail?: string;
}

export interface UiStudyPlanNode {
  type: "study-plan";
  id: string;
  title?: string;
  overview?: string;
  items?: UiStudyPlanItem[];
  relatedPlans?: UiStudyPlanLink[];
  /** Legacy/fallback representation retained for imported v1 documents. */
  resource?: UiArtifactResource;
}

export type UiDocumentNode =
  | { type: "markdown"; id: string; markdown: string }
  | { type: "callout"; id: string; markdown: string; tone: "info" | "hint" | "check" | "warning"; title?: string }
  | ({ type: "question" } & UiQuestion)
  | { type: "question-group"; id: string; title?: string; intro?: string; topic?: string; questions: UiQuestion[] }
  | { type: "quiz"; id: string; title: string; questions: UiQuestion[] }
  | { type: "goal"; id: string; title: string; description?: string; status: "active" | "completed" | "paused"; steps: UiGoalStep[] }
  | { type: "deck"; id: string; title: string; topic: string; description?: string; cards: UiDeckCard[] }
  | UiStudyPlanNode
  | { type: "artifact"; id: string; resource: UiArtifactResource }
  | { type: "concept-map"; id: string; title?: string; source: string }
  | { type: "notes"; id: string; title: string; value: string; placeholder?: string }
  | { type: "image"; id: string; alt: string; resource: UiArtifactResource }
  | { type: "media"; id: string; kind: "animation" | "audio" | "video"; resource: UiArtifactResource }
  | { type: "handoff"; id: string; target: LearnerSurface; reason: string; context: string };

export interface UiDocument {
  schemaVersion: typeof UI_CONTRACT_VERSION;
  id: string;
  revision: number;
  lifecycle: DocumentLifecycle;
	/** Persistence policy, distinct from the runtime lifecycle state. */
	retention?: UiDocumentRetention;
  supportedSurfaces: LearnerSurface[];
  title?: string;
  description?: string;
  nodes: UiDocumentNode[];
  createdAt: string;
  updatedAt: string;
}

export type UiAction =
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "submit-answer"; documentId: string; documentRevision: number; nodeId: string; answer: UiAnswer; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "choose-option"; documentId: string; documentRevision: number; nodeId: string; optionIds: string[]; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "submit-question-group"; documentId: string; documentRevision: number; nodeId: string; responses: UiQuestionGroupResponse[]; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-quiz"; documentId: string; documentRevision: number; nodeId: string; resultId: string; answers: UiQuizResponse[]; score: number; partialCreditPoints: number; partialCredits: Record<string, number>; timing: UiQuizTiming; flaggedQuestionIds: string[]; pendingGradeQuestionIds: string[]; skippedQuestionIds: string[]; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-goal-step"; documentId: string; documentRevision: number; nodeId: string; stepId: string; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-plan-item"; documentId: string; documentRevision: number; nodeId: string; itemId: string; completed: boolean; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "update-notes"; documentId: string; documentRevision: number; nodeId: string; value: string; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "rate-card"; documentId: string; documentRevision: number; nodeId: string; cardId: string; rating: 0 | 1 | 2 | 3; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-deck"; documentId: string; documentRevision: number; nodeId: string; ratings: UiDeckRating[]; summary: UiDeckCompletionSummary; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "save-artifact"; documentId: string; documentRevision: number; nodeId: string; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "retry"; documentId: string; documentRevision: number; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "open-handoff"; documentId: string; documentRevision: number; nodeId: string; idempotencyKey: string };

export interface UiActionResult {
  schemaVersion: typeof UI_CONTRACT_VERSION;
  documentId: string;
  /** The action's source revision, distinct from the completed snapshot revision. */
  sourceRevision: number;
  actionIdempotencyKey: string;
  status: "accepted" | "completed" | "rejected" | "retryable";
  documentLifecycle: DocumentLifecycle;
  resultingDocument?: UiDocument;
  message?: string;
  retryAfterMs?: number;
}

export interface UiActionReceipt {
  schemaVersion: typeof UI_CONTRACT_VERSION;
  action: UiAction;
  /** Deterministic canonical action form; detects accidental idempotency-key reuse. */
  actionFingerprint: string;
  state: "pending" | "accepted" | "completed" | "rejected" | "retryable";
  createdAt: string;
  updatedAt: string;
  result?: UiActionResult;
}

/** Serializable storage boundary. Implementations own atomic writes and dispatch transport. */
export interface UiActionJournal {
  kind: typeof UI_ACTION_JOURNAL_KIND;
  schemaVersion: typeof UI_CONTRACT_VERSION;
  documentId: string;
  receipts: UiActionReceipt[];
}

/** Dependency-free seam for web, Electron, native, and terminal effect adapters. */
export interface UiActionDispatcher {
  dispatch(action: UiAction, sourceDocument: UiDocument, receipt?: UiActionReceipt): Promise<UiActionResult>;
}

export class UiActionReplayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiActionReplayConflictError";
  }
}

const SURFACES = new Set<LearnerSurface>(["web", "desktop", "mobile", "terminal"]);
const LIFECYCLES = new Set<DocumentLifecycle>(["draft", "streaming", "ready", "submitted", "completed", "failed", "cancelled"]);
const RETENTION_POLICIES = new Set<UiDocumentRetention>(["ephemeral", "resumable", "workspace"]);
const GOAL_STEP_STATUSES = new Set<UiGoalStepStatus>(["not_started", "in_progress", "done"]);
const ARTIFACT_FORMATS = new Set<UiArtifactFormat>(["markdown", "text", "json", "uri"]);
const ACTION_TYPES = new Set<UiAction["type"]>(["submit-answer", "choose-option", "submit-question-group", "complete-quiz", "complete-goal-step", "complete-plan-item", "update-notes", "rate-card", "complete-deck", "save-artifact", "retry", "open-handoff"]);
const RECEIPT_STATES = new Set<UiActionReceipt["state"]>(["pending", "accepted", "completed", "rejected", "retryable"]);
const DOCUMENT_KEYS = new Set(["schemaVersion", "id", "revision", "lifecycle", "retention", "supportedSurfaces", "title", "description", "nodes", "createdAt", "updatedAt"]);
const OPTION_KEYS = new Set(["id", "label"]);
const ROW_ANSWER_KEYS = new Set(["item", "optionId", "reason"]);
const QUESTION_FIELD_KEYS = ["id", "prompt", "kind", "header", "choices", "items", "blanks", "hint", "allowText", "multiSelect", "requireReasons", "itemLabel", "choiceLabel", "reasonLabel", "uniqueMatches", "correctMatches", "level", "correctAnswer", "correctAnswers", "explanation", "rubric", "timeLimit", "min", "max", "step"];
const QUESTION_KEYS = new Set(["type", ...QUESTION_FIELD_KEYS]);
const NESTED_QUESTION_KEYS = new Set(QUESTION_FIELD_KEYS);
const QUESTION_GROUP_KEYS = new Set(["type", "id", "title", "intro", "topic", "questions"]);
const QUIZ_KEYS = new Set(["type", "id", "title", "questions"]);
const GOAL_KEYS = new Set(["type", "id", "title", "description", "status", "steps"]);
const GOAL_STEP_KEYS = new Set(["id", "title", "status", "successCriteria"]);
const DECK_KEYS = new Set(["type", "id", "title", "topic", "description", "cards"]);
const CARD_KEYS = new Set(["id", "front", "back", "tags"]);
const RESOURCE_KEYS = new Set(["id", "title", "format", "content", "uri", "mimeType"]);
const RESOURCE_NODE_KEYS = new Set(["type", "id", "resource"]);
const STUDY_PLAN_KEYS = new Set(["type", "id", "title", "overview", "items", "relatedPlans", "resource"]);
const PLAN_ITEM_KEYS = new Set(["id", "title", "detail", "dependsOn", "estimatedMinutes", "outcomes", "status", "children"]);
const PLAN_LINK_KEYS = new Set(["planId", "title", "relation", "detail"]);
const CALLOUT_KEYS = new Set(["type", "id", "markdown", "tone", "title"]);
const CONCEPT_MAP_KEYS = new Set(["type", "id", "title", "source"]);
const NOTES_KEYS = new Set(["type", "id", "title", "value", "placeholder"]);
const IMAGE_KEYS = new Set(["type", "id", "alt", "resource"]);
const MEDIA_KEYS = new Set(["type", "id", "kind", "resource"]);
const HANDOFF_KEYS = new Set(["type", "id", "target", "reason", "context"]);
const MARKDOWN_KEYS = new Set(["type", "id", "markdown"]);
const ACTION_BASE_KEYS = new Set(["schemaVersion", "type", "documentId", "documentRevision", "nodeId", "idempotencyKey"]);
const ACTION_KEYS: Readonly<Record<UiAction["type"], ReadonlySet<string>>> = {
  "submit-answer": new Set([...ACTION_BASE_KEYS, "answer"]),
  "choose-option": new Set([...ACTION_BASE_KEYS, "optionIds"]),
  "submit-question-group": new Set([...ACTION_BASE_KEYS, "responses"]),
  "complete-quiz": new Set([...ACTION_BASE_KEYS, "resultId", "answers", "score", "partialCreditPoints", "partialCredits", "timing", "flaggedQuestionIds", "pendingGradeQuestionIds", "skippedQuestionIds"]),
  "complete-goal-step": new Set([...ACTION_BASE_KEYS, "stepId"]),
  "complete-plan-item": new Set([...ACTION_BASE_KEYS, "itemId", "completed"]),
  "update-notes": new Set([...ACTION_BASE_KEYS, "value"]),
  "rate-card": new Set([...ACTION_BASE_KEYS, "cardId", "rating"]),
  "complete-deck": new Set([...ACTION_BASE_KEYS, "ratings", "summary"]),
  "save-artifact": ACTION_BASE_KEYS,
  "retry": new Set(["schemaVersion", "type", "documentId", "documentRevision", "idempotencyKey"]),
  "open-handoff": ACTION_BASE_KEYS,
};
const RESULT_KEYS = new Set(["schemaVersion", "documentId", "sourceRevision", "actionIdempotencyKey", "status", "documentLifecycle", "resultingDocument", "message", "retryAfterMs"]);
const RECEIPT_KEYS = new Set(["schemaVersion", "action", "actionFingerprint", "state", "createdAt", "updatedAt", "result"]);
const JOURNAL_KEYS = new Set(["kind", "schemaVersion", "documentId", "receipts"]);

const MAX_DOCUMENT_NODES = 64;
const MAX_QUIZ_QUESTIONS = 32;
const MAX_CHOICES = 32;
const MAX_GOAL_STEPS = 64;
const MAX_DECK_CARDS = 256;
const MAX_TAGS = 32;
const MAX_JOURNAL_RECEIPTS = 1024;
const MAX_TEXT = 16_384;
const MAX_MARKDOWN = 65_536;
const MAX_RESOURCE_CONTENT = 131_072;
const MAX_PLAN_ITEMS = 256;
const MAX_PLAN_DEPTH = 6;

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function boundedString(value: unknown, maxLength = MAX_TEXT, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function boundedArray(value: unknown, maxLength: number): value is unknown[] {
  return Array.isArray(value) && value.length <= maxLength;
}

function uniqueIds(entries: ReadonlyArray<{ id: string }>): boolean {
  return new Set(entries.map((entry) => entry.id)).size === entries.length;
}

function validateUiOption(value: unknown): value is UiOption {
  return hasOnlyKeys(value, OPTION_KEYS) && isContractId((value as UiOption).id) && boundedString((value as UiOption).label, 512);
}

function validateUiRowAnswer(value: unknown): value is UiRowAnswer {
  if (!hasOnlyKeys(value, ROW_ANSWER_KEYS)) return false;
  const answer = value as UiRowAnswer;
  return boundedString(answer.item, 2048) && isContractId(answer.optionId)
    && (answer.reason === undefined || boundedString(answer.reason, 8192, true));
}

function validateQuestionFields(value: Record<string, unknown>): boolean {
  const choices = value.choices;
  const items = value.items;
  const blanks = value.blanks;
  const questionType = value.kind;
  const allowedTypes = new Set<UiQuestionType>(["choice", "text", "blanks", "classification", "matching", "multiple_choice", "multi_select", "true_false", "fill_in", "short_answer", "transfer", "slider", "dropdown"]);
  const allowedLevels = new Set<UiQuestionLevel>(["recall", "comprehension", "application", "analysis", "transfer"]);
  if (!boundedString(value.prompt, 4096)) return false;
  if (choices !== undefined && !(boundedArray(choices, MAX_CHOICES) && choices.length > 0 && choices.every(validateUiOption) && uniqueIds(choices))) return false;
  if (questionType !== undefined && !allowedTypes.has(questionType as UiQuestionType)) return false;
  if (value.level !== undefined && !allowedLevels.has(value.level as UiQuestionLevel)) return false;
  for (const key of ["header", "hint", "itemLabel", "choiceLabel", "reasonLabel", "correctAnswer", "explanation", "rubric"] as const) {
    if (value[key] !== undefined && !boundedString(value[key], key === "explanation" || key === "rubric" ? 8192 : 4096, true)) return false;
  }
  for (const key of ["allowText", "multiSelect", "requireReasons", "uniqueMatches"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return false;
  }
  if (items !== undefined && !(boundedArray(items, MAX_CHOICES) && items.length > 0 && items.every((item) => boundedString(item, 2048)))) return false;
  if (blanks !== undefined && !(boundedArray(blanks, MAX_CHOICES) && blanks.every((blank) => {
    if (!hasOnlyKeys(blank, new Set(["placeholder", "hint"]))) return false;
    const candidate = blank as { placeholder?: unknown; hint?: unknown };
    return (candidate.placeholder === undefined || boundedString(candidate.placeholder, 512, true))
      && (candidate.hint === undefined || boundedString(candidate.hint, 1024, true));
  }))) return false;
  for (const key of ["correctMatches", "correctAnswers"] as const) {
    const entries = value[key];
    if (entries !== undefined && !(boundedArray(entries, MAX_CHOICES) && entries.every((entry) => boundedString(entry, 4096, true)))) return false;
  }
  if (value.timeLimit !== undefined && !(typeof value.timeLimit === "number" && Number.isSafeInteger(value.timeLimit) && value.timeLimit > 0)) return false;
  for (const key of ["min", "max", "step"] as const) if (value[key] !== undefined && !(typeof value[key] === "number" && Number.isFinite(value[key]))) return false;
  if (typeof value.min === "number" && typeof value.max === "number" && value.min >= value.max) return false;
  if (typeof value.step === "number" && value.step <= 0) return false;
  if (value.multiSelect === true && choices === undefined) return false;
  if ((questionType === "classification" || questionType === "matching") && (items === undefined || choices === undefined)) return false;
  if ((questionType === "choice" || questionType === "multiple_choice" || questionType === "multi_select" || questionType === "dropdown") && choices === undefined && value.allowText !== true) return false;
  if (questionType === "matching" && Array.isArray(value.correctMatches) && value.correctMatches.length !== (items as unknown[]).length) return false;
	if (questionType === "matching" && Array.isArray(value.correctMatches)) {
		const optionIds = new Set((choices as UiOption[]).map((choice) => choice.id));
		if (!value.correctMatches.every((optionId) => typeof optionId === "string" && optionIds.has(optionId))) return false;
	}
  return true;
}

function validateUiQuestion(value: unknown): value is UiQuestion {
  return hasOnlyKeys(value, NESTED_QUESTION_KEYS)
    && isContractId((value as UiQuestion).id)
    && validateQuestionFields(value as Record<string, unknown>);
}

function validateQuestionGroupNode(value: Record<string, unknown>): boolean {
  return hasOnlyKeys(value, QUESTION_GROUP_KEYS)
    && (value.title === undefined || boundedString(value.title, 512, true))
    && (value.intro === undefined || boundedString(value.intro, 8192, true))
    && (value.topic === undefined || boundedString(value.topic, 512, true))
    && boundedArray(value.questions, MAX_QUIZ_QUESTIONS) && value.questions.length > 0
    && value.questions.every(validateUiQuestion) && uniqueIds(value.questions as UiQuestion[]);
}

function validateStudyPlanItem(value: unknown, depth: number, seen: Set<string>): value is UiStudyPlanItem {
  if (depth > MAX_PLAN_DEPTH || !hasOnlyKeys(value, PLAN_ITEM_KEYS)) return false;
  const item = value as UiStudyPlanItem;
  if (!isContractId(item.id) || seen.has(item.id) || !boundedString(item.title, 512)) return false;
  seen.add(item.id);
  if (item.detail !== undefined && !boundedString(item.detail, 8192, true)) return false;
  if (item.estimatedMinutes !== undefined && !(Number.isSafeInteger(item.estimatedMinutes) && item.estimatedMinutes > 0 && item.estimatedMinutes <= 600)) return false;
  if (item.status !== undefined && item.status !== "not_started" && item.status !== "in_progress" && item.status !== "done") return false;
  if (item.dependsOn !== undefined && !(boundedArray(item.dependsOn, 32) && item.dependsOn.every(isContractId) && new Set(item.dependsOn).size === item.dependsOn.length)) return false;
  if (item.outcomes !== undefined && !(boundedArray(item.outcomes, 32) && item.outcomes.every((outcome) => boundedString(outcome, 2048)))) return false;
  return item.children === undefined || (boundedArray(item.children, 20) && item.children.length > 0 && item.children.every((child) => validateStudyPlanItem(child, depth + 1, seen)));
}

function validateStudyPlanNode(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, STUDY_PLAN_KEYS)) return false;
  const resourceValid = value.resource !== undefined && validateArtifactResource(value.resource);
  if (value.items === undefined) return resourceValid;
  if (!boundedString(value.title, 512) || !boundedArray(value.items, 12) || value.items.length === 0) return false;
  const seen = new Set<string>();
  if (!value.items.every((item) => validateStudyPlanItem(item, 0, seen)) || seen.size > MAX_PLAN_ITEMS) return false;
  const flatItems = flattenPlanItems(value.items as UiStudyPlanItem[]);
  if (!planDependenciesAreValid(flatItems)) return false;
  if (value.overview !== undefined && !boundedString(value.overview, 8192, true)) return false;
  if (value.relatedPlans !== undefined && !(boundedArray(value.relatedPlans, 16) && value.relatedPlans.every((link) => {
    if (!hasOnlyKeys(link, PLAN_LINK_KEYS)) return false;
    const candidate = link as UiStudyPlanLink;
    return isContractId(candidate.planId) && boundedString(candidate.title, 512)
      && (candidate.relation === undefined || candidate.relation === "prerequisite" || candidate.relation === "follow-up" || candidate.relation === "related")
      && (candidate.detail === undefined || boundedString(candidate.detail, 4096, true));
  }) && new Set((value.relatedPlans as UiStudyPlanLink[]).map((link) => link.planId)).size === value.relatedPlans.length)) return false;
  return value.resource === undefined || resourceValid;
}

function flattenPlanItems(items: readonly UiStudyPlanItem[]): UiStudyPlanItem[] {
  return items.flatMap((item) => [item, ...(item.children ? flattenPlanItems(item.children) : [])]);
}

function planDependenciesAreValid(items: readonly UiStudyPlanItem[]): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (items.some((item) => item.dependsOn?.some((id) => id === item.id || !byId.has(id)))) return false;
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (!visit(dependency)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  return items.every((item) => visit(item.id));
}

function validateGoalStep(value: unknown): value is UiGoalStep {
  const step = value as UiGoalStep;
  return hasOnlyKeys(value, GOAL_STEP_KEYS) && isContractId(step.id) && boundedString(step.title, 512)
    && GOAL_STEP_STATUSES.has(step.status)
    && (step.successCriteria === undefined || (boundedArray(step.successCriteria, MAX_CHOICES) && step.successCriteria.every((criterion) => boundedString(criterion, 1024))));
}

function validateDeckCard(value: unknown): value is UiDeckCard {
  const card = value as UiDeckCard;
  return hasOnlyKeys(value, CARD_KEYS) && isContractId(card.id) && boundedString(card.front, 4096) && boundedString(card.back, 8192)
    && (card.tags === undefined || (boundedArray(card.tags, MAX_TAGS) && card.tags.every((tag) => boundedString(tag, 256))));
}

function isSafeResourceUri(value: unknown): value is string {
  if (!boundedString(value, 4096)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "https:") return !!url.hostname;
    if (url.protocol === "artifact:") return isContractId(url.hostname || url.pathname.replace(/^\/+/, ""));
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function validateArtifactResource(value: unknown, requireUri = false): value is UiArtifactResource {
  const resource = value as UiArtifactResource;
  if (!hasOnlyKeys(value, RESOURCE_KEYS) || !isContractId(resource.id) || !boundedString(resource.title, 512)
    || !ARTIFACT_FORMATS.has(resource.format) || (resource.content !== undefined && !boundedString(resource.content, MAX_RESOURCE_CONTENT, true))
    || (resource.uri !== undefined && !isSafeResourceUri(resource.uri))
    || (resource.mimeType !== undefined && !boundedString(resource.mimeType, 256))) return false;
  if (resource.format === "uri" && resource.uri === undefined) return false;
  return requireUri ? resource.uri !== undefined : resource.content !== undefined || resource.uri !== undefined;
}

function validateUiDocumentNode(value: unknown): value is UiDocumentNode {
  if (!isRecord(value) || !isContractId(value.id) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "markdown": return hasOnlyKeys(value, MARKDOWN_KEYS) && boundedString(value.markdown, MAX_MARKDOWN, true);
    case "callout": return hasOnlyKeys(value, CALLOUT_KEYS) && boundedString(value.markdown, MAX_MARKDOWN, true)
      && (value.tone === "info" || value.tone === "hint" || value.tone === "check" || value.tone === "warning")
      && (value.title === undefined || boundedString(value.title, 512, true));
    case "question": return hasOnlyKeys(value, QUESTION_KEYS) && validateQuestionFields(value);
    case "question-group": return validateQuestionGroupNode(value);
    case "quiz": return hasOnlyKeys(value, QUIZ_KEYS) && boundedString(value.title, 512)
      && boundedArray(value.questions, MAX_QUIZ_QUESTIONS) && value.questions.every(validateUiQuestion) && uniqueIds(value.questions);
    case "goal": return hasOnlyKeys(value, GOAL_KEYS) && boundedString(value.title, 512)
      && (value.description === undefined || boundedString(value.description, 4096, true))
      && (value.status === "active" || value.status === "completed" || value.status === "paused")
      && boundedArray(value.steps, MAX_GOAL_STEPS) && value.steps.every(validateGoalStep) && uniqueIds(value.steps);
    case "deck": return hasOnlyKeys(value, DECK_KEYS) && boundedString(value.title, 512) && boundedString(value.topic, 512)
      && (value.description === undefined || boundedString(value.description, 8192, true))
      && boundedArray(value.cards, MAX_DECK_CARDS) && value.cards.every(validateDeckCard) && uniqueIds(value.cards);
    case "study-plan": return validateStudyPlanNode(value);
    case "artifact": return hasOnlyKeys(value, RESOURCE_NODE_KEYS) && validateArtifactResource(value.resource);
    case "concept-map": return hasOnlyKeys(value, CONCEPT_MAP_KEYS) && boundedString(value.source, MAX_MARKDOWN)
      && (value.title === undefined || boundedString(value.title, 512, true));
    case "notes": return hasOnlyKeys(value, NOTES_KEYS) && boundedString(value.title, 512) && boundedString(value.value, MAX_RESOURCE_CONTENT, true)
      && (value.placeholder === undefined || boundedString(value.placeholder, 4096, true));
    case "image": return hasOnlyKeys(value, IMAGE_KEYS) && boundedString(value.alt, 4096) && validateArtifactResource(value.resource, true);
    case "media": return hasOnlyKeys(value, MEDIA_KEYS) && (value.kind === "animation" || value.kind === "audio" || value.kind === "video") && validateArtifactResource(value.resource, true);
    case "handoff": return hasOnlyKeys(value, HANDOFF_KEYS) && SURFACES.has(value.target as LearnerSurface)
      && boundedString(value.reason, 2048) && boundedString(value.context, 8192);
    default: return false;
  }
}

export function validateUiDocument(value: unknown): value is UiDocument {
  if (!hasOnlyKeys(value, DOCUMENT_KEYS)) return false;
  const document = value as UiDocument;
  const resources = Array.isArray(document.nodes) ? document.nodes.flatMap((node) => {
    if (node.type === "study-plan") return node.resource ? [node.resource] : [];
    if (node.type === "artifact" || node.type === "image" || node.type === "media") return [node.resource];
    return [];
  }) : [];
  const interactionIds = Array.isArray(document.nodes) ? document.nodes.flatMap((node) => {
    if (!isRecord(node) || !isContractId(node.id)) return [];
    if ((node.type === "quiz" || node.type === "question-group") && Array.isArray(node.questions)) {
      return [node.id, ...node.questions.flatMap((question) => isRecord(question) && isContractId(question.id) ? [question.id] : [])];
    }
    return [node.id];
  }) : [];
  return document.schemaVersion === UI_CONTRACT_VERSION && isContractId(document.id) && validRevision(document.revision)
    && (document.title === undefined || boundedString(document.title, 512, true))
    && (document.description === undefined || boundedString(document.description, 8192, true))
    && LIFECYCLES.has(document.lifecycle) && boundedArray(document.supportedSurfaces, SURFACES.size)
	&& (document.retention === undefined || RETENTION_POLICIES.has(document.retention))
    && document.supportedSurfaces.length > 0 && document.supportedSurfaces.every((surface) => SURFACES.has(surface))
    && new Set(document.supportedSurfaces).size === document.supportedSurfaces.length
    && boundedArray(document.nodes, MAX_DOCUMENT_NODES) && document.nodes.every(validateUiDocumentNode) && uniqueIds(document.nodes) && uniqueIds(resources)
    && new Set(interactionIds).size === interactionIds.length
    && isContractTimestamp(document.createdAt) && isContractTimestamp(document.updatedAt) && compareContractTimestamps(document.updatedAt, document.createdAt) >= 0;
}

function hasActionBase(value: Record<string, unknown>): boolean {
  return value.schemaVersion === UI_CONTRACT_VERSION && ACTION_TYPES.has(value.type as UiAction["type"])
    && isContractId(value.documentId) && validRevision(value.documentRevision) && isContractId(value.idempotencyKey);
}

export function validateUiAction(value: unknown): value is UiAction {
  if (!isRecord(value) || !hasActionBase(value)) return false;
  const type = value.type as UiAction["type"];
  if (!hasOnlyKeys(value, ACTION_KEYS[type])) return false;
  if (type !== "retry" && !isContractId(value.nodeId)) return false;
  switch (type) {
    case "submit-answer": return (typeof value.answer === "string" && boundedString(value.answer, 8192, true))
      || (boundedArray(value.answer, MAX_CHOICES) && value.answer.length > 0
        && (value.answer.every((answer) => boundedString(answer, 8192, true)) || value.answer.every(validateUiRowAnswer)));
    case "choose-option": return boundedArray(value.optionIds, MAX_CHOICES) && value.optionIds.length > 0 && value.optionIds.every(isContractId) && new Set(value.optionIds).size === value.optionIds.length;
    case "submit-question-group": return boundedArray(value.responses, MAX_QUIZ_QUESTIONS) && value.responses.length > 0
      && value.responses.every(validateQuestionGroupResponse);
    case "complete-quiz": return isContractId(value.resultId)
      && boundedArray(value.answers, MAX_QUIZ_QUESTIONS) && value.answers.every(validateQuizResponse)
      && uniqueField(value.answers as UiQuizResponse[], "questionId")
      && isNonNegativeFinite(value.score) && isNonNegativeFinite(value.partialCreditPoints)
      && validatePartialCredits(value.partialCredits) && validateQuizTiming(value.timing)
      && validateContractIdList(value.flaggedQuestionIds, MAX_QUIZ_QUESTIONS)
      && validateContractIdList(value.pendingGradeQuestionIds, MAX_QUIZ_QUESTIONS)
      && validateContractIdList(value.skippedQuestionIds, MAX_QUIZ_QUESTIONS);
    case "complete-goal-step": return isContractId(value.stepId);
    case "complete-plan-item": return isContractId(value.itemId) && typeof value.completed === "boolean";
    case "update-notes": return boundedString(value.value, MAX_RESOURCE_CONTENT, true);
    case "rate-card": return isContractId(value.cardId) && (value.rating === 0 || value.rating === 1 || value.rating === 2 || value.rating === 3);
    case "complete-deck": return boundedArray(value.ratings, MAX_DECK_CARDS) && value.ratings.every(validateDeckRating)
      && uniqueField(value.ratings as UiDeckRating[], "cardId") && validateDeckCompletionSummary(value.summary);
    case "save-artifact": case "retry": case "open-handoff": return true;
  }
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateContractIdList(value: unknown, maxLength: number): value is string[] {
  return boundedArray(value, maxLength) && value.every(isContractId) && new Set(value).size === value.length;
}

function uniqueField<Entry extends Record<Key, string>, Key extends string>(entries: readonly Entry[], key: Key): boolean {
  return new Set(entries.map((entry) => entry[key])).size === entries.length;
}

function validateQuestionGroupResponse(value: unknown): value is UiQuestionGroupResponse {
  if (!isRecord(value) || !isContractId(value.questionId) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "text": return hasOnlyKeys(value, new Set(["questionId", "type", "answer"])) && boundedString(value.answer, 8192, true);
    case "choice": return hasOnlyKeys(value, new Set(["questionId", "type", "optionIds", "text"]))
      && boundedArray(value.optionIds, MAX_CHOICES) && value.optionIds.every(isContractId)
      && new Set(value.optionIds).size === value.optionIds.length
      && (value.text === undefined || boundedString(value.text, 8192, true));
    case "blanks": return hasOnlyKeys(value, new Set(["questionId", "type", "answers"]))
      && boundedArray(value.answers, MAX_CHOICES) && value.answers.every((answer) => boundedString(answer, 8192, true));
    case "rows": return hasOnlyKeys(value, new Set(["questionId", "type", "rows"]))
      && boundedArray(value.rows, MAX_CHOICES) && value.rows.every(validateUiRowAnswer);
    default: return false;
  }
}

function validateQuizResponse(value: unknown): value is UiQuizResponse {
  return hasOnlyKeys(value, new Set(["questionId", "answer"])) && isContractId((value as UiQuizResponse).questionId)
    && boundedString((value as UiQuizResponse).answer, 8192, true);
}

function validatePartialCredits(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.entries(value).every(([questionId, credit]) => isContractId(questionId)
    && typeof credit === "number" && Number.isFinite(credit) && credit >= 0 && credit <= 1);
}

function validateQuizTiming(value: unknown): value is UiQuizTiming {
  if (!hasOnlyKeys(value, new Set(["totalMs", "perQuestionMs"]))) return false;
  const timing = value as UiQuizTiming;
  return Number.isSafeInteger(timing.totalMs) && timing.totalMs >= 0 && isRecord(timing.perQuestionMs)
    && Object.entries(timing.perQuestionMs).every(([questionId, elapsed]) => isContractId(questionId)
      && Number.isSafeInteger(elapsed) && elapsed >= 0);
}

function validateDeckRating(value: unknown): value is UiDeckRating {
  if (!hasOnlyKeys(value, new Set(["cardId", "rating", "appliedIntervalDays", "easeAfter"]))) return false;
  const rating = value as UiDeckRating;
  return isContractId(rating.cardId) && (rating.rating === 0 || rating.rating === 1 || rating.rating === 2 || rating.rating === 3)
    && isNonNegativeFinite(rating.appliedIntervalDays) && isNonNegativeFinite(rating.easeAfter);
}

function validateDeckCompletionSummary(value: unknown): value is UiDeckCompletionSummary {
  return hasOnlyKeys(value, new Set(["reviewed", "lapses"]))
    && Number.isSafeInteger((value as UiDeckCompletionSummary).reviewed) && (value as UiDeckCompletionSummary).reviewed >= 0
    && Number.isSafeInteger((value as UiDeckCompletionSummary).lapses) && (value as UiDeckCompletionSummary).lapses >= 0;
}

interface ActionTarget {
  node: UiDocumentNode;
  question?: UiQuestion;
}

function findActionTarget(document: UiDocument, nodeId: string): ActionTarget | undefined {
  for (const node of document.nodes) {
    if (node.id === nodeId) return { node };
    if (node.type === "quiz") {
      const question = node.questions.find((candidate) => candidate.id === nodeId);
      if (question) return { node, question };
    }
  }
  return undefined;
}

/** Validates that an action is applicable to this exact document snapshot. */
export function validateUiActionAgainstDocument(action: unknown, document: unknown): action is UiAction {
  if (!validateUiAction(action) || !validateUiDocument(document)) return false;
  if (action.documentId !== document.id || action.documentRevision !== document.revision) return false;
  if (action.type === "retry") return document.lifecycle === "failed" || document.lifecycle === "cancelled";
  if (document.lifecycle !== "ready") return false;
  const target = findActionTarget(document, action.nodeId);
  if (!target) return false;
  const question = target.node.type === "question" ? target.node : target.question;
  switch (action.type) {
    case "submit-answer": {
      if (!question) return false;
      if (question.kind === "blanks" || question.kind === "fill_in") {
        return Array.isArray(action.answer) && action.answer.length > 0 && action.answer.every((entry) => typeof entry === "string");
      }
      if (question.kind === "classification" || question.kind === "matching") {
        if (!Array.isArray(action.answer) || !action.answer.every(validateUiRowAnswer)
          || action.answer.length !== question.items?.length) return false;
        const allowed = new Set(question.choices?.map((choice) => choice.id) ?? []);
        if (action.answer.some((row, index) => row.item !== question.items?.[index] || !allowed.has(row.optionId)
          || (question.requireReasons && !row.reason?.trim()))) return false;
        return question.kind !== "matching" || question.uniqueMatches === false
          || new Set(action.answer.map((row) => row.optionId)).size === action.answer.length;
      }
      return question.choices === undefined && typeof action.answer === "string";
    }
    case "choose-option": {
      if (!question?.choices || question.choices.length === 0) return false;
      if (!question.multiSelect && action.optionIds.length !== 1) return false;
      const allowed = new Set(question.choices.map((choice) => choice.id));
      return action.optionIds.every((id) => allowed.has(id));
    }
    case "submit-question-group": return target.node.type === "question-group"
      && validateQuestionGroupResponsesAgainstQuestions(action.responses, target.node.questions);
    case "complete-quiz": return target.node.type === "quiz"
      && validateQuizCompletionAgainstQuestions(action, target.node.questions);
    case "complete-goal-step": return target.node.type === "goal" && target.node.steps.some((step) => step.id === action.stepId && step.status !== "done");
    case "complete-plan-item": return target.node.type === "study-plan" && !!target.node.items && planContainsItem(target.node.items, action.itemId);
    case "update-notes": return target.node.type === "notes";
    case "rate-card": return target.node.type === "deck" && target.node.cards.some((card) => card.id === action.cardId);
    case "complete-deck": return target.node.type === "deck" && validateDeckCompletionAgainstCards(action, target.node.cards);
    case "save-artifact": return target.node.type === "study-plan" || target.node.type === "artifact" || target.node.type === "image" || target.node.type === "media";
    case "open-handoff": return target.node.type === "handoff";
  }
}

function responseTypeForQuestion(question: UiQuestion): UiQuestionGroupResponse["type"] {
  if (question.kind === "classification" || question.kind === "matching") return "rows";
  if (question.kind === "blanks" || question.kind === "fill_in") return "blanks";
  if (question.choices !== undefined || question.kind === "choice" || question.kind === "multiple_choice"
    || question.kind === "multi_select" || question.kind === "true_false" || question.kind === "dropdown") return "choice";
  return "text";
}

function validateQuestionGroupResponsesAgainstQuestions(
  responses: UiQuestionGroupResponse[],
  questions: UiQuestion[],
): boolean {
  if (responses.length !== questions.length) return false;
  return questions.every((question, index) => {
    const response = responses[index];
    if (!response || response.questionId !== question.id || response.type !== responseTypeForQuestion(question)) return false;
    if (response.type === "text") return true;
    if (response.type === "choice") {
      const allowed = new Set(question.choices?.map((choice) => choice.id) ?? []);
      if (response.optionIds.some((optionId) => !allowed.has(optionId))) return false;
      if (!question.multiSelect && response.optionIds.length > 1) return false;
      if (response.optionIds.length === 0 && !question.allowText) return false;
      return response.text === undefined || question.allowText === true;
    }
    if (response.type === "blanks") {
      return question.blanks === undefined || response.answers.length === question.blanks.length;
    }
    if (response.rows.length !== question.items?.length) return false;
    const allowed = new Set(question.choices?.map((choice) => choice.id) ?? []);
    if (response.rows.some((row, rowIndex) => row.item !== question.items?.[rowIndex] || !allowed.has(row.optionId)
      || (question.requireReasons && !row.reason?.trim()))) return false;
    return question.kind !== "matching" || question.uniqueMatches === false
      || new Set(response.rows.map((row) => row.optionId)).size === response.rows.length;
  });
}

function validateQuizCompletionAgainstQuestions(
  action: Extract<UiAction, { type: "complete-quiz" }>,
  questions: UiQuestion[],
): boolean {
  const questionIds = new Set(questions.map((question) => question.id));
  const hasOnlyQuestionIds = (ids: readonly string[]) => ids.every((id) => questionIds.has(id));
  if (!hasOnlyQuestionIds(action.answers.map((answer) => answer.questionId))
    || !hasOnlyQuestionIds(Object.keys(action.partialCredits))
    || !hasOnlyQuestionIds(Object.keys(action.timing.perQuestionMs))
    || !hasOnlyQuestionIds(action.flaggedQuestionIds)
    || !hasOnlyQuestionIds(action.pendingGradeQuestionIds)
    || !hasOnlyQuestionIds(action.skippedQuestionIds)) return false;
  const order = new Map(questions.map((question, index) => [question.id, index]));
  if (!isStrictlyOrdered(action.answers.map((answer) => answer.questionId), order)) return false;
  const answered = new Set(action.answers.map((answer) => answer.questionId));
  if (action.skippedQuestionIds.some((id) => answered.has(id))) return false;
  return action.score <= questions.length && action.partialCreditPoints <= questions.length;
}

function isStrictlyOrdered(ids: readonly string[], order: ReadonlyMap<string, number>): boolean {
  let prior = -1;
  for (const id of ids) {
    const next = order.get(id);
    if (next === undefined || next <= prior) return false;
    prior = next;
  }
  return true;
}

function validateDeckCompletionAgainstCards(
  action: Extract<UiAction, { type: "complete-deck" }>,
  cards: UiDeckCard[],
): boolean {
  if (action.summary.reviewed !== action.ratings.length || action.summary.lapses > action.summary.reviewed) return false;
  const order = new Map(cards.map((card, index) => [card.id, index]));
  return isStrictlyOrdered(action.ratings.map((rating) => rating.cardId), order);
}

function planContainsItem(items: readonly UiStudyPlanItem[], itemId: string): boolean {
  return items.some((item) => item.id === itemId || (item.children ? planContainsItem(item.children, itemId) : false));
}

export function validateUiActionResult(value: unknown): value is UiActionResult {
  if (!hasOnlyKeys(value, RESULT_KEYS)) return false;
  const result = value as UiActionResult;
  if (result.schemaVersion !== UI_CONTRACT_VERSION || !isContractId(result.documentId) || !validRevision(result.sourceRevision)
    || !isContractId(result.actionIdempotencyKey) || !(result.status === "accepted" || result.status === "completed" || result.status === "rejected" || result.status === "retryable")
    || !LIFECYCLES.has(result.documentLifecycle) || (result.message !== undefined && !boundedString(result.message, 4096, true))) return false;
  if (result.status === "retryable") {
    const retryAfterMs = result.retryAfterMs;
    if (typeof retryAfterMs !== "number" || !Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0 || result.resultingDocument !== undefined) return false;
  } else if (result.retryAfterMs !== undefined) return false;
  if (result.status === "completed") {
    const document = result.resultingDocument;
    return !!document && validateUiDocument(document) && document.id === result.documentId
      && document.revision > result.sourceRevision && document.lifecycle === result.documentLifecycle;
  }
  return result.resultingDocument === undefined;
}

/** A result is only applicable to the action/document revision it acknowledges. */
export function validateUiActionCorrelation(action: UiAction, result: UiActionResult, sourceDocument?: UiDocument): boolean {
  if (!validateUiAction(action) || !validateUiActionResult(result)
    || action.schemaVersion !== result.schemaVersion || action.documentId !== result.documentId
    || action.documentRevision !== result.sourceRevision || action.idempotencyKey !== result.actionIdempotencyKey) return false;
  if (!sourceDocument) return true;
  if (!validateUiActionAgainstDocument(action, sourceDocument)) return false;
  if (result.status === "completed") return result.resultingDocument?.id === sourceDocument.id
    && result.resultingDocument.revision > sourceDocument.revision;
  return result.documentLifecycle === sourceDocument.lifecycle;
}

/** Stable representation used to reject accidental reuse of an idempotency key. */
export function canonicalUiAction(action: UiAction): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => codePointCompare(left, right)).map(([key, child]) => [key, sort(child)]));
  };
  return JSON.stringify(sort(action));
}

export function validateUiActionReceipt(value: unknown): value is UiActionReceipt {
  if (!hasOnlyKeys(value, RECEIPT_KEYS)) return false;
  const receipt = value as UiActionReceipt;
  if (receipt.schemaVersion !== UI_CONTRACT_VERSION || !validateUiAction(receipt.action)
    || receipt.actionFingerprint !== canonicalUiAction(receipt.action) || !RECEIPT_STATES.has(receipt.state)
    || !isContractTimestamp(receipt.createdAt) || !isContractTimestamp(receipt.updatedAt) || compareContractTimestamps(receipt.updatedAt, receipt.createdAt) < 0) return false;
  if (receipt.state === "pending") return receipt.result === undefined;
  return !!receipt.result && validateUiActionResult(receipt.result)
    && receipt.result.status === receipt.state && validateUiActionCorrelation(receipt.action, receipt.result);
}

export function validateUiActionJournal(value: unknown): value is UiActionJournal {
  if (!hasOnlyKeys(value, JOURNAL_KEYS)) return false;
  const journal = value as UiActionJournal;
  if (journal.kind !== UI_ACTION_JOURNAL_KIND || journal.schemaVersion !== UI_CONTRACT_VERSION || !isContractId(journal.documentId)
    || !boundedArray(journal.receipts, MAX_JOURNAL_RECEIPTS) || !journal.receipts.every(validateUiActionReceipt)) return false;
  const keys = new Map<string, string>();
  for (const receipt of journal.receipts) {
    if (receipt.action.documentId !== journal.documentId) return false;
    const prior = keys.get(receipt.action.idempotencyKey);
    if (prior !== undefined) return false;
    keys.set(receipt.action.idempotencyKey, receipt.actionFingerprint);
  }
  return true;
}

/** Returns a replayable receipt or fails closed when a key names a different action. */
export function receiptForUiAction(journal: UiActionJournal, action: UiAction): UiActionReceipt | undefined {
  if (!validateUiActionJournal(journal)) throw new UiActionReplayConflictError("Cannot replay an invalid UI action journal.");
  if (!validateUiAction(action) || journal.documentId !== action.documentId) throw new UiActionReplayConflictError("Action does not belong to this UI action journal.");
  const receipt = journal.receipts.find((candidate) => candidate.action.idempotencyKey === action.idempotencyKey);
  if (!receipt) return undefined;
  if (receipt.actionFingerprint !== canonicalUiAction(action)) {
    throw new UiActionReplayConflictError(`Idempotency key ${action.idempotencyKey} names a different action.`);
  }
  return receipt;
}
