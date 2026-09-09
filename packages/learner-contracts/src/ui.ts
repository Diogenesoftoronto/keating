import { isValidSimulationExpression } from "./simulation-expression.js";
import { codePointCompare, compareContractTimestamps, hasOnlyKeys, isBoundedJsonValue, isContractId, isContractTimestamp, isRecord } from "./validation.js";

export const UI_CONTRACT_VERSION = 1 as const;
export const UI_ACTION_JOURNAL_KIND = "keating-ui-action-journal" as const;

export type LearnerSurface = "web" | "desktop" | "mobile" | "terminal";
export type DocumentLifecycle = "draft" | "streaming" | "ready" | "submitted" | "completed" | "failed" | "cancelled";
export type UiDocumentRetention = "ephemeral" | "resumable" | "workspace";
export type UiGoalStepStatus = "not_started" | "in_progress" | "done";
export type UiArtifactFormat = "markdown" | "text" | "json" | "uri";
export type UiQuestionType = "choice" | "text" | "blanks" | "classification" | "matching"
  | "multiple_choice" | "multi_select" | "true_false" | "fill_in" | "short_answer"
  | "transfer" | "slider" | "dropdown" | "ordering";
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
  | { questionId: string; type: "rows"; rows: UiRowAnswer[] }
  /** A sequence the learner arranged; always a permutation of the question's items. */
  | { questionId: string; type: "order"; items: string[] };

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

/**
 * Work the learner does away from the conversation.
 *
 * One node covers four shapes because they differ in framing and in what the
 * learner hands back, not in structure: an `assignment` produces one
 * deliverable, a `practice` set is repeated drills, a `draft` is long-form
 * writing revised over rounds, and `fieldwork` collects evidence from the world
 * against a protocol.
 */
export type UiTaskKind = "assignment" | "practice" | "draft" | "fieldwork";

export interface UiTaskItem {
  id: string;
  title: string;
  detail?: string;
  status?: UiGoalStepStatus;
  /** What the learner recorded while doing it. */
  note?: string;
}

export interface UiSubmissionAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export function validateSubmissionAttachment(value: unknown): value is UiSubmissionAttachment {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, new Set(["id", "name", "mimeType", "sizeBytes"]))
    && typeof value.id === "string" && /^attachment_[a-f0-9]{32}$/.test(value.id)
    && boundedString(value.name, 255) && boundedString(value.mimeType, 160)
    && Number.isInteger(value.sizeBytes) && (value.sizeBytes as number) > 0
    && (value.sizeBytes as number) <= 25 * 1024 * 1024;
}

export interface UiResponseCapture {
  kind: "audio" | "video";
  /** Optional fluency target. Learners may choose untimed practice. */
  timeLimitSeconds?: number;
}

export interface UiTaskSubmission {
  capture?: UiResponseCapture;
  /** `none` is a task tracked only by its items, with nothing handed back. */
  format: "text" | "link" | "none";
  label?: string;
  placeholder?: string;
  /** Length target for a draft, in words. Advisory, never enforced. */
  targetWords?: number;
}

export interface UiTaskNode {
  type: "task";
  kind: UiTaskKind;
  id: string;
  title: string;
  /** Agent-authored brief, prompt, or objective, as markdown. */
  brief: string;
  /** Success criteria or rubric lines the work is judged against. */
  criteria?: string[];
  /** Steps, exercises, or collection protocol, depending on `kind`. */
  items?: UiTaskItem[];
  estimatedMinutes?: number;
  /** When the work is due. Advisory: a late submission is still accepted. */
  dueAt?: string;
  /** Before this, the task is visible but not yet open for submission. */
  availableFrom?: string;
  /** 1-based revision round, for a draft carried across submissions. */
  round?: number;
  submission?: UiTaskSubmission;
}

/**
 * A model the learner manipulates directly, recomputed locally on every change.
 *
 * This is the one component with a feedback loop that costs no conversational
 * turn: the learner moves a parameter and sees the consequence immediately.
 * `expr` is a closed arithmetic language over this node's own parameter ids —
 * see `simulation-expression.ts`. Nothing about it is evaluated as code.
 */
export interface UiSimulationParameter {
  id: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
}

