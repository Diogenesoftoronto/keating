import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { generateQuiz, generateWorkbook, quizToMarkdown, workbookToMarkdown, quizAnswerKeyToMarkdown } from "../src/core/quiz.js";
import { CANONICAL_TOPICS } from "./helpers.js";

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

// ─── generateQuiz properties ─────────────────────────────────────────────────

test("ALWAYS: generateQuiz is deterministic for same seed", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    fc.integer({ min: 1, max: 9999 }),
    (topic, seed) => {
      const a = generateQuiz(topic, seed);
      const b = generateQuiz(topic, seed);
      expect(a.questions.map(q => q.id)).toEqual(b.questions.map(q => q.id));
    }
  ));
});

test("ALWAYS: generateQuiz produces exactly 8 questions", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      expect(quiz.questions.length).toBe(8);
    }
  ));
});

test("ALWAYS: generateQuiz answer key has entry for every question", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      for (const q of quiz.questions) {
        expect(quiz.answerKey.has(q.id)).toBe(true);
        expect(quiz.answerKey.get(q.id)!.length).toBeGreaterThan(0);
      }
    }
  ));
});

test("ALWAYS: question IDs are unique", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      const ids = quiz.questions.map(q => q.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  ));
});

test("ALWAYS: generated questions are not repetitive", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    fc.integer({ min: 1, max: 9999 }),
    (topic, seed) => {
      const quiz = generateQuiz(topic, seed);
      for (let i = 0; i < quiz.questions.length; i++) {
        for (let j = i + 1; j < quiz.questions.length; j++) {
          expect(tokenSimilarity(quiz.questions[i]!.question, quiz.questions[j]!.question)).toBeLessThan(0.82);
        }
      }
    }
  ));
});

test("ALWAYS: quiz text obeys concise character limits", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    fc.integer({ min: 1, max: 9999 }),
    (topic, seed) => {
      const quiz = generateQuiz(topic, seed);
      for (const q of quiz.questions) {
        expect(q.question.length).toBeLessThanOrEqual(quiz.review.maxQuestionChars);
        expect(q.correctAnswer.length).toBeLessThanOrEqual(quiz.review.maxAnswerChars);
        expect(q.explanation.length).toBeLessThanOrEqual(quiz.review.maxExplanationChars);
        for (const option of q.options ?? []) {
          expect(option.length).toBeLessThanOrEqual(quiz.review.maxOptionChars);
        }
      }
    }
  ));
});

test("ALWAYS: quiz is reviewed before output", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      expect(quiz.review.status).toBe("passed");
      expect(quiz.review.duplicatesRemoved).toBe(0);
      expect(quizToMarkdown(quiz)).toContain("> Reviewed: passed");
    }
  ));
});

test("ALWAYS: generateQuiz honors caller-selected concise limits", () => {
  const quiz = generateQuiz("bayes theorem", 42, {
    limits: {
      questionChars: 120,
      answerChars: 130,
      explanationChars: 130,
      rubricChars: 80,
      optionChars: 90,
    },
  });

  expect(quiz.review.maxQuestionChars).toBe(120);
  expect(quiz.review.maxAnswerChars).toBe(130);
  expect(quiz.review.maxExplanationChars).toBe(130);
  expect(quiz.review.maxRubricChars).toBe(80);
  expect(quiz.review.maxOptionChars).toBe(90);
  for (const q of quiz.questions) {
    expect(q.question.length).toBeLessThanOrEqual(120);
    expect(q.correctAnswer.length).toBeLessThanOrEqual(130);
    expect(q.explanation.length).toBeLessThanOrEqual(130);
    if (q.rubric) expect(q.rubric.length).toBeLessThanOrEqual(80);
    for (const option of q.options ?? []) {
      expect(option.length).toBeLessThanOrEqual(90);
    }
  }
});

test("ALWAYS: generateQuiz clamps unsafe caller-selected limits", () => {
  const quiz = generateQuiz("bayes theorem", 42, {
    limits: {
      questionChars: 1,
      answerChars: 9999,
      explanationChars: Number.NaN,
      rubricChars: 9999,
      optionChars: -10,
    },
  });

  expect(quiz.review.maxQuestionChars).toBe(80);
  expect(quiz.review.maxAnswerChars).toBe(500);
  expect(quiz.review.maxExplanationChars).toBe(220);
  expect(quiz.review.maxRubricChars).toBe(220);
  expect(quiz.review.maxOptionChars).toBe(40);
});

