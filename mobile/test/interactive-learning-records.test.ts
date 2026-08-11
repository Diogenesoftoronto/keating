import { describe, expect, test } from "bun:test";
import {
  validateLearnerGoal,
  validateLearnerQuestionCheck,
  validateLearnerQuizResult,
} from "@keating/learner-contracts";
import type { LearnerGoal, QuestionForm, Quiz } from "../src/lib/interactive-tags";
import {
  interactiveRecordId,
  portableGoalFromInteractive,
  portableQuestionChecksFromInteractive,
  portableQuizResultFromInteractive,
} from "../src/lib/interactive-learning-records";

const NOW = "2026-08-10T15:30:00.000Z";
const SESSION = "session-mobile-42";

const goal: LearnerGoal = {
  id: "model goal with a secret",
  title: "Understand eigenvectors",
  description: "Connect the geometry to the algebra.",
  steps: [{
    id: "model step id",
    order: 7,
    title: "Draw the transformation",
    description: "This is display-only detail.",
    kind: "practice",
    successCriteria: ["Explain what remains on its own line."],
    status: "in_progress",
  }],
};

const quiz: Quiz = {
  topic: "Eigenvectors",
  slug: "eigenvectors",
  questions: [
    {
      id: "<untrusted-objective-id>", type: "multiple_choice", level: "recall",
      question: "Which vector is unchanged in direction?", options: ["Eigenvector", "Scalar"],
      correctAnswer: "Eigenvector", explanation: "It stays on its own span.",
    },
    {
      id: "model-open-id", type: "short_answer", level: "comprehension",
      question: "Why can an eigenvector scale?", correctAnswer: "The transformation maps it to a scalar multiple of itself.",
      explanation: "The direction is preserved.",
    },
  ],
};

describe("interactive learning record projections", () => {
  test("uses opaque bounded IDs that are deterministic across retry and isolated by card identity", () => {
    const maliciousSource = `assistant-message-<script>secret-token</script>-${"x".repeat(20_000)}`;
    const first = interactiveRecordId("quiz-question", maliciousSource, 2);
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    expect(first).not.toContain("secret-token");
    expect(first).not.toContain("script");
    expect(first).toBe(interactiveRecordId("quiz-question", maliciousSource, 2));
    expect(first).not.toBe(interactiveRecordId("quiz-question", `${maliciousSource}-other-card`, 2));
    expect(first).not.toBe(interactiveRecordId("quiz-question", maliciousSource, 3));
    expect(() => interactiveRecordId("quiz<script>", maliciousSource, 0)).toThrow("kind is invalid");
  });

  test("projects goals without mutating source and documents presentation-only omissions", () => {
    const before = structuredClone(goal);
    const portable = portableGoalFromInteractive(goal, "message-42-card-1", NOW);
    expect(validateLearnerGoal(portable)).toBe(true);
    expect(portable).toMatchObject({ title: goal.title, description: goal.description, updatedAt: NOW });
    expect(portable.steps[0]).toEqual({
      id: interactiveRecordId("goal-step", "message-42-card-1", 0),
      title: goal.steps[0].title,
      status: goal.steps[0].status,
      successCriteria: goal.steps[0].successCriteria,
    });
    expect(goal).toEqual(before);
  });

  test("keeps objective partial credit and leaves open-ended answers pending", () => {
    const answers = {
      "<untrusted-objective-id>": "Eigenvector",
      "model-open-id": "It becomes a scalar multiple of itself.",
    };
    const portable = portableQuizResultFromInteractive(quiz, answers, "message-42-card-2", NOW, SESSION);
    expect(validateLearnerQuizResult(portable)).toBe(true);
    expect(portable.sessionId).toBe(SESSION);
    expect(portable.score).toBeGreaterThan(1);
    expect(Object.values(portable.answers)).toEqual(Object.values(answers));
    expect(Object.keys(portable.answers)).toEqual([
      interactiveRecordId("quiz-question", "message-42-card-2", 0),
      interactiveRecordId("quiz-question", "message-42-card-2", 1),
    ]);
    expect(portable.partialCredits?.[interactiveRecordId("quiz-question", "message-42-card-2", 0)]).toBe(1);
    expect(portable.pendingGradeQuestionIds).toEqual([interactiveRecordId("quiz-question", "message-42-card-2", 1)]);
  });

  test("creates pending checks for answered fields, reports skipped fields, and preserves source data", () => {
    const form: QuestionForm = {
      topic: "Eigenvectors",
      questions: [
        { question: "What does Av = λv mean?", multiSelect: false, allowText: true },
        { question: "Which condition matters?", multiSelect: false, allowText: true },
        { question: "Give a geometric explanation.", multiSelect: false, allowText: true },
      ],
    };
    const answers = ["A preserves the vector's direction.", "   ", "It remains on its span."];
    const before = structuredClone({ form, answers });
    const result = portableQuestionChecksFromInteractive(form, answers, "message-42-card-3", NOW, SESSION);
    expect(result.skipped).toBe(1);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every(validateLearnerQuestionCheck)).toBe(true);
    expect(result.checks[0]).toMatchObject({
      id: interactiveRecordId("question-check", "message-42-card-3", 0),
      topic: form.topic,
      question: form.questions[0].question,
      answer: answers[0],
      grading: "pending",
      sessionId: SESSION,
    });
    expect(result.checks[1].id).toBe(interactiveRecordId("question-check", "message-42-card-3", 2));
    expect({ form, answers }).toEqual(before);
  });
});
