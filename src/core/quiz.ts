/**
 * Quiz Engine — generates question sets, workbooks, and answer keys.
 */

import { TopicDefinition, resolveTopic } from "./topics.js";
import { Prng } from "./random.js";

export type QuestionType = "multiple_choice" | "short_answer" | "true_false" | "fill_in" | "transfer";

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  level: "recall" | "comprehension" | "application" | "analysis" | "transfer";
  question: string;
  options?: string[]; // For multiple_choice, true_false
  correctAnswer: string;
  explanation: string;
  rubric?: string; // For short_answer / transfer
}

export interface QuizReview {
  status: "passed" | "revised";
  issues: string[];
  duplicatesRemoved: number;
  maxQuestionChars: number;
  maxAnswerChars: number;
  maxExplanationChars: number;
  maxRubricChars: number;
  maxOptionChars: number;
  limits: QuizLimits;
}

export interface Quiz {
  topic: string;
  slug: string;
  generatedAt: string;
  questions: QuizQuestion[];
  answerKey: Map<string, string>;
  totalPoints: number;
  review: QuizReview;
}

export interface WorkbookSection {
  title: string;
  instructions: string;
  questions: QuizQuestion[];
}

export interface Workbook {
  topic: string;
  slug: string;
  sections: WorkbookSection[];
  generatedAt: string;
}

export interface QuizLimits {
  questionChars: number;
  answerChars: number;
  explanationChars: number;
  rubricChars: number;
  optionChars: number;
}

export type QuizLimitOverrides = Partial<QuizLimits>;

/**
 * A question crafted by the teaching agent, grounded in the actual material.
 * Only `question`, `correctAnswer`, and `explanation` are required; the rest is
 * inferred. When authored questions are supplied they replace the templated set.
 */
export interface AuthoredQuestion {
  type?: QuestionType;
  level?: QuizQuestion["level"];
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  rubric?: string;
}

export interface GenerateQuizOptions {
  limits?: QuizLimitOverrides;
  /** Agent-crafted questions grounded in real material. Used instead of templates when 2+ are valid. */
  authored?: AuthoredQuestion[];
}

const QUIZ_LEVELS: ReadonlySet<QuizQuestion["level"]> = new Set([
  "recall",
  "comprehension",
  "application",
  "analysis",
  "transfer",
]);

const QUIZ_LEVEL_CYCLE: QuizQuestion["level"][] = [
  "recall",
  "comprehension",
  "application",
  "analysis",
  "transfer",
];

/**
 * Convert agent-authored question specs into validated QuizQuestions. Drops
 * entries missing a question/answer/explanation, infers type and level, ensures
 * multiple-choice options contain the correct answer, and supplies a default
 * rubric for open-ended questions.
 */
export function buildAuthoredQuestions(topic: TopicDefinition, authored: AuthoredQuestion[]): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  authored.forEach((raw, i) => {
    const question = (raw.question ?? "").trim();
    const correctAnswer = (raw.correctAnswer ?? "").trim();
    const explanation = (raw.explanation ?? "").trim();
    if (!question || !correctAnswer || !explanation) return;

    let options = Array.isArray(raw.options)
      ? raw.options.map((o) => String(o).trim()).filter(Boolean)
      : undefined;

    const level: QuizQuestion["level"] = raw.level && QUIZ_LEVELS.has(raw.level)
      ? raw.level
      : QUIZ_LEVEL_CYCLE[i % QUIZ_LEVEL_CYCLE.length];

    let type: QuestionType = raw.type ?? (options && options.length >= 2 ? "multiple_choice" : "short_answer");

    if (type === "multiple_choice" && options) {
      if (!options.some((o) => o === correctAnswer)) options = [correctAnswer, ...options];
      if (options.length < 2) type = "short_answer";
    }
    if (type === "multiple_choice" && (!options || options.length < 2)) {
      type = "short_answer";
    }

    const isOpen = type === "short_answer" || type === "transfer" || type === "fill_in";
    const rubric = raw.rubric?.trim()
      ? raw.rubric.trim()
      : isOpen
        ? "1pt vague, 2pts captures the essence, 3pts precise with a concrete detail or limit."
        : undefined;

    out.push({
      id: `${topic.slug}-q${out.length + 1}`,
      type,
      level,
      question,
      options: options && options.length ? options : undefined,
      correctAnswer,
      explanation,
      rubric,
    });
  });
  return out;
}

