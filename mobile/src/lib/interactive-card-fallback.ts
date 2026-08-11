import type { InteractiveSegment } from "./interactive-tags";

type CardSegment = Exclude<InteractiveSegment, { type: "text" }>;

/**
 * Converts an already-received card into a complete text interaction. This is
 * both a migration path for saved lessons and a recovery path when the learner
 * turns interactive controls off after a reply was generated.
 */
export function interactiveCardFallback(segment: CardSegment): string {
  if (segment.type === "quiz") {
    const questions = segment.quiz.questions.map((question, index) => {
      const choices = question.options?.map((option, optionIndex) =>
        `   ${String.fromCharCode(65 + optionIndex)}. ${option}`,
      ).join("\n");
      return `${index + 1}. ${question.question}${choices ? `\n${choices}` : ""}`;
    }).join("\n\n");
    return `### Quiz: ${segment.quiz.topic}\n\n${questions}\n\nAnswer in the message box. Keating will check your reasoning after you reply.`;
  }

  if (segment.type === "question") {
    const heading = segment.form.topic ? `### ${segment.form.topic}` : "### A question for you";
    const intro = segment.form.intro ? `\n\n${segment.form.intro}` : "";
    const questions = segment.form.questions.map((question, index) => {
      const label = question.header ? `**${question.header}**\n\n` : "";
      const choices = question.choices?.map((choice) => `- ${choice}`).join("\n");
      const hint = question.hint ? `\n\n_Hint: ${question.hint}_` : "";
      return `${index + 1}. ${label}${question.question}${choices ? `\n\n${choices}` : ""}${hint}`;
    }).join("\n\n");
    return `${heading}${intro}\n\n${questions}\n\nReply in the message box.`;
  }

  const description = segment.goal.description ? `\n\n${segment.goal.description}` : "";
  const steps = segment.goal.steps.map((step) => {
    const checked = step.status === "done" ? "x" : " ";
    const criteria = step.successCriteria.map((criterion) => `  - ${criterion}`).join("\n");
    return `- [${checked}] **${step.title}**${step.description ? `: ${step.description}` : ""}${criteria ? `\n${criteria}` : ""}`;
  }).join("\n");
  return `### Learning goal: ${segment.goal.title}${description}\n\n${steps}\n\nTell Keating which step you want to work on next.`;
}
