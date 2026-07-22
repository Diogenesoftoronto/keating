/**
 * Local grading for quiz cards, ported from the web renderer.
 *
 * Objective question types are graded exactly; open-ended ones only get a
 * partial-credit estimate here, because the authoritative judgment comes from
 * the teacher when the answers are reported back into the conversation.
 *
 * React Native imports stay out of this module so it can run under `bun test`.
 */
import type { QuestionField, QuizQuestion } from "./interactive-tags";

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
}

function ngrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return [];
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i += 1) grams.push(tokens.slice(i, i + n).join(" "));
  return grams;
}

// Fraction of the reference's n-grams that appear in the answer. Bigrams reward
// phrasing and word order, which single-token overlap misses.
function ngramRecall(answerTokens: string[], referenceTokens: string[], n: number): number {
  const reference = ngrams(referenceTokens, n);
  if (reference.length === 0) return 0;
  const answer = new Set(ngrams(answerTokens, n));
  return reference.filter((gram) => answer.has(gram)).length / reference.length;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    const ac = a[i - 1];
    for (let j = 1; j <= n; j += 1) {
      curr[j] = ac === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], curr[j - 1], prev[j]);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

/** Fraction of the point awarded for an answer, between 0 and 1. */
export function questionCredit(question: QuizQuestion, rawAnswer: string): number {
  if (!rawAnswer.trim()) return 0;

  if (question.type === "fill_in" && question.blanks && question.blanks.length > 0) {
    const given = rawAnswer.split("|").map((value) => value.trim());
    const expected = question.correctAnswers ?? [question.correctAnswer];
    let correct = 0;
    for (let i = 0; i < Math.min(given.length, expected.length); i += 1) {
      if (given[i].toLowerCase() === expected[i].trim().toLowerCase()) correct += 1;
    }
    return correct / expected.length;
  }

  if (question.type === "true_false" || question.type === "multiple_choice") {
    return rawAnswer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase() ? 1 : 0;
  }

  // Open-ended: there is no single correct string, so take the most generous of
  // several similarity signals and let the teacher give the real verdict.
  const answer = rawAnswer.trim().toLowerCase();
  const reference = question.correctAnswer.trim().toLowerCase();
  if (answer === reference) return 1;
  const distance = levenshtein(answer, reference);
  const editScore = Math.max(0, 1 - distance / (Math.max(answer.length, reference.length) || 1));
  const answerTokens = tokenize(answer);
  const referenceTokens = tokenize(reference);
  const answerSet = new Set(answerTokens);
  const overlap = referenceTokens.filter((token) => answerSet.has(token)).length;
  const keywordScore = referenceTokens.length ? overlap / referenceTokens.length : 0;
  return Math.max(editScore, keywordScore * 0.9, ngramRecall(answerTokens, referenceTokens, 2));
}

/** True when only the teacher can really judge the answer. */
export function isOpenEnded(question: QuizQuestion): boolean {
  if (question.type === "short_answer" || question.type === "transfer") return true;
  // Single-blank fill_in is free text; multi-blank fill_in is graded per blank.
  return question.type === "fill_in" && !(question.blanks && question.blanks.length > 0);
}

// Open-ended answers can't be graded by string equality, so accept anything
// close enough locally rather than showing a misleadingly strict score.
const OPEN_ENDED_CREDIT_THRESHOLD = 0.6;

export function isCorrect(question: QuizQuestion, rawAnswer: string): boolean {
  if (question.type === "fill_in" && question.blanks && question.blanks.length > 0) {
    const given = rawAnswer.split("|").map((value) => value.trim());
    const expected = question.correctAnswers ?? [question.correctAnswer];
    if (given.length !== expected.length) return false;
    return given.every((value, index) => value.toLowerCase() === expected[index].trim().toLowerCase());
  }
  if (isOpenEnded(question)) return questionCredit(question, rawAnswer) >= OPEN_ENDED_CREDIT_THRESHOLD;
  return rawAnswer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
}

export interface QuizScore {
  /** Questions marked correct outright. */
  correct: number;
  total: number;
  /** Sum of partial credit, so open-ended near-misses still count for something. */
  weighted: number;
  percent: number;
  hasOpenEnded: boolean;
}

export function scoreQuiz(questions: QuizQuestion[], answers: Record<string, string>): QuizScore {
  let correct = 0;
  let weighted = 0;
  for (const question of questions) {
    const answer = answers[question.id] ?? "";
    if (isCorrect(question, answer)) correct += 1;
    weighted += questionCredit(question, answer);
  }
  const total = questions.length;
  return {
    correct,
    total,
    weighted,
    percent: total === 0 ? 0 : Math.round((weighted / total) * 100),
    hasOpenEnded: questions.some(isOpenEnded),
  };
}

/**
 * Builds the user turn sent back to the teacher after a quiz. Open-ended items
 * are flagged explicitly so the teacher knows which answers still need a real
 * verdict.
 */
export function buildQuizReport(topic: string, questions: QuizQuestion[], answers: Record<string, string>): string {
  const score = scoreQuiz(questions, answers);
  const lines = [
    `I finished the ${topic} quiz: ${score.correct}/${score.total} correct (${score.percent}% with partial credit).`,
    "",
  ];
  for (const question of questions) {
    const answer = (answers[question.id] ?? "").trim() || "(blank)";
    if (isOpenEnded(question)) {
      lines.push(`- [open-ended] ${question.question} → my answer: "${answer}" (reference: "${question.correctAnswer}")`);
    } else {
      lines.push(`- ${question.question} → my answer: "${answer}" ${isCorrect(question, answers[question.id] ?? "") ? "✓" : "✗"}`);
    }
  }
  lines.push("");
  if (score.hasOpenEnded) {
    lines.push(
      "Grade the open-ended answers by meaning rather than exact wording — the reference is one acceptable answer, not the only one.",
    );
  }
  lines.push("Review what I missed and tell me what to work on next.");
  return lines.join("\n");
}

/** Builds the user turn sent back after an ask-the-learner form. */
export function buildQuestionReport(
  fields: QuestionField[],
  answers: string[],
  topic?: string,
): string {
  const lines = [topic ? `Here are my answers about ${topic}:` : "Here are my answers:", ""];
  fields.forEach((field, index) => {
    const answer = (answers[index] ?? "").trim() || "(skipped)";
    lines.push(`- ${field.header ? `${field.header}: ` : ""}${field.question} → ${answer}`);
  });
  lines.push("");
  lines.push("Use these to pitch the next step at the right level.");
  return lines.join("\n");
}