// ─── Question Generation ──────────────────────────────────────────────────

const DEFAULT_QUIZ_LIMITS: QuizLimits = {
  questionChars: 180,
  answerChars: 220,
  explanationChars: 220,
  rubricChars: 120,
  optionChars: 140,
};

function clampLimit(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function resolveQuizLimits(overrides: QuizLimitOverrides = {}): QuizLimits {
  return {
    questionChars: clampLimit(overrides.questionChars, 80, 320, 180),
    answerChars: clampLimit(overrides.answerChars, 80, 500, 220),
    explanationChars: clampLimit(overrides.explanationChars, 80, 500, 220),
    rubricChars: clampLimit(overrides.rubricChars, 60, 220, 120),
    optionChars: clampLimit(overrides.optionChars, 40, 220, 140),
  };
}

function limitText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  const boundary = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","));
  const shortened = boundary >= maxChars * 0.6 ? clipped.slice(0, boundary) : clipped;
  return `${shortened.trimEnd()}…`;
}

function pickDistinct(items: string[], prng: Prng, idx: number, fallback: string): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) return fallback;
  const start = prng.int(0, clean.length - 1);
  return clean[(start + idx - 1) % clean.length] ?? fallback;
}

function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "your", "this", "that", "about"].includes(word))
    .join(" ");
}

function tokenSimilarity(a: string, b: string): number {
  const left = new Set(normalizeQuestion(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalizeQuestion(b).split(/\s+/).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  return intersection / (left.size + right.size - intersection);
}

function enforceQuestionLimits(q: QuizQuestion, limits: QuizLimits): QuizQuestion {
  return {
    ...q,
    question: limitText(q.question, limits.questionChars),
    correctAnswer: limitText(q.correctAnswer, limits.answerChars),
    explanation: limitText(q.explanation, limits.explanationChars),
    rubric: q.rubric ? limitText(q.rubric, limits.rubricChars) : undefined,
    options: q.options?.map((option) => limitText(option, limits.optionChars)),
  };
}

function reviewQuizQuestions(questions: QuizQuestion[], limits: QuizLimits): QuizReview {
  const issues: string[] = [];
  let duplicatesRemoved = 0;
  const seen: QuizQuestion[] = [];

  for (const q of questions) {
    if (q.question.length > limits.questionChars) issues.push(`${q.id}: question exceeded ${limits.questionChars} chars`);
    if (q.correctAnswer.length > limits.answerChars) issues.push(`${q.id}: answer exceeded ${limits.answerChars} chars`);
    if (q.explanation.length > limits.explanationChars) issues.push(`${q.id}: explanation exceeded ${limits.explanationChars} chars`);
    if (q.rubric && q.rubric.length > limits.rubricChars) issues.push(`${q.id}: rubric exceeded ${limits.rubricChars} chars`);
    for (const option of q.options ?? []) {
      if (option.length > limits.optionChars) issues.push(`${q.id}: option exceeded ${limits.optionChars} chars`);
    }
    if (seen.some((prior) => tokenSimilarity(prior.question, q.question) >= 0.82)) {
      duplicatesRemoved++;
      issues.push(`${q.id}: similar to an earlier question`);
    } else {
      seen.push(q);
    }
  }

  return {
    status: issues.length === 0 ? "passed" : "revised",
    issues,
    duplicatesRemoved,
    maxQuestionChars: limits.questionChars,
    maxAnswerChars: limits.answerChars,
    maxExplanationChars: limits.explanationChars,
    maxRubricChars: limits.rubricChars,
    maxOptionChars: limits.optionChars,
    limits,
  };
}

function refineQuizQuestions(questions: QuizQuestion[], limits: QuizLimits): { questions: QuizQuestion[]; review: QuizReview } {
  const refined = questions.map((question) => enforceQuestionLimits(question, limits));
  const review = reviewQuizQuestions(refined, limits);
  return { questions: refined, review };
}

function makeRecallQ(topic: TopicDefinition, _prng: Prng, idx: number): QuizQuestion {
  return {
    id: `${topic.slug}-r${idx}`,
    type: "short_answer",
    level: "recall",
    question: idx === 1
      ? `Define "${topic.title}" in your own words.`
      : `State the central idea of ${topic.title} without using the exact lesson wording.`,
    correctAnswer: topic.summary,
    explanation: `The core definition: ${topic.summary}`,
    rubric: `1pt vague, 2pts essence, 3pts precise with nuance.`,
  };
}

function makeComprehensionQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
  const hook = pickDistinct(topic.intuition, prng, idx, "the concept");
  return {
    id: `${topic.slug}-c${idx}`,
    type: "short_answer",
    level: "comprehension",
    question: `Explain the intuition: "${hook}". Why is this a helpful way to think about ${topic.title}?`,
    correctAnswer: `Because it maps ${topic.title} to something concrete before formal notation.`,
    explanation: `Intuition first, formalism second: ${hook}`,
    rubric: `2pts: explains the metaphor. 3pts: identifies when it breaks down.`,
  };
}

function makeApplicationQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
  const ex = pickDistinct(topic.examples, prng, idx, `an example involving ${topic.title}`);
  return {
    id: `${topic.slug}-a${idx}`,
    type: "short_answer",
    level: "application",
    question: idx === 1
      ? `Work through this example: ${ex}. Show the key reasoning steps.`
      : `Use ${topic.title} to solve or analyze this case: ${ex}. Name the rule you used.`,
    correctAnswer: `Follow the mechanics demonstrated in ${topic.title}.`,
    explanation: `Application grounds abstract knowledge: ${ex}`,
    rubric: `2pts attempt, 3pts correct mechanics, 4pts clear reasoning.`,
  };
}

function makeMisconceptionQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
  const mis = topic.misconceptions;
  const m = mis[prng.int(0, mis.length - 1)] ?? "a common misconception";
  return {
    id: `${topic.slug}-m${idx}`,
    type: "multiple_choice",
    level: "comprehension",
    question: `Which of the following statements about ${topic.title} is FALSE?`,
    options: [
      `${m}`,
      `${topic.title} can be reasoned about using concrete examples.`,
      `A good answer should mention limits or boundary conditions.`,
      `The formal version should connect back to the intuition.`,
    ],
    correctAnswer: `${m}`,
    explanation: `"${m}" is a known misconception. The other statements are generally true.`,
  };
}

function makeTransferQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
  const domain = pickDistinct(topic.interdisciplinaryHooks, prng, idx, "a new domain");
  return {
    id: `${topic.slug}-t${idx}`,
    type: "short_answer",
    level: "transfer",
    question: idx === 1
      ? `Apply ${topic.title} to ${domain}. What structure carries over?`
      : `Where would an analogy between ${topic.title} and ${domain} break down?`,
    correctAnswer: `A valid analogy that preserves structural relationships and acknowledges boundary conditions.`,
    explanation: `Transfer requires mapping invariants, not surface features, to ${domain}.`,
    rubric: `2pts surface analogy, 3pts structure, 4pts limits included.`,
  };
}

export function generateQuiz(topicName: string, seed = 42, options: GenerateQuizOptions = {}): Quiz {
  const topic = resolveTopic(topicName);
  const prng = new Prng(seed);
  const limits = resolveQuizLimits(options.limits);
  const questions: QuizQuestion[] = [];

  // Preferred path: the teaching agent crafted questions grounded in the real
  // material. Use them instead of the generic templates (which produce vacuous
  // "Define X in your own words" questions for any topic not hardcoded).
  const authored = options.authored ? buildAuthoredQuestions(topic, options.authored) : [];
  if (authored.length >= 2) {
    const refinedAuthored = refineQuizQuestions(authored, limits);
    const authoredKey = new Map<string, string>();
    for (const q of refinedAuthored.questions) authoredKey.set(q.id, q.correctAnswer);
    return {
      topic: topic.title,
      slug: topic.slug,
      generatedAt: new Date().toISOString(),
      questions: refinedAuthored.questions,
      answerKey: authoredKey,
      totalPoints: refinedAuthored.questions.reduce((s, q) => s + (q.rubric ? 3 : 1), 0),
      review: refinedAuthored.review,
    };
  }

  // 2 recall
  questions.push(makeRecallQ(topic, prng, 1));
  questions.push(makeRecallQ(topic, prng, 2));
  // 2 comprehension
  questions.push(makeComprehensionQ(topic, prng, 1));
  questions.push(makeMisconceptionQ(topic, prng, 1));
  // 2 application
  questions.push(makeApplicationQ(topic, prng, 1));
  questions.push(makeApplicationQ(topic, prng, 2));
  // 2 transfer
  questions.push(makeTransferQ(topic, prng, 1));
  questions.push(makeTransferQ(topic, prng, 2));

  const refined = refineQuizQuestions(questions, limits);
  const answerKey = new Map<string, string>();
  for (const q of refined.questions) {
    answerKey.set(q.id, q.correctAnswer);
  }

  return {
    topic: topic.title,
    slug: topic.slug,
    generatedAt: new Date().toISOString(),
    questions: refined.questions,
    answerKey,
    totalPoints: refined.questions.reduce((s, q) => s + (q.rubric ? 3 : 1), 0),
    review: refined.review,
  };
}

