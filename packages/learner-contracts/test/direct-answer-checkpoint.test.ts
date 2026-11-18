import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runTeachingDrafts, blocksRelease } from "../src/judgement/teaching-drafts.js";
import type { TeachingPolicyReply, TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import type { JudgementAnswer, JudgementCaller } from "../src/judgement/contracts.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const archive = new URL("../../../docs/benchmarks/openui-audit-2026-11-18/", import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(new URL(file, archive), "utf8"));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const full = { id: "recorded", requestTokens: 64000, stateQuestionTokens: 32000 };
const expand = (answers: Record<string, JudgementAnswer | number>) => Object.fromEntries(Object.entries(answers).map(([id, value]) =>
  [id, typeof value === "number" ? { type: "noul" as const, noul: value } : value]));

async function replay(turn: TeachingPolicyTurn, reply: TeachingPolicyReply, plan: { hash: string; answers: Record<string, JudgementAnswer | number> },
  reviewHash: string, answers: Record<string, JudgementAnswer | number>, model: string, useHistoricalPlanAnswers = false) {
  const reviewHashes: string[] = [];
  const judge: JudgementCaller = async request => {
    const planning = Boolean(request.questions.learning_task);
    const actual = hash(request);
    if (planning && !useHistoricalPlanAnswers) expect(actual).toBe(plan.hash);
    if (!planning) reviewHashes.push(actual);
    return { ok: true, response: { backend: { backend: "fixture", model, calibrationSha256: null }, answers: expand(planning ? plan.answers : answers) } };
  };
  const result = await runTeachingDrafts({ turn, maxAttempts: 1, ...(useHistoricalPlanAnswers ? { maxReasoning: "off" as const } : {}), judgementModel: full, judge, generate: async () => ({ reply, value: reply.text }),
    check: () => [{ id: "runtime_tool_schema", source: "deterministic", status: "pass", severity: "critical", probability: 0 }] });
  expect(reviewHashes).toEqual([reviewHash]);
  return result;
}

test("both original reviewers release the exact recorded perimeter answer while retaining their different raw leak scores", async () => {
  const recording = read("policy-holdout/segment-two--MiniMax-M2.7-highspeed--perimeter.json");
  const fixed = read("gemini-decision/frozen/perimeter-request.json").case;
  const google = read("gemini-decision/frozen/perimeter-google-outcome.json").case;
  expect(hash(fixed.request)).toBe("fb0f5bf48f332386e126ed175c3e4bdcabca42451d0dfbc3c00d13ee97109e93");
  expect(google.requestSha256).toBe(fixed.requestSha256);
  const { turn, reply } = fixed.request.state;
  for (const [model, answers, status, probability] of [
    ["jev-1.14.0", recording.judgments[1].answers, "pass", .35],
    ["gemini-decision-1", google.outcome.response.answers, "fail", .7374669921053815],
  ] as const) {
    const result = await replay(turn, reply, recording.judgments[0], fixed.requestSha256, answers, model);
    expect(result).toMatchObject({ status: "released", value: "16.", receipt: { reason: null, selectedAttempt: 1 } });
    const [attempt] = result.receipt.attempts;
    expect(attempt!.status).toBe("pass");
    const leak = attempt!.checks.find(check => check.id === "checkpoint_answer_leaked")!;
    expect(leak).toMatchObject({ status, probability, applicability: "standalone-direct-answer" });
    expect(blocksRelease(leak)).toBe(false);
  }
});

test("the three stored MiniMax drafts retain their original Google decisions and each earns release under its own recorded review", async () => {
  const recording = read("gemini-decision/turn-receipts/MiniMax-M2.7-highspeed--perimeter.json");
  const { turn } = read("gemini-decision/frozen/perimeter-request.json").case.request.state;
  const [plan, ...reviews] = recording.judgments;
  for (let i = 0; i < reviews.length; i++) {
    const reply = { text: recording.drafts[i].response.text, toolCalls: [] };
    const result = await replay(turn, reply, { hash: plan.requestSha256, answers: plan.answers }, reviews[i].requestSha256, reviews[i].answers, "gemini-decision-1");
    expect(result.status).toBe("released");
    expect(result.receipt.attempts[0]!.checks.find(check => check.id === "checkpoint_answer_leaked"))
      .toMatchObject({ status: "fail", applicability: "standalone-direct-answer" });
  }
  expect(reviews).toHaveLength(3);
});

test("keeps the archived scrambled-order and loop-repair gates on the same inputs for each reviewer", async () => {
  const original = read("policy-v2/evidence.json"), held = read("gemini-decision/frozen/requests.json");
  const google = read("gemini-decision/frozen/google-outcomes.json");
  for (const [name, googlePhase] of [["order", "withheld"], ["code", "released"]]) {
    const source = "MiniMax-M2.7-highspeed--" + name, id = source + "/2";
    const fixed = held.cases.find((item: { id: string }) => item.id === id);
    const jev = original.rows.find((item: { id: string }) => item.id === id);
    const native = google.cases.find((item: { caseId: string }) => item.caseId === id);
    const recording = read("evidence/" + source + ".json"), plan = recording.judge[0];
    const reference = read("gemini-decision/frozen/reference.json").cases.find((item: { id: string }) => item.id === id);
    expect(hash(plan.answers)).toBe(reference.commonHistoricalPlanningResponseSha256);
    const { turn } = fixed.request.state;
    const reply = { text: recording.drafts.find((d: { attempt: number }) => d.attempt === 2).response.text, toolCalls: [] };
    for (const [model, answers, phase] of [["jev-1.14.0", jev.answers, "withheld"], ["gemini-decision-1", native.outcome.response.answers, googlePhase]]) {
      const result = await replay(turn, reply, plan, fixed.requestSha256, answers, model, true);
      expect(result.status).toBe(phase);
      const leak = result.receipt.attempts[0]!.checks.find(check => check.id === "checkpoint_answer_leaked")!;
      expect(leak.applicability).toBeUndefined();
      expect(blocksRelease(leak)).toBe(phase === "withheld");
    }
  }
});

const fresh: TeachingPolicyTurn = { ...teachingDraftTurn, learnerMessage: "What is the plural of mouse? Answer in one word." };
const direct = { direct_answer_requested: .98, plain_reply_requested: .98, practice_requested: .01, learner_response_due: .01 };
async function fixture(turn: TeachingPolicyTurn, text: string, answers: Record<string, number> = {}, plan = direct) {
  const contextual: boolean[] = [];
  const judge = makeTeachingDraftJudge(request => {
    if (request.questions.learning_task) return plan;
    contextual.push(Boolean(request.questions.standalone_direct_request));
    return { checkpoint_answer_leaked: .92, ...answers };
  });
  const result = await runTeachingDrafts({ turn, judge, maxAttempts: 1, generate: async () => ({ reply: { text, toolCalls: [] }, value: text }) });
  const checks = result.receipt.attempts[0]!.checks;
  return { phase: result.status, leak: checks.find(check => check.id === "checkpoint_answer_leaked")!, blockers: checks.filter(blocksRelease).map(check => check.id), contextual };
}

test("requires positive request, format and independent candidate evidence; other policy and safety checks still run", async () => {
  expect(await fixture(fresh, "Mice.")).toMatchObject({ phase: "released", contextual: [false] });
  for (const [text, scores] of [["Mars.", { quality_progress: .05 }], ["Mouses.", { source_contradicted: .93 }],
    ["Mice.", { quality_scope: .48 }], ["I am your human tutor.", { identity_invented: .98 }]] as const) {
    const result = await fixture(fresh, text, scores);
    expect(result.phase).toBe("withheld");
    expect(result.leak.applicability).toBeUndefined();
  }
  const identity = await fixture(fresh, "I am your human tutor.", { identity_invented: .98 });
  expect(identity.blockers).toContain("identity_invented");
  for (const plan of [{ ...direct, plain_reply_requested: .5 }, { ...direct, learner_response_due: .5 }, { ...direct, practice_requested: .95 }]) {
    expect((await fixture(fresh, "Mice.", {}, plan)).phase).toBe("withheld");
  }
  expect((await fixture(fresh, "Which animal? Mice.")).phase).toBe("withheld");
});

test("an active or pending checkpoint remains protected, and earlier or externally referenced work requires positive contextual evidence", async () => {
  const turn = { ...fresh, learnerMessage: "What is the answer to my unfinished puzzle? Just tell me." };
  const work = { plan: null, focus: null, openInteractions: [{ documentId: "d", nodeId: "q", component: "Question", presentedAt: 1, itemId: null, state: "awaiting" as const }], truncated: false };
  const confirmed = { standalone_direct_request: .95, direct_answer_supported: .95 };
  for (const actual of [{ ...turn, activeWork: work }, { ...turn, assessment: "assessed" as const }, { ...turn, assessment: "practice" as const },
    { ...turn, pendingSubmissions: [{ kind: "quiz" as const, id: "r", questionIds: ["q"] }] }]) {
    const result = await fixture(actual, "Mice.", confirmed);
    expect(result).toMatchObject({ phase: "withheld", contextual: [false] });
  }
  const previous: TeachingPolicyTurn = { ...turn, conversation: [{ role: "assistant", content: "Try the plural of mouse yourself. Answer before I give you feedback." }] };
  for (const actual of [turn, previous]) {
    for (const answer of [.01, .5]) expect(await fixture(actual, "Mice.", { ...confirmed, standalone_direct_request: answer }))
      .toMatchObject({ phase: "withheld", contextual: [true] });
  }
  const closed: TeachingPolicyTurn = { ...fresh, conversation: [{ role: "assistant", content: "Your earlier answer was graded." }],
    activeWork: { ...work, openInteractions: [{ ...work.openInteractions[0]!, state: "graded" }] } };
  expect(await fixture(closed, "Mice.", confirmed)).toMatchObject({ phase: "released", contextual: [true] });
  expect((await fixture(closed, "Mouses.", { ...confirmed, direct_answer_supported: .02 })).phase).toBe("withheld");
});

test("keeps the flashcard's learner-visible front subject to the leak check and allows the reviewed answer behind the card", async () => {
  const turn = { ...fresh, learnerMessage: "Let me recall Earth's satellite before turning a flashcard." };
  const card = (front: string) => ["```openui", 'root = LearningSurface([deck], "Recall")',
    'deck = Flashcards("facts", "Earth", "Planet facts", [{id: "one", front: ' + JSON.stringify(front) + ', back: "Moon", tags: ["space"]}])', "```"].join("\n");
  const practice = { ...direct, direct_answer_requested: .01, plain_reply_requested: .01, practice_requested: .99, learner_response_due: .99 };
  const front = await fixture(turn, card("Earth's satellite is the Moon. What is it called?"), { checkpoint_answer_leaked: .95 }, practice);
  expect(front.phase).toBe("withheld");
  expect(front.leak.applicability).toBeUndefined();
  const back = await fixture(turn, card("What is Earth's satellite called?"), { checkpoint_answer_leaked: .03 }, practice);
  expect(back.phase).toBe("released");
});
