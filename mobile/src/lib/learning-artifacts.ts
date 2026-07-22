import {
  DEFAULT_POLICY,
  buildConceptMap,
  buildLessonPlan,
  generateQuiz,
  lessonPlanToMarkdown,
  quizToMarkdown,
  resolveTopic,
} from "./keating-core";
import type { GeneratedArtifactKind } from "./types";

export interface GeneratedLearningArtifact {
  kind: GeneratedArtifactKind;
  topic: string;
  title: string;
  content: string;
}

export function generateLearningArtifact(
  topicName: string,
  kind: GeneratedArtifactKind,
  seed = 42,
): GeneratedLearningArtifact {
  const topic = resolveTopic(topicName.trim());

  if (kind === "study-plan") {
    return {
      kind,
      topic: topic.title,
      title: `Study plan: ${topic.title}`,
      content: lessonPlanToMarkdown(buildLessonPlan(topic.title, DEFAULT_POLICY)),
    };
  }

  if (kind === "concept-map") {
    return {
      kind,
      topic: topic.title,
      title: `Concept map: ${topic.title}`,
      content: `# Concept Map: ${topic.title}\n\n\`\`\`mermaid\n${buildConceptMap(topic.title)}\n\`\`\`\n`,
    };
  }

  const quiz = generateQuiz(topic.title, seed);
  const answerLines = quiz.questions.flatMap((question) => [
    `## ${question.id}`,
    `||${question.correctAnswer} ${question.explanation}||`,
    "",
  ]);
  return {
    kind,
    topic: topic.title,
    title: `Practice quiz: ${topic.title}`,
    content: `${quizToMarkdown(quiz)}\n# Check your answers\n\nTry every question before revealing these.\n\n${answerLines.join("\n").trim()}\n`,
  };
}
