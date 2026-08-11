import type { Quiz, QuizQuestion } from "../keating/core";

export function parseCourseQuiz(content: string): Quiz | null {
  try {
    const value = JSON.parse(content) as Partial<Quiz>;
    if (
      !value ||
      typeof value.topic !== "string" ||
      typeof value.slug !== "string" ||
      !Array.isArray(value.questions)
    )
      return null;
    if (
      !value.questions.every(
        (question) =>
          question &&
          typeof question.id === "string" &&
          typeof question.question === "string" &&
          typeof question.correctAnswer === "string" &&
          typeof question.explanation === "string",
      )
    )
      return null;
    return value as Quiz;
  } catch {
    return null;
  }
}

export function newCourseQuizQuestion(index = 0): QuizQuestion {
  return {
    id: `question_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "short_answer",
    level: "application",
    question:
      index === 0
        ? "What should the learner be able to explain or do?"
        : "New question",
    correctAnswer: "Describe the expected answer.",
    explanation: "Explain why this answer matters.",
  };
}

export function createBlankCourseQuiz(title: string): Quiz {
  const question = newCourseQuizQuestion();
  return {
    topic: title.trim() || "Course quiz",
    slug: `course-quiz-${crypto.randomUUID()}`,
    generatedAt: new Date().toISOString(),
    questions: [question],
    totalPoints: 1,
    review: {
      status: "passed",
      issues: [],
      duplicatesRemoved: 0,
      maxQuestionChars: question.question.length,
      maxAnswerChars: question.correctAnswer.length,
      maxExplanationChars: question.explanation.length,
      maxRubricChars: 0,
      maxOptionChars: 0,
      limits: {
        questionChars: 320,
        answerChars: 500,
        explanationChars: 500,
        rubricChars: 220,
        optionChars: 220,
      },
    },
  };
}