export interface UiSimulationReadout {
  id: string;
  label: string;
  unit?: string;
  /** Arithmetic over parameter ids only. No calls, no free identifiers. */
  expr: string;
  /** Decimal places; defaults to 2. */
  precision?: number;
  /** Marks the one number the learner is meant to watch. */
  emphasis?: boolean;
}

export interface UiSimulationNode {
  type: "simulation";
  id: string;
  title: string;
  /** What to try, and what to watch for. Markdown. */
  brief?: string;
  parameters: UiSimulationParameter[];
  readouts: UiSimulationReadout[];
}

export type UiCodeValue = null | boolean | number | string | UiCodeValue[] | { [key: string]: UiCodeValue };

/** Pure function exercises. Test inputs and expected outputs are data, never test code. */
export interface UiCodingChallengeNode {
  type: "coding-challenge";
  id: string;
  title: string;
  prompt: string;
  language: "javascript" | "typescript";
  starterCode: string;
  entrypoint: string;
  tests: Array<{ id: string; label: string; args: UiCodeValue[]; expected: UiCodeValue }>;
  hint?: string;
}

/** Authored Strudel code is editable data until explicit playback in an isolated surface. */
export interface UiMusicLabNode {
  type: "music-lab";
  id: string;
  title: string;
  code: string;
  brief?: string;
  /** Numeric values available to the pattern as controls.<id>. */
  controls?: UiSimulationParameter[];
  visualization?: "pianoroll" | "scope";
}

interface UiLanguageRoundBase {
  id: string;
  prompt: string;
  hint?: string;
}

export type UiLanguageRound =
  | (UiLanguageRoundBase & { kind: "translation"; text: string; acceptedAnswers: string[] })
  | (UiLanguageRoundBase & { kind: "word-order"; tokens: UiOption[]; correctOrder: string[] })
  | (UiLanguageRoundBase & { kind: "listening"; text: string; acceptedAnswers: string[]; referenceAudioUrl?: string; audioCreditUrl?: string })
  | (UiLanguageRoundBase & { kind: "pronunciation"; text: string; referenceAudioUrl?: string; audioCreditUrl?: string });

export interface UiLanguagePracticeNode {
  type: "language-practice";
  id: string;
  title: string;
  /** Target language, for example French or fr-FR. */
  language: string;
  rounds: UiLanguageRound[];
}

/** Pronunciation records practice only; recordings stay on the learner's device. */
export interface UiLanguageRoundResult {
  roundId: string;
  outcome: "correct" | "retry" | "practiced" | "skipped";
  attempts: number;
  timeMs: number;
  answer?: string;
}

export function normalizeLanguagePracticeAnswer(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/[‘’]/gu, "'").replace(/\s+/gu, " ").replace(/^[¡¿]+|[.!?]+$/gu, "").trim();
}

function languageRoundAnswerMatches(round: UiLanguageRound, answer: string): boolean {
  if (round.kind === "pronunciation") return false;
  const accepted = round.kind === "word-order"
    ? [round.correctOrder.map((id) => round.tokens.find((token) => token.id === id)!.label).join(" ")]
    : round.acceptedAnswers;
  return accepted.some((value) => normalizeLanguagePracticeAnswer(value) === normalizeLanguagePracticeAnswer(answer));
}

