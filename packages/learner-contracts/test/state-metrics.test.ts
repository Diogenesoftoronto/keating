import { expect, test } from "bun:test";
import { estimatedRequestTokens, estimatedStateQuestionTokens, estimatedTextTokens, measureStateComposition, prepareTeachingWindow } from "../src/judgement/state-metrics.js";
import { teachingPolicyState } from "../src/judgement/teaching-policy.js";
import type { JudgementRequest } from "../src/judgement/contracts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";

const turn: TeachingPolicyTurn = { learnerMessage: "PRIVATE_REQUEST", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general" };
const build = (input: TeachingPolicyTurn): JudgementRequest => ({ state: teachingPolicyState(input), questions: { check: { type: "noul", instructions: "Is this supported?" } } });

test("UTF-8 state bytes, Unicode estimates and longest-question accounting are distinct", () => {
  expect(estimatedTextTokens("abc漢😀")).toBe(3);
  const request = build({ ...turn, learnerMessage: "漢😀", conversation: [{ role: "user", content: "PRIVATE_HISTORY" }] });
  const measured = measureStateComposition(request, null);
  expect(measured.totalBytes).toBe(new TextEncoder().encode(JSON.stringify(request.state)).length);
  expect(measured.sections.learnerMessage.bytes).toBe(9);
  expect(Object.values(measured.sections).reduce((sum, value) => sum + value.bytes, 0)).toBe(measured.totalBytes);
  expect(measured.sections.conversation.entries).toBe(1);
  expect(measured.fillRatio).toBeNull();
  expect(JSON.stringify(measured)).not.toContain("PRIVATE_");
  const extended = { ...request, questions: { ...request.questions, copy: request.questions.check! } };
  expect(estimatedStateQuestionTokens(extended)).toBe(estimatedStateQuestionTokens(request));
  expect(estimatedRequestTokens(extended)).toBeGreaterThan(estimatedRequestTokens(request));
});

test("window rebuild retains a nonempty newest contiguous suffix and all pinned evidence", () => {
  const original: TeachingPolicyTurn = { ...turn,
    conversation: Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `PRIVATE_${index} ${"x".repeat(200)}` })),
    activeWork: { plan: { documentId: "PRIVATE_ID", revision: 1, title: "PRIVATE_PLAN", outline: [] }, focus: null, openInteractions: [], truncated: false },
    pendingSubmissions: [{ id: "PRIVATE_PENDING", kind: "quiz", questionIds: ["a"] }],
    learnerEvidence: [{ kind: "attempt", content: "PRIVATE_EVIDENCE" }], sources: [{ id: "source", url: "https://example.test", text: "PRIVATE_SOURCE" }],
  };
  let builds = 0;
  const result = prepareTeachingWindow(original, input => { builds++; return build(input); }, 2000);
  expect(result.before!.fillRatio).toBeGreaterThanOrEqual(0.8);
  expect(result.after!.fillRatio).toBeLessThanOrEqual(0.65);
  expect(result.turn.conversation.length).toBeGreaterThan(0);
  expect(result.turn.conversation).toEqual(original.conversation.slice(result.turnsDropped * 2));
  expect(result.turn.conversation.at(-1)).toEqual(original.conversation.at(-1));
  expect(builds).toBe(result.turnsDropped + 1);
  expect(result.turn.activeWork).toEqual(original.activeWork);
  expect(result.turn.pendingSubmissions).toEqual(original.pendingSubmissions);
  expect(result.turn.learnerEvidence).toEqual(original.learnerEvidence);
  expect(result.turn.sources).toEqual(original.sources);
  expect(result.after!.pinned.plan).toBe(true);
  expect(JSON.stringify([result.before, result.after])).not.toContain("PRIVATE_");
  expect(original.conversation).toHaveLength(20);
});

test("the 80 percent trigger does not compact before it, and oversized pinned data remains visible", () => {
  const input = { ...turn, conversation: [{ role: "user" as const, content: "small" }] };
  const estimate = estimatedStateQuestionTokens(build(input));
  const below = prepareTeachingWindow(input, build, Math.ceil(estimate / 0.79));
  expect(below.turnsDropped).toBe(0);
  expect(prepareTeachingWindow(input, build, null).turnsDropped).toBe(0);
  const pinned = { ...input, learnerMessage: "x".repeat(10000) };
  const oversized = prepareTeachingWindow(pinned, build, 2000);
  expect(oversized.turn.conversation).toHaveLength(0);
  expect(oversized.turn.learnerMessage).toBe(pinned.learnerMessage);
  expect(oversized.after!.fillRatio).toBeGreaterThan(1);
  expect(prepareTeachingWindow(input, () => null, 2000).after).toBeNull();
});
