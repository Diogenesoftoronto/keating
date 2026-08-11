import { expect, test } from "bun:test";
import { interactiveCardFallback } from "../src/lib/interactive-card-fallback";
import { normalizeGoal, normalizeQuestionForm, normalizeQuiz } from "../src/lib/interactive-tags";

test("quiz fallback exposes every prompt and choice without leaking answers", () => {
  const quiz = normalizeQuiz({
    topic: "Closures",
    questions: [{
      question: "What does a closure retain?",
      options: ["Lexical bindings", "Only arguments"],
      correctAnswer: "Lexical bindings",
      explanation: "The function closes over its lexical environment.",
    }],
  })!;
  const markdown = interactiveCardFallback({ type: "quiz", quiz });
  expect(markdown).toContain("What does a closure retain?");
  expect(markdown).toContain("A. Lexical bindings");
  expect(markdown).toContain("Answer in the message box");
  expect(markdown).not.toContain("lexical environment");
});

test("question and goal fallbacks remain actionable through the composer", () => {
  const form = normalizeQuestionForm({
    topic: "Starting point",
    question: "What do you already know?",
    choices: ["A little", "A lot"],
  })!;
  const goal = normalizeGoal({
    title: "Read fluently",
    steps: [{ title: "Name notes", successCriteria: ["20 notes in a minute"] }],
  })!;
  expect(interactiveCardFallback({ type: "question", form })).toContain("Reply in the message box");
  expect(interactiveCardFallback({ type: "goal", goal })).toContain("20 notes in a minute");
});
