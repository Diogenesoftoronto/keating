import { expect, test } from "bun:test";
import type { TeachingPolicyTurn } from "@keating/learner-contracts";
import { createMobileTeachingDraftRound } from "../src/lib/judgement/teaching-drafts";
import type { ProviderToolContinuation } from "../src/lib/provider-client";
import { runMobileToolLoop } from "../src/lib/provider-tool-loop";
import type { ChatMessage } from "../src/lib/types";
import { mobileTeachingHistory } from "../src/state/turn-policy";
import { EMPTY_LEARNER_DATA, acceptingTeachingJudge } from "./helpers/judgement-fixtures";

const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, role, content, createdAt: 1 });
const recent = Array.from({ length: 40 }, (_, index) => message("recent-" + index,
  index % 2 === 0 ? "assistant" : "user", index === 39 ? "Continue from the beginning." : "Recent message " + index));
const first = "My original learning goal.";
test.each(["fits", "overflow", "cancel on tool result"] as const)("native tool rounds review the full available transcript (%s)", async mode => {
  const controller = new AbortController();
  const original = [message("first", "user", first), message("tutor", "assistant", "An earlier answer." + (mode === "overflow" ? "x".repeat(32_000) : "")),
    message("second", "user", "A second question from the learner."), ...recent];
  const history = mobileTeachingHistory(original);
  const reviewed: TeachingPolicyTurn[] = [], actorHistory: ChatMessage[][] = [], visible: string[] = [];
  let committed = 0;
  const requestRound = createMobileTeachingDraftRound({
    reviewHistory: history.reviewHistory, current: () => !controller.signal.aborted,
    judgementModel: { id: "fixture", requestTokens: 64_000, stateQuestionTokens: 6000 },
    evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    judge: async (request, signal) => {
      const turn = (request.state as { turn: TeachingPolicyTurn }).turn;
      reviewed.push(turn);
      if (mode === "cancel on tool result" && turn.toolResults.length === 2) controller.abort();
      const outcome = await acceptingTeachingJudge(request, signal);
      if (!outcome.ok || !request.questions.identity_invented) return outcome;
      return { ok: true, response: { ...outcome.response, answers: { ...outcome.response.answers,
        identity_invented: { type: "noul", noul: 0 } } } };
    },
    request: async (_settings, _key, messages, options) => {
      actorHistory.push(messages);
      const continuation = options?.continuation;
      if (continuation?.provider === "openai") expect(continuation.results).toHaveLength(1);
      if (!continuation || continuation.provider === "openai" && continuation.previousResponseId === "response-1") {
        const sequence = continuation ? 2 : 1;
        return { text: "", calls: [{ id: `call-${sequence}`, name: "generate_practice_quiz", arguments: { topic: sequence === 1 ? "Division" : "Fractions" } }],
          assistantTurn: { provider: "openai", previousResponseId: `response-${sequence}` }, usage: null };
      }
      return { text: "Continuing the lesson.", calls: [], assistantTurn: null, usage: null };
    },
  });
  const run = runMobileToolLoop({ provider: "openai", model: "fixture-actor", customBaseUrl: "" }, null, history.recent, {
    sessionId: "history", triggeringMessageId: recent.at(-1)!.id, createdAt: 1, signal: controller.signal, requestRound,
    executeTool: async (name, _args, context) => ({ ok: true, toolName: name, idempotencyKey: context.idempotencyKey, output: { sequence: committed + 1 }, effects: [] }),
    commitToolCall: async () => { committed++; }, onTextDelta: delta => { visible.push(delta); },
  });
  if (mode === "cancel on tool result") {
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(visible).toEqual([]);
  } else {
    expect(await run).toMatchObject({ text: "Continuing the lesson.", toolCalls: 2, rounds: 3 });
    expect(visible.join("")).toBe("Continuing the lesson.");
  }
  expect(committed).toBe(2);
  expect(actorHistory.length).toBe(mode === "cancel on tool result" ? 4 : 6);
  for (const actor of actorHistory) expect(actor).toEqual(recent);
  expect(reviewed.some(turn => turn.toolResults.length === 0)).toBe(true);
  expect(new Set(reviewed.map(turn => turn.toolResults.length))).toEqual(new Set([0, 1, 2]));
  for (const turn of reviewed) {
    expect(turn.toolResults.map(result => JSON.parse(result.content).sequence)).toEqual([1, 2].slice(0, turn.toolResults.length));
    if (mode === "overflow") {
      expect(turn.earlierLearnerExcerpts?.[0]).toBe(first);
      expect(turn.conversation.length).toBeLessThan(original.length - 1);
    } else {
      expect(turn.earlierLearnerExcerpts).toBeUndefined();
      expect(turn.conversation).toEqual(original.slice(0, -1).map(({ role, content }) => ({ role, content })));
    }
    expect(turn.learnerMessage).toBe(recent.at(-1)!.content);
  }
});

test("retrying a provider continuation replaces only its observed tool batch", async () => {
  const result = (text: string) => ({ callId: "call", name: "generate_practice_quiz", output: { text } });
  const responses: string[][] = [];
  const round = createMobileTeachingDraftRound({
    current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    judge: async (request, signal) => {
      const turn = (request.state as { turn: TeachingPolicyTurn }).turn;
      responses.push(turn.toolResults.map(tool => JSON.parse(tool.content).text));
      return acceptingTeachingJudge(request, signal);
    },
    request: async () => ({ text: "Reviewed.", calls: [], assistantTurn: null, usage: null }),
  });
  const check = async (expected: string[], continuation?: ProviderToolContinuation) => {
    responses.length = 0;
    await round({ provider: continuation?.provider === "anthropic" ? "anthropic" : "openai", model: "fixture", customBaseUrl: "" },
      null, recent, { continuation });
    expect(responses.length).toBeGreaterThan(0);
    for (const recorded of responses) expect(recorded).toEqual(expected);
  };
  const openAi = (id: string, text: string): ProviderToolContinuation => ({ provider: "openai", previousResponseId: id, results: [result(text)] });
  await check(["first"], openAi("A", "first"));
  await check(["first", "second"], openAi("B", "second"));
  await check(["first", "retried"], openAi("B", "retried"));
  await check(["earlier retry"], openAi("A", "earlier retry"));
  const anthropic: ProviderToolContinuation = { provider: "anthropic", exchanges: [
    { assistantContent: [], results: [result("one")] }, { assistantContent: [], results: [result("two")] },
  ] };
  await check(["one", "two"], anthropic);
  await check(["one", "two"], anthropic);
  await check([]);
});