// ─── Workbook ─────────────────────────────────────────────────────────────

export function generateWorkbook(topicName: string, seed = 42): Workbook {
  const topic = resolveTopic(topicName);
  const prng = new Prng(seed);
  const quiz = generateQuiz(topicName, seed);

  const sections: WorkbookSection[] = [
    {
      title: "Part A: Foundation",
      instructions: "Answer every question without looking at notes. Retrieval practice beats re-reading.",
      questions: quiz.questions.filter(q => q.level === "recall" || q.level === "comprehension"),
    },
    {
      title: "Part B: Application",
      instructions: "Work each example out on paper or in a text editor. Show all steps.",
      questions: quiz.questions.filter(q => q.level === "application"),
    },
    {
      title: "Part C: Transfer",
      instructions: "Bridge this concept into unfamiliar territory. If your analogy feels too easy, it is probably too shallow.",
      questions: quiz.questions.filter(q => q.level === "transfer"),
    },
  ];

  return {
    topic: topic.title,
    slug: topic.slug,
    sections,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Markdown output ──────────────────────────────────────────────────────

export function quizToMarkdown(quiz: Quiz): string {
  const lines = [
    `# Quiz: ${quiz.topic}`,
    `> Generated: ${quiz.generatedAt}`,
    `> Reviewed: ${quiz.review.status}; limits q/a/expl/rubric/option ${quiz.review.maxQuestionChars}/${quiz.review.maxAnswerChars}/${quiz.review.maxExplanationChars}/${quiz.review.maxRubricChars}/${quiz.review.maxOptionChars} chars`,
    ``,
  ];
  for (const q of quiz.questions) {
    lines.push(`## ${q.id} — ${q.level} (${q.type})`);
    lines.push(q.question);
    if (q.options) {
      lines.push("");
      for (let i = 0; i < q.options.length; i++) {
        lines.push(`${String.fromCharCode(65 + i)}. ${q.options[i]}`);
      }
    }
    lines.push("");
    if (q.rubric) lines.push(`*Rubric:* ${q.rubric}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

export function quizAnswerKeyToMarkdown(quiz: Quiz): string {
  const lines = [
    `# Answer Key: ${quiz.topic}`,
    "",
  ];
  for (const q of quiz.questions) {
    lines.push(`## ${q.id}`);
    lines.push(`**Answer:** ${q.correctAnswer}`);
    lines.push(`**Explanation:** ${q.explanation}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

export function workbookToMarkdown(wb: Workbook): string {
  const lines = [
    `# Workbook: ${wb.topic}`,
    `> Self-paced. Do Part A in one sitting, Part B after a break, Part C tomorrow.`,
    "",
  ];
  for (const section of wb.sections) {
    lines.push(`---`);
    lines.push(`# ${section.title}`);
    lines.push(section.instructions);
    lines.push("");
    for (const q of section.questions) {
      lines.push(`### ${q.id} — ${q.level}`);
      lines.push(q.question);
      if (q.options) {
        for (let i = 0; i < q.options.length; i++) {
          lines.push(`${String.fromCharCode(65 + i)}. ${q.options[i]}`);
        }
      }
      lines.push("");
      lines.push(`*Space for answer:*`);
      lines.push("\n\n\n\n"); // Blank space
    }
  }
  return lines.join("\n") + "\n";
}
