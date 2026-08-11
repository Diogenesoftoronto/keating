import { canonicalUiAction, UI_ACTION_JOURNAL_KIND, type AgentStreamEvent, type CapabilityManifest, type PortableLearnerData, type UiAction, type UiActionJournal, type UiActionResult, type UiDocument } from "../src/index.js";

/** A secret-free, fork-capable fixture shared by contract consumer tests. */
export function portableLearnerFixture(): PortableLearnerData {
  return {
    generatedAt: "2026-08-10T00:00:00.000Z",
    sessions: [{
      id: "session-source",
      title: "Bayes source",
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
      activeBranchId: "branch-source",
      branches: [{
        id: "branch-source", sessionId: "session-source", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z",
      }],
      messages: [{
        id: "message-source", role: "user", content: "Teach Bayes", createdAt: "2026-08-08T00:00:00.000Z",
        attachments: [{ id: "attachment-source", kind: "image", name: "bayes-tree.png", mimeType: "image/png", sizeBytes: 512 }],
      }],
    }, {
      id: "session-1",
      title: "Bayes",
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      parentSessionId: "session-source",
      forkedFromMessageId: "message-source",
      activeBranchId: "branch-alternative",
      branches: [{
        id: "branch-1", sessionId: "session-1", createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z",
      }, {
        id: "branch-alternative", sessionId: "session-1", parentBranchId: "branch-1", forkedFromMessageId: "message-1", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z",
      }],
      messages: [{ id: "message-1", role: "user", content: "Teach Bayes", createdAt: "2026-08-09T00:00:00.000Z" }],
    }],
    artifacts: [{
      id: "artifact-1", kind: "study-plan", format: "markdown", title: "Bayes plan",
      content: "# Bayes", createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z",
      attachment: { id: "attachment-1", mimeType: "image/png", sizeBytes: 512, remoteUrl: "https://keating.help/artifacts/attachment-1" },
    }],
    goals: [{ id: "goal-1", title: "Understand Bayes", description: "", updatedAt: "2026-08-10T00:00:00.000Z", steps: [] }],
    questionChecks: [],
    quizResults: [{
      id: "quiz-result-1", topic: "Bayes", createdAt: "2026-08-10T00:00:00.000Z", score: 1, totalQuestions: 2,
      answers: { "q-1": "prior" }, partialCreditPoints: 1, partialCredits: { "q-1": 1 },
      timing: { totalMs: 12_000, perQuestionMs: { "q-1": 4_000, "q-2": 8_000 } },
      flaggedQuestionIds: ["q-2"], pendingGradeQuestionIds: ["q-2"], skippedQuestionIds: ["q-2"], sessionId: "session-1",
    }],
    decks: [{ id: "deck-1", title: "Bayes cards", topic: "Bayes", createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z", cards: [{
      id: "card-1", front: "What is a prior?", back: "A belief before evidence.", tags: ["bayes"],
      srs: { ease: 2.65, intervalDays: 1, repetitions: 1, lapses: 0, dueAt: "2026-08-11T00:00:00.000Z", lastReviewedAt: "2026-08-10T00:00:00.000Z", lastRating: 3 },
    }] }],
    cardReviews: [{ id: "review-1", deckId: "deck-1", cardId: "card-1", rating: 3, previousIntervalDays: 0, appliedIntervalDays: 1, easeAfter: 2.65, repetitionsAfter: 1, lapsesAfter: 0, isLapse: false, nextDueAt: "2026-08-11T00:00:00.000Z", createdAt: "2026-08-10T00:00:00.000Z", sessionId: "session-1" }],
    studyPriorities: [],
    feedbackEvents: [{ id: "feedback-1", sessionId: "session-1", messageId: "message-1", rating: "helpful", createdAt: "2026-08-10T00:00:00.000Z" }],
    usageEvents: [{
      id: "usage-1", provider: "openai", model: "gpt-5", createdAt: "2026-08-10T00:00:00.000Z", sessionId: "session-1",
      providerReported: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    }],
    topicEvidence: [{
      id: "evidence-1", topic: "Bayes", createdAt: "2026-08-10T00:00:00.000Z", provenance: "assessment",
      reference: { kind: "quiz-result", id: "quiz-result-1" },
    }, {
      id: "evidence-2", topic: "Bayesian inference", createdAt: "2026-08-10T00:00:00.000Z", provenance: "learner-declared",
    }],
    benchmarks: [{
      id: "benchmark-1", createdAt: "2026-08-10T00:00:00.000Z", score: 82.5,
      report: "Benchmark completed against the configured suite.", topic: "Bayes", sessionId: "session-1", provenance: "benchmark-run",
    }],
    evolutions: [{
      id: "evolution-1", createdAt: "2026-08-10T00:01:00.000Z", bestScore: 87,
      policy: "# Policy\nPrefer retrieval practice.", report: "Evolution completed.", topic: "Bayes", sessionId: "session-1", provenance: "evolution-run",
    }],
    learnerProfile: { topicsExplored: ["Bayes"], strengths: [], weaknesses: [], sessionsCount: 1 },
  };
}

