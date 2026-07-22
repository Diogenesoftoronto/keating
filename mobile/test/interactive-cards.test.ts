import { describe, expect, it } from "bun:test";

import {
  decodeTagPayload,
  hasInteractiveCard,
  normalizeGoal,
  normalizeQuestionForm,
  normalizeQuiz,
  parseInteractiveSegments,
  stripInteractiveTags,
  type QuizQuestion,
} from "../src/lib/interactive-tags";
import {
  buildQuestionReport,
  buildQuizReport,
  isCorrect,
  isOpenEnded,
  questionCredit,
  scoreQuiz,
} from "../src/lib/quiz-grading";
import { INTERACTIVE_CARD_PROTOCOL, composeSystemPrompt } from "../src/lib/system-prompt";

/** Emit a tag exactly the way the teaching protocol asks for it. */
function emitTag(tag: string, payload: unknown): string {
  return `<keating-${tag} json=${JSON.stringify(JSON.stringify(payload))} />`;
}

const quizPayload = {
  topic: "Photosynthesis",
  questions: [
    {
      id: "q1",
      type: "multiple_choice",
      level: "recall",
      question: "Where do the light reactions occur?",
      options: ["Thylakoid membrane", "Stroma", "Cytosol"],
      correctAnswer: "Thylakoid membrane",
      explanation: "The membrane holds the photosystems.",
    },
    {
      id: "q2",
      type: "short_answer",
      level: "comprehension",
      question: "Why does the plant need the proton gradient?",
      correctAnswer: "It drives ATP synthase to make ATP",
      explanation: "Chemiosmosis converts the gradient into chemical energy.",
    },
  ],
};

