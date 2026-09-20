import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { mathQuestionCredit } from "../../../../packages/learner-contracts/src/index.js";
import {
  animateTopicArtifact,
  mapTopicArtifact,
  planTopicArtifact,
  verifyTopicArtifact
} from "../../../core/project.js";
import { cliGradingEnabled, reviewCliOpenResponses, type CliGradingReceipt } from "../../../judgement/cli-grading.js";
import { cliQuizRecordPath, saveCliQuizSubmission, saveCliQuizProposal, loadCliQuizRecord, finalizeCliQuizReview } from "../../../core/quiz-grading.js";
import { generateQuiz, quizToMarkdown, quizAnswerKeyToMarkdown, type Quiz, type AuthoredQuestion } from "../../../core/quiz.js";
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

function withGradingNotice(card: ReturnType<typeof renderQuizCard>, details: { grading?: CliGradingReceipt; review?: unknown; pendingIds?: readonly string[] }) {
  if (!details.grading) return card;
  const estimates = details.grading.proposals.flatMap(({ id, proposal }) => proposal
    ? [`${id}: ${proposal.verdict}, ${proposal.backend.model} (uncalibrated proposal)`] : []);
  const notice = details.review ? "Explicit review saved; model proposals remain separate."
    : details.pendingIds?.length || details.grading.grades.some((grade) => grade.grading === "pending")
      ? "Final open-response grades pending. Uncalibrated proposals require review."
      : "Exact grades require no model judgement.";
  return { render: (width: number) => [...card.render(width), ...[notice, ...estimates].flatMap((text) => wrapTextWithAnsi(text, Math.max(1, width)))],
    invalidate: () => card.invalidate() };
}