export type UiDocumentNode =
  | { type: "markdown"; id: string; markdown: string }
  | { type: "callout"; id: string; markdown: string; tone: "info" | "hint" | "check" | "warning"; title?: string }
  | ({ type: "question" } & UiQuestion)
  | { type: "question-group"; id: string; title?: string; intro?: string; topic?: string; questions: UiQuestion[] }
  | {
    type: "quiz";
    id: string;
    title: string;
    questions: UiQuestion[];
    /** Exams use one overall deadline and reveal grades only after submission. */
    mode?: "exam";
    /** Whole-exam seconds. Omitted means 30 minutes; independent of per-question timeLimit. */
    examTimeLimit?: number;
    /**
     * Seconds allowed per question unless a question overrides it. Omitted
     * means the surface default; 0 means untimed, which is how a model opts a
     * reflective quiz out of the clock entirely.
     */
    timeLimit?: number;
  }
  | { type: "goal"; id: string; title: string; description?: string; status: "active" | "completed" | "paused"; steps: UiGoalStep[] }
  | { type: "deck"; id: string; title: string; topic: string; description?: string; cards: UiDeckCard[] }
  | UiStudyPlanNode
  | { type: "artifact"; id: string; resource: UiArtifactResource }
  | { type: "concept-map"; id: string; title?: string; source: string }
  | { type: "notes"; id: string; title: string; value: string; placeholder?: string }
  | UiTaskNode
  | UiSimulationNode
  | UiCodingChallengeNode
  | UiMusicLabNode
  | UiLanguagePracticeNode
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
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-language-practice"; documentId: string; documentRevision: number; nodeId: string; rounds: UiLanguageRoundResult[]; correct: number; objectiveTotal: number; pronunciationPracticed: number; totalMs: number; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "submit-answer"; documentId: string; documentRevision: number; nodeId: string; answer: UiAnswer; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "choose-option"; documentId: string; documentRevision: number; nodeId: string; optionIds: string[]; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "submit-question-group"; documentId: string; documentRevision: number; nodeId: string; responses: UiQuestionGroupResponse[]; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-quiz"; documentId: string; documentRevision: number; nodeId: string; resultId: string; answers: UiQuizResponse[]; score: number; partialCreditPoints: number; partialCredits: Record<string, number>; timing: UiQuizTiming; flaggedQuestionIds: string[]; pendingGradeQuestionIds: string[]; skippedQuestionIds: string[]; timedOutQuestionIds?: string[]; examTimedOut?: boolean; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-goal-step"; documentId: string; documentRevision: number; nodeId: string; stepId: string; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-plan-item"; documentId: string; documentRevision: number; nodeId: string; itemId: string; completed: boolean; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "update-notes"; documentId: string; documentRevision: number; nodeId: string; value: string; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "complete-task-item"; documentId: string; documentRevision: number; nodeId: string; itemId: string; completed: boolean; note?: string; idempotencyKey: string }
  | { schemaVersion: typeof UI_CONTRACT_VERSION; type: "submit-task"; documentId: string; documentRevision: number; nodeId: string; submission: string; attachments?: UiSubmissionAttachment[]; round?: number; idempotencyKey: string }
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
const ACTION_TYPES = new Set<UiAction["type"]>(["complete-language-practice", "submit-answer", "choose-option", "submit-question-group", "complete-quiz", "complete-goal-step", "complete-plan-item", "update-notes", "rate-card", "complete-deck", "save-artifact", "retry", "open-handoff", "complete-task-item", "submit-task"]);
const RECEIPT_STATES = new Set<UiActionReceipt["state"]>(["pending", "accepted", "completed", "rejected", "retryable"]);
const DOCUMENT_KEYS = new Set(["schemaVersion", "id", "revision", "lifecycle", "retention", "supportedSurfaces", "title", "description", "nodes", "createdAt", "updatedAt"]);
const OPTION_KEYS = new Set(["id", "label"]);
const ROW_ANSWER_KEYS = new Set(["item", "optionId", "reason"]);
const QUESTION_FIELD_KEYS = ["id", "prompt", "kind", "header", "choices", "items", "blanks", "hint", "allowText", "multiSelect", "requireReasons", "itemLabel", "choiceLabel", "reasonLabel", "uniqueMatches", "correctMatches", "level", "correctAnswer", "correctAnswers", "explanation", "rubric", "timeLimit", "min", "max", "step"];
const QUESTION_KEYS = new Set(["type", ...QUESTION_FIELD_KEYS]);
const NESTED_QUESTION_KEYS = new Set(QUESTION_FIELD_KEYS);
const QUESTION_GROUP_KEYS = new Set(["type", "id", "title", "intro", "topic", "questions"]);
const LANGUAGE_KEYS = new Set(["type", "id", "title", "language", "rounds"]);
const LANGUAGE_ROUND_KEYS = new Set(["id", "kind", "prompt", "hint", "text", "acceptedAnswers", "tokens", "correctOrder", "referenceAudioUrl", "audioCreditUrl"]);
const LANGUAGE_RESULT_KEYS = new Set(["roundId", "outcome", "attempts", "timeMs", "answer"]);
const QUIZ_KEYS = new Set(["type", "id", "title", "questions", "timeLimit", "mode", "examTimeLimit"]);
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
const TASK_KEYS = new Set(["type", "kind", "id", "title", "brief", "criteria", "items", "estimatedMinutes", "dueAt", "availableFrom", "round", "submission"]);
const TASK_ITEM_KEYS = new Set(["id", "title", "detail", "status", "note"]);
const TASK_SUBMISSION_KEYS = new Set(["format", "label", "placeholder", "targetWords", "capture"]);
const SIMULATION_KEYS = new Set(["type", "id", "title", "brief", "parameters", "readouts"]);
const CODING_CHALLENGE_KEYS = new Set(["type", "id", "title", "prompt", "language", "starterCode", "entrypoint", "tests", "hint"]);
const CODING_TEST_KEYS = new Set(["id", "label", "args", "expected"]);
const MUSIC_LAB_KEYS = new Set(["type", "id", "title", "code", "brief", "controls", "visualization"]);
const SIMULATION_PARAMETER_KEYS = new Set(["id", "label", "unit", "min", "max", "step", "value"]);
const SIMULATION_READOUT_KEYS = new Set(["id", "label", "unit", "expr", "precision", "emphasis"]);
const TASK_KINDS = new Set<UiTaskKind>(["assignment", "practice", "draft", "fieldwork"]);
const TASK_SUBMISSION_FORMATS = new Set(["text", "link", "none"]);
const IMAGE_KEYS = new Set(["type", "id", "alt", "resource"]);
const MEDIA_KEYS = new Set(["type", "id", "kind", "resource"]);
const HANDOFF_KEYS = new Set(["type", "id", "target", "reason", "context"]);
const MARKDOWN_KEYS = new Set(["type", "id", "markdown"]);
const ACTION_BASE_KEYS = new Set(["schemaVersion", "type", "documentId", "documentRevision", "nodeId", "idempotencyKey"]);
const ACTION_KEYS: Readonly<Record<UiAction["type"], ReadonlySet<string>>> = {
  "submit-answer": new Set([...ACTION_BASE_KEYS, "answer"]),
  "choose-option": new Set([...ACTION_BASE_KEYS, "optionIds"]),
  "submit-question-group": new Set([...ACTION_BASE_KEYS, "responses"]),
  "complete-language-practice": new Set([...ACTION_BASE_KEYS, "rounds", "correct", "objectiveTotal", "pronunciationPracticed", "totalMs"]),
  "complete-quiz": new Set([...ACTION_BASE_KEYS, "resultId", "answers", "score", "partialCreditPoints", "partialCredits", "timing", "flaggedQuestionIds", "pendingGradeQuestionIds", "skippedQuestionIds", "timedOutQuestionIds", "examTimedOut"]),
  "complete-goal-step": new Set([...ACTION_BASE_KEYS, "stepId"]),
  "complete-plan-item": new Set([...ACTION_BASE_KEYS, "itemId", "completed"]),
  "update-notes": new Set([...ACTION_BASE_KEYS, "value"]),
  "rate-card": new Set([...ACTION_BASE_KEYS, "cardId", "rating"]),
  "complete-deck": new Set([...ACTION_BASE_KEYS, "ratings", "summary"]),
  "save-artifact": ACTION_BASE_KEYS,
  "retry": new Set(["schemaVersion", "type", "documentId", "documentRevision", "idempotencyKey"]),
  "open-handoff": ACTION_BASE_KEYS,
  "complete-task-item": new Set([...ACTION_BASE_KEYS, "itemId", "completed", "note"]),
  "submit-task": new Set([...ACTION_BASE_KEYS, "submission", "round", "attachments"]),
};
const RESULT_KEYS = new Set(["schemaVersion", "documentId", "sourceRevision", "actionIdempotencyKey", "status", "documentLifecycle", "resultingDocument", "message", "retryAfterMs"]);
const RECEIPT_KEYS = new Set(["schemaVersion", "action", "actionFingerprint", "state", "createdAt", "updatedAt", "result"]);
const JOURNAL_KEYS = new Set(["kind", "schemaVersion", "documentId", "receipts"]);

