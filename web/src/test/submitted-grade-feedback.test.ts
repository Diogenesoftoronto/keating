import { expect, test } from "bun:test";
import type { AssistantMessage, Context, ToolResultMessage } from "@earendil-works/pi-ai";
import { currentGradeFeedback, prepareSubmittedGradeExecution, releaseSubmittedGrade, submittedGradeCommitted,
  type CommittedGrade } from "../keating/judgement/submitted-grade-execution";

test("a previous, failed, foreign or changed grade cannot authorize a fresh feedback round", () => {
  const model = new AbortController().signal, tool = new AbortController().signal;
  const target = { sessionId: "this-session", id: "this-card", question: "Which colour?", topic: "Tiles", answer: "Red" };
  const args = { topic: target.topic, results: [{ question: target.question, verdict: "incorrect" }] };
  const call = { type: "toolCall" as const, id: "chosen-call", name: "grade_question_checks", arguments: args };
  let receipt: CommittedGrade | undefined;
  releaseSubmittedGrade(model, call, target, committed => { receipt = committed; });
  prepareSubmittedGradeExecution(model, tool, call.name, call.id, args);
  submittedGradeCommitted(new AbortController().signal, "incorrect", 0);
  expect(receipt).toBeUndefined();
  submittedGradeCommitted(tool, "incorrect", 0);
  expect(receipt).toBeDefined();
  const learner = { role: "user" as const, timestamp: 1, content: "submitted form" };
  const assistant: AssistantMessage = { role: "assistant", content: [call], api: "openai-completions", provider: "openai",
    model: "fixture", stopReason: "toolUse", timestamp: 2, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const result: ToolResultMessage = { role: "toolResult", toolName: call.name, toolCallId: call.id, isError: false,
    timestamp: 2, content: [{ type: "text", text: "Recorded one check." }] };
  const row = { ...target, score: 0 };
  const messages = [learner, assistant, result];
  expect(currentGradeFeedback(receipt!, 1, messages, row)).toMatchObject({ answer: "Red", verdict: "incorrect", score: 0 });
  const mismatches: Context["messages"][] = [
    [learner, assistant, { ...result, isError: true }], [learner, assistant, { ...result, toolCallId: "other-call" }],
    [learner, assistant, { ...result, toolName: "grade_quiz" }], [learner, assistant, result, { ...learner, timestamp: 3 }],
    [{ ...learner, timestamp: 4 }, assistant, result], [learner, { ...assistant, content: [call, call] }, result],
    [learner, { ...assistant, content: [{ ...call, arguments: { ...args, results: [{ question: "Different stem", verdict: "incorrect" }] } }] }, result],
  ];
  for (const changed of mismatches) expect(currentGradeFeedback(receipt!, 1, changed, row)).toBeUndefined();
  for (const changed of [undefined, { ...row, id: "other-card" }, { ...row, score: 1 }, { ...row, answer: "changed" }]) {
    expect(currentGradeFeedback(receipt!, 1, messages, changed)).toBeUndefined();
  }
});
