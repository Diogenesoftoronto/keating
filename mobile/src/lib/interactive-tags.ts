/**
 * Parsing for the `<keating-… />` interactive tags the teacher emits inline.
 *
 * The web app produces these tags from browser tools; the mobile app has no
 * tool loop, so the teaching protocol asks the model to emit them directly in
 * its reply. Either way the wire format is identical: an attribute holding a
 * double-stringified JSON payload.
 *
 * This module is deliberately free of React Native imports so the parsing and
 * normalization can be exercised under plain `bun test`.
 */

/** A quiz question as authored by the teacher. */
export interface QuizQuestion {
  id: string;
  type: "multiple_choice" | "short_answer" | "true_false" | "fill_in" | "transfer";
  level: "recall" | "comprehension" | "application" | "analysis" | "transfer";
  question: string;
  options?: string[];
  blanks?: { placeholder?: string; hint?: string }[];
  correctAnswer: string;
  correctAnswers?: string[];
  explanation: string;
  rubric?: string;
}

export interface Quiz {
  topic: string;
  slug: string;
  questions: QuizQuestion[];
}

/** One field of an ask-the-learner form. */
export interface QuestionField {
  header?: string;
  question: string;
  type?: "choice" | "text" | "blanks";
  choices?: string[];
  blanks?: { placeholder?: string; hint?: string }[];
  multiSelect: boolean;
  allowText: boolean;
  hint?: string;
}

export interface QuestionForm {
  intro?: string;
  topic?: string;
  questions: QuestionField[];
}

export type GoalStepStatus = "not_started" | "in_progress" | "done";
export type GoalStepKind = "concept" | "practice" | "project" | "milestone" | "reflection";

export interface GoalStep {
  id: string;
  order: number;
  title: string;
  description: string;
  kind: GoalStepKind;
  successCriteria: string[];
  status: GoalStepStatus;
}

export interface LearnerGoal {
  id: string;
  title: string;
  description: string;
  steps: GoalStep[];
}

export type InteractiveSegment =
  | { type: "text"; content: string }
  | { type: "quiz"; quiz: Quiz }
  | { type: "question"; form: QuestionForm }
  | { type: "goal"; goal: LearnerGoal };

// Payloads are JSON string literals and may contain literal ">" characters, so
// match a complete quoted string first and only fall back to the legacy
// "anything up to >" form for older unquoted payloads.
const TAG_PAYLOAD = String.raw`("(?:[^"\\]|\\.)*"|[^>]+)`;
const TAG_PATTERN = new RegExp(String.raw`<keating-(quiz|question|goal)\s+json=${TAG_PAYLOAD}\s*\/>`, "g");

/**
 * Decodes a tag attribute. Tools double-stringify the payload; hand-written
 * tags from a model sometimes only stringify it once, so unwrap until an
 * object falls out.
 */
export function decodeTagPayload(raw: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  for (let depth = 0; typeof value === "string" && depth < 3; depth += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

function asBlanks(value: unknown): { placeholder?: string; hint?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blanks = value
    .filter((blank): blank is Record<string, unknown> => !!blank && typeof blank === "object")
    .map((blank) => ({
      placeholder: typeof blank.placeholder === "string" ? blank.placeholder : undefined,
      hint: typeof blank.hint === "string" ? blank.hint : undefined,
    }));
  return blanks.length > 0 ? blanks : undefined;
}

const QUESTION_TYPES = ["multiple_choice", "short_answer", "true_false", "fill_in", "transfer"] as const;
const BLOOM_LEVELS = ["recall", "comprehension", "application", "analysis", "transfer"] as const;

function normalizeQuizQuestion(raw: unknown, index: number): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const question = asString(q.question).trim();
  const correctAnswer = asString(q.correctAnswer ?? q.correct_answer).trim();
  if (!question || !correctAnswer) return null;

  const options = asStringArray(q.options);
  const blanks = asBlanks(q.blanks);
  const declared = asString(q.type);
  const type = (QUESTION_TYPES as readonly string[]).includes(declared)
    ? (declared as QuizQuestion["type"])
    : options
      ? "multiple_choice"
      : "short_answer";
  const level = (BLOOM_LEVELS as readonly string[]).includes(asString(q.level))
    ? (asString(q.level) as QuizQuestion["level"])
    : "recall";

  // A multiple-choice question whose key is missing from the options would be
  // unanswerable, so fold it back in.
  const withAnswer = options && !options.some((option) => option.trim().toLowerCase() === correctAnswer.toLowerCase())
    ? [...options, correctAnswer]
    : options;

  return {
    id: asString(q.id) || `q${index + 1}`,
    type,
    level,
    question,
    options: type === "multiple_choice" ? withAnswer : undefined,
    blanks,
    correctAnswer,
    correctAnswers: asStringArray(q.correctAnswers ?? q.correct_answers),
    explanation: asString(q.explanation),
    rubric: asString(q.rubric) || undefined,
  };
}

/** Returns a renderable quiz, or null when the payload has no usable questions. */
export function normalizeQuiz(raw: unknown): Quiz | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const source = Array.isArray(obj.questions) ? obj.questions : [];
  const questions = source
    .map((entry, index) => normalizeQuizQuestion(entry, index))
    .filter((entry): entry is QuizQuestion => entry !== null);
  if (questions.length === 0) return null;
  const topic = asString(obj.topic) || asString(obj.title) || "this lesson";
  return { topic, slug: asString(obj.slug) || topic.toLowerCase().replace(/\s+/g, "-"), questions };
}