const MAX_DOCUMENT_NODES = 64;
export const MIN_EXAM_QUESTIONS = 20;
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
const MAX_TASK_ITEMS = 64;
const MAX_TASK_CRITERIA = 32;
const MAX_SIMULATION_PARAMETERS = 8;
const MAX_SIMULATION_READOUTS = 8;
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

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateSimulationParameter(value: unknown): value is UiSimulationParameter {
  const parameter = value as UiSimulationParameter;
  return hasOnlyKeys(value, SIMULATION_PARAMETER_KEYS) && isContractId(parameter.id) && boundedString(parameter.label, 512)
    && (parameter.unit === undefined || boundedString(parameter.unit, 64, true))
    && finiteNumber(parameter.min) && finiteNumber(parameter.max) && parameter.min < parameter.max
    && (parameter.step === undefined || (finiteNumber(parameter.step) && parameter.step > 0))
    && finiteNumber(parameter.value) && parameter.value >= parameter.min && parameter.value <= parameter.max;
}

function validateSimulationNode(value: Record<string, unknown>): boolean {
  const node = value as unknown as UiSimulationNode;
  if (!hasOnlyKeys(value, SIMULATION_KEYS) || !boundedString(node.title, 512)) return false;
  if (node.brief !== undefined && !boundedString(node.brief, MAX_MARKDOWN, true)) return false;
  if (!boundedArray(node.parameters, MAX_SIMULATION_PARAMETERS) || node.parameters.length === 0) return false;
  if (!node.parameters.every(validateSimulationParameter) || !uniqueField(node.parameters, "id")) return false;
  if (!boundedArray(node.readouts, MAX_SIMULATION_READOUTS) || node.readouts.length === 0) return false;
  if (!uniqueField(node.readouts, "id")) return false;
  const parameterIds = node.parameters.map((parameter) => parameter.id);
  return node.readouts.every((readout) => hasOnlyKeys(readout, SIMULATION_READOUT_KEYS)
    && isContractId(readout.id) && boundedString(readout.label, 512)
    && (readout.unit === undefined || boundedString(readout.unit, 64, true))
    && (readout.precision === undefined || (Number.isInteger(readout.precision) && readout.precision >= 0 && readout.precision <= 6))
    && (readout.emphasis === undefined || typeof readout.emphasis === "boolean")
    // A readout that references anything undeclared is rejected at the door, so
    // no surface has to decide what an unknown identifier means at render time.
    && isValidSimulationExpression(readout.expr, parameterIds));
}

