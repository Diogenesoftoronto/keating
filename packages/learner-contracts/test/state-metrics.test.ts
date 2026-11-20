import { expect, test } from "bun:test";
import { earlierLearnerExcerpts, estimatedRequestTokens, estimatedStateQuestionTokens, estimatedTextTokens, measureStateComposition, prepareTeachingWindow } from "../src/judgement/state-metrics.js";
import { teachingPolicyState } from "../src/judgement/teaching-policy.js";
import { MAX_STATE_CHARS, stateCharacterCount, type JudgementRequest } from "../src/judgement/contracts.js";
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
  const excerpts = [original.conversation[0]!.content, original.conversation[2]!.content];
  const budget = estimatedStateQuestionTokens(build({ ...original, conversation: original.conversation.slice(8), earlierLearnerExcerpts: excerpts }));
  let builds = 0;
  const result = prepareTeachingWindow(original, input => { builds++; return build(input); }, budget);
  expect(result.before!.fillRatio).toBeGreaterThan(1);
  expect(result.after!.fillRatio).toBeLessThanOrEqual(1);
  expect(result.turn.conversation.length).toBeGreaterThan(0);
  expect(result.turn.conversation).toEqual(original.conversation.slice(result.turnsDropped * 2));
  expect(result.turn.conversation.at(-1)).toEqual(original.conversation.at(-1));
  expect(builds).toBeLessThanOrEqual(3 + Math.ceil(Math.log2(original.conversation.length + 1)));
  expect(result.turn.earlierLearnerExcerpts).toEqual(excerpts);
  expect(estimatedStateQuestionTokens(build({ ...original, conversation: original.conversation.slice((result.turnsDropped - 1) * 2) }))).toBeGreaterThan(budget);
  expect(result.after!.sections.earlierLearnerExcerpts.entries).toBe(2);
  expect(result.turn.activeWork).toEqual(original.activeWork);
  expect(result.turn.pendingSubmissions).toEqual(original.pendingSubmissions);
  expect(result.turn.learnerEvidence).toEqual(original.learnerEvidence);
  expect(result.turn.sources).toEqual(original.sources);
  expect(result.after!.pinned.plan).toBe(true);
  expect(JSON.stringify([result.before, result.after])).not.toContain("PRIVATE_");
  expect(original.conversation).toHaveLength(20);
});

test("the opening uses bounded, distinct learner excerpts and survives later windows", () => {
  const original = {
    ...turn, learnerMessage: "Correction: use my new deadline 🗓️.",
    conversation: [
      { role: "assistant", content: "PRIVATE_ASSUMPTION" }, { role: "user", content: "   " },
      { role: "user", content: "漢😀".repeat(200) }, { role: "tool", content: "PRIVATE_TOOL" },
      { role: "user", content: "Work in stages." }, { role: "user", content: "Work in stages." },
      { role: "assistant", content: "x".repeat(9000) },
      { role: "user", content: "Recent question" }, { role: "assistant", content: "Recent answer" },
    ] as TeachingPolicyTurn["conversation"],
  };
  const first = prepareTeachingWindow(original, build, 1200);
  const expected = [Array.from("漢😀".repeat(200)).slice(0, 319).join("") + "…", "Work in stages."];
  expect(first.turn.earlierLearnerExcerpts).toEqual(expected);
  expect(first.turn.learnerMessage).toBe(original.learnerMessage);
  const again = prepareTeachingWindow({ ...first.turn, conversation: [...first.turn.conversation, { role: "user", content: "Later" },
    { role: "assistant", content: "x".repeat(8000) }, ...original.conversation.slice(-2)] }, build, 1200);
  expect(again.turnsDropped).toBeGreaterThan(0);
  expect(again.turn.earlierLearnerExcerpts).toEqual(expected);
  expect((again.request!.state as { turn: TeachingPolicyTurn }).turn.earlierLearnerExcerpts).toEqual(expected);
  expect(earlierLearnerExcerpts([{ role: "user", content: "repeat" }, { role: "tool", content: "skip" }, { role: "user", content: "next" }], ["repeat"])).toEqual(["repeat", "next"]);
});

