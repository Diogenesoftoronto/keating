import {
  KeatingStorage, LEARNING_EVIDENCE_CHANGED_EVENT, LEARNING_HISTORY_REPLACEMENT_EVENT,
  OPENUI_PRESENTATIONS_CHANGED_EVENT, QUESTION_JUDGEMENT_CHANGED_EVENT,
  type OpenUiPresentationRecord, type QuestionCheckRecord,
} from "../storage";
import type { PrivateStudyEvidence } from "./engine";

export const HABIT_EVIDENCE_EVENTS = [
  LEARNING_EVIDENCE_CHANGED_EVENT, LEARNING_HISTORY_REPLACEMENT_EVENT,
  OPENUI_PRESENTATIONS_CHANGED_EVENT, QUESTION_JUDGEMENT_CHANGED_EVENT,
];

const records = new KeatingStorage();
const clean = (input: string) => input.trim().toLowerCase();

function bySource(documentId: string, nodeId: string): string {
  return JSON.stringify([documentId, nodeId]);
}

function quizzesMatch(check: QuestionCheckRecord, presented: OpenUiPresentationRecord): boolean {
  const quiz = presented.document?.nodes.find(node => node.id === presented.nodeId && node.type === "quiz");
  if (quiz?.type !== "quiz") return false;
  const questions = quiz.questions.filter(question => clean(question.prompt) === clean(check.question));
  if (questions.length !== 1) return false;
  const question = questions[0];
  const expected = question.correctAnswers ?? (question.correctAnswer === undefined ? [] : [question.correctAnswer]);
  // Quiz grading also accepts reported partial credit. For a habit receipt,
  // independently compare a single saved answer to the presented answer key.
  return expected.length === 1 && (clean(expected[0]) === clean(check.answer)
    || question.choices?.some(choice => choice.id === expected[0] && clean(choice.label) === clean(check.answer)) === true);
}

function checkedPass(check: QuestionCheckRecord, presented: OpenUiPresentationRecord): boolean {
  if (check.score !== 1 || !check.answer.trim() || !check.question.trim()) return false;
  if (check.judgement?.evidenceKind === "calibrated-model-grade") {
    const { final } = check.judgement;
    return check.grading === "model" && final.id === check.id && final.grading === "model" && final.credit === 1;
  }
  if (check.grading !== "auto") return false;
  if (presented.component === "quiz") return quizzesMatch(check, presented);
  return presented.component === "question" || presented.component === "question-group";
}

async function fingerprint(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function privateQuestionEvidence(
  checks: readonly QuestionCheckRecord[],
  presentations: readonly OpenUiPresentationRecord[],
  sessionId: string,
  since: number,
  now: number,
): Promise<PrivateStudyEvidence[]> {
  const nodes = new Map(presentations.filter(node => node.sessionId === sessionId).map(node => [bySource(node.documentId, node.nodeId), node]));
  const matching = checks.flatMap(check => {
    if (check.sessionId !== sessionId || !check.source || !Number.isSafeInteger(check.createdAt)
        || check.createdAt < since || check.createdAt > now) return [];
    const identity = bySource(check.source.documentId, check.source.nodeId);
    const presented = nodes.get(identity);
    if (!presented || !checkedPass(check, presented)) return [];
    return [{ check, presented, identity }];
  });
  return Promise.all(matching.sort((a, b) => a.check.createdAt - b.check.createdAt).slice(-128).map(async ({ check, presented, identity }) => {
    const family = await fingerprint(identity);
    const questionId = await fingerprint(JSON.stringify([sessionId, family, clean(check.question)]));
    const quiz = presented.document?.nodes.find(node => node.id === presented.nodeId && node.type === "quiz");
    const passedWholeQuiz = quiz?.type === "quiz" && quiz.questions.length > 0 && quiz.questions.every(question =>
      matching.some(candidate => candidate.identity === identity && clean(candidate.check.question) === clean(question.prompt)));
    return {
      id: `question:${questionId}`, objective: check.topic.trim().slice(0, 230) || "Lesson question", family: `question:${family}`,
      checkedAt: check.createdAt, mastery: 1,
      ...(passedWholeQuiz ? { sessionId, lessonTitle: quiz.title.trim().slice(0, 128) || check.topic.trim().slice(0, 128) } : {}),
    };
  }));
}

export async function collectQuestionEvidence(sessionId: string, since: number, now: number): Promise<PrivateStudyEvidence[]> {
  const [checks, presentations] = await Promise.all([records.getQuestionChecks(), records.getOpenUiPresentations(sessionId)]);
  return privateQuestionEvidence(checks, presentations, sessionId, since, now);
}