function validateTaskItem(value: unknown): value is UiTaskItem {
  const item = value as UiTaskItem;
  return hasOnlyKeys(value, TASK_ITEM_KEYS) && isContractId(item.id) && boundedString(item.title, 512)
    && (item.detail === undefined || boundedString(item.detail, MAX_TEXT, true))
    && (item.status === undefined || GOAL_STEP_STATUSES.has(item.status))
    && (item.note === undefined || boundedString(item.note, MAX_TEXT, true));
}

export function validateResponseCapture(value: unknown): value is UiResponseCapture {
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(["kind", "timeLimitSeconds"]))) return false;
  return (value.kind === "audio" || value.kind === "video")
    && (value.timeLimitSeconds === undefined || (Number.isInteger(value.timeLimitSeconds) && (value.timeLimitSeconds as number) >= 1 && (value.timeLimitSeconds as number) <= 180));
}

function validateTaskSubmission(value: unknown): value is UiTaskSubmission {
  const submission = value as UiTaskSubmission;
  return hasOnlyKeys(value, TASK_SUBMISSION_KEYS) && TASK_SUBMISSION_FORMATS.has(submission.format)
    && (submission.capture === undefined || (submission.format === "text" && validateResponseCapture(submission.capture)))
    && (submission.label === undefined || boundedString(submission.label, 512, true))
    && (submission.placeholder === undefined || boundedString(submission.placeholder, 4096, true))
    && (submission.targetWords === undefined || (isNonNegativeFinite(submission.targetWords) && submission.targetWords <= 100_000));
}