describe("parseInteractiveSegments", () => {
  it("splits prose from a quiz card", () => {
    const segments = parseInteractiveSegments(`Quiz ready.\n\n${emitTag("quiz", quizPayload)}`);
    expect(segments.map((segment) => segment.type)).toEqual(["text", "quiz"]);
    const [text, quiz] = segments;
    if (text.type !== "text" || quiz.type !== "quiz") throw new Error("unreachable");
    expect(text.content.trim()).toBe("Quiz ready.");
    expect(quiz.quiz.topic).toBe("Photosynthesis");
    expect(quiz.quiz.questions).toHaveLength(2);
  });

  it("parses payloads containing '>' and escaped quotes", () => {
    const payload = {
      title: "Compare operators",
      steps: [{ title: 'Explain why "a > b" is not "a >= b"', kind: "concept" }],
    };
    const segments = parseInteractiveSegments(emitTag("goal", payload));
    const goal = segments.find((segment) => segment.type === "goal");
    if (goal?.type !== "goal") throw new Error("expected a goal segment");
    expect(goal.goal.steps[0].title).toBe('Explain why "a > b" is not "a >= b"');
  });

  it("drops malformed and unrenderable tags instead of showing markup", () => {
    const broken = '<keating-quiz json="{not json" />';
    const empty = emitTag("quiz", { topic: "Nothing", questions: [] });
    expect(hasInteractiveCard(broken)).toBe(false);
    expect(hasInteractiveCard(empty)).toBe(false);
    expect(parseInteractiveSegments(`Hi ${empty}`).map((segment) => segment.type)).toEqual(["text"]);
  });

  it("keeps prose on both sides of a card", () => {
    const text = `before\n${emitTag("question", { question: "What do you know?" })}\nafter`;
    expect(parseInteractiveSegments(text).map((segment) => segment.type)).toEqual(["text", "question", "text"]);
    expect(stripInteractiveTags(text)).toBe("before\n\nafter");
  });

  it("accepts a singly-stringified payload from a hand-written tag", () => {
    expect(decodeTagPayload(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
    expect(decodeTagPayload(JSON.stringify({ a: 1 }))).toEqual({ a: 1 });
    expect(decodeTagPayload("{oops")).toBeNull();
  });
});

describe("normalizeQuiz", () => {
  it("infers types, fills ids, and folds a missing key into the options", () => {
    const quiz = normalizeQuiz({
      topic: "Set theory",
      questions: [
        { question: "Pick the union", options: ["A ∩ B", "A ∪ B"], correctAnswer: "A ∪ B", explanation: "" },
        { question: "Name the empty set symbol", correctAnswer: "∅", explanation: "" },
        { question: "Which one?", options: ["a", "b"], correctAnswer: "c", explanation: "" },
      ],
    });
    if (!quiz) throw new Error("expected a quiz");
    expect(quiz.questions.map((question) => question.type)).toEqual([
      "multiple_choice",
      "short_answer",
      "multiple_choice",
    ]);
    expect(quiz.questions[0].id).toBe("q1");
    expect(quiz.questions[2].options).toEqual(["a", "b", "c"]);
  });

  it("rejects questions missing a prompt or an answer", () => {
    expect(normalizeQuiz({ questions: [{ question: "No answer", explanation: "" }] })).toBeNull();
  });
});

describe("normalizeQuestionForm and normalizeGoal", () => {
  it("accepts both the multi-field and single-question shapes", () => {
    const multi = normalizeQuestionForm({
      topic: "Recursion",
      questions: [{ question: "What is a base case?", choices: ["A guard", "A loop"], multi_select: true }],
    });
    expect(multi?.questions[0].multiSelect).toBe(true);
    expect(multi?.questions[0].type).toBe("choice");

    const single = normalizeQuestionForm({ question: "How confident are you?" });
    expect(single?.questions).toHaveLength(1);
    // Free text is the default when no choices are offered.
    expect(single?.questions[0].allowText).toBe(true);
    expect(normalizeQuestionForm({ intro: "hi" })).toBeNull();
  });

  it("defaults goal step kind, status, and order", () => {
    const goal = normalizeGoal({ title: "Learn Go", steps: [{ title: "Read the tour" }, { title: "Ship a CLI", kind: "project", status: "done" }] });
    if (!goal) throw new Error("expected a goal");
    expect(goal.steps[0]).toMatchObject({ id: "step-1", order: 0, kind: "concept", status: "not_started" });
    expect(goal.steps[1]).toMatchObject({ kind: "project", status: "done" });
    expect(normalizeGoal({ title: "No steps", steps: [] })).toBeNull();
  });
});

describe("quiz grading", () => {
  const mc: QuizQuestion = {
    id: "q1",
    type: "multiple_choice",
    level: "recall",
    question: "Pick one",
    options: ["a", "b"],
    correctAnswer: "a",
    explanation: "",
  };
  const open: QuizQuestion = {
    id: "q2",
    type: "short_answer",
    level: "comprehension",
    question: "Explain",
    correctAnswer: "the proton gradient drives ATP synthase",
    explanation: "",
  };
  const blanks: QuizQuestion = {
    id: "q3",
    type: "fill_in",
    level: "recall",
    question: "___ and ___",
    blanks: [{}, {}],
    correctAnswer: "salt|pepper",
    correctAnswers: ["salt", "pepper"],
    explanation: "",
  };

  it("grades objective questions exactly and case-insensitively", () => {
    expect(isCorrect(mc, "A")).toBe(true);
    expect(isCorrect(mc, "b")).toBe(false);
    expect(questionCredit(mc, "")).toBe(0);
  });

  it("gives partial credit per blank", () => {
    expect(questionCredit(blanks, "salt|pepper")).toBe(1);
    expect(questionCredit(blanks, "salt|sugar")).toBe(0.5);
    expect(isCorrect(blanks, "salt|sugar")).toBe(false);
  });

  it("accepts an open-ended answer that means the same thing", () => {
    expect(isOpenEnded(open)).toBe(true);
    expect(isCorrect(open, "the proton gradient drives ATP synthase")).toBe(true);
    expect(isCorrect(open, "ATP synthase is driven by the proton gradient")).toBe(true);
    expect(isCorrect(open, "photons hit chlorophyll")).toBe(false);
  });

  it("scores a whole quiz with partial credit", () => {
    const score = scoreQuiz([mc, open], { q1: "a", q2: "no idea" });
    expect(score).toMatchObject({ correct: 1, total: 2, hasOpenEnded: true });
    expect(score.percent).toBeGreaterThanOrEqual(50);
    expect(score.percent).toBeLessThan(100);
  });
});

describe("learner reports", () => {
  it("flags open-ended answers so the teacher grades them", () => {
    const quiz = normalizeQuiz(quizPayload);
    if (!quiz) throw new Error("expected a quiz");
    const report = buildQuizReport(quiz.topic, quiz.questions, { q1: "Stroma", q2: "it makes ATP" });
    // "Stroma" is wrong and the written answer is too thin to pass locally, so
    // nothing is marked correct — but the open-ended one still goes up for review.
    expect(report).toContain("0/2 correct");
    expect(report).toContain("[open-ended]");
    expect(report).toContain('my answer: "Stroma" ✗');
    expect(report).toContain("Grade the open-ended answers by meaning");
  });

  it("marks skipped form fields rather than dropping them", () => {
    const form = normalizeQuestionForm({
      topic: "Recursion",
      questions: [{ header: "Now", question: "What do you know?" }, { question: "What confuses you?" }],
    });
    if (!form) throw new Error("expected a form");
    const report = buildQuestionReport(form.questions, ["Base cases"], form.topic);
    expect(report).toContain("about Recursion");
    expect(report).toContain("- Now: What do you know? → Base cases");
    expect(report).toContain("→ (skipped)");
  });
});

describe("card protocol in the system prompt", () => {
  it("teaches a tag the parser can actually read back", () => {
    const match = INTERACTIVE_CARD_PROTOCOL.match(/<keating-quiz[\s\S]*?\/>/);
    if (!match) throw new Error("expected a quiz example in the protocol");
    const segments = parseInteractiveSegments(match[0]);
    const quiz = segments.find((segment) => segment.type === "quiz");
    if (quiz?.type !== "quiz") throw new Error("the documented example must parse");
    expect(quiz.quiz.questions[0].options).toContain("Thylakoid membrane");
  });

  it("ships the protocol with every composed prompt", () => {
    expect(composeSystemPrompt("Be terse.")).toContain("<keating-goal");
  });
});
