import { describe, expect, test } from "bun:test";
import { validatePortableLearnerData, type LearnerSession, type PortableLearnerData } from "@keating/learner-contracts";
import {
  projectPortableToNativeState,
  reconcileNativeStateIntoPortable,
} from "../src/lib/learner-repository/portable-native-state";
import type { PersistedAppState, ProviderSettings } from "../src/lib/types";

const T0 = "2026-08-10T00:00:00.000Z";
const T1 = "2026-08-10T00:01:00.000Z";
const T2 = "2026-08-10T00:02:00.000Z";
const PROVIDER: ProviderSettings = {
  provider: "openai",
  model: "gpt-5",
  baseUrl: "https://api.openai.com/v1",
  temperature: 0.6,
};

function branch(sessionId: string, createdAt = T0, updatedAt = T1) {
  return {
    id: `branch.${sessionId}`,
    sessionId,
    createdAt,
    updatedAt,
  };
}

function session(id: string, messages: LearnerSession["messages"], options: Partial<LearnerSession> = {}): LearnerSession {
  return {
    id,
    title: id,
    createdAt: T0,
    updatedAt: T1,
    activeBranchId: `branch.${id}`,
    branches: [branch(id)],
    messages,
    ...options,
  };
}

function blankData(overrides: Partial<PortableLearnerData> = {}): PortableLearnerData {
  return {
    generatedAt: T2,
    sessions: [],
    artifacts: [],
    goals: [],
    questionChecks: [],
    quizResults: [],
    decks: [],
    cardReviews: [],
    studyPriorities: [],
    feedbackEvents: [],
    usageEvents: [],
    topicEvidence: [],
    benchmarks: [],
    evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
    ...overrides,
  };
}

function emptyNative(): PersistedAppState {
  return {
    schemaVersion: 4,
    sessions: [],
    activeSessionId: "",
    artifacts: [],
    providerSettings: PROVIDER,
    learnerFeedback: { helpful: 0, missed: 0 },
  };
}

