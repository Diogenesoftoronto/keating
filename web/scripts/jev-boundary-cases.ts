import { createHash } from "node:crypto";
import {
  estimatedRequestTokens, estimatedStateQuestionTokens, MAX_STATE_CHARS, measureStateComposition, stateCharacterCount,
  teachingPolicyDecisionRequest, type JudgementRequest, type TeachingPolicyTurn,
} from "@keating/learner-contracts";
import { JEV_REQUEST_TOKEN_LIMIT, JEV_STATE_QUESTION_TOKEN_LIMIT } from "@keating/runtime-config";
import { reasoningQuestions, standardQuestion } from "../../packages/learner-contracts/src/judgement/teaching-drafts/policy";

export const CASES = ["under", "at", "over", "current", "dense"] as const;
export type BoundaryCase = typeof CASES[number];
export const TUTOR_MODEL = "gemini-3.1-flash-lite";
export const REVIEW_MODEL = "jev-1.14.0";
export const studyPrompt = "Answer the learner's latest question using the conversation.";
const opening = "My workshop code is AMBER-42. Use it when I ask about our workshop.";
const current = "What is the perimeter of a rectangle with sides 7 and 5? Include my workshop code from earlier and the numeric answer in one sentence.";
// One BMP non-ASCII character costs one estimated token. This isolates the token guard from the 96k wire guard.
const reference = "直角四边形两组对边相等。周长是四边长度之和。";
export const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export const digest = (value: unknown) => sha(JSON.stringify(value));
export function correctAnswer(value: string) {
  return /\b24\b|\btwenty[ -]four\b/i.test(value) && /\bAMBER-42\b/i.test(value);
}

function makeTurn(kind: BoundaryCase, characters: number): TeachingPolicyTurn {
  const referenceText = reference.repeat(Math.ceil(characters / reference.length)).slice(0, characters);
  const pinned = kind === "current";
  return {
    learnerMessage: pinned ? current + "\n" + referenceText : current,
    conversation: pinned ? [] : [
      { role: "user", content: opening },
      { role: "assistant", content: "We will use a rectangle for the next exercise. ".repeat(75) },
      { role: "user", content: "Here are my bilingual reference notes for the exercise." },
      { role: "assistant", content: "Reference notes\n" + referenceText },
    ],
    learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "unknown", improvementRuns: null, domain: "unknown",
  };
}

// Mirror the production plan assembly, using its actual questions. The Flue run independently verifies the real gate's plan estimates.
function planningRequest(turn: TeachingPolicyTurn): JudgementRequest {
  const decision = teachingPolicyDecisionRequest(turn);
  return { ...decision, questions: { ...decision.questions,
    ...Object.fromEntries(reasoningQuestions.map(({ id, question }) => [id, question])), draft_standard: standardQuestion } };
}

export function calibratedCase(kind: BoundaryCase) {
  const offset = kind === "under" ? -1 : kind === "at" ? 0 : 1;
  const target = kind === "dense" ? 18_104 : JEV_STATE_QUESTION_TOKEN_LIMIT + offset;
  const baseline = estimatedStateQuestionTokens(planningRequest(makeTurn(kind, 0)));
  let turn = makeTurn(kind, target - baseline);
  if (kind === "dense") {
    const empty = makeTurn(kind, 0);
    const characters = 3 * (target - estimatedStateQuestionTokens(planningRequest(empty)));
    const hashes: string[] = [];
    for (let i = 0; hashes.length * 44 < characters; i++) hashes.push(createHash("sha256").update("jev-boundary-" + i).digest("base64"));
    turn = { ...empty, conversation: empty.conversation.map((message, index) =>
      index === 1 ? { ...message, content: message.content + hashes.join("").slice(0, characters) } : message) };
  }
  const request = planningRequest(turn);
  const measured = measureStateComposition(request, JEV_STATE_QUESTION_TOKEN_LIMIT);
  if (measured.estimatedStateQuestionTokens !== target || stateCharacterCount(request.state) >= MAX_STATE_CHARS) {
    throw new Error("fixture-calibration-failed");
  }
  return { kind, turn, full: {
    estimatedStateQuestionTokens: measured.estimatedStateQuestionTokens, estimatedStateTokens: measured.estimatedStateTokens,
    estimatedRequestTokens: estimatedRequestTokens(request), stateCharacters: stateCharacterCount(request.state),
    stateUtf8Bytes: measured.totalBytes, stateHash: digest(request.state), questionsHash: digest(request.questions),
    currentHash: sha(turn.learnerMessage), orderedMessageHashes: turn.conversation.map(digest),
    limits: { stateQuestionTokens: JEV_STATE_QUESTION_TOKEN_LIMIT, requestTokens: JEV_REQUEST_TOKEN_LIMIT, stateCharacters: MAX_STATE_CHARS },
  } };
}

export type CaseFixture = ReturnType<typeof calibratedCase>;
