import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import type { PortableLearnerData } from "@keating/learner-contracts";
import { buildNativeTrainingArchive } from "../src/lib/training-archive";
import { buildNativeFineTuneExport, NativeTrainingExportTooLargeError } from "../src/lib/training-export";

const T0 = "2026-08-10T12:00:00.000Z";
const T1 = "2026-08-10T12:01:00.000Z";
const T2 = "2026-08-10T12:02:00.000Z";
const T3 = "2026-08-10T12:03:00.000Z";

function fixture(): PortableLearnerData {
  return {
    generatedAt: T3,
    sessions: [{
      id: "session-training",
      title: "Linear algebra",
      createdAt: T0,
      updatedAt: T3,
      activeBranchId: "branch-main",
      branches: [{ id: "branch-main", sessionId: "session-training", createdAt: T0, updatedAt: T3 }],
      model: { provider: "openai", id: "gpt-5" },
      messages: [
        { id: "message-user-1", role: "user", content: "Explain eigenvectors", createdAt: T0 },
        { id: "message-assistant-1", role: "assistant", content: "An eigenvector keeps its direction under the linear transformation.", createdAt: T1 },
        { id: "message-user-2", role: "user", content: "Give me a shortcut", createdAt: T2 },
        { id: "message-assistant-2", role: "assistant", content: "Email me at learner@example.com and paste sk-abcdefghijklmnop.", createdAt: T3 },
      ],
    }],
    artifacts: [{
      id: "artifact-map",
      kind: "lesson-map",
      format: "mermaid",
      title: "Vector spaces",
      createdAt: T0,
      updatedAt: T0,
      content: "flowchart LR\nA[Vector] --> B[Basis]",
    }],
    goals: [],
    questionChecks: [],
    quizResults: [],
    decks: [],
    cardReviews: [],
    studyPriorities: [],
    feedbackEvents: [
      { id: "feedback-helpful", sessionId: "session-training", messageId: "message-assistant-1", rating: "helpful", createdAt: T2 },
      { id: "feedback-missed", sessionId: "session-training", messageId: "message-assistant-2", rating: "missed", createdAt: T3 },
    ],
    usageEvents: [],
    topicEvidence: [],
    benchmarks: [],
    evolutions: [],
    learnerProfile: { topicsExplored: ["Linear algebra"], strengths: [], weaknesses: [], sessionsCount: 1, lastSessionAt: T3 },
  };
}

function jsonl(text: string | undefined): any[] {
  return text?.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
}

