import { describe, expect, test } from "bun:test";
import type { PortableLearnerData } from "@keating/learner-contracts";
import { buildMobileUsageSummary, buildRepositoryUsageSummary } from "../src/lib/usage-summary";
import { activityYears, buildActivityCalendar, buildTopicSlices } from "../src/lib/usage-insights";
import type { PersistedAppState } from "../src/lib/types";

describe("mobile usage and study summary", () => {
  test("aggregates only recorded local evidence and labels topic provenance", () => {
    const state: PersistedAppState = {
      schemaVersion: 4,
      activeSessionId: "session-1",
      providerSettings: { provider: "openai", model: "gpt-5.4", baseUrl: "https://api.openai.com/v1", temperature: 0.6 },
      learnerFeedback: { helpful: 2, missed: 1 },
      artifacts: [{ id: "artifact-1", kind: "study-plan", title: "Plan", content: "", topic: "Calculus", createdAt: 9 }],
      sessions: [{
        id: "session-1",
        title: "Limits and continuity",
        createdAt: 1,
        updatedAt: 8,
        messages: [
          { id: "user-1", role: "user", content: "Teach me limits", createdAt: 2, attachments: [{ id: "a", kind: "image", name: "graph.png", mimeType: "image/png", size: 4, uri: "file:///graph.png" }] },
          { id: "assistant-1", role: "assistant", content: "What do you notice?", createdAt: 3, provider: "openai", model: "gpt-5.4", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
        ],
      }],
    };
    const summary = buildMobileUsageSummary(state);
    expect(summary).toMatchObject({ lessons: 1, messages: 2, attachments: 1, totalTokens: 15, helpful: 2, missed: 1 });
    expect(summary.topics.map((topic) => [topic.label, topic.source])).toEqual([
      ["Calculus", "generated artifact"],
      ["Limits and continuity", "lesson title"],
    ]);
    expect(summary.models[0]).toMatchObject({ provider: "openai", model: "gpt-5.4", replies: 1, tokens: 15 });
    expect(summary.sessionStarts).toEqual([{ id: "session-1", title: "Limits and continuity", startedAt: 1, messages: 2 }]);
  });

  test("uses repository events as the authoritative usage and feedback history", () => {
    const at = "2026-08-10T00:00:00.000Z";
    const data: PortableLearnerData = {
      generatedAt: at,
      sessions: [{
        id: "session-1", title: "Calculus", createdAt: at, updatedAt: at,
        activeBranchId: "branch-1",
        branches: [{ id: "branch-1", sessionId: "session-1", createdAt: at, updatedAt: at }],
        messages: [
          { id: "message-1", role: "user", content: "Limits", createdAt: at },
          { id: "message-2", role: "assistant", content: "What changes?", createdAt: at },
        ],
      }],
      artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [], studyPriorities: [],
      feedbackEvents: [{ id: "feedback-1", sessionId: "session-1", messageId: "message-2", rating: "helpful", createdAt: at }],
      usageEvents: [{
        id: "usage-1", provider: "anthropic", model: "claude-sonnet-4-6", createdAt: at, sessionId: "session-1",
        providerReported: { inputTokens: 12, outputTokens: 8, totalTokens: 20, costUsd: 0.002 },
      }],
      topicEvidence: [{
        id: "evidence-1", topic: "Calculus", createdAt: at, provenance: "session",
        reference: { kind: "session", id: "session-1" },
      }],
      benchmarks: [],
      evolutions: [],
      learnerProfile: { topicsExplored: ["Calculus"], strengths: [], weaknesses: [], sessionsCount: 1, lastSessionAt: at },
    };
    expect(buildRepositoryUsageSummary(data)).toMatchObject({
      lessons: 1,
      messages: 2,
      assistantReplies: 1,
      totalTokens: 20,
      reportedCostUsd: 0.002,
      helpful: 1,
      missed: 0,
      topics: [{ label: "Calculus", source: "session", turns: 2 }],
      models: [{ provider: "anthropic", model: "claude-sonnet-4-6", replies: 1, tokens: 20 }],
    });
  });

  test("groups lesson starts by local calendar day and preserves leap days", () => {
    const starts = [
      { id: "a", title: "Late UTC", startedAt: Date.parse("2024-03-01T00:30:00.000Z"), messages: 2 },
      { id: "b", title: "Same local day", startedAt: Date.parse("2024-03-01T02:30:00.000Z"), messages: 3 },
      { id: "c", title: "Next year", startedAt: Date.parse("2025-01-01T12:00:00.000Z"), messages: 1 },
    ];
    expect(activityYears(starts, "America/Toronto")).toEqual([2025, 2024]);
    const calendar = buildActivityCalendar(2024, starts, "America/Toronto");
    expect(calendar.days).toHaveLength(366);
    expect(calendar.days.find((day) => day.key === "2024-02-29")).toMatchObject({ count: 2 });
    expect(calendar.maxCount).toBe(2);
  });

  test("sorts topic slices by recorded evidence and folds the remainder", () => {
    const topics = Array.from({ length: 10 }, (_, index) => ({
      key: `topic-${index}`,
      label: `Topic ${index}`,
      source: "session",
      lastStudiedAt: index,
      turns: index,
      occurrences: 10 - index,
    }));
    const slices = buildTopicSlices(topics, 3);
    expect(slices.map((slice) => [slice.label, slice.count])).toEqual([
      ["Topic 0", 10],
      ["Topic 1", 9],
      ["Topic 2", 8],
      ["Other topics", 28],
    ]);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1);
  });
});
