import { expect, test } from "bun:test";
import { runTeachingDrafts, type TeachingDraftGenerationInput } from "../src/judgement/teaching-drafts.js";
import { isStandaloneCheckpointQuestion, TEACHING_POLICY_VERSION } from "../src/judgement/teaching-policy.js";
import type { JudgementRequest } from "../src/judgement/contracts.js";
import type { TeachingPolicyReply, TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import { teachingDraftAnswers, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const marker = "Collect the learner's own answer in one OpenUI Question.";
const firstTurn = { ...teachingDraftTurn, learnerMessage: "A shaded part of the garden gets less light. I want to predict what grows there first." };
const due = { learning_task: .97, learner_response_due: .85, prediction_opportunity: .64, direct_answer_requested: .84 };
const question = (items: readonly object[]): string =>
  ["```openui", "root = LearningSurface([response])", 'response = Question(' + JSON.stringify(items) + ', "ephemeral")', "```"].join("\n");
const item = { type: "text", question: "Which plant do you expect to grow better in the shaded part?" };
const visible = (text: string): TeachingPolicyReply => ({ text, toolCalls: [] });

async function exercise(turn: TeachingPolicyTurn, scores: Record<string, number | string>,
  author: (input: TeachingDraftGenerationInput) => TeachingPolicyReply = input =>
    visible(input.predictionQuestionOnly ? question([item]) : "I can wait for your answer."),
  reviewScores: Record<string, number | string> = {}) {
  const dispatched: TeachingDraftGenerationInput[] = [];
  const requests: JudgementRequest[] = [];
  const result = await runTeachingDrafts({
    turn, ruleIds: [],
    generate: async input => {
      dispatched.push(input);
      return { reply: author(input), value: input.attempt };
    },
    judge: async request => {
      requests.push(request);
      const pair = request.questions.draft_pair_choice;
      const overrides = request.questions.learning_task ? scores
        : pair?.type === "choice" ? { draft_pair_choice: Object.keys(pair.criteria)[1]! } : reviewScores;
      return { ok: true, response: { backend: { backend: "system-one", model: "jev-1.14.0", calibrationSha256: null },
        answers: teachingDraftAnswers(request, overrides) } };
    },
  });
  return { result, dispatched, requests };
}

test("a fresh answer-before-explanation gets one authored field in each pair, with full text passed to both judges", async () => {
  const { result, dispatched, requests } = await exercise(firstTurn, due);
  expect(dispatched.map(x => [x.attempt, x.variant, Boolean(x.predictionQuestionOnly), x.systemPrompt.includes(marker)])).toEqual([
    [1, "default", false, false], [2, "interactive", true, true], [3, "default", false, false], [4, "interactive", true, true],
  ]);
  const targeted = dispatched.filter(x => x.predictionQuestionOnly);
  expect(targeted.every(x => !x.feedbackOnly && !x.textOnlyRecovery && x.systemPrompt.includes("type: \"text\""))).toBe(true);
  expect(targeted[0]!.systemPrompt).not.toBe(targeted[1]!.systemPrompt);
  const compared = requests.filter(x => x.questions.draft_pair_choice)
    .map(x => (x.state as { candidates: Record<string, TeachingPolicyReply> }).candidates);
  expect(compared.map(Object.keys)).toEqual([["draft_1", "draft_2"], ["draft_3", "draft_4"]]);
  expect([compared[0]!.draft_2, compared[1]!.draft_4]).toEqual([visible(question([item])), visible(question([item]))]);
  expect(requests.filter(x => x.questions.checkpoint_answer_leaked && (x.state as {reply?: TeachingPolicyReply}).reply?.text === question([item]))).toHaveLength(2);
  expect(result.status).toBe("released");
  expect(result.reply).toEqual(visible(question([item])));
  expect(result.receipt.pairReviews?.map(p => [p.policyVersion, p.predictionQuestionAttempts])).toEqual([
    [TEACHING_POLICY_VERSION, [2]], [TEACHING_POLICY_VERSION, [4]],
  ]);
});

test("a requested choice between alternatives remains a functioning choice Question", async () => {
  const prompt = "Which leaf shape do you predict?";
  const choice = question([{ type: "choice", question: prompt, choices: ["Wide", "Narrow"] }]);
  const { result, dispatched } = await exercise({ ...firstTurn, learnerMessage: "Let me choose between wide and narrow leaves before you explain." },
    due, input => visible(input.predictionQuestionOnly ? choice : "I can wait for your answer."));
  expect(dispatched.filter(x => x.predictionQuestionOnly).every(x => x.systemPrompt.includes("preserve their requested choices"))).toBe(true);
  expect(result.reply).toEqual(visible(choice));
});

test("a preferred answer with a suffix, hint, key, or tool cannot use the reserved Question slot to evade ordinary review", async () => {
  for (const reply of [visible(question([{ ...item, hint: "Think about light." }])), visible(question([{ ...item, correctAnswer: "Fern" }])),
    visible("First, tell me your answer.\n" + question([item])), visible(question([item, item])), visible("What do you think?"),
    { text: question([item]), toolCalls: [{ name: "remember_learner_profile", arguments: {} }] }]) {
    expect(isStandaloneCheckpointQuestion(reply)).toBe(false);
  }
  const suffix = visible(question([item]) + "\nThe fern copes better.");
  const { result } = await exercise(firstTurn, due, input => input.attempt === 2 ? suffix
    : input.attempt === 4 ? visible(question([{ ...item, hint: "Look in the shade." }])) : visible("Take your time."));
  expect(result.receipt.attempts.filter(x => x.predictionQuestionOnly).map(x => [x.trimmedCheckpointSuffix,
    x.checks.some(c => c.id === "prediction_question_format" && c.status === "fail")])).toEqual([[undefined, true], [undefined, true]]);
  expect(result.receipt.pairReviews?.map(p => [p.preferredAttempt, p.eligibleAttempts])).toEqual([[2, [1]], [4, [3]]]);
  expect(result.reply).toEqual(visible("Take your time."));
  const rejected = await exercise(firstTurn, due, input => visible(input.predictionQuestionOnly ? question([item]) : "Take your time."), { checkpoint_answer_leaked: .99 });
  expect(rejected.result.receipt.attempts.filter(x => x.predictionQuestionOnly).every(a => a.checks.some(c =>
    c.id === "checkpoint_answer_leaked" && c.status === "fail"))).toBe(true);
  expect(rejected.result.receipt.pairReviews?.every(p => !p.eligibleAttempts?.some(n => n === 2 || n === 4))).toBe(true);
});

test("existing answers and requests for a hint or thinking time stay on the feedback path", async () => {
  const conversation: TeachingPolicyTurn["conversation"] = [{ role: "user", content: "Let me predict the tile." },
    { role: "assistant", content: "Three tiles are round and one is square. Which shape is more likely?" }];
  for (const learnerMessage of ["Round, because three of them are round.", "Square, since only one is square.", "One hint, please.", "Give me time to think."]) {
    const { dispatched } = await exercise({ ...firstTurn, conversation, learnerMessage },
      { ...due, checkpoint_reply_mode: "feedback", learner_response_due: .99 });
    expect(dispatched.filter(x => x.feedbackOnly).map(x => x.attempt)).toEqual([1, 3]);
    expect(dispatched.filter(x => x.predictionQuestionOnly)).toHaveLength(0);
  }
});

test("direct facts, requested simulations or formal quizzes, opt-outs, pending grades, and uncertain intent keep their ordinary alternatives", async () => {
  const cases: [string, Record<string, number>, Partial<TeachingPolicyTurn>?][] = [
    ["What is the symbol for copper?", { learner_response_due: .05, plain_reply_requested: .97 }],
    ["I want to vary the train speed and see what happens.", { hands_on_requested: .99, variable_relationship: .91 }],
    ["Show me; please don't quiz me.", { assessment_declined: .99 }],
    ["Make me a quiz on these plants.", { practice_requested: .99 }],
    ["I'd like an animated picture.", { motion_requested: .99 }],
    ["Work through the light calculation for me.", { explanation_requested: .99 }],
    ["I am stuck. Give me a hint.", { learner_stuck: .99 }],
    ["Could I try this?", { learner_response_due: .50 }],
    ["I think it is a fern.", { attempt_present: .99 }],
    ["What comes next?", {}, { assessment: "assessed", pendingSubmissions: [{ kind: "quiz", id: "q", questionIds: ["q1"] }] }],
  ];
  for (const [learnerMessage, scores, evidence] of cases) {
    const { dispatched } = await exercise({ ...firstTurn, learnerMessage, ...evidence }, { ...due, ...scores });
    expect(dispatched, learnerMessage).toHaveLength(4);
    expect(dispatched.some(x => x.predictionQuestionOnly || x.systemPrompt.includes(marker)), learnerMessage).toBe(false);
  }
});

test("an unfinished targeted generation contributes no completed Question provenance", async () => {
  const { result } = await exercise(firstTurn, due, input => {
    if (input.attempt === 2) throw new Error("generation unavailable");
    return visible(input.predictionQuestionOnly ? question([item]) : "Take your time.");
  });
  expect(result.receipt.pairReviews).toMatchObject([
    { status: "incomplete", policyVersion: TEACHING_POLICY_VERSION, candidateAttempts: [1], predictionQuestionAttempts: [] },
    { status: "compared", policyVersion: TEACHING_POLICY_VERSION, candidateAttempts: [3, 4], predictionQuestionAttempts: [4] },
  ]);
});