test("a retained question link follows its exact conversation message", () => {
  const conversation: TeachingPolicyTurn["conversation"] = [
    { role: "user", content: "Opening " + "a".repeat(8000) }, { role: "assistant", content: "Earlier question?" },
    { role: "user", content: "Recent turn" }, { role: "assistant", content: "The current question?" },
  ];
  const presentation = { assistantTurnIndex: 3, documentId: "doc", nodeId: "question" };
  const kept = prepareTeachingWindow({ ...turn, conversation, previousQuestionPresentation: presentation }, build, 2200);
  expect(kept.turn.conversation).toEqual(conversation.slice(2));
  expect(kept.turn.previousQuestionPresentation).toEqual({ ...presentation, assistantTurnIndex: 1 });
  const removed = prepareTeachingWindow({ ...turn, conversation, previousQuestionPresentation: { ...presentation, assistantTurnIndex: 1 } }, build, 2200);
  expect(removed.turn.previousQuestionPresentation).toBeUndefined();
});

test("optional excerpts yield when the complete current request only just fits", () => {
  const pinned = { ...turn, learnerMessage: "Current request. ".repeat(160) };
  const budget = estimatedStateQuestionTokens(build(pinned));
  const original = { ...pinned, earlierLearnerExcerpts: ["界".repeat(320)], conversation: [] };
  const result = prepareTeachingWindow(original, build, budget);
  expect(result.turn.earlierLearnerExcerpts).toBeUndefined();
  expect(result.turn.learnerMessage).toBe(pinned.learnerMessage);
  expect(result.after!.estimatedStateQuestionTokens).toBe(budget);
  expect(original.earlierLearnerExcerpts).toHaveLength(1);
});

test("the full conversation survives right up to and including the limit; protected inputs remain complete", () => {
  const input = { ...turn, conversation: [{ role: "user" as const, content: "small" }, { role: "assistant" as const, content: "Earlier reply." }] };
  const estimate = estimatedStateQuestionTokens(build(input));
  for (const budget of [estimate + 1, estimate]) {
    const kept = prepareTeachingWindow(input, build, budget);
    expect(kept.turnsDropped).toBe(0);
    expect(kept.turn).toBe(input);
    expect(kept.request).toEqual(build(input));
  }
  expect(prepareTeachingWindow(input, build, estimate - 1).turnsDropped).toBe(1);
  expect(prepareTeachingWindow(input, build, null).turnsDropped).toBe(0);
  const pinned = { ...input, learnerMessage: "x".repeat(10000) };
  const oversized = prepareTeachingWindow(pinned, build, 2000);
  expect(oversized.turn.conversation).toHaveLength(0);
  expect(oversized.turn.learnerMessage).toBe(pinned.learnerMessage);
  expect(oversized.after!.fillRatio).toBeGreaterThan(1);
  expect(prepareTeachingWindow(input, () => null, 2000).after).toBeNull();
});

test("batching questions retains full history until a single question exceeds the request-token limit", () => {
  const input: TeachingPolicyTurn = { ...turn, conversation: [{ role: "user", content: "History ".repeat(250) }] };
  const questions = { 'id"漢': { type: "noul", instructions: "条件".repeat(80) },
    second: { type: "noul", instructions: "Another question. ".repeat(20) } } as const;
  const makeRequest = (current: TeachingPolicyTurn) => ({ state: teachingPolicyState(current), questions });
  const whole = makeRequest(input);
  const single = Math.max(...Object.entries(questions).map(([id, question]) => estimatedRequestTokens({ state: whole.state, questions: { [id]: question } })));
  expect(estimatedRequestTokens(whole)).toBeGreaterThan(single);
  expect(prepareTeachingWindow(input, makeRequest, null, single).turn).toBe(input);
  const over = prepareTeachingWindow(input, makeRequest, null, single - 1);
  expect(over.turnsDropped).toBe(1);
  expect(over.fitsLimits).toBe(true);
});

test("the transport character ceiling also preserves the full transcript at exactly the limit", () => {
  const withHistory = (content: string): TeachingPolicyTurn => ({ ...turn, conversation: [
    { role: "user", content: "Keep the opening requirement." }, { role: "assistant", content },
    { role: "user", content: "Recent exchange" },
  ] });
  const padding = "a".repeat(MAX_STATE_CHARS - stateCharacterCount(build(withHistory("")).state));
  const exact = withHistory(padding);
  expect(stateCharacterCount(build(exact).state)).toBe(MAX_STATE_CHARS);
  expect(prepareTeachingWindow(exact, build, null).turn).toBe(exact);
  const over = prepareTeachingWindow(withHistory(padding + "a"), build, null);
  expect(over.turnsDropped).toBe(1);
  expect(over.turn.conversation).toEqual(exact.conversation.slice(2));
  expect(over.turn.earlierLearnerExcerpts).toEqual(["Keep the opening requirement."]);
  expect(over.turn.learnerMessage).toBe(turn.learnerMessage);
});
