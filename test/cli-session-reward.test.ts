import { describe, expect, test } from "bun:test";
import {
  CLI_FEEDBACK_WINDOW_MS,
  CLI_REWARDED_TURN_EVIDENCE_SOURCE,
  computeCliRewardedTurns,
} from "../src/core/session-reward.js";
import type { LearnerState } from "../src/core/types.js";

const T0 = 1_786_000_000_000;
const minute = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

function feedback(
  entries: Array<{ topic: string; at: number; signal: "thumbs-up" | "thumbs-down" | "confused" }>,
): LearnerState["feedback"] {
  return entries.map((entry) => ({ topic: entry.topic, timestamp: iso(entry.at), signal: entry.signal }));
}

describe("CLI rewarded-turn join (§7)", () => {
  test("explicit feedback joins by timestamp window with the web weights", () => {
    const turns = computeCliRewardedTurns({
      sessionId: "session-cli",
      topic: "fractions",
      messages: [
        { role: "user", content: "Explain halves", timestamp: T0 },
        { role: "assistant", content: "A half is one of two equal parts.", timestamp: T0 + minute },
      ],
      feedback: feedback([{ topic: "fractions", at: T0 + 2 * minute, signal: "thumbs-up" }]),
      quizResults: [],
    });
    expect(turns).toHaveLength(1);
    expect(turns[0].signals.explicit).toMatchObject({ score: 0.85, joinedBy: "timestampWindow" });
    expect(turns[0].signals.inferred).toBeUndefined();
    expect(turns[0].reward).toBeCloseTo(0.85, 5);
    expect(turns[0].scored).toBe(true);
  });

  test("a follow-up learner message infers the turn signal when nothing explicit exists", () => {
    const turns = computeCliRewardedTurns({
      sessionId: "session-cli",
      topic: "fractions",
      messages: [
        { role: "assistant", content: "A half is one of two equal parts.", timestamp: T0 },
        { role: "user", content: "Got it, that makes sense now!", timestamp: T0 + minute },
      ],
      feedback: [],
      quizResults: [],
    });
    expect(turns[0].signals.inferred).toMatchObject({ joinedBy: "nextTurn", signal: "thumbs-up" });
    expect(turns[0].reward).toBeCloseTo(0.85, 5);
    expect(turns[0].scored).toBe(true);
  });

  test("explicit feedback suppresses the inferred channel", () => {
    const turns = computeCliRewardedTurns({
      sessionId: "session-cli",
      topic: "fractions",
      messages: [
        { role: "assistant", content: "A half is one of two equal parts.", timestamp: T0 },
        { role: "user", content: "Got it!", timestamp: T0 + minute },
      ],
      feedback: feedback([{ topic: "fractions", at: T0 + 30_000, signal: "thumbs-down" }]),
      quizResults: [],
    });
    expect(turns[0].signals.explicit?.score).toBeCloseTo(0.15, 5);
    expect(turns[0].signals.inferred).toBeUndefined();
  });

  test("quiz results join by topic window and blend with explicit feedback", () => {
    const turns = computeCliRewardedTurns({
      sessionId: "session-cli",
      topic: "fractions",
      messages: [
        { role: "assistant", content: "A half is one of two equal parts.", timestamp: T0 },
      ],
      feedback: feedback([{ topic: "fractions", at: T0 + minute, signal: "thumbs-up" }]),
      quizResults: [
        {
          topic: "fractions",
          timestamp: iso(T0 + 2 * minute),
          correct: 1,
          total: 2,
          score: 0.5,
        },
      ],
    });
    expect(turns[0].signals.quiz).toMatchObject({ score: 0.5, joinedBy: "topicWindow" });
    expect(turns[0].signals.quiz?.timing).toMatchObject({ answeredCount: 0, quickFraction: null });
    expect(turns[0].reward).toBeCloseTo((0.85 * 0.6 + 0.5 * 0.25) / 0.85, 5);
  });

  test("a later assistant message shields the earlier turn from a later quiz", () => {
    const turns = computeCliRewardedTurns({
      sessionId: "session-cli",
      topic: "fractions",
      messages: [
        { role: "assistant", content: "First explanation.", timestamp: T0 },
        { role: "assistant", content: "Second explanation.", timestamp: T0 + minute },
      ],
      feedback: [],
      quizResults: [
        { topic: "fractions", timestamp: iso(T0 + 2 * minute), correct: 2, total: 2, score: 1 },
      ],
    });
    expect(turns[0].signals.quiz).toBeUndefined();
    expect(turns[0].scored).toBe(false);
    expect(turns[1].signals.quiz?.joinedBy).toBe("topicWindow");
  });

  test("feedback outside the window leaves the turn neutral and unscored", () => {
    expect(CLI_FEEDBACK_WINDOW_MS).toBe(10 * 60_000);
    const turns = computeCliRewardedTurns({
      sessionId: "session-cli",
      topic: "fractions",
      messages: [{ role: "assistant", content: "A half is one of two equal parts.", timestamp: T0 }],
      feedback: feedback([{ topic: "fractions", at: T0 + 11 * minute, signal: "thumbs-up" }]),
      quizResults: [],
    });
    expect(turns[0].reward).toBe(0.5);
    expect(turns[0].scored).toBe(false);
  });

  test("every row is proxy evidence, never observed (§0.1)", () => {
    const turns = computeCliRewardedTurns({
      sessionId: "session-cli",
      topic: "fractions",
      messages: [{ role: "assistant", content: "A half is one of two equal parts.", timestamp: T0 }],
      feedback: feedback([{ topic: "fractions", at: T0 + minute, signal: "thumbs-up" }]),
      quizResults: [
        { topic: "fractions", timestamp: iso(T0 + 2 * minute), correct: 1, total: 1, score: 1 },
      ],
    });
    expect(CLI_REWARDED_TURN_EVIDENCE_SOURCE).toBe("proxy");
    for (const turn of turns) expect(turn.evidenceSource).toBe("proxy");
    const serialized = JSON.stringify(turns);
    expect(serialized).not.toContain("observed");
    expect(serialized).not.toContain("eligibleForPromotion");
  });
});
