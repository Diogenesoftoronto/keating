import { expect, test } from "bun:test";
import { runTeachingDrafts, type SubmittedComprehensionAnswer, type TeachingDraftGenerationInput } from "../src/judgement/teaching-drafts.js";
import type { TeachingPolicyReply, TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import type { JudgementRequest } from "../src/judgement/contracts.js";
import { teachingDraftAnswers, teachingDraftTurn } from "./fixtures/teaching-drafts.js";
import { projectOpenUiPairReviews, validOpenUiPairReviews } from "../src/openui-pair-reviews.js";

const saved: SubmittedComprehensionAnswer = { id: "saved-1", topic: "Socks", question: "Which colour is more likely?", answer: "Blue" };
const row = { kind: "comprehension" as const, id: saved.id, topic: saved.topic, questionText: saved.question, questionIds: [saved.id] };
const turn: TeachingPolicyTurn = { ...teachingDraftTurn, learnerMessage: "I choose blue.", availableTools: ["grade_question_checks", "feedback"],
  pendingSubmissions: [row] };
const grade = (question = saved.question) => ({ name: "grade_question_checks", arguments: { topic: saved.topic, results: [{ question, verdict: "correct" }] } });
const feedback = { name: "feedback", arguments: { signal: "thumbs-up" } };
const text = (value: string): TeachingPolicyReply => ({ text: value, toolCalls: [] });
const accepted = { text: "Blue is more likely because two of the three socks are blue.", toolCalls: [grade()] };
const marker = "Grade only the saved comprehension answer.";
async function run(options: {
  turn?: TeachingPolicyTurn; item?: SubmittedComprehensionAnswer | null; decisions?: Record<string, number>; preferenceScore?: number;
  ruleIds?: string[]; reviewScores?: Record<string,number>;
  produce?: (input: TeachingDraftGenerationInput) => TeachingPolicyReply;
} = {}) {
  const inputs: TeachingDraftGenerationInput[] = [], requests: JudgementRequest[] = [];
  const result = await runTeachingDrafts({ turn: options.turn ?? turn, submittedComprehension: options.item === null ? undefined : options.item ?? saved, ruleIds: options.ruleIds ?? [],
    generate: async input => {
      inputs.push(input);
      const reply = options.produce ? options.produce(input) : input.gradeOnly ? accepted : text("Consider the three socks.");
      return { reply, value: input.attempt };
    },
    judge: async request => {
      requests.push(request);
      const pair = request.questions.draft_pair_choice;
      const scores: Record<string, string | number> = request.questions.learning_task ? { learning_task: .99, ...options.decisions }
        : pair?.type === "choice" ? { draft_pair_choice: Object.keys(pair.criteria)[1]! }
        : { preference_graded: options.preferenceScore ?? .01, ...options.reviewScores };
      return { ok: true, response: { backend: { backend: "system-one", model: "jev-1.14.0", calibrationSha256: null },
        answers: teachingDraftAnswers(request, scores) } };
    },
  });
  return { inputs, requests, result };
}

test("a submitted factual form gets two independent grading-only alternatives and only the selected call is released", async () => {
  const { inputs, requests, result } = await run();
  expect(result.receipt.interaction?.action).toBe("grade-first");
  expect(inputs.map(i => [i.attempt, !!i.gradeOnly, i.systemPrompt.includes(marker)])).toEqual([[1,false,false],[2,true,true],[3,false,false],[4,true,true]]);
  const focused = inputs.filter(i => i.gradeOnly);
  expect(focused[0]!.systemPrompt).not.toBe(focused[1]!.systemPrompt);
  for (const i of focused) {
    expect(i.systemPrompt).toContain(JSON.stringify({ topic: saved.topic, question: saved.question, answer: saved.answer }));
    expect(i.systemPrompt).toContain("leave it ungraded");
  }
  expect(requests.filter(r => r.questions.preference_graded)).toHaveLength(2);
  expect(requests.filter(r => r.questions.draft_pair_choice)).toHaveLength(2);
  expect(result.reply).toEqual(accepted);
  expect(result.value).toBe(2);
  const pairs = projectOpenUiPairReviews(result.receipt.pairReviews)!;
  expect(pairs.map(p => p.gradeOnlyAttempts)).toEqual([[2],[4]]);
  expect(validOpenUiPairReviews([{ ...pairs[0]!, gradeOnlyAttempts: [3] }])).toBe(false);
  expect(validOpenUiPairReviews([{ ...pairs[0]!, feedbackOnlyAttempts: [2] }])).toBe(false);
  const { gradeOnlyAttempts: _, ...legacy } = pairs[0]!;
  expect(projectOpenUiPairReviews([legacy])![0]).not.toHaveProperty("gradeOnlyAttempts");
});

test("the next round explains a recorded grade in slots two and four and still reviews new checkpoints and unsupported claims", async () => {
  const confirmedQuestionGrade = { topic: saved.topic, question: saved.question, answer: saved.answer, verdict: "correct" as const, score: 1 };
  const after: TeachingPolicyTurn = { ...turn, pendingSubmissions: [], confirmedQuestionGrade,
    toolResults: [{ name: "grade_question_checks", status: "success", content: "Recorded one check." }] };
  const ruleIds = ["checkpoint_answer_leaked", "checkpoint_continued", "mastery_overclaimed"];
  const produce = () => text("Blue is most likely because two socks are blue and only one is yellow.");
  const ordinary = await run({ turn: after, item: null, ruleIds, produce });
  expect(ordinary.result.status).toBe("released");
  expect(ordinary.inputs.filter(i => i.feedbackOnly).map(i => i.attempt)).toEqual([2, 4]);
  expect(ordinary.result.receipt.pairReviews?.map(pair => pair.feedbackOnlyAttempts)).toEqual([[2], [4]]);
  expect(ordinary.inputs.some(i => i.gradeOnly || i.predictionQuestionOnly)).toBe(false);
  expect(ordinary.requests.every(req => (req.state as { turn?: TeachingPolicyTurn }).turn?.confirmedQuestionGrade?.verdict === "correct")).toBe(true);
  const reviews = ordinary.requests.filter(req => req.questions.checkpoint_continued);
  expect(reviews).toHaveLength(4);
  for (const review of reviews) {
    expect(review.questions.checkpoint_continued?.instructions).toContain("Independently check every other or newly posed item");
    expect(review.questions.checkpoint_answer_leaked?.instructions).toContain("confirmedQuestionGrade");
    expect(review.questions.checkpoint_attempt_state).toBeUndefined();
  }
  const harms = [
    ["checkpoint_answer_leaked", "Now take a different bag and predict the next draw. The answer to this new checkpoint is red."],
    ["checkpoint_continued", "Now guess the next draw. While you think, here is the solution."],
    ["mastery_overclaimed", "You have independently mastered all of probability."],
  ] as const;
  for (const [id, addition] of harms) {
    const blocked = await run({ turn: after, item: null, ruleIds, reviewScores: { [id]: .99 }, produce: () => text(produce().text + " " + addition) });
    for (const draft of blocked.result.receipt.attempts) {
      const finding = draft.checks.find(check => check.id === id);
      expect(finding).toMatchObject({ status: "fail", probability: .99 });
      expect(finding?.applicability).toBeUndefined();
    }
    expect(blocked.result.status).toBe("withheld");
  }
  const { confirmedQuestionGrade: _grade, ...historyOnly } = after;
  const stale = await run({ turn: historyOnly, item: null, ruleIds, produce });
  expect(stale.inputs.some(i => i.feedbackOnly)).toBe(false);
});

test("tools outside the saved grading target cannot become eligible even if the private reviewer prefers them", async () => {
  for (const toolCalls of [[grade(),feedback], [feedback], [grade("A different stem")], [grade(),grade()]]) {
    const { result } = await run({ produce: i => i.gradeOnly ? { text: "Blue.", toolCalls } : text("Two of three are blue.") });
    expect(result.reply?.toolCalls).toEqual([]);
    expect(result.receipt.pairReviews?.map(p => [p.preferredAttempt, p.eligibleAttempts])).toEqual([[2,[1]],[4,[3]]]);
    expect(result.receipt.attempts.filter(a => a.gradeOnly).every(a => a.checks.some(c => c.id === "submitted_grade_scope" && c.status === "fail"))).toBe(true);
  }
});

test("the reviewer can block a preference verdict; an undecidable personal choice can be acknowledged without scoring it", async () => {
  const item = { ...saved, question: "Which colour do you prefer?" };
  const preferenceTurn = { ...turn, pendingSubmissions: [{ ...row, questionText: item.question }] };
  const abstained = await run({ turn: preferenceTurn, item, produce: () => text("Blue is your preference. There is no right choice here.") });
  expect(abstained.result.reply?.toolCalls).toEqual([]);
  expect(abstained.result.receipt.selectedAttempt).toBe(2);
  const rejected = await run({ turn: preferenceTurn, item, preferenceScore: .99,
    produce: i => i.gradeOnly ? { text: "Correct.", toolCalls: [grade(item.question)] } : text("I hear you.") });
  expect(rejected.result.reply?.toolCalls).toEqual([]);
  expect(rejected.result.receipt.attempts.filter(a => a.gradeOnly).every(a => a.checks.some(c => c.id === "preference_graded" && c.status === "fail"))).toBe(true);
});

test("unlinked older records, ambiguous targets, missing permissions and opted-out turns keep their ordinary slots", async () => {
  const cases: Parameters<typeof run>[0][] = [
    { item: null }, { item: { ...saved, id: "another-session" } },
    { turn: { ...turn, availableTools: ["feedback"] } },
    { turn: { ...turn, pendingSubmissions: [{ ...row, questionText: undefined }] } },
    { turn: { ...turn, pendingSubmissions: [row, { ...row, id: "other" }] } },
    { decisions: { assessment_declined: .99 } }, { decisions: { learning_task: .01 } },
  ];
  for (const options of cases) {
    const { inputs, result } = await run(options);
    expect(inputs.filter(i => i.gradeOnly || i.systemPrompt.includes(marker))).toHaveLength(0);
    expect(result.receipt.pairReviews?.map(p => p.gradeOnlyAttempts)).toEqual([[],[]]);
  }
});


test("a tool-only saved grade cannot advance the lesson in visible text, while Jev's reported score and all other checks survive", async () => {
  for (const probability of [.47, .45]) {
    const options = { ruleIds: ["checkpoint_continued","preference_graded"], reviewScores: { checkpoint_continued: probability },
      produce: (i: TeachingDraftGenerationInput) => ({ text: i.attempt === 4 ? "  \n" : "", toolCalls: [grade()] }) };
    const { result } = await run(options);
    expect(result.receipt.pairReviews?.map(p => p.eligibleAttempts)).toEqual([[2],[4]]);
    for (const draft of result.receipt.attempts) {
      const finding = draft.checks.find(c => c.id === "checkpoint_continued");
      expect(finding).toMatchObject({ source: "jev", status: "unknown", probability });
      expect(finding?.applicability).toBe(draft.gradeOnly ? "submitted-grade-without-text" : undefined);
    }
    for (const altered of [
      { produce: () => ({ text: "There is more to the lesson.", toolCalls: [grade()] }) },
      { produce: () => ({ text: "", toolCalls: [grade(),feedback] }) },
      { produce: () => ({ text: "", toolCalls: [grade("Different question")] }) },
      { item: null },
    ]) {
      const { result: ordinary } = await run({ ...options, ...altered });
      expect(ordinary.status).toBe("withheld");
      expect(ordinary.receipt.attempts.some(a => a.checks.some(c => c.applicability === "submitted-grade-without-text"))).toBe(false);
    }
    const blocked = await run({ ...options, preferenceScore: .99 });
    expect(blocked.result.status).toBe("withheld");
  }
});
