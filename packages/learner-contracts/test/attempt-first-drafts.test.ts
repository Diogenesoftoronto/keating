/** A learner who asks to answer first gets the reviewed Question; every other path keeps its existing protection. */
import { describe, expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import { isLoneQuestionSurface, retainsAttemptFirstCheckpoint, approvesAttemptFirstCheckpoint } from "../src/judgement/teaching-drafts/attempt-first.js";
import { rankBestEffortDrafts } from "../src/judgement/teaching-drafts/policy.js";
import type { JudgementAnswer, JudgementCaller, JudgementRequest } from "../src/judgement/contracts.js";
import type { TeachingPolicyCheck, TeachingPolicyPlan, TeachingPolicyReply, TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";

const turn: TeachingPolicyTurn = { learnerMessage: "A strip is folded in half twice. Before you tell me, I'd like to guess how many layers it has.",
  conversation: [], learnerEvidence: [], availableTools: ["remember_learner_profile"], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "unknown" };
const question = 'Guess first:\n\n```openui lifecycle=ephemeral id=fold\n\nroot = LearningSurface([guess], "How many layers?", "Predict first.", "ephemeral")\nguess = Question([{ header: "Your guess", question: "How many layers after two folds?", type: "choice", choices: ["2", "3", "4", "8"], allowText: true }], "ephemeral", "Folding", "Commit to an answer.")\n```';
const prose = "How many layers do you think the strip has after the two folds?";
const wantsToAnswer = { learning_task: .99, learner_response_due: .9, prediction_opportunity: .9 };

type Scores = Record<string, string | number | undefined>;
function judge(scores: (request: JudgementRequest, review: number) => Scores, seen: { reviews: number; choosers: number } = { reviews: 0, choosers: 0 }): JudgementCaller {
  return async request => {
    if (request.questions.draft_choice) seen.choosers++;
    const override = scores(request, "reply" in (request.state as object) ? ++seen.reviews : 0);
    const answers: Record<string, JudgementAnswer> = {};
    for (const [id, item] of Object.entries(request.questions)) {
      if (item.type === "choice") {
        const choice = typeof override[id] === "string" ? override[id] as string : id === "draft_standard" ? "concise" : Object.keys(item.criteria)[0]!;
        answers[id] = { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(item.criteria).map(key => [key, Number(key === choice)])) };
      } else if (item.type === "score") {
        answers[id] = { type: "score", score: 0, legend: Object.fromEntries(item.criteria.map((text, index) => [String(index), text])),
          probabilities: Object.fromEntries(item.criteria.map((_, index) => [String(index), Number(index === 0)])), confidence: 1 };
      } else {
        answers[id] = { type: "noul", noul: typeof override[id] === "number" ? override[id] as number : id.startsWith("quality_") ? .9 : .02 };
      }
    }
    return { ok: true, response: { backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, answers } };
  };
}
const drafts = (...texts: (string | TeachingPolicyReply)[]) => {
  let index = 0;
  return async () => { const next = texts[Math.min(index, texts.length - 1)]!; index++; return { reply: typeof next === "string" ? { text: next, toolCalls: [] } : next, value: index }; };
};

describe("best-effort release when the learner asked to answer first", () => {
  // Recorded shape: Question rejected only for a possibly repetitive introduction, a tool-only retry, then bare prose.
  const recorded = (first: Scores = {}, plan: Scores = {}) => runTeachingDrafts({ turn, maxAttempts: 3,
    judge: judge((_, review) => review === 0 ? { ...wantsToAnswer, ...plan }
      : review === 1 ? { checkpoint_repeated: .6, ...first } : { checkpoint_repeated: .72, checkpoint_not_interactive: .73, quality_progress: .59, quality_scope: .57 }),
    generate: drafts(question + "\n\nTake your pick.", prose, prose) });

  test("the reviewed Question is published as unverified instead of a later prose question", async () => {
    const result = await recorded();
    expect(result).toMatchObject({ status: "released", value: 1, reply: { text: question, toolCalls: [] } });
    expect(result.receipt).toMatchObject({ reason: "best-effort-draft", selectedAttempt: 1, selectionRule: "presentation-only-checkpoint-retained", attempts: [{ status: "fail", trimmedCheckpointSuffix: true }, {}] });
    expect(result.receipt.attempts).toHaveLength(2);
    expect(JSON.stringify(result.receipt)).not.toContain("How many layers");
  });

  test.each<[string, Scores, Scores]>([
    ["a leaked answer", { checkpoint_answer_leaked: .7 }, {}], ["an uncertain leak", { checkpoint_answer_leaked: .5 }, {}],
    ["continuing past the question", { checkpoint_continued: .7 }, {}], ["confident repetition", { checkpoint_repeated: .8 }, {}],
    ["an unsupported claim", { tool_success_invented: .9 }, {}], ["a weak answer", { quality_progress: .3 }, {}],
    ["a declined assessment", {}, { assessment_declined: .95 }], ["a plain-reply request", {}, { plain_reply_requested: .95 }],
    ["no request to answer", {}, { learner_response_due: .05 }], ["an uncertain request to answer", {}, { learner_response_due: .5 }],
  ])("%s keeps the Question out", async (_, first, plan) => {
    const result = await recorded(first, plan);
    expect(result.reply?.text ?? "").not.toContain("```openui");
    expect(result.receipt.selectedAttempt).not.toBe(1);
    expect(result.receipt.selectionRule).toBe(result.status === "released" ? "none" : undefined);
  });

  test("a failed host check, a profile write or broken component syntax keeps the Question out", async () => {
    const scores = judge((_, review) => review === 0 ? wantsToAnswer : { checkpoint_repeated: .6 });
    const host = await runTeachingDrafts({ turn, maxAttempts: 1, judge: scores, generate: drafts(question),
      check: () => [{ id: "host-schema", source: "deterministic", severity: "major", status: "fail", probability: 1 }] });
    const write = await runTeachingDrafts({ turn, maxAttempts: 1, judge: scores,
      generate: drafts({ text: question, toolCalls: [{ name: "remember_learner_profile", arguments: { value: "likes guessing" } }] }) });
    const broken = await runTeachingDrafts({ turn, maxAttempts: 1, judge: scores, generate: drafts(question.replace('"ephemeral")\nguess', '"ephemeral"\nguess')) });
    for (const result of [host, write, broken]) expect(result).toMatchObject({ status: "withheld", receipt: { selectedAttempt: null } });
  });

  test("a turn that runs out of time applies the same preference", async () => {
    const result = await runTeachingDrafts({ turn, maxAttempts: 3, timeoutMs: 60,
      judge: judge((_, review) => review === 0 ? wantsToAnswer : { checkpoint_repeated: .6 }),
      generate: async input => { if (input.attempt > 1) await new Promise(resolve => setTimeout(resolve, 400)); return { reply: { text: question, toolCalls: [] }, value: input.attempt }; } });
    expect(result).toMatchObject({ status: "released", value: 1, receipt: { reason: "best-effort-draft", selectedAttempt: 1, selectionRule: "presentation-only-checkpoint-retained" } });
    expect(result.receipt.attempts).toHaveLength(1);
  });
});

describe("approved choice when the learner asked to answer first", () => {
  // Recorded shape: approved prose question, one repair into an approved Question, a chooser that prefers the prose.
  const recorded = (second: Scores = {}, plan: Scores = {}, first: Scores = { checkpoint_not_interactive: .63 }) => {
    const seen = { reviews: 0, choosers: 0 };
    return runTeachingDrafts({ turn, maxAttempts: 3, generate: drafts(prose, question),
      judge: judge((_, review) => review === 0 ? { ...wantsToAnswer, ...plan } : review === 1 ? first : review === 2 ? second : { draft_choice: "draft_1" }, seen) })
      .then(result => ({ result, seen }));
  };

  test("the approved Question replaces the approved prose question without asking the chooser", async () => {
    const { result, seen } = await recorded();
    expect(result).toMatchObject({ status: "released", value: 2, reply: { text: question }, receipt: { reason: null, selectedAttempt: 2, selectionRule: "requested-prediction-over-prose", selectionCandidateAttempts: [2] } });
    expect(seen.choosers).toBe(0);
  });

  test("a Question that is not approved leaves the approved prose in place", async () => {
    for (const second of [{ checkpoint_answer_leaked: .7 }, { checkpoint_continued: .7 }, { tool_success_invented: .9 }]) {
      const { result } = await recorded(second);
      expect(result).toMatchObject({ status: "released", value: 1, reply: { text: prose }, receipt: { reason: null, selectionRule: "none" } });
    }
  });

  test("an ordinary chooser still decides when the prose was not a question in prose", async () => {
    const seen = { reviews: 0, choosers: 0 };
    const result = await runTeachingDrafts({ turn, maxAttempts: 2, collectAllAttempts: true, generate: drafts("Each fold doubles the stack.", question),
      judge: judge((_, review) => review === 0 ? wantsToAnswer : { draft_choice: "draft_1" }, seen) });
    expect(seen.choosers).toBe(1);
    expect(result).toMatchObject({ status: "released", value: 1, receipt: { selectionRule: "none", selectionCandidateAttempts: [1, 2] } });
  });
});

describe("attempt-first predicates", () => {
  const plan = (change: Partial<{ due: boolean | null; declined: boolean | null; plain: boolean | null; action: string; family: string; status: string }> = {}) => ({
    version: "test", status: change.status ?? "guided", planReview: null, directives: [], uncertain: [], allowedTools: [],
    decisions: { assessment_declined: change.declined === undefined ? false : change.declined, plain_reply_requested: change.plain === undefined ? false : change.plain },
    features: { learner_response_due: change.due === undefined ? true : change.due },
    interaction: { action: change.action ?? "create", families: [{ family: change.family ?? "question", components: change.family ? ["Quiz"] : ["Question"] }] },
  }) as unknown as TeachingPolicyPlan;
  const check = (id: string, status: TeachingPolicyCheck["status"] = "pass", probability: number | null = .02, more: Partial<TeachingPolicyCheck> = {}): TeachingPolicyCheck =>
    ({ id, source: "jev", severity: "major", status, probability, ...more });
  const repeated = check("checkpoint_repeated", "fail", .6, { severity: "minor" });
  const passing = ["checkpoint_answer_leaked", "checkpoint_continued", "quality_progress", "quality_scope"].map(id => check(id));
  const reply = { text: question, toolCalls: [] };

  test("only one Question surface in compiled syntax qualifies", () => {
    expect(isLoneQuestionSurface(question)).toBe(true);
    expect(isLoneQuestionSurface(question.replace("Question([", "Quiz(["))).toBe(false);
    expect(isLoneQuestionSurface(question.replace("guess = ", "sim = Simulation(\"x\")\nguess = "))).toBe(false);
    expect(isLoneQuestionSurface(question.replace('"Folding"', '"Folding Quiz(1)"'))).toBe(true);
    expect(isLoneQuestionSurface(question + "\n\n" + question.slice(question.indexOf("```")))).toBe(false);
    expect(isLoneQuestionSurface(question + "\n\n```python\nprint(4)\n```")).toBe(false);
    expect(isLoneQuestionSurface('```openui\n{"nodes":[{"type":"question"}]}\n```')).toBe(false);
    expect(isLoneQuestionSurface(prose)).toBe(false);
  });

  test("retention needs the request, the offered family and nothing but mild repetition against it", () => {
    expect(retainsAttemptFirstCheckpoint(reply, plan(), [...passing, repeated], [repeated])).toBe(true);
    for (const other of [plan({ due: null }), plan({ due: false }), plan({ declined: true }), plan({ declined: null }), plan({ plain: true }),
      plan({ plain: null }), plan({ action: "continue" }), plan({ action: "none" }), plan({ family: "retrieval" }), plan({ status: "abstained" })]) {
      expect(retainsAttemptFirstCheckpoint(reply, other, [...passing, repeated], [repeated])).toBe(false);
      expect(approvesAttemptFirstCheckpoint(reply, other, passing)).toBe(false);
    }
    expect(retainsAttemptFirstCheckpoint(reply, plan(), passing, [])).toBe(false);
    expect(retainsAttemptFirstCheckpoint({ text: question, toolCalls: [{ name: "remember_learner_profile", arguments: {} }] }, plan(), [...passing, repeated], [repeated])).toBe(false);
    for (const blocker of [check("checkpoint_repeated", "fail", .8, { severity: "minor" }), check("checkpoint_repeated", "unknown", null, { severity: "minor" }),
      check("checkpoint_repeated", "fail", .6, { severity: "critical" }), check("checkpoint_repeated", "fail", 1, { severity: "minor", source: "deterministic" }),
      check("source_contradicted", "fail", .9)]) {
      expect(retainsAttemptFirstCheckpoint(reply, plan(), [...passing, blocker], [blocker])).toBe(false);
    }
    for (const id of ["checkpoint_answer_leaked", "checkpoint_continued", "quality_progress", "quality_scope"]) {
      const without = passing.filter(item => item.id !== id);
      expect(retainsAttemptFirstCheckpoint(reply, plan(), [...without, repeated], [repeated])).toBe(false);
      expect(retainsAttemptFirstCheckpoint(reply, plan(), [...without, check(id, "unknown", .5), repeated], [repeated])).toBe(false);
      expect(approvesAttemptFirstCheckpoint(reply, plan(), without)).toBe(false);
    }
    const host = check("host-schema", "unknown", null, { source: "deterministic" });
    expect(retainsAttemptFirstCheckpoint(reply, plan(), [...passing, repeated, host], [repeated])).toBe(false);
    expect(retainsAttemptFirstCheckpoint(reply, plan(), [...passing, repeated, check("mastery_overclaimed", "unknown", .5, { severity: "critical" })], [repeated])).toBe(false);
    expect(approvesAttemptFirstCheckpoint(reply, plan(), passing)).toBe(true);
  });

  test("the requested answer field leads unverified drafts; quality orders the rest", () => {
    const draft = (attempt: number, quality: number, attemptFirst?: true) => ({ attempt, quality, reply, value: attempt, ...(attemptFirst ? { attemptFirst } : {}) });
    expect(rankBestEffortDrafts([draft(1, .9), draft(2, .6, true), draft(3, .95)]).map(item => item.attempt)).toEqual([2, 3, 1]);
    expect(rankBestEffortDrafts([draft(1, .5), draft(2, .5), draft(3, .7)]).map(item => item.attempt)).toEqual([3, 1, 2]);
  });
});
