import { expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import type { JudgementBackendKey, JudgementRequest } from "../src/judgement/contracts.js";
import { teachingDraftAnswers, teachingDraftTurn as turn } from "./fixtures/teaching-drafts.js";

const jev: JudgementBackendKey = { backend: "system-one", model: "jev-1.14.0", calibrationSha256: null };
const generated = (attempt: number) => ({ reply: { text: `Private candidate ${attempt}`, toolCalls: [] }, value: attempt });
const judge = async (request: JudgementRequest) =>
  ({ ok: true as const, response: { backend: jev, answers: teachingDraftAnswers(request), usage: { inputTokens: 5, outputTokens: 1 } } });

test("focused breadth writes one draft when no targeted alternative is wanted, even without parallel drafts", async () => {
  const attempts: number[] = [];
  const broad = await runTeachingDrafts({ turn, ruleIds: [], judge, generate: async ({ attempt }) => { attempts.push(attempt); return generated(attempt); } });
  expect(broad.receipt.attempts).toHaveLength(4);
  attempts.length = 0;
  const focused = await runTeachingDrafts({ turn, ruleIds: [], judge, breadth: "focused",
    generate: async ({ attempt }) => { attempts.push(attempt); return generated(attempt); } });
  expect(attempts).toEqual([1]);
  expect(focused.status).toBe("released");
  expect(focused.receipt.pairReviews).toBeUndefined();
});

test("focused breadth compares one targeted pair instead of two on a prediction turn", async () => {
  const predictionTurn = { ...turn, learnerMessage: "A shaded part of the garden gets less light. I want to predict what grows there first." };
  const due = { learning_task: .97, learner_response_due: .85, prediction_opportunity: .64, direct_answer_requested: .84 };
  const attempts: number[] = [];
  const result = await runTeachingDrafts({ turn: predictionTurn, ruleIds: [], breadth: "focused",
    judge: async request => ({ ok: true as const, response: { backend: jev,
      answers: teachingDraftAnswers(request, request.questions.learning_task ? due : {}) } }),
    generate: async ({ attempt, predictionQuestionOnly }) => { attempts.push(attempt);
      return { reply: { text: predictionQuestionOnly ? "```openui\nroot = LearningSurface([response])\nresponse = Question([{\"type\":\"text\",\"question\":\"Which plant grows better in shade?\"}], \"ephemeral\")\n```" : "I can wait for your answer.", toolCalls: [] }, value: attempt }; } });
  expect(attempts).toEqual([1, 2]);
  expect(result.receipt.pairReviews?.map(review => review.pair)).toEqual([1]);
});

test("focused breadth releases the first passing ordinary draft without an opening pair", async () => {
  const attempts: number[] = [];
  const requests: string[][] = [];
  const result = await runTeachingDrafts({ turn, ruleIds: [], parallelDrafts: true, breadth: "focused",
    judge: async request => { requests.push(Object.keys(request.questions)); return judge(request); },
    generate: async ({ attempt }) => { attempts.push(attempt); return generated(attempt); } });
  expect(result.status).toBe("released");
  expect(attempts).toEqual([1]);
  expect(requests.some(keys => keys.includes("draft_pair_choice") || keys.includes("draft_choice"))).toBe(false);
});

test("focused breadth caps ordinary repairs at three attempts", async () => {
  const attempts: number[] = [];
  const result = await runTeachingDrafts({ turn, ruleIds: [], breadth: "focused", maxAttempts: 10,
    judge: async request => ({ ok: true as const, response: { backend: { backend: "fixture", model: "fixture", calibrationSha256: null },
      answers: teachingDraftAnswers(request, { quality_progress: 0 }) } }),
    generate: async ({ attempt }) => { attempts.push(attempt); return generated(attempt); } });
  expect(attempts.length).toBeLessThanOrEqual(3);
  expect(result.receipt.maxAttempts).toBeLessThanOrEqual(3);
});

test("a prior plan skips the planning request and still reviews the new draft", async () => {
  const requests: string[][] = [];
  const record = async (request: JudgementRequest) => { requests.push(Object.keys(request.questions)); return judge(request); };
  const first = await runTeachingDrafts({ turn, ruleIds: [], breadth: "focused", judge: record, generate: async ({ attempt }) => generated(attempt) });
  expect(first.plan).toBeDefined();
  const planned = requests.filter(keys => keys.includes("draft_standard")).length;
  expect(planned).toBe(1);
  requests.length = 0;
  const later = await runTeachingDrafts({ turn: { ...turn, toolResults: [{ name: "lookup", status: "success", content: "observed" }] },
    ruleIds: [], breadth: "focused", priorPlan: first.plan, judge: record, generate: async ({ attempt }) => generated(attempt) });
  expect(later.status).toBe("released");
  expect(requests.some(keys => keys.includes("draft_standard"))).toBe(false);
  expect(requests.length).toBeGreaterThan(0);
  expect(later.receipt.judgeModel).toBe(jev.model);
});

test("proceed=false ends the session after planning without drafting", async () => {
  const attempts: number[] = [];
  const result = await runTeachingDrafts({ turn, ruleIds: [], breadth: "focused", judge, proceed: Promise.resolve(false),
    generate: async ({ attempt }) => { attempts.push(attempt); return generated(attempt); } });
  expect(result.status).toBe("cancelled");
  expect(attempts).toEqual([]);
});
