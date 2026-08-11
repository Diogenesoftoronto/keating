import { describe, expect, test } from "bun:test";
import {
  createPortableLearnerEnvelope,
  type PortableLearnerData,
} from "@keating/learner-contracts";
import {
  MAX_PORTABLE_LEARNER_JSON_BYTES,
  PortableLearnerJsonError,
  formatPortableLearnerCountSummary,
  parsePortableLearnerJson,
  serializePortableLearnerJson,
  summarizePortableLearnerData,
  utf8ByteLength,
} from "../src/lib/learner-portable-json";

const at = "2026-08-10T00:00:00.000Z";

function fixture(): PortableLearnerData {
  return {
    generatedAt: at,
    sessions: [{
      id: "session-1", title: "Calculus", createdAt: at, updatedAt: at, activeBranchId: "branch-1",
      branches: [{ id: "branch-1", sessionId: "session-1", createdAt: at, updatedAt: at }],
      messages: [
        { id: "message-1", role: "user", content: "Teach limits", createdAt: at },
        { id: "message-2", role: "assistant", content: "What changes?", createdAt: at },
      ],
    }],
    artifacts: [], goals: [],
    questionChecks: [{ id: "check-1", topic: "Calculus", question: "What is a limit?", answer: "A value approached.", grading: "auto", createdAt: at }],
    quizResults: [{ id: "quiz-1", topic: "Calculus", score: 1, totalQuestions: 1, answers: { "question-1": "A value approached." }, createdAt: at }],
    decks: [], cardReviews: [], studyPriorities: [],
    feedbackEvents: [{ id: "feedback-1", sessionId: "session-1", messageId: "message-2", rating: "helpful", createdAt: at }],
    usageEvents: [{ id: "usage-1", provider: "openai", model: "gpt-5", createdAt: at, providerReported: { totalTokens: 1 } }],
    topicEvidence: [{ id: "evidence-1", topic: "Calculus", provenance: "session", createdAt: at, reference: { kind: "session", id: "session-1" } }],
    benchmarks: [],
    evolutions: [],
    learnerProfile: { topicsExplored: ["Calculus"], strengths: [], weaknesses: [], sessionsCount: 1, lastSessionAt: at },
  };
}

function expectPortableError(run: () => unknown, code: PortableLearnerJsonError["code"]): void {
  try {
    run();
    throw new Error("Expected portable JSON failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(PortableLearnerJsonError);
    expect((error as PortableLearnerJsonError).code).toBe(code);
  }
}

describe("portable learner JSON", () => {
  test("parses a validated export and serializes deterministically with a final newline", () => {
    const envelope = createPortableLearnerEnvelope(fixture());
    const first = serializePortableLearnerJson(envelope);
    const second = serializePortableLearnerJson(JSON.parse(first));

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(parsePortableLearnerJson(first)).toEqual(envelope);
  });

  test("counts only portable records for an import/export confirmation", () => {
    const summary = summarizePortableLearnerData(fixture());
    expect(summary).toEqual({
      sessions: 1, messages: 2, artifacts: 0, goals: 0, assessments: 2,
      decks: 0, reviews: 0, priorities: 0, feedback: 1, usage: 1, topicEvidence: 1, benchmarks: 0, evolutions: 0,
    });
    expect(formatPortableLearnerCountSummary(summary)).toContain("1 sessions · 2 messages · 0 artifacts");
  });

  test("checks UTF-8 bytes before parsing and cannot be configured above the repository cap", () => {
    expect(utf8ByteLength("aé🙂\ud800")).toBe(10);
    expectPortableError(() => parsePortableLearnerJson("123456789", { maximumBytes: 8 }), "too-large");
    expectPortableError(() => parsePortableLearnerJson("x".repeat(MAX_PORTABLE_LEARNER_JSON_BYTES + 1)), "too-large");
  });

  test("distinguishes malformed, invalid, unsafe, and unsupported exports without leaking the payload", () => {
    expectPortableError(() => parsePortableLearnerJson('{"token":"super-secret"'), "malformed-json");
    expectPortableError(() => parsePortableLearnerJson("{}"), "invalid-contract");

    // Exercise the parsing boundary with a valid-shape document altered after construction.
    const validText = JSON.stringify(createPortableLearnerEnvelope(fixture()));
    const unsafeCandidate = JSON.parse(validText) as { payload: PortableLearnerData };
    unsafeCandidate.payload.sessions[0]!.messages[0]!.content = "Bearer abcdefghijklmnopqrstuvwxyz012345";
    try {
      parsePortableLearnerJson(JSON.stringify(unsafeCandidate));
      throw new Error("Expected unsafe export failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(PortableLearnerJsonError);
      expect((error as PortableLearnerJsonError).code).toBe("unsafe-contract");
      expect((error as Error).message).not.toContain("abcdefghijklmnopqrstuvwxyz");
    }

    const unsupported = JSON.parse(validText) as { schemaVersion: number };
    unsupported.schemaVersion = 99;
    expectPortableError(() => parsePortableLearnerJson(JSON.stringify(unsupported)), "unsupported-contract");
  });
});