function validateTaskNode(value: Record<string, unknown>): boolean {
  const node = value as unknown as UiTaskNode;
  return hasOnlyKeys(value, TASK_KEYS) && TASK_KINDS.has(node.kind)
    && boundedString(node.title, 512) && boundedString(node.brief, MAX_MARKDOWN)
    && (node.criteria === undefined || (boundedArray(node.criteria, MAX_TASK_CRITERIA) && node.criteria.every((entry) => boundedString(entry, 2048))))
    && (node.items === undefined || (boundedArray(node.items, MAX_TASK_ITEMS) && node.items.every(validateTaskItem) && uniqueField(node.items, "id")))
    && (node.estimatedMinutes === undefined || (isNonNegativeFinite(node.estimatedMinutes) && node.estimatedMinutes <= 100_000))
    && (node.dueAt === undefined || isContractTimestamp(node.dueAt))
    && (node.availableFrom === undefined || isContractTimestamp(node.availableFrom))
    && (node.round === undefined || (isNonNegativeFinite(node.round) && node.round <= 1000))
    && (node.submission === undefined || validateTaskSubmission(node.submission));
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

function validateLanguageRound(value: unknown): value is UiLanguageRound {
  if (!isRecord(value) || !hasOnlyKeys(value, LANGUAGE_ROUND_KEYS) || !isContractId(value.id)
    || !boundedString(value.prompt, 1024) || (value.hint !== undefined && !boundedString(value.hint, 1024))) return false;
  if (value.kind === "word-order") return value.text === undefined && value.acceptedAnswers === undefined && value.referenceAudioUrl === undefined && value.audioCreditUrl === undefined
    && boundedArray(value.tokens, 24) && value.tokens.length > 0 && value.tokens.every((token): token is UiOption => hasOnlyKeys(token, OPTION_KEYS)
      && isContractId((token as UiOption).id) && boundedString((token as UiOption).label, 128))
    && uniqueIds(value.tokens) && validateContractIdList(value.correctOrder, 24)
    && value.correctOrder.length === value.tokens.length
    && value.correctOrder.every((id) => (value.tokens as UiOption[]).some((token) => token.id === id));
  if (!(value.kind === "translation" || value.kind === "listening" || value.kind === "pronunciation")
    || !boundedString(value.text, 2048) || value.tokens !== undefined || value.correctOrder !== undefined) return false;
  for (const uri of [value.referenceAudioUrl, value.audioCreditUrl]) {
    if (uri === undefined) continue;
    if (value.kind === "translation" || typeof uri !== "string" || !boundedString(uri, 4096)) return false;
    if (!(uri.startsWith("/") && !uri.startsWith("//") && !/[\\?#]/u.test(uri))
      && !(isSafeResourceUri(uri) && !uri.startsWith("artifact:"))) return false;
  }
  return value.kind === "pronunciation" ? value.acceptedAnswers === undefined
    : boundedArray(value.acceptedAnswers, 16) && value.acceptedAnswers.length > 0
      && value.acceptedAnswers.every((answer) => boundedString(answer, 2048));
}

function validateLanguageRoundResult(value: unknown): value is UiLanguageRoundResult {
  if (!isRecord(value) || !hasOnlyKeys(value, LANGUAGE_RESULT_KEYS) || !isContractId(value.roundId)
    || !validRevision(value.attempts) || value.attempts > 1000 || !validRevision(value.timeMs)
    || (value.answer !== undefined && !boundedString(value.answer, 4096, true))) return false;
  return value.outcome === "skipped" || ((value.outcome === "correct" || value.outcome === "retry" || value.outcome === "practiced") && value.attempts > 0);
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
    case "language-practice": return hasOnlyKeys(value, LANGUAGE_KEYS) && boundedString(value.title, 512)
      && boundedString(value.language, 128) && boundedArray(value.rounds, 16) && value.rounds.length > 0
      && value.rounds.every(validateLanguageRound) && uniqueIds(value.rounds);
    case "quiz": return (value.timeLimit === undefined || (isNonNegativeFinite(value.timeLimit) && value.timeLimit <= 86_400))
      && (value.mode === undefined || value.mode === "exam")
      && (value.examTimeLimit === undefined || (value.mode === "exam" && typeof value.examTimeLimit === "number" && Number.isSafeInteger(value.examTimeLimit) && value.examTimeLimit > 0 && value.examTimeLimit <= 86_400))
      && hasOnlyKeys(value, QUIZ_KEYS) && boundedString(value.title, 512)
      && boundedArray(value.questions, MAX_QUIZ_QUESTIONS)
      && (value.mode !== "exam" || value.questions.length >= MIN_EXAM_QUESTIONS)
      && value.questions.every(validateUiQuestion) && uniqueIds(value.questions);
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
    case "task": return validateTaskNode(value);
    case "simulation": return validateSimulationNode(value);
    case "coding-challenge": return hasOnlyKeys(value, CODING_CHALLENGE_KEYS)
      && boundedString(value.title, 512) && boundedString(value.prompt, 8192)
      && (value.language === "javascript" || value.language === "typescript")
      && boundedString(value.starterCode, 32768, true)
      && typeof value.entrypoint === "string" && /^[A-Za-z_$][\w$]{0,127}$/.test(value.entrypoint)
      && boundedArray(value.tests, 24) && value.tests.length > 0
      && value.tests.every((test) => isRecord(test) && hasOnlyKeys(test, CODING_TEST_KEYS) && isContractId(test.id)
        && boundedString(test.label, 256) && Array.isArray(test.args) && test.args.length <= 16
        && isBoundedJsonValue(test.args, { maximumDepth: 6, maximumItems: 128, maximumStringLength: 4096 })
        && isBoundedJsonValue(test.expected, { maximumDepth: 6, maximumItems: 128, maximumStringLength: 4096 }))
      && new Set(value.tests.map((test) => (test as { id: string }).id)).size === value.tests.length
      && (value.hint === undefined || boundedString(value.hint, 4096, true));
    case "music-lab": return hasOnlyKeys(value, MUSIC_LAB_KEYS) && boundedString(value.title, 512)
      && boundedString(value.code, 32768) && (value.brief === undefined || boundedString(value.brief, 4096, true))
      && (value.visualization === undefined || value.visualization === "pianoroll" || value.visualization === "scope")
      && (value.controls === undefined || (boundedArray(value.controls, 8)
        && value.controls.every(validateSimulationParameter) && uniqueField(value.controls, "id")));
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
    case "complete-language-practice": return boundedArray(value.rounds, 16) && value.rounds.length > 0
      && value.rounds.every(validateLanguageRoundResult) && uniqueField(value.rounds as UiLanguageRoundResult[], "roundId")
      && validRevision(value.totalMs) && validRevision(value.correct) && validRevision(value.objectiveTotal)
      && validRevision(value.pronunciationPracticed) && value.correct <= value.objectiveTotal
      && value.objectiveTotal + value.pronunciationPracticed <= value.rounds.length
      && value.correct === value.rounds.filter((round) => (round as UiLanguageRoundResult).outcome === "correct").length
      && value.pronunciationPracticed === value.rounds.filter((round) => (round as UiLanguageRoundResult).outcome === "practiced").length
      && value.rounds.reduce<number>((total, round) => total + (round as UiLanguageRoundResult).timeMs, 0) <= value.totalMs;
    case "complete-quiz": return isContractId(value.resultId)
      && boundedArray(value.answers, MAX_QUIZ_QUESTIONS) && value.answers.every(validateQuizResponse)
      && uniqueField(value.answers as UiQuizResponse[], "questionId")
      && isNonNegativeFinite(value.score) && isNonNegativeFinite(value.partialCreditPoints)
      && validatePartialCredits(value.partialCredits) && validateQuizTiming(value.timing)
      && validateContractIdList(value.flaggedQuestionIds, MAX_QUIZ_QUESTIONS)
      && validateContractIdList(value.pendingGradeQuestionIds, MAX_QUIZ_QUESTIONS)
      && validateContractIdList(value.skippedQuestionIds, MAX_QUIZ_QUESTIONS)
      && (value.timedOutQuestionIds === undefined || validateContractIdList(value.timedOutQuestionIds, MAX_QUIZ_QUESTIONS))
      && (value.examTimedOut === undefined || typeof value.examTimedOut === "boolean");
    case "complete-goal-step": return isContractId(value.stepId);
    case "complete-plan-item": return isContractId(value.itemId) && typeof value.completed === "boolean";
    case "update-notes": return boundedString(value.value, MAX_RESOURCE_CONTENT, true);
    case "rate-card": return isContractId(value.cardId) && (value.rating === 0 || value.rating === 1 || value.rating === 2 || value.rating === 3);
    case "complete-deck": return boundedArray(value.ratings, MAX_DECK_CARDS) && value.ratings.every(validateDeckRating)
      && uniqueField(value.ratings as UiDeckRating[], "cardId") && validateDeckCompletionSummary(value.summary);
    case "complete-task-item": return isContractId(value.itemId) && typeof value.completed === "boolean"
      && (value.note === undefined || boundedString(value.note, MAX_TEXT, true));
    case "submit-task": return boundedString(value.submission, MAX_RESOURCE_CONTENT, true)
      && (value.attachments === undefined || (boundedArray(value.attachments, 10) && value.attachments.every(validateSubmissionAttachment)))
      && (value.round === undefined || (isNonNegativeFinite(value.round) && value.round <= 1000));
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
    case "order": return hasOnlyKeys(value, new Set(["questionId", "type", "items"]))
      && boundedArray(value.items, MAX_CHOICES) && value.items.every((item) => boundedString(item, 8192, true));
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
      if (question.kind === "ordering") {
        return Array.isArray(action.answer) && action.answer.every((entry) => typeof entry === "string")
          && isPermutationOf(action.answer as string[], question.items);
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
      if (!question.multiSelect && question.kind !== "multi_select" && action.optionIds.length !== 1) return false;
      const allowed = new Set(question.choices.map((choice) => choice.id));
      return action.optionIds.every((id) => allowed.has(id));
    }
    case "submit-question-group": return target.node.type === "question-group"
      && validateQuestionGroupResponsesAgainstQuestions(action.responses, target.node.questions);
    case "complete-language-practice": {
      if (target.node.type !== "language-practice") return false;
      const node = target.node;
      return action.rounds.length === node.rounds.length
      && action.objectiveTotal === node.rounds.filter((round) => round.kind !== "pronunciation").length
      && action.rounds.every((result, index) => {
        const round = node.rounds[index]!;
        return result.roundId === round.id && (round.kind === "pronunciation"
          ? (result.outcome === "practiced" || result.outcome === "skipped") && result.answer === undefined
          : result.outcome === "skipped" || (typeof result.answer === "string"
            && (result.outcome === "correct" ? languageRoundAnswerMatches(round, result.answer)
              : result.outcome === "retry" && !languageRoundAnswerMatches(round, result.answer))));
      });
    }
    case "complete-quiz": return target.node.type === "quiz"
      && validateQuizCompletionAgainstQuestions(action, target.node.questions);
    case "complete-goal-step": return target.node.type === "goal" && target.node.steps.some((step) => step.id === action.stepId && step.status !== "done");
    case "complete-plan-item": return target.node.type === "study-plan" && !!target.node.items && planContainsItem(target.node.items, action.itemId);
    case "update-notes": return target.node.type === "notes";
    case "rate-card": return target.node.type === "deck" && target.node.cards.some((card) => card.id === action.cardId);
    case "complete-deck": return target.node.type === "deck" && validateDeckCompletionAgainstCards(action, target.node.cards);
    case "save-artifact": return target.node.type === "study-plan" || target.node.type === "artifact" || target.node.type === "image" || target.node.type === "media";
    case "complete-task-item": return target.node.type === "task" && !!target.node.items && target.node.items.some((item) => item.id === action.itemId);
    case "submit-task": return target.node.type === "task" && target.node.submission?.format !== "none";
    case "open-handoff": return target.node.type === "handoff";
  }
}

/**
 * An arrangement must contain exactly the question's items, each once. Anything
 * else is a client that dropped, duplicated, or invented one.
 */
function isPermutationOf(candidate: readonly string[], items: readonly string[] | undefined): boolean {
  if (!items || candidate.length !== items.length) return false;
  const remaining = new Map<string, number>();
  for (const item of items) remaining.set(item, (remaining.get(item) ?? 0) + 1);
  for (const entry of candidate) {
    const count = remaining.get(entry);
    if (!count) return false;
    remaining.set(entry, count - 1);
  }
  return true;
}

function responseTypeForQuestion(question: UiQuestion): UiQuestionGroupResponse["type"] {
  if (question.kind === "ordering") return "order";
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
      if (!question.multiSelect && question.kind !== "multi_select" && response.optionIds.length > 1) return false;
      if (response.optionIds.length === 0 && !question.allowText) return false;
      return response.text === undefined || question.allowText === true;
    }
    if (response.type === "blanks") {
      return question.blanks === undefined || response.answers.length === question.blanks.length;
    }
    if (response.type === "order") return isPermutationOf(response.items, question.items);
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