export function uiDocumentFixture(): UiDocument {
  return {
    schemaVersion: 1,
    id: "document-1",
    revision: 2,
    lifecycle: "ready",
    supportedSurfaces: ["web", "mobile", "terminal"],
    nodes: [{
      type: "question",
      id: "node-1",
      prompt: "What changes after evidence?",
    }],
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:01:00.000Z",
  };
}

export function uiActionFixture(): Extract<UiAction, { type: "submit-answer" }> {
  return { schemaVersion: 1, type: "submit-answer", documentId: "document-1", documentRevision: 2, nodeId: "node-1", answer: "posterior", idempotencyKey: "action-1" };
}

export function uiActionResultFixture(): UiActionResult {
  const resultingDocument = uiDocumentFixture();
  resultingDocument.revision = 3;
  resultingDocument.lifecycle = "completed";
  resultingDocument.updatedAt = "2026-08-10T00:02:00.000Z";
  return {
    schemaVersion: 1,
    documentId: "document-1",
    sourceRevision: 2,
    actionIdempotencyKey: "action-1",
    status: "completed",
    documentLifecycle: "completed",
    resultingDocument,
  };
}

export function uiActionJournalFixture(): UiActionJournal {
  const action = uiActionFixture();
  return {
    kind: UI_ACTION_JOURNAL_KIND,
    schemaVersion: 1,
    documentId: action.documentId,
    receipts: [{
      schemaVersion: 1,
      action,
      actionFingerprint: canonicalUiAction(action),
      state: "completed",
      createdAt: "2026-08-10T00:00:10.000Z",
      updatedAt: "2026-08-10T00:00:11.000Z",
      result: uiActionResultFixture(),
    }],
  };
}

export function capabilityManifestFixture(): CapabilityManifest {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-10T00:00:00.000Z",
    entries: [
      { id: "streaming-chat", available: true, surface: "mobile" },
      { id: "provider-settings", available: true, surface: "mobile" },
      { id: "sessions", available: true, surface: "mobile" },
      { id: "artifacts", available: true, surface: "mobile" },
      { id: "learner-review", available: true, surface: "mobile" },
      { id: "courses", available: true, surface: "mobile" },
      { id: "share", available: true, surface: "mobile" },
      { id: "voice", available: true, surface: "mobile" },
      { id: "live-media", available: false, surface: "mobile", recovery: "handoff", handoff: { target: "web", reason: "Camera playback is not available here." } },
      { id: "workspace", available: false, surface: "mobile", recovery: "handoff", handoff: { target: "web", reason: "No authenticated remote workspace is connected." } },
    ],
  };
}

export function streamFixture(): AgentStreamEvent[] {
  return [
    { id: "event-1", occurredAt: "2026-08-10T00:00:00.000Z", type: "reasoning-delta", turnId: "turn-1", sequence: 0, text: "Check the learner's premise." },
    { id: "event-2", occurredAt: "2026-08-10T00:00:00.500Z", type: "text-delta", turnId: "turn-1", sequence: 1, text: "Let us test it." },
    { id: "event-3", occurredAt: "2026-08-10T00:00:01.000Z", type: "tool-call", turnId: "turn-1", sequence: 2, call: { id: "call-1", name: "quiz", arguments: { topic: "Bayes" }, idempotencyKey: "call-key-1" } },
    { id: "event-4", occurredAt: "2026-08-10T00:00:02.000Z", type: "tool-result", turnId: "turn-1", sequence: 3, result: { toolCallId: "call-1", idempotencyKey: "call-key-1", status: "success", text: "Created quiz." } },
    { id: "event-5", occurredAt: "2026-08-10T00:00:03.000Z", type: "ui-document", turnId: "turn-1", sequence: 4, document: uiDocumentFixture() },
    { id: "event-6", occurredAt: "2026-08-10T00:00:04.000Z", type: "completed", turnId: "turn-1", sequence: 5 },
  ];
}
