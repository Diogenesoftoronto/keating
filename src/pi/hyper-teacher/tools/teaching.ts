import { relative } from "node:path";
import {
  animateTopicArtifact,
  mapTopicArtifact,
  planTopicArtifact,
  verifyTopicArtifact
} from "../../../core/project.js";
import { generateQuiz, quizToMarkdown, quizAnswerKeyToMarkdown, type Quiz } from "../../../core/quiz.js";
import { learnerStatePath } from "../../../core/paths.js";
import { loadLearnerState, recordQuizResult, saveLearnerState } from "../../../core/learner-state.js";
import { renderQuizCard, AnswerFormComponent, type AnswerFormQuestion } from "../tui-components.js";
import { keatingToolMaker, artifactPreviewRenderer, getCwd, pendingQuizResults } from "./shared.js";

async function persistQuizResult(topicSlug: string, correct: number, total: number): Promise<void> {
  if (total <= 0) return;
  const statePath = learnerStatePath(getCwd());
  const state = await loadLearnerState(statePath);
  recordQuizResult(state, topicSlug, correct, total);
  await saveLearnerState(statePath, state);
}

export const teachingTools = [
  keatingToolMaker(
    "plan",
    "plan",
    "Generate a structured lesson plan for a topic, adapted to the current teaching policy. Use before teaching any topic to structure your approach.",
    { topic: { type: "string", description: "The topic to generate a lesson plan for" } },
    async (params) => {
      const topic = (params.topic as string) || "";
      if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
      const artifact = await planTopicArtifact(getCwd(), topic);
      return {
        content: [{ type: "text", text: `[artifact://plan]\nWrote ${relative(getCwd(), artifact.planPath)}` }],
        details: artifact
      };
    },
    { result: artifactPreviewRenderer("Lesson Plan", "planPath") }
  ),
  keatingToolMaker(
    "map",
    "map",
    "Generate a Mermaid concept map for a topic. Use to visualize knowledge structure before or during teaching.",
    { topic: { type: "string", description: "The topic to generate a concept map for" } },
    async (params) => {
      const topic = (params.topic as string) || "";
      if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
      const artifact = await mapTopicArtifact(getCwd(), topic);
      const outputs = [relative(getCwd(), artifact.mmdPath)];
      return {
        content: [{ type: "text", text: `[artifact://map]\nGenerated ${outputs.join(" and ")}` }],
        details: artifact
      };
    },
    { result: artifactPreviewRenderer("Concept Map", "mmdPath") }
  ),
  keatingToolMaker(
    "animate",
    "animate",
    "Generate an animation storyboard for a topic. Use to create visual teaching materials.",
    { topic: { type: "string", description: "The topic to generate an animation storyboard for" } },
    async (params) => {
      const topic = (params.topic as string) || "";
      if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
      const artifact = await animateTopicArtifact(getCwd(), topic);
      return {
        content: [{ type: "text", text: `[artifact://animation]\nGenerated storyboard and player` }],
        details: artifact
      };
    },
    { result: artifactPreviewRenderer("Animation Storyboard", "storyboardPath") }
  ),
  keatingToolMaker(
    "verify",
    "verify",
    "Generate a fact-checking checklist for a topic. Always use this BEFORE teaching to self-verify your knowledge.",
    { topic: { type: "string", description: "The topic to generate a verification checklist for" } },
    async (params) => {
      const topic = (params.topic as string) || "";
      if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
      const artifact = await verifyTopicArtifact(getCwd(), topic);
      return {
        content: [{ type: "text", text: `[artifact://verification]\n${artifact.alreadyVerified ? "Already verified" : "Generated checklist"}: ${relative(getCwd(), artifact.checklistPath)}` }],
        details: artifact
      };
    },
    { result: artifactPreviewRenderer("Verification Checklist", "checklistPath") }
  ),
  keatingToolMaker(
    "quiz",
    "quiz",
    "Generate retrieval practice questions for a topic. Creates recall, comprehension, application, and transfer questions with answer keys.",
    { topic: { type: "string", description: "The topic to generate quiz questions for" } },
    async (params, ctx) => {
      const topic = (params.topic as string) || "";
      if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
      const quiz = generateQuiz(topic);

      if (typeof ctx?.ui?.custom === "function" && ctx.hasUI) {
        const formQuestions: AnswerFormQuestion[] = quiz.questions.map((q) => ({
          id: q.id,
          prompt: q.question,
          kind: q.options && q.options.length > 0 ? "choice" : "text",
          choices: q.options,
        }));
        const rawAnswers: Record<string, string> = await ctx.ui.custom((_tui: any, theme: any, _keybindings: any, done: (result: Record<string, string>) => void) => {
          return new AnswerFormComponent(theme, formQuestions, done);
        });

        const objectiveResults: Record<string, boolean> = {};
        const openEndedIds: string[] = [];
        for (const q of quiz.questions) {
          const isObjective = q.type === "multiple_choice" || q.type === "true_false" || q.type === "fill_in";
          if (isObjective) {
            const expected = (quiz.answerKey.get(q.id) ?? "").trim().toLowerCase();
            const given = (rawAnswers[q.id] ?? "").trim().toLowerCase();
            objectiveResults[q.id] = given.length > 0 && given === expected;
          } else {
            openEndedIds.push(q.id);
          }
        }
        const correctCount = Object.values(objectiveResults).filter(Boolean).length;
        const objectiveTotal = Object.keys(objectiveResults).length;

        let text = `Objective score: ${correctCount}/${objectiveTotal}.`;
        let resultId: string | undefined;
        if (openEndedIds.length === 0) {
          await persistQuizResult(quiz.slug, correctCount, objectiveTotal);
        }
        if (openEndedIds.length > 0) {
          resultId = `quiz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          pendingQuizResults.set(resultId, { quiz, answers: rawAnswers, objectiveResults });
          const openEndedText = openEndedIds
            .map((id) => `- ${id}: learner answered "${rawAnswers[id] ?? ""}" (model answer: ${quiz.answerKey.get(id) ?? ""})`)
            .join("\n");
          text += ` Grade the open-ended answers below by calling grade_quiz with result_id "${resultId}" and, for each question_id, a verdict ("correct"|"incorrect"|"partial") plus an optional note:\n${openEndedText}`;
        }

        return {
          content: [{ type: "text", text }],
          details: { quiz, topic, answers: rawAnswers, objectiveResults, resultId }
        };
      }

      const md = quizToMarkdown(quiz);
      const answerKeyMd = quizAnswerKeyToMarkdown(quiz);
      const text = `${md}\n---\n${answerKeyMd}`;
      return {
        content: [{ type: "text", text }],
        details: { quiz, topic }
      };
    },
    {
      result: (result: any, _options: any, theme: any) => {
        const details = result?.details;
        if (!details?.quiz) return undefined;
        const answers = details.answers ? new Map<string, string>(Object.entries(details.answers)) : undefined;
        const objectiveResults = details.objectiveResults ? new Map<string, boolean>(Object.entries(details.objectiveResults)) : undefined;
        return renderQuizCard(theme, details.quiz as Quiz, { answers, objectiveResults });
      }
    }
  ),
  keatingToolMaker(
    "grade_quiz",
    "grade_quiz",
    "Grade the open-ended (short_answer/transfer) questions from a prior quiz tool call. Call after the quiz tool returns a result_id for open-ended grading.",
    {
      result_id: { type: "string", description: "The result_id returned by the quiz tool." },
      grades: {
        type: "array",
        description: "One entry per open-ended question: question_id, verdict ('correct'|'incorrect'|'partial'), and an optional short note.",
        items: {
          type: "object",
          properties: {
            question_id: { type: "string" },
            verdict: { type: "string", enum: ["correct", "incorrect", "partial"] },
            note: { type: "string" }
          },
          required: ["question_id", "verdict"]
        }
      }
    },
    async (params) => {
      const resultId = (params.result_id as string) || "";
      const pending = pendingQuizResults.get(resultId);
      if (!pending) return { content: [{ type: "text", text: `No pending quiz result found for result_id "${resultId}".` }] };

      const gradesInput = Array.isArray(params.grades) ? params.grades : [];
      const openEndedGrades: Record<string, { verdict: "correct" | "incorrect" | "partial"; note?: string }> = {};
      for (const g of gradesInput) {
        if (!g || typeof g !== "object") continue;
        const questionId = (g as Record<string, unknown>).question_id;
        const verdict = (g as Record<string, unknown>).verdict;
        if (typeof questionId !== "string" || (verdict !== "correct" && verdict !== "incorrect" && verdict !== "partial")) continue;
        const note = (g as Record<string, unknown>).note;
        openEndedGrades[questionId] = { verdict, note: typeof note === "string" ? note : undefined };
      }

      const objectiveCorrect = Object.values(pending.objectiveResults).filter(Boolean).length;
      const objectiveTotal = Object.keys(pending.objectiveResults).length;
      const openEndedCorrect = Object.values(openEndedGrades).filter((g) => g.verdict === "correct").length;
      const openEndedTotal = Object.keys(openEndedGrades).length;

      const openEndedPoints = Object.values(openEndedGrades).reduce(
        (sum, g) => sum + (g.verdict === "correct" ? 1 : g.verdict === "partial" ? 0.5 : 0),
        0
      );
      await persistQuizResult(pending.quiz.slug, objectiveCorrect + openEndedPoints, objectiveTotal + openEndedTotal);
      pendingQuizResults.delete(resultId);

      return {
        content: [{ type: "text", text: `Final quiz score: ${objectiveCorrect + openEndedCorrect}/${objectiveTotal + openEndedTotal}.` }],
        details: { quiz: pending.quiz, answers: pending.answers, objectiveResults: pending.objectiveResults, openEndedGrades }
      };
    },
    {
      result: (result: any, _options: any, theme: any) => {
        const details = result?.details;
        if (!details?.quiz) return undefined;
        const answers = details.answers ? new Map<string, string>(Object.entries(details.answers)) : undefined;
        const objectiveResults = details.objectiveResults ? new Map<string, boolean>(Object.entries(details.objectiveResults)) : undefined;
        const openEndedGrades = details.openEndedGrades
          ? new Map<string, { verdict: "correct" | "incorrect" | "partial"; note?: string }>(Object.entries(details.openEndedGrades))
          : undefined;
        return renderQuizCard(theme, details.quiz as Quiz, { answers, objectiveResults, openEndedGrades });
      }
    }
  ),
];
