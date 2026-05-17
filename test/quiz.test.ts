import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { generateQuiz, generateWorkbook, quizToMarkdown, workbookToMarkdown, quizAnswerKeyToMarkdown } from "../src/core/quiz.js";
import { CANONICAL_TOPICS } from "./helpers.js";

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
