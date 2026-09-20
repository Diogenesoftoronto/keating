import { expect, test } from "bun:test";
import { inferBrowserLearnerTurnSignal } from "../keating/core";
import { computeSessionRewardedTurns } from "../keating/reward";
import { computeMobileRewardedTurns } from "../../../mobile/src/lib/session-reward";
import type { PortableLearnerData } from "@keating/learner-contracts";

test("shared extraction preserves browser vocabulary, priority, evidence formatting and mobile inferred reward parity", () => {
  const cases = [
    ["wrong", "thumbs-down", .15], ["incorrect", "thumbs-down", .15], ["not helpful", "thumbs-down", .15],
    ["bad explanation", "thumbs-down", .15], ["no, that's not", "thumbs-down", .15], ["still wrong", "thumbs-down", .15],
    ["confused", "confused", .35], ["lost", "confused", .35], ["stuck", "confused", .35], ["unclear", "confused", .35],
    ["not sure", "confused", .35], ["don't understand", "confused", .35], ["dont understand", "confused", .35],
    ["doesn't make sense", "confused", .35], ["doesnt make sense", "confused", .35], ["can you explain", "confused", .35],
    ["what do you mean", "confused", .35], ["why is", "confused", .35], ["how does", "confused", .35],
    ["got it", "thumbs-up", .85], ["makes sense", "thumbs-up", .85], ["i understand", "thumbs-up", .85],
    ["that helps", "thumbs-up", .85], ["clear now", "thumbs-up", .85], ["yes exactly", "thumbs-up", .85], ["correct", "thumbs-up", .85],
    ["GOT\n IT, but STILL WRONG", "thumbs-down", .15], ["correct but confused", "confused", .35],
    ["ok", null, null], ["Tell me another fact", null, null], ["wrongness", null, null],
  ] as const;
  for (const [text, signal, score] of cases) {
    const normalized = text.replace(/\s+/g, " ").trim();
    const inferred = inferBrowserLearnerTurnSignal(text, "recursion");
    if (signal) expect(inferred).toEqual({ topic: "recursion", signal, masteryEstimate: signal === "thumbs-up" ? .75 : signal === "confused" ? .35 : .2, evidence: normalized });
    else expect(inferred).toBeNull();
    const messages = [{ role: "user" as const, content: "Teach recursion", timestamp: 1000 },
      { role: "assistant" as const, content: "Recursion repeats a smaller problem.", timestamp: 2000 },
      { role: "user" as const, content: text, timestamp: 3000 }];
    const web = computeSessionRewardedTurns({ sessionId: "session", title: "recursion", messages, feedback: [], quizResults: [], usedFeedbackIds: new Set() })[0];
    // Only fields consumed by the pure mobile join are needed for this cross-platform fixture.
    const data = { sessions: [{ id: "session", title: "recursion", messages: messages.map((message, index) => ({ ...message, id: `message-${index}`, createdAt: new Date(message.timestamp).toISOString() })) }],
      decks: [], feedbackEvents: [], quizResults: [], cardReviews: [], questionChecks: [], topicEvidence: [] } as unknown as PortableLearnerData;
    const mobile = computeMobileRewardedTurns(data, { includeContext: false })[0];
    expect(mobile.signals.inferred?.signal).toBe(web.signals.inferred?.signal);
    expect(mobile.scored).toBe(web.scored);
    if (score === null) expect(mobile.reward).toBeNull();
    else { expect(mobile.reward).toBeCloseTo(web.reward); expect(mobile.reward).toBeCloseTo(score); }
  }
  expect(inferBrowserLearnerTurnSignal(`got it ${"x".repeat(300)}`)?.evidence).toHaveLength(240);
});