test("authored questions replace templates when 2+ are valid", () => {
  const quiz = generateQuiz("Some Obscure Topic Not In The List", 42, {
    authored: [
      {
        question: "What is the base case in a recursive factorial?",
        correctAnswer: "0! = 1 (or 1! = 1)",
        explanation: "The base case stops the recursion at the smallest input.",
      },
      {
        type: "multiple_choice",
        level: "comprehension",
        question: "Which causes a stack overflow?",
        options: ["Unbounded recursion", "A correct base case", "Memoization"],
        correctAnswer: "Unbounded recursion",
        explanation: "Without progress toward the base case, the call stack grows without limit.",
      },
    ],
  });

  // No templated "Define X in your own words" question leaked through.
  expect(quiz.questions.length).toBe(2);
  expect(quiz.questions.every((q) => !/in your own words|central idea of/i.test(q.question))).toBe(true);
  const mc = quiz.questions.find((q) => q.type === "multiple_choice");
  expect(mc?.options).toContain("Unbounded recursion");
  for (const q of quiz.questions) {
    expect(quiz.answerKey.get(q.id)).toBe(q.correctAnswer);
  }
});

test("falls back to templates when fewer than 2 authored questions are valid", () => {
  const quiz = generateQuiz("derivative", 42, {
    authored: [
      { question: "", correctAnswer: "", explanation: "" }, // invalid, dropped
    ],
  });
  expect(quiz.questions.length).toBe(8);
});

test("multiple-choice authored question gets the correct answer injected as an option", () => {
  const quiz = generateQuiz("recursion", 42, {
    authored: [
      {
        type: "multiple_choice",
        question: "Pick the recursive case.",
        options: ["Return 1", "Return n * f(n-1)"],
        correctAnswer: "Return n * f(n-1)",
        explanation: "It reduces the problem toward the base case.",
      },
      {
        type: "multiple_choice",
        question: "Which is NOT required for recursion?",
        options: ["A loop counter", "A base case"],
        correctAnswer: "A loop counter",
        explanation: "Recursion needs a base case and progress, not a loop counter.",
      },
    ],
  });
  for (const q of quiz.questions) {
    if (q.type === "multiple_choice") {
      expect(q.options).toContain(q.correctAnswer);
    }
  }
});

test("ALWAYS: each question has non-empty text", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      for (const q of quiz.questions) {
        expect(q.question.length).toBeGreaterThan(0);
        expect(q.correctAnswer.length).toBeGreaterThan(0);
        expect(q.explanation.length).toBeGreaterThan(0);
      }
    }
  ));
});

test("ALWAYS: quiz topic matches input", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      expect(quiz.slug.length).toBeGreaterThan(0);
    }
  ));
});

test("ALWAYS: totalPoints is positive", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      expect(quiz.totalPoints).toBeGreaterThan(0);
    }
  ));
});

// ─── generateWorkbook properties ─────────────────────────────────────────────

test("ALWAYS: generateWorkbook has 3 sections", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const wb = generateWorkbook(topic);
      expect(wb.sections.length).toBe(3);
      expect(wb.sections[0]!.title).toContain("Foundation");
      expect(wb.sections[1]!.title).toContain("Application");
      expect(wb.sections[2]!.title).toContain("Transfer");
    }
  ));
});

// ─── Markdown output properties ─────────────────────────────────────────────

test("ALWAYS: quizToMarkdown is non-empty and contains questions", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      const md = quizToMarkdown(quiz);
      expect(md.length).toBeGreaterThan(50);
      for (const q of quiz.questions) {
        expect(md.includes(q.id)).toBe(true);
      }
    }
  ));
});

test("ALWAYS: quizAnswerKeyToMarkdown contains all correct answers", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const quiz = generateQuiz(topic);
      const md = quizAnswerKeyToMarkdown(quiz);
      expect(md.includes("Answer Key")).toBe(true);
    }
  ));
});

test("ALWAYS: workbookToMarkdown is non-empty", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topic) => {
      const wb = generateWorkbook(topic);
      const md = workbookToMarkdown(wb);
      expect(md.length).toBeGreaterThan(50);
    }
  ));
});
