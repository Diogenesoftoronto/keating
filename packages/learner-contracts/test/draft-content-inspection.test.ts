import { expect, test } from "bun:test";
import { runTeachingDrafts, type TeachingDraftCandidateText } from "../src/judgement/teaching-drafts.js";
import type { JudgementAnswer, JudgementCaller } from "../src/judgement/contracts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
const turn: TeachingPolicyTurn = { learnerMessage: "Explain this.", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "unknown" };
const judge: JudgementCaller = async request => {
  const answers: Record<string, JudgementAnswer> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === "choice") {
      const choice = id === "draft_standard" ? "supported" : Object.keys(question.criteria)[0]!;
      answers[id] = { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === choice)])) };
    } else if (question.type === "score") {
      answers[id] = { type: "score", score: 0, legend: Object.fromEntries(question.criteria.map((text, index) => [String(index), text])), probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), Number(index === 0)])), confidence: 1 };
    } else answers[id] = { type: "noul", noul: .01 };
  }
  return { ok: true, response: { backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, answers } };
};

test("opt-in inspection projects only candidate answer text; receipts stay content-free", async () => {
  const captured: TeachingDraftCandidateText[] = [];
  const result = await runTeachingDrafts({ turn, judge, maxAttempts: 1,
    onDraftContent: candidate => captured.push(candidate),
    generate: async () => ({ reply: { text: "PRIVATE_ANSWER", toolCalls: [] }, value: { hiddenReasoning: "SECRET_REASONING", toolArguments: "SECRET_TOOL" } }) });
  expect(captured).toEqual([{ attempt: 1, variant: "default", text: "PRIVATE_ANSWER" }]);
  expect(JSON.stringify(result.receipt)).not.toContain("PRIVATE_ANSWER");
  expect(JSON.stringify(captured)).not.toContain("SECRET_");
});

test("an inspection observer cannot change ordinary publication", async () => {
  const generate = async () => ({ reply: { text: "A clear explanation.", toolCalls: [] }, value: "value" });
  const ordinary = await runTeachingDrafts({ turn, judge, generate, maxAttempts: 1 });
  const inspected = await runTeachingDrafts({ turn, judge, generate, maxAttempts: 1, onDraftContent: () => { throw new Error("private observer failure"); } });
  expect(ordinary.status).toBe("released");
  expect(inspected.status).toBe(ordinary.status);
  expect(inspected.reply).toEqual(ordinary.reply);
});

test("generation completed after cancellation never reaches inspection", async () => {
  const abort = new AbortController();
  const captured: TeachingDraftCandidateText[] = [];
  const result = await runTeachingDrafts({ turn, judge, signal: abort.signal, maxAttempts: 1,
    onDraftContent: candidate => captured.push(candidate), generate: async () => {
      abort.abort(); return { reply: { text: "STALE_PRIVATE", toolCalls: [] }, value: "value" };
    } });
  expect(result.status).toBe("cancelled");
  expect(captured).toEqual([]);
});