function normalizeQuestionField(raw: unknown): QuestionField | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const question = asString(q.question).trim();
  if (!question) return null;

  const choices = asStringArray(q.choices);
  const blanks = asBlanks(q.blanks);
  const multiSelect = q.multiSelect === true || q.multi_select === true;
  const allowText = typeof q.allowText === "boolean"
    ? q.allowText
    : typeof q.allow_text === "boolean"
      ? q.allow_text
      : !choices;
  const declared = asString(q.type);
  const type: QuestionField["type"] = blanks
    ? "blanks"
    : declared === "choice" || declared === "text" || declared === "blanks"
      ? declared
      : choices
        ? "choice"
        : "text";

  return {
    header: asString(q.header) || undefined,
    question,
    type,
    choices,
    blanks,
    multiSelect,
    allowText,
    hint: asString(q.hint) || undefined,
  };
}

/**
 * Accepts the multi-field shape `{ questions: [...] }` or a single question
 * object, and returns a normalized form. Null when nothing is renderable.
 */
export function normalizeQuestionForm(raw: unknown): QuestionForm | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const intro = asString(obj.intro) || undefined;
  const topic = asString(obj.topic) || undefined;

  if (Array.isArray(obj.questions)) {
    const questions = obj.questions
      .map(normalizeQuestionField)
      .filter((field): field is QuestionField => field !== null);
    if (questions.length === 0) return null;
    return { intro, topic, questions };
  }

  const single = normalizeQuestionField(obj);
  return single ? { intro, topic, questions: [single] } : null;
}

const STEP_KINDS = ["concept", "practice", "project", "milestone", "reflection"] as const;
const STEP_STATUSES = ["not_started", "in_progress", "done"] as const;

/** Returns a renderable goal, or null when the payload has no usable steps. */
export function normalizeGoal(raw: unknown): LearnerGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = asString(obj.title).trim();
  if (!title) return null;
  const source = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = source
    .filter((step): step is Record<string, unknown> => !!step && typeof step === "object")
    .map((step, index) => {
      const stepTitle = asString(step.title).trim();
      if (!stepTitle) return null;
      const kind = asString(step.kind);
      const status = asString(step.status);
      return {
        id: asString(step.id) || `step-${index + 1}`,
        order: typeof step.order === "number" ? step.order : index,
        title: stepTitle,
        description: asString(step.description),
        kind: (STEP_KINDS as readonly string[]).includes(kind) ? (kind as GoalStepKind) : "concept",
        successCriteria: asStringArray(step.successCriteria ?? step.success_criteria) ?? [],
        status: (STEP_STATUSES as readonly string[]).includes(status) ? (status as GoalStepStatus) : "not_started",
      } satisfies GoalStep;
    })
    .filter((step): step is GoalStep => step !== null);
  if (steps.length === 0) return null;
  return { id: asString(obj.id) || `goal-${title.toLowerCase().replace(/\s+/g, "-")}`, title, description: asString(obj.description), steps };
}

/**
 * Splits assistant text into plain-text runs and the interactive cards embedded
 * in it. Malformed tags are dropped rather than shown as raw markup.
 */
export function parseInteractiveSegments(text: string): InteractiveSegment[] {
  const segments: InteractiveSegment[] = [];
  let lastIndex = 0;

  const pushText = (content: string) => {
    if (content.trim().length > 0) segments.push({ type: "text", content });
  };

  for (const match of text.matchAll(TAG_PATTERN)) {
    const index = match.index ?? 0;
    pushText(text.slice(lastIndex, index));
    lastIndex = index + match[0].length;

    const payload = decodeTagPayload(match[2]);
    if (payload === null) continue;
    if (match[1] === "quiz") {
      const quiz = normalizeQuiz(payload);
      if (quiz) segments.push({ type: "quiz", quiz });
    } else if (match[1] === "question") {
      const form = normalizeQuestionForm(payload);
      if (form) segments.push({ type: "question", form });
    } else {
      const goal = normalizeGoal(payload);
      if (goal) segments.push({ type: "goal", goal });
    }
  }

  pushText(text.slice(lastIndex));
  if (segments.length === 0) segments.push({ type: "text", content: text });
  return segments;
}

/** True when the text carries at least one well-formed interactive card. */
export function hasInteractiveCard(text: string): boolean {
  return parseInteractiveSegments(text).some((segment) => segment.type !== "text");
}

/** Strips every interactive tag, leaving the prose the model wrote around it. */
export function stripInteractiveTags(text: string): string {
  return text.replace(TAG_PATTERN, "").trim();
}