describe("native fine-tuning export", () => {
  test("actual native export includes inferred proxy rewards and accurate source counts without inferred preference labels", () => {
    const data = fixture(); data.feedbackEvents = [];
    data.sessions[0].messages[2].content = "That helps, I understand";
    const before = JSON.stringify(data);
    const result = buildNativeFineTuneExport(data, { minimumAssistantCharacters: 1 });
    const record = jsonl(result.canonicalJsonl).find(row => row.source.messageId === "message-assistant-1");
    expect(record.quality).toMatchObject({ status: "review", scored: true, evidenceSource: "proxy", recommendedForSft: false,
      signals: { inferred: { score: .85, signal: "thumbs-up", joinedBy: "nextTurn", sourceMessageId: "message-user-2" } } });
    expect(record.quality.reward).toBeCloseTo(.85);
    expect(jsonl(result.rewardedJsonl)).toHaveLength(1);
    expect(jsonl(result.ktoJsonl)).toEqual([]); expect(jsonl(result.preferenceJsonl)).toEqual([]);
    expect(JSON.parse(result.manifestJson).rewardStats).toMatchObject({ scored: 1, unscored: 1, bySource: { explicit: 0, inferred: 1, quiz: 0, judge: 0 }, inferredSignalsAvailable: true });
    expect(JSON.stringify(data)).toBe(before);
    data.feedbackEvents.push({ id: "explicit-reject", sessionId: "session-training", messageId: "message-assistant-1", rating: "missed", createdAt: T2 });
    const explicit = buildNativeFineTuneExport(data, { minimumAssistantCharacters: 1 });
    const explicitRecord = jsonl(explicit.canonicalJsonl).find(row => row.source.messageId === "message-assistant-1");
    expect(explicitRecord.quality).toMatchObject({ status: "rejected", reward: 0 }); expect(explicitRecord.quality.signals.inferred).toBeUndefined();
    expect(jsonl(explicit.ktoJsonl).map(row => row.label)).toEqual([false]);
    expect(JSON.parse(explicit.manifestJson).rewardStats.bySource).toMatchObject({ explicit: 1, inferred: 0 });
  });

  test("exports joined outcomes with numeric timing as reviewable proxies, without inventing preference labels", () => {
    const data = fixture();
    data.feedbackEvents = [];
    data.quizResults = [{ id: "quiz-outcome", sessionId: "session-training", topic: "Linear algebra", createdAt: T2,
      score: 3, totalQuestions: 4, answers: {}, timing: { totalMs: 10_000, perQuestionMs: { first: 4_000, second: 6_000 } } }];
    const result = buildNativeFineTuneExport(data, { minimumAssistantCharacters: 1 });
    const records = jsonl(result.canonicalJsonl);
    expect(records.find(record => record.source.messageId === "message-assistant-1")?.quality).toMatchObject({
      status: "review", scored: true, reward: 0.75, recommendedForSft: false, evidenceSource: "proxy",
      signals: { quiz: { quizResultId: "quiz-outcome", joinedBy: "sessionId", timing: { meanMs: 5_000, answeredCount: 2 } } },
    });
    expect(records.find(record => record.source.messageId === "message-assistant-2")?.quality).toMatchObject({
      status: "unscored", scored: false, reward: null,
    });
    expect(jsonl(result.rewardedJsonl)).toHaveLength(1);
    expect(jsonl(result.rewardedJsonl)[0]).toMatchObject({ sessionId: "session-training", messageId: "message-assistant-1", evidenceSource: "proxy" });
    expect(jsonl(result.ktoJsonl)).toEqual([]); expect(jsonl(result.preferenceJsonl)).toEqual([]);
    expect(JSON.parse(result.manifestJson).rewardStats).toMatchObject({ scored: 1, unscored: 1, bySource: { explicit: 0, quiz: 1, inferred: 0, judge: 0 }, inferredSignalsAvailable: true });
    expect(JSON.parse(result.manifestJson).counts.ktoLines).toBe(0);
  });

  test("retains explicit rejection over a successful quiz and binds reused message ids to their own session", () => {
    const data = fixture();
    data.feedbackEvents = [{ id: "rejected", sessionId: "session-training", messageId: "message-assistant-1", rating: "missed", createdAt: T2 }];
    data.quizResults = [{ id: "quiz-perfect", sessionId: "session-training", topic: "Linear algebra", createdAt: T2, score: 1, totalQuestions: 1, answers: {} }];
    const sibling = structuredClone(data.sessions[0]); sibling.id = "session-other";
    sibling.messages[1].content = "This is a different assistant response in another session.";
    sibling.messages[3].content = "Another distinct response without feedback.";
    data.sessions.push(sibling);
    const result = buildNativeFineTuneExport(data, { minimumAssistantCharacters: 1 });
    const records = jsonl(result.canonicalJsonl);
    const rejected = records.find(record => record.source.sessionId === "session-training" && record.source.messageId === "message-assistant-1");
    expect(rejected.quality).toMatchObject({ status: "rejected", reward: 0, signals: { explicit: { feedbackId: "rejected" }, quiz: { score: 1 } } });
    const other = records.filter(record => record.source.sessionId === "session-other");
    expect(other).toHaveLength(2);
    for (const record of other) expect(record.quality).toMatchObject({ scored: false, reward: null });
    expect(jsonl(result.ktoJsonl)).toHaveLength(1);
    expect(jsonl(result.ktoJsonl)[0].label).toBe(false);
    expect(result.chatmlJsonl).toContain(sibling.messages[1].content);
    expect(result.chatmlJsonl).not.toContain(data.sessions[0].messages[1].content);
  });

  test("pending quiz grades remain unknown in the real export", () => {
    const data = fixture(); data.feedbackEvents = [];
    data.quizResults = [{ id: "pending-quiz", sessionId: "session-training", topic: "Linear algebra", createdAt: T2,
      score: 0, totalQuestions: 1, answers: { open: "A tentative answer" }, pendingGradeQuestionIds: ["open"] }];
    const result = buildNativeFineTuneExport(data, { minimumAssistantCharacters: 1 });
    expect(jsonl(result.rewardedJsonl)).toEqual([]);
    for (const record of jsonl(result.canonicalJsonl).filter(record => record.source.type === "session")) {
      expect(record.quality).toMatchObject({ scored: false, reward: null });
    }
  });

  test("preserves provenance, uses explicit feedback, and excludes rejected responses from SFT", () => {
    const result = buildNativeFineTuneExport(fixture(), { now: new Date(T3), minimumAssistantCharacters: 1 });
    const records = jsonl(result.canonicalJsonl);
    expect(records).toHaveLength(3);
    expect(records.find((record) => record.source.type === "artifact")?.quality).toMatchObject({ status: "unscored", scored: false, recommendedForSft: false });
    expect(records.find((record) => record.source.messageTimestamp === Date.parse(T1))?.quality).toMatchObject({
      status: "accepted", scored: true, reward: 1,
    });
    expect(records.find((record) => record.source.messageTimestamp === Date.parse(T3))?.quality).toMatchObject({
      status: "rejected", scored: true, reward: 0,
    });
    expect(jsonl(result.alpacaJsonl).map((record) => record.output)).not.toContain("Email me at [REDACTED] and paste [REDACTED].");
    expect(result.exampleCount).toBe(2);
    expect(jsonl(result.ktoJsonl).map((record) => record.label).sort()).toEqual([false, true]);
  });

  test("redacts credential and email patterns without mutating source data", () => {
    const data = fixture();
    const original = data.sessions[0]!.messages[3]!.content;
    const result = buildNativeFineTuneExport(data, { minimumAssistantCharacters: 1 });
    expect(result.canonicalJsonl).not.toContain("learner@example.com");
    expect(result.canonicalJsonl).not.toContain("sk-abcdefghijklmnop");
    expect(result.canonicalJsonl).toContain("[REDACTED]");
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
    expect(data.sessions[0]!.messages[3]!.content).toBe(original);
  });

  test("redacts titles in prompts, canonical provenance, and ChatML metadata", () => {
    const data = fixture();
    data.sessions[0]!.title = "sk-abcdefghijklmnop";
    data.artifacts[0]!.title = "learner@example.com";
    const result = buildNativeFineTuneExport(data, { minimumAssistantCharacters: 1 });
    const combined = `${result.canonicalJsonl}\n${result.chatmlJsonl}\n${result.alpacaJsonl}`;
    expect(combined).not.toContain("sk-abcdefghijklmnop");
    expect(combined).not.toContain("learner@example.com");
    expect(combined).toContain("[REDACTED]");
  });

  test("rejects a corpus that would require unsafe native JS-thread materialization", () => {
    const data = fixture();
    data.artifacts = [0, 1, 2].map((index) => ({
      id: `large-artifact-${index}`,
      kind: "document" as const,
      format: "text" as const,
      title: `Large ${index}`,
      createdAt: T0,
      updatedAt: T0,
      content: "x".repeat(800_000),
    }));
    expect(() => buildNativeFineTuneExport(data)).toThrow(NativeTrainingExportTooLargeError);
  });

  test("keeps a session group in one deterministic split", () => {
    const records = jsonl(buildNativeFineTuneExport(fixture(), { minimumAssistantCharacters: 1 }).canonicalJsonl)
      .filter((record) => record.source.sessionId === "session-training");
    expect(new Set(records.map((record) => record.split)).size).toBe(1);
  });

  test("packages the canonical dataset, compatibility files, schema, manifest, and data card", () => {
    const result = buildNativeFineTuneExport(fixture(), { now: new Date(T3), minimumAssistantCharacters: 1 });
    const archive = buildNativeTrainingArchive(result);
    const files = unzipSync(archive.bytes);
    expect(Object.keys(files).sort()).toContain("data/keating.training.jsonl");
    expect(Object.keys(files).sort()).toContain("data/preferences/train.kto.jsonl");
    expect(Object.keys(files).sort()).toContain("schemas/keating-training-record.schema.json");
    expect(strFromU8(files["README.md"]!)).toContain("explicit missed feedback");
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest.counts.canonicalRecords).toBe(3);
    expect(manifest.files.some((file: { path: string }) => file.path === "data/keating.training.jsonl")).toBe(true);
    expect(archive.filename).toBe("keating-training-2026-08-10T12-03-00-000Z.zip");
  });
});