describe("portable learner data ↔ native state boundary", () => {
  test("projects locations, missing attachment metadata, feedback, and explicit unprojected records", () => {
    const data = blankData({
      sessions: [
        session("session-native", [{
          id: "message-user",
          role: "user",
          content: "Read both files",
          createdAt: T0,
          attachments: [
            { id: "attachment-local", kind: "image", name: "diagram.png", mimeType: "image/png", sizeBytes: 24 },
            { id: "attachment-missing", kind: "document", name: "notes.pdf", mimeType: "application/pdf", sizeBytes: 48 },
          ],
        }, {
          id: "message-assistant",
          role: "assistant",
          content: "What does the diagram imply?",
          createdAt: T1,
          agentEvents: [
            { id: "event-reasoning", occurredAt: T0, type: "reasoning-delta", turnId: "turn-1", sequence: 0, text: "Inspect the axes." },
            { id: "event-text", occurredAt: T1, type: "text-delta", turnId: "turn-1", sequence: 1, text: "What does the diagram imply?" },
            { id: "event-complete", occurredAt: T1, type: "completed", turnId: "turn-1", sequence: 2 },
          ],
        }], { model: { provider: "openai", id: "gpt-5" } }),
        session("session-tool", [{ id: "message-tool", role: "tool", content: "tool output", createdAt: T0 }]),
        session("session-child", [{ id: "message-child", role: "user", content: "continue", createdAt: T1 }], {
          parentSessionId: "session-tool",
        }),
      ],
      artifacts: [{
        id: "artifact-map",
        kind: "lesson-map",
        format: "mermaid",
        title: "Map",
        content: "graph TD; A-->B",
        createdAt: T0,
        updatedAt: T1,
        sourceSessionId: "session-native",
        sourceMessageId: "message-assistant",
      }, {
        id: "artifact-video",
        kind: "animation",
        format: "video",
        title: "Video",
        content: "remote renderer reference",
        createdAt: T0,
        updatedAt: T1,
      }, {
        id: "artifact-tool-source",
        kind: "note",
        format: "markdown",
        title: "Tool note",
        content: "do not drop this",
        createdAt: T0,
        updatedAt: T1,
        sourceSessionId: "session-tool",
      }],
      feedbackEvents: [{ id: "feedback-old", sessionId: "session-native", messageId: "message-assistant", rating: "helpful", createdAt: T0 }, {
        id: "feedback-new", sessionId: "session-native", messageId: "message-assistant", rating: "missed", createdAt: T1,
      }],
      learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 3 },
    });
    expect(validatePortableLearnerData(data)).toBe(true);

    const projected = projectPortableToNativeState(data, PROVIDER, [{
      messageId: "message-user",
      attachmentId: "attachment-local",
      uri: "file:///documents/diagram.png",
    }]);
    expect(projected.state.providerSettings).toEqual(PROVIDER);
    expect(projected.state.sessions.map((value) => value.id)).toEqual(["session-native"]);
    expect(projected.state.sessions[0]?.messages[1]?.agentEvents?.map((event) => event.type)).toEqual([
      "text-delta", "completed",
    ]);
    const nativeAttachments = projected.state.sessions[0]?.messages[0]?.attachments;
    expect(nativeAttachments).toEqual([{
      id: "attachment-local", kind: "image", name: "diagram.png", mimeType: "image/png", size: 24,
      uri: "file:///documents/diagram.png",
    }, {
      id: "attachment-missing", kind: "document", name: "notes.pdf", mimeType: "application/pdf", size: 48,
      localState: "missing",
    }]);
    expect(projected.state.sessions[0]?.messages[1]).toMatchObject({ feedback: "missed", feedbackAt: Date.parse(T1) });
    expect(projected.state.learnerFeedback).toEqual({ helpful: 1, missed: 1 });
    expect(projected.state.artifacts[0]).toMatchObject({ id: "artifact-map", kind: "concept-map", sessionId: "session-native" });
    expect(projected.unprojected.sessionIds).toEqual(["session-child", "session-tool"]);
    expect(projected.unprojected.sessionCount).toBe(2);
    expect(projected.unprojected.incompatibleSessionIds).toEqual(["session-tool"]);
    expect(projected.unprojected.ancestorBlockedSessionIds).toEqual(["session-child"]);
    expect(projected.unprojected.artifactIds).toEqual(["artifact-tool-source", "artifact-video"]);
    expect(projected.unprojected.artifactCount).toBe(2);
    expect(projected.unprojected.unsupportedArtifactIds).toEqual(["artifact-tool-source", "artifact-video"]);
    expect(JSON.stringify(projected.state)).not.toContain("file:///documents/notes.pdf");
  });

  test("reconciliation keeps portable-only learning records while allowing native deletion of projectable records", () => {
    const imported = session("session-imported", [{ id: "message-system", role: "system", content: "Imported system context", createdAt: T0 }, {
      id: "message-imported",
      role: "user",
      content: "Retain the source file",
      createdAt: T1,
      attachments: [{ id: "attachment-imported", kind: "document", name: "source.pdf", mimeType: "application/pdf", sizeBytes: 42 }],
    }]);
    const native = session("session-native", [{ id: "message-native", role: "user", content: "A native lesson", createdAt: T0 }]);
    const current = blankData({
      sessions: [imported, native],
      artifacts: [{
        id: "artifact-imported", kind: "document", format: "text", title: "Imported research", content: "Full source transcript",
        createdAt: T0, updatedAt: T1, sourceSessionId: "session-imported",
      }, {
        id: "artifact-native", kind: "note", format: "markdown", title: "Local note", content: "will be deleted",
        createdAt: T0, updatedAt: T1, sourceSessionId: "session-native",
      }],
      goals: [{ id: "goal-imported", title: "Master Bayes", description: "practice", updatedAt: T1, steps: [] }],
      questionChecks: [{ id: "check-imported", topic: "Bayes", question: "q", answer: "a", createdAt: T1, grading: "pending" }],
      quizResults: [{ id: "quiz-imported", topic: "Bayes", createdAt: T1, score: 1, totalQuestions: 1, answers: {} }],
      decks: [{
        id: "deck-imported", title: "Deck", topic: "Bayes", createdAt: T0, updatedAt: T1,
        cards: [{
          id: "card-imported", front: "f", back: "b", tags: [],
          srs: {
            ease: 2.65, intervalDays: 1, repetitions: 1, lapses: 0,
            dueAt: "2026-08-11T00:01:00.000Z", lastReviewedAt: T1, lastRating: 3,
          },
        }],
      }],
      cardReviews: [{
        id: "review-imported", deckId: "deck-imported", cardId: "card-imported", rating: 3,
        appliedIntervalDays: 1, easeAfter: 2.65, createdAt: T1, previousIntervalDays: 0,
        nextDueAt: "2026-08-11T00:01:00.000Z", repetitionsAfter: 1, lapsesAfter: 0, isLapse: false,
      }],
      studyPriorities: [{ id: "priority-imported", targetType: "deck", targetId: "deck-imported", priority: "focus", updatedAt: T1 }],
      feedbackEvents: [{ id: "feedback-imported", sessionId: "session-imported", messageId: "message-imported", rating: "helpful", createdAt: T1 }],
      usageEvents: [{ id: "usage-imported", provider: "web-provider", model: "web-model", createdAt: T1, sessionId: "session-imported", providerReported: { totalTokens: 12 } }],
      topicEvidence: [{ id: "evidence-imported", topic: "Research", createdAt: T1, provenance: "session", reference: { kind: "session", id: "session-imported" } }, {
        id: "evidence-native", topic: "Local", createdAt: T1, provenance: "session", reference: { kind: "session", id: "session-native" } }],
      learnerProfile: { topicsExplored: ["Research"], strengths: ["careful reading"], weaknesses: ["calculus"], sessionsCount: 2 },
    });
    expect(validatePortableLearnerData(current)).toBe(true);

    const reconciled = reconcileNativeStateIntoPortable(current, emptyNative(), [{
      messageId: "message-imported", attachmentId: "attachment-imported", uri: "file:///documents/retained.pdf",
    }]);
    expect(reconciled.data.sessions.map((value) => value.id)).toEqual(["session-imported"]);
    expect(reconciled.data.artifacts.map((value) => value.id)).toEqual(["artifact-imported"]);
    expect(reconciled.data.goals.map((value) => value.id)).toEqual(["goal-imported"]);
    expect(reconciled.data.questionChecks.map((value) => value.id)).toEqual(["check-imported"]);
    expect(reconciled.data.quizResults.map((value) => value.id)).toEqual(["quiz-imported"]);
    expect(reconciled.data.decks.map((value) => value.id)).toEqual(["deck-imported"]);
    expect(reconciled.data.cardReviews.map((value) => value.id)).toEqual(["review-imported"]);
    expect(reconciled.data.studyPriorities.map((value) => value.id)).toEqual(["priority-imported"]);
    expect(reconciled.data.feedbackEvents.map((value) => value.id)).toEqual(["feedback-imported"]);
    expect(reconciled.data.usageEvents.map((value) => value.id)).toEqual(["usage-imported"]);
    expect(reconciled.data.topicEvidence.map((value) => value.id)).toEqual(["evidence-imported"]);
    expect(reconciled.data.learnerProfile.strengths).toEqual(["careful reading"]);
    expect(reconciled.data.learnerProfile.weaknesses).toEqual(["calculus"]);
    expect(reconciled.preserveMessageIds).toEqual(["message-imported", "message-system"]);
    expect(reconciled.preserveLocalAttachments).toEqual([{
      messageId: "message-imported", attachmentId: "attachment-imported", uri: "file:///documents/retained.pdf",
    }]);
    expect(validatePortableLearnerData(reconciled.data)).toBe(true);
  });

  test("retains a projectable ancestor when it is required by an unprojectable child", () => {
    const parent = session("session-parent", [{ id: "message-parent", role: "user", content: "Parent", createdAt: T0 }]);
    const child = session("session-child", [{ id: "message-child", role: "tool", content: "Imported tool trace", createdAt: T1 }], {
      parentSessionId: "session-parent",
      forkedFromMessageId: "message-parent",
    });
    const current = blankData({
      sessions: [parent, child],
      learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 2 },
    });
    expect(validatePortableLearnerData(current)).toBe(true);
    const reconciled = reconcileNativeStateIntoPortable(current, emptyNative());
    expect(reconciled.data.sessions.map((value) => value.id).sort()).toEqual(["session-child", "session-parent"]);
    expect(reconciled.data.sessions.find((value) => value.id === "session-child")?.parentSessionId).toBe("session-parent");
    expect(reconciled.preserveMessageIds).toEqual(["message-child", "message-parent"]);
    expect(validatePortableLearnerData(reconciled.data)).toBe(true);
  });

  test("preserves imported event identities for a kept native-compatible session", () => {
    const compatible = session("session-compatible", [{
      id: "message-user",
      role: "user",
      content: "Keep my activity history",
      createdAt: T0,
    }, {
      id: "message-assistant",
      role: "assistant",
      content: "It remains tied to this lesson.",
      createdAt: T1,
    }], { model: { provider: "openai", id: "gpt-5" } });
    const current = blankData({
      sessions: [compatible],
      feedbackEvents: [{
        id: "feedback-imported-id", sessionId: compatible.id, messageId: "message-assistant", rating: "helpful", createdAt: T1,
      }],
      usageEvents: [{
        id: "usage-imported-id", provider: "openai", model: "gpt-5", createdAt: T1,
        sessionId: compatible.id, providerReported: { totalTokens: 12 },
      }],
      topicEvidence: [{
        id: "evidence-imported-id", topic: "Activity history", createdAt: T1,
        provenance: "session", reference: { kind: "session", id: compatible.id },
      }],
      learnerProfile: { topicsExplored: ["Activity history"], strengths: [], weaknesses: [], sessionsCount: 1 },
    });
    const native = projectPortableToNativeState(current, PROVIDER).state;
    const reconciled = reconcileNativeStateIntoPortable(current, native);

    expect(reconciled.data.feedbackEvents.some((event) => event.id === "feedback-imported-id")).toBe(true);
    expect(reconciled.data.usageEvents.some((event) => event.id === "usage-imported-id")).toBe(true);
    expect(reconciled.data.topicEvidence.some((event) => event.id === "evidence-imported-id")).toBe(true);
    expect(validatePortableLearnerData(reconciled.data)).toBe(true);
  });
});