export const teachingTools = [
  keatingToolMaker(
    "plan",
    "plan",
    "Generate a structured lesson plan for a topic, adapted to the current teaching policy. Use before teaching any topic to structure your approach.",
    { topic: { type: "string", description: "The topic to generate a lesson plan for" } },
    async (params, _ctx, signal) => {
      const topic = (params.topic as string) || "";
      if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
      const artifact = await planTopicArtifact(getCwd(), topic, { signal });
      return {
        content: [{ type: "text", text: `[artifact://plan]\nWrote ${relative(getCwd(), artifact.planPath)}\nLesson plan review: ${artifact.reviewStatus}${artifact.reviewPath ? ` — ${relative(getCwd(), artifact.reviewPath)}` : ". Opt in with KEATING_LESSON_PLAN_JUDGE=notorganic."}` }],
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
    "Generate retrieval practice questions for a topic. Creates recall, comprehension, application, and transfer questions with answer keys. Optional independent review: keating login --judgement, then start the shell with KEATING_GRADING_JUDGE=notorganic (KEATING_JUDGEMENT_MODEL optionally pins a concrete judge). Proposals stay uncalibrated and pending until explicit review.",
    {
      topic: { type: "string", description: "The topic to generate quiz questions for" },
      questions: { type: "array", description: "Authored questions with question, correctAnswer, explanation, and optional mathProblem (arithmetic expression or linear-equation left, right, variable x).", items: { type: "object", properties: { question: { type: "string" }, correctAnswer: { type: "string" }, explanation: { type: "string" }, type: { type: "string" }, mathProblem: { type: "object", properties: { kind: { type: "string" }, expression: { type: "string" }, left: { type: "string" }, right: { type: "string" }, variable: { type: "string" } }, required: ["kind"] } }, required: ["question", "correctAnswer", "explanation"] } },
    },
    async (params, ctx) => {
      const topic = (params.topic as string) || "";
      if (!topic) return { content: [{ type: "text", text: "Topic required." }] };
      let quiz: Quiz;
      try {
        quiz = generateQuiz(topic, 42, { authored: Array.isArray(params.questions) ? params.questions as AuthoredQuestion[] : undefined });
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Invalid quiz questions." }] };
      }

      if (typeof ctx?.ui?.custom === "function" && ctx.hasUI) {
        const formQuestions: AnswerFormQuestion[] = quiz.questions.map((q) => ({
          id: q.id,
          prompt: q.question,
          kind: q.options && q.options.length > 0 ? "choice" : "text",
          choices: q.options,
        }));
        const customAnswers: Record<string, string> | undefined = await ctx.ui.custom((_tui: any, theme: any, _keybindings: any, done: (result: Record<string, string>) => void) => {
          return new AnswerFormComponent(theme, formQuestions, done);
        });
        const rawAnswers: Record<string, string> = customAnswers ?? {};

        // Pi RPC exposes custom() for API compatibility but resolves it to undefined.
        // Fall back to the standard dialog methods that RPC hosts can transport.
        if (!customAnswers) {
          for (const q of quiz.questions) {
            const prompt = `${q.level ? `[${q.level}] ` : ""}${q.question}`;
            const answer = q.options && q.options.length > 0
              ? await ctx.ui.select(prompt, q.options)
              : await ctx.ui.input(prompt, "Type your answer");
            rawAnswers[q.id] = answer ?? "";
          }
        }

        const objectiveResults: Record<string, boolean> = {};
        const openEndedIds: string[] = [];
        const pendingMathIds: string[] = [];
        for (const q of quiz.questions) {
          if (q.mathProblem) {
            const credit = mathQuestionCredit(q, rawAnswers[q.id] ?? "");
            if (credit === undefined) { pendingMathIds.push(q.id); openEndedIds.push(q.id); }
            else objectiveResults[q.id] = credit === 1;
            continue;
          }
          const isObjective = q.type === "multiple_choice" || q.type === "true_false" || q.type === "fill_in";
          if (isObjective) {
            const expected = (quiz.answerKey.get(q.id) ?? "").trim().toLowerCase();
            const given = (rawAnswers[q.id] ?? "").trim().toLowerCase();
            objectiveResults[q.id] = given.length > 0 && given === expected;
          } else {
            openEndedIds.push(q.id);
          }
        }
        if (cliGradingEnabled()) {
          const resultId = `quiz-${randomUUID()}`;
          const recordPath = await saveCliQuizSubmission(getCwd(), { id: resultId, quiz, answers: rawAnswers, objectiveResults, pendingMathIds });
          const semanticQuestions = quiz.questions.filter((q) => openEndedIds.includes(q.id) && !q.mathProblem);
          const receipt = await reviewCliOpenResponses(getCwd(), semanticQuestions.map((q) => ({
            id: q.id, question: q.question, learnerAnswer: rawAnswers[q.id] ?? "", referenceAnswer: quiz.answerKey.get(q.id), rubric: q.rubric,
          })));
          await saveCliQuizProposal(getCwd(), resultId, receipt);
          for (const grade of receipt.grades) if (grade.grading === "auto") objectiveResults[grade.id] = grade.credit === 1;
          const pendingIds = quiz.questions.filter((q) => !Object.hasOwn(objectiveResults, q.id)).map((q) => q.id);
          const correct = Object.values(objectiveResults).filter(Boolean).length;
          if (pendingIds.length) pendingQuizResults.set(resultId, { quiz, answers: rawAnswers, objectiveResults, gradingRecordPath: recordPath });
          else await persistQuizResult(quiz.slug, correct, Object.keys(objectiveResults).length);
          const proposals = receipt.proposals.filter((entry) => entry.proposal !== null);
          const description = proposals.map(({ id, proposal }) => `${id}: ${proposal!.verdict} (model ${proposal!.backend.model}; uncalibrated proposal only)`).join("; ");
          return {
            content: [{ type: "text", text: `Exact score: ${correct}/${Object.keys(objectiveResults).length}. ${pendingIds.length} answers pending final review. ${description || "No semantic proposal available."}\nSaved answers and judgement evidence: ${relative(getCwd(), recordPath)}. Use grade_quiz with result_id "${resultId}" to inspect; explicit reviewer grades are required to finalize pending answers. Do not turn a model proposal into a final grade automatically.` }],
            details: { quiz, topic, answers: rawAnswers, objectiveResults, pendingMathIds, resultId, grading: receipt, pendingIds, gradingRecordPath: recordPath },
          };
        }
        const correctCount = Object.values(objectiveResults).filter(Boolean).length;
        const objectiveTotal = Object.keys(objectiveResults).length;

        let text = `Objective score: ${correctCount}/${objectiveTotal}.`;
        if (pendingMathIds.length) text += ` Math answers not independently checked: ${pendingMathIds.join(", ")}. Continue normally; you may model-grade these answers, clearly labeling the verdict as not independently checked.`;
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
          details: { quiz, topic, answers: rawAnswers, objectiveResults, pendingMathIds, resultId }
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
        return withGradingNotice(renderQuizCard(theme, details.quiz as Quiz, { answers, objectiveResults }), details);
      }
    }
  ),
  keatingToolMaker(
    "grade_quiz",
    "grade_quiz",
    "Inspect or explicitly review open-ended questions from a prior quiz result_id. In account-backed mode omit grades to inspect saved pending proposals; submit a complete set only after reviewer authorization. Uncalibrated proposals must not be finalized automatically.",
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
      const saved = /^quiz-[a-z0-9-]{8,90}$/.test(resultId) ? await loadCliQuizRecord(getCwd(), resultId) : null;
      if (saved) {
        const quiz: Quiz = { ...saved.submission.quiz, answerKey: new Map(Object.entries(saved.submission.quiz.answerKey)) };
        const objectiveResults = { ...saved.submission.objectiveResults };
        for (const grade of saved.proposal?.grades ?? []) if (grade.grading === "auto") objectiveResults[grade.id] = grade.credit === 1;
        const sharedDetails = { quiz, answers: saved.submission.answers, objectiveResults, grading: saved.proposal, resultId, pendingIds: quiz.questions.filter((q) => !Object.hasOwn(objectiveResults, q.id)).map((q) => q.id),
          gradingRecordPath: cliQuizRecordPath(getCwd(), resultId) };
        if (saved.review) return { content: [{ type: "text", text: `Reviewed quiz score: ${saved.review.score.correct}/${saved.review.score.total}. Existing review retained.` }], details: { ...sharedDetails, openEndedGrades: saved.review.grades, review: saved.review } };
        const gradesInput = Array.isArray(params.grades) ? params.grades : [];
        if (!gradesInput.length) return { content: [{ type: "text", text: "Final open-response grades remain pending. Saved model proposals are uncalibrated review suggestions; submit explicit reviewer grades to finalize." }], details: sharedDetails };
        const grades: Record<string, { verdict: "correct" | "incorrect" | "partial"; note?: string }> = {};
        for (const raw of gradesInput) {
          if (!raw || typeof raw !== "object") return { isError: true, content: [{ type: "text", text: "Invalid reviewer grades." }] };
          const item = raw as Record<string, unknown>;
          if (typeof item.question_id !== "string" || Object.hasOwn(grades, item.question_id) || !["correct", "incorrect", "partial"].includes(String(item.verdict))) return { isError: true, content: [{ type: "text", text: "Invalid or duplicate reviewer grade." }] };
          grades[item.question_id] = { verdict: item.verdict as "correct" | "incorrect" | "partial", ...(typeof item.note === "string" ? { note: item.note } : {}) };
        }
        try {
          const review = await finalizeCliQuizReview(getCwd(), resultId, grades);
          await persistQuizResult(quiz.slug, review.score.correct, review.score.total);
          pendingQuizResults.delete(resultId);
          return { content: [{ type: "text", text: `Reviewed quiz score: ${review.score.correct}/${review.score.total}. Model proposals remain separate from this explicit review.` }], details: { ...sharedDetails, openEndedGrades: review.grades, review } };
        } catch {
          return { isError: true, content: [{ type: "text", text: "Review was not applied. Include every pending question exactly once; exact results cannot be overridden. A saved review is never overwritten." }] };
        }
      }
      const pending = pendingQuizResults.get(resultId);
      if (pending?.gradingRecordPath) return { isError: true, content: [{ type: "text", text: "This saved quiz belongs to another workspace or its submission is unavailable. Reopen the original workspace to review it." }] };
      if (!pending) return { content: [{ type: "text", text: `No pending quiz result found for result_id "${resultId}".` }] };

      const gradesInput = Array.isArray(params.grades) ? params.grades : [];
      const openEndedGrades: Record<string, { verdict: "correct" | "incorrect" | "partial"; note?: string }> = {};
      for (const g of gradesInput) {
        if (!g || typeof g !== "object") continue;
        const questionId = (g as Record<string, unknown>).question_id;
        const verdict = (g as Record<string, unknown>).verdict;
        const question = pending.quiz.questions.find(q => q.id === questionId);
        if (!question || Object.prototype.hasOwnProperty.call(pending.objectiveResults, String(questionId))) {
          return { isError: true, content: [{ type: "text", text: "Only pending questions may be model-graded; exact results cannot be overridden." }] };
        }
        if (typeof questionId !== "string" || (verdict !== "correct" && verdict !== "incorrect" && verdict !== "partial")) continue;
        const note = (g as Record<string, unknown>).note;
        openEndedGrades[questionId] = { verdict, note: question.mathProblem ? `Not independently checked. ${typeof note === "string" ? note : "Model-generated verdict."}` : typeof note === "string" ? note : undefined };
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
        return withGradingNotice(renderQuizCard(theme, details.quiz as Quiz, { answers, objectiveResults, openEndedGrades }), details);
      }
    }
  ),
];
