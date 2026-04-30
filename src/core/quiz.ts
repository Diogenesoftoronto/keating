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

export interface Quiz {
  topic: string;
  slug: string;
  generatedAt: string;
  questions: QuizQuestion[];
  answerKey: Map<string, string>;
  totalPoints: number;
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

// ─── Question Generation ──────────────────────────────────────────────────

function makeRecallQ(topic: TopicDefinition, _prng: Prng, idx: number): QuizQuestion {
  return {
    id: `${topic.slug}-r${idx}`,
    type: "short_answer",
    level: "recall",
    question: `Define "${topic.title}" in your own words.`,
    correctAnswer: topic.summary,
    explanation: `The core definition: ${topic.summary}`,
    rubric: `0-1pt: vague. 2pts: captures essence. 3pts: precise, mentions nuance.`,
  };
}

function makeComprehensionQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
  const hooks = topic.intuition;
  const hook = hooks[prng.int(0, hooks.length - 1)] ?? "the concept";
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
  const exs = topic.examples;
  const ex = exs[prng.int(0, exs.length - 1)] ?? `an example involving ${topic.title}`;
  return {
    id: `${topic.slug}-a${idx}`,
    type: "short_answer",
    level: "application",
    question: `Work through this example: ${ex}. Show your reasoning step-by-step.`,
    correctAnswer: `Follow the mechanics demonstrated in ${topic.title}.`,
    explanation: `Application grounds abstract knowledge: ${ex}`,
    rubric: `2pts: attempts solution. 3pts: correct mechanics. 4pts: correct + clear reasoning.`,
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
      `This is a correct statement about ${topic.title}.`,
      `Another correct property of ${topic.title}.`,
      `A third correct property of ${topic.title}.`,
    ],
    correctAnswer: `${m}`,
    explanation: `"${m}" is a known misconception. The other statements are generally true.`,
  };
}

function makeTransferQ(topic: TopicDefinition, prng: Prng, idx: number): QuizQuestion {
  const hooks = topic.interdisciplinaryHooks;
  const domain = hooks[prng.int(0, hooks.length - 1)] ?? "a new domain";
  return {
    id: `${topic.slug}-t${idx}`,
    type: "short_answer",
    level: "transfer",
    question: `How could ${topic.title} be applied or analogized in ${domain}? Construct an explicit bridge.`,
    correctAnswer: `A valid analogy that preserves structural relationships and acknowledges boundary conditions.`,
    explanation: `Transfer requires mapping invariants, not surface features, to ${domain}.`,
    rubric: `2pts: superficial analogy. 3pts: structural mapping. 4pts: mapping + awareness of limits.`,
  };
}

export function generateQuiz(topicName: string, seed = 42): Quiz {
  const topic = resolveTopic(topicName);
  const prng = new Prng(seed);
  const questions: QuizQuestion[] = [];

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

  const answerKey = new Map<string, string>();
  for (const q of questions) {
    answerKey.set(q.id, q.correctAnswer);
  }

  return {
    topic: topic.title,
    slug: topic.slug,
    generatedAt: new Date().toISOString(),
    questions,
    answerKey,
    totalPoints: questions.reduce((s, q) => s + (q.rubric ? 3 : 1), 0),
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
