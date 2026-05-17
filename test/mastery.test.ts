import { test, expect } from "bun:test";
import * as fc from "fast-check";

import { generateDiagnosticQuestions, scoreAnswer, computeMasteryAssessment } from "../src/core/mastery.js";
import { arbTopicDefinition, CANONICAL_TOPICS } from "./helpers.js";
import { clamp } from "../src/core/util.js";

// ─── generateDiagnosticQuestions properties ─────────────────────────────────

test("ALWAYS: generateDiagnosticQuestions produces questions for any valid topic", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const questions = generateDiagnosticQuestions(topic);
    expect(questions.length).toBeGreaterThan(0);
  }));
});

test("ALWAYS: each question has non-empty text and id", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const questions = generateDiagnosticQuestions(topic);
    for (const q of questions) {
      expect(q.id.length).toBeGreaterThan(0);
      expect(q.question.length).toBeGreaterThan(0);
    }
  }));
});

test("ALWAYS: question IDs are unique within a topic", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const questions = generateDiagnosticQuestions(topic);
    const ids = questions.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  }));
});

test("ALWAYS: each question has a valid level", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const questions = generateDiagnosticQuestions(topic);
    const validLevels = ["recall", "comprehension", "application", "analysis", "transfer"];
    for (const q of questions) {
      expect(validLevels).toContain(q.level);
    }
  }));
});

test("ALWAYS: each question has maxPoints > 0", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const questions = generateDiagnosticQuestions(topic);
    for (const q of questions) {
      expect(q.maxPoints).toBeGreaterThan(0);
    }
  }));
});

// ─── scoreAnswer properties ────────────────────────────────────────────────

test("ALWAYS: empty answer scores 0", () => {
  fc.assert(fc.property(arbTopicDefinition, (topic) => {
    const questions = generateDiagnosticQuestions(topic);
    for (const q of questions) {
      expect(scoreAnswer(q, "")).toBe(0);
      expect(scoreAnswer(q, "   ")).toBe(0);
    }
  }));
});

test("ALWAYS: score is always in [0, maxPoints]", () => {
  fc.assert(fc.property(
    arbTopicDefinition,
    fc.string({ minLength: 1, maxLength: 500 }),
    (topic, answer) => {
      const questions = generateDiagnosticQuestions(topic);
      for (const q of questions) {
        const score = scoreAnswer(q, answer);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(q.maxPoints);
      }
    }
  ));
});

// ─── computeMasteryAssessment properties ─────────────────────────────────────

test("ALWAYS: computeMasteryAssessment returns valid level", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    fc.record({}),
    (topicName) => {
      const validLevels = ["novice", "beginner", "competent", "proficient", "expert"];
      const assessment = computeMasteryAssessment(topicName, {});
      expect(validLevels).toContain(assessment.level);
    }
  ));
});

test("ALWAYS: computeMasteryAssessment overallScore <= maxScore", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topicName) => {
      const assessment = computeMasteryAssessment(topicName, {});
      expect(assessment.overallScore).toBeLessThanOrEqual(assessment.maxScore);
      expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    }
  ));
});

test("ALWAYS: computeMasteryAssessment has at least one dimension", () => {
  fc.assert(fc.property(
    fc.constantFrom(...CANONICAL_TOPICS),
    (topicName) => {
      const assessment = computeMasteryAssessment(topicName, {});
      expect(assessment.dimensions.length).toBeGreaterThan(0);
    }
  ));
});
