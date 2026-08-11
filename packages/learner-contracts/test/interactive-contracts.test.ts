import { describe, expect, test } from "bun:test";
import {
  MergeConflictError,
  createPortableLearnerEnvelope,
  mergePortableLearnerData,
  validateAgentStream,
  validateAgentStreamEvent,
  validateCapabilityManifest,
  validateLearnerSession,
  validateToolCall,
  validateToolResult,
  validateUiAction,
  validateUiActionAgainstDocument,
  validateUiActionCorrelation,
  validateUiActionJournal,
  validateUiActionResult,
  validateUiDocument,
  validateWorkspaceRuntimeCapability,
  workspaceCanMutate,
  receiptForUiAction,
  UiActionReplayConflictError,
} from "../src/index.js";
import {
  capabilityManifestFixture,
  portableLearnerFixture,
  streamFixture,
  uiActionFixture,
  uiActionJournalFixture,
  uiActionResultFixture,
  uiDocumentFixture,
} from "./fixtures.js";

describe("interactive learner contracts", () => {
  test("validates versioned UI documents, actions, results, and their correlation", () => {
    const document = uiDocumentFixture();
    const action = uiActionFixture();
    const result = uiActionResultFixture();
    expect(validateUiDocument(document)).toBe(true);
    expect(validateUiAction(action)).toBe(true);
    expect(validateUiActionResult(result)).toBe(true);
    expect(validateUiActionCorrelation(action, result, document)).toBe(true);
    expect(validateUiActionCorrelation(action, { ...result, sourceRevision: 3 }, document)).toBe(false);
  });

  test("keeps supported learner interactions self-contained and validates their semantic targets", () => {
    const document = uiDocumentFixture();
    document.nodes = [
      document.nodes[0]!,
      { type: "question", id: "choice-node", prompt: "Choose the posterior.", choices: [{ id: "option-posterior", label: "posterior" }] },
      { type: "question", id: "matching-node", kind: "matching", prompt: "Match the terms.", items: ["prior", "posterior"], choices: [{ id: "before", label: "Before evidence" }, { id: "after", label: "After evidence" }], uniqueMatches: true },
      { type: "quiz", id: "quiz-node", title: "Bayes quiz", questions: [{ id: "quiz-question", prompt: "What is updated?", choices: [{ id: "quiz-option", label: "Prior" }] }] },
      { type: "goal", id: "goal-node", title: "Learn Bayes", status: "active", steps: [{ id: "goal-step", title: "Explain the prior", status: "in_progress" }] },
      { type: "deck", id: "deck-node", title: "Bayes cards", topic: "Bayes", cards: [{ id: "deck-card", front: "Prior?", back: "Belief before evidence." }] },
      { type: "study-plan", id: "plan-node", title: "Bayes plan", items: [{ id: "plan-item", title: "Explain the model", status: "not_started" }] },
      { type: "notes", id: "notes-node", title: "Learner notes", value: "My current model" },
      { type: "artifact", id: "artifact-node", resource: { id: "artifact-1", title: "Bayes notes", format: "markdown", content: "# Bayes" } },
      { type: "media", id: "media-node", kind: "animation", resource: { id: "media-1", title: "Bayes animation", format: "uri", uri: "https://keating.help/bayes.mp4", mimeType: "video/mp4" } },
      { type: "handoff", id: "handoff-node", target: "web", reason: "Open the interactive graph.", context: "document-1" },
    ];
    expect(validateUiDocument(document)).toBe(true);

    const base = { schemaVersion: 1 as const, documentId: document.id, documentRevision: document.revision, idempotencyKey: "action-1" };
    const actions = [
      { ...base, type: "choose-option" as const, nodeId: "choice-node", optionIds: ["option-posterior"] },
      { ...base, type: "submit-answer" as const, nodeId: "matching-node", answer: [{ item: "prior", optionId: "before" }, { item: "posterior", optionId: "after" }] },
      { ...base, type: "choose-option" as const, nodeId: "quiz-question", optionIds: ["quiz-option"] },
      { ...base, type: "complete-goal-step" as const, nodeId: "goal-node", stepId: "goal-step" },
      { ...base, type: "complete-plan-item" as const, nodeId: "plan-node", itemId: "plan-item", completed: true },
      { ...base, type: "update-notes" as const, nodeId: "notes-node", value: "Evidence updates the prior." },
      { ...base, type: "rate-card" as const, nodeId: "deck-node", cardId: "deck-card", rating: 3 },
      { ...base, type: "save-artifact" as const, nodeId: "artifact-node" },
      { ...base, type: "open-handoff" as const, nodeId: "handoff-node" },
    ];
    for (const action of actions) expect(validateUiActionAgainstDocument(action, document)).toBe(true);
    expect(validateUiActionAgainstDocument(uiActionFixture(), document)).toBe(true);

    expect(validateUiActionAgainstDocument({ ...actions[0]!, optionIds: ["unknown"] }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...actions[1]!, answer: [{ item: "prior", optionId: "before" }, { item: "posterior", optionId: "before" }] }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...actions[3]!, stepId: "unknown" }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...actions[4]!, itemId: "unknown" }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...actions[6]!, cardId: "unknown" }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...actions[7]!, nodeId: "goal-node" }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...actions[8]!, nodeId: "media-node" }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...uiActionFixture(), answer: ["posterior"] }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...uiActionFixture(), nodeId: "choice-node" }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...uiActionFixture(), documentRevision: 1 }, document)).toBe(false);

    const completedGoal = structuredClone(document);
    (completedGoal.nodes.find((node) => node.type === "goal") as Extract<(typeof completedGoal.nodes)[number], { type: "goal" }>).steps[0]!.status = "done";
    expect(validateUiActionAgainstDocument(actions[3]!, completedGoal)).toBe(false);

    const cyclicPlan = structuredClone(document) as any;
    cyclicPlan.nodes.find((node: any) => node.id === "plan-node").items = [
      { id: "plan-a", title: "A", dependsOn: ["plan-b"] },
      { id: "plan-b", title: "B", dependsOn: ["plan-a"] },
    ];
    expect(validateUiDocument(cyclicPlan)).toBe(false);

    const collidingQuestion = structuredClone(document);
    collidingQuestion.nodes.push({ type: "quiz", id: "quiz-collision", title: "Collision", questions: [{ id: "choice-node", prompt: "Duplicate identifier" }] });
    expect(validateUiDocument(collidingQuestion)).toBe(false);
  });

  test("preserves grouped form, quiz-result, and deck-review completion semantics", () => {
    const document = uiDocumentFixture();
    document.nodes = [
      {
        type: "question-group",
        id: "diagnostic-form",
        title: "Bayes diagnostic",
        intro: "Answer each prompt before submitting the diagnostic.",
        topic: "Bayes",
        questions: [
          { id: "form-text", kind: "text", prompt: "Explain a prior." },
          { id: "form-choice", kind: "choice", prompt: "Pick evidence.", allowText: true, choices: [{ id: "evidence", label: "Observation" }] },
          { id: "form-blanks", kind: "blanks", prompt: "Fill both blanks.", blanks: [{ placeholder: "first" }, { placeholder: "second" }] },
          { id: "form-match", kind: "matching", prompt: "Match terms.", items: ["prior", "posterior"], choices: [{ id: "before", label: "Before" }, { id: "after", label: "After" }], uniqueMatches: true },
        ],
      },
      {
        type: "quiz",
        id: "bayes-quiz",
        title: "Bayes quiz",
        questions: [
          { id: "quiz-one", kind: "choice", prompt: "What changes?", choices: [{ id: "posterior", label: "Posterior" }] },
          { id: "quiz-two", kind: "text", prompt: "Why?" },
          { id: "quiz-three", kind: "text", prompt: "Optional extension." },
        ],
      },
      {
        type: "deck",
        id: "bayes-deck",
        title: "Bayes cards",
        topic: "Bayes",
        description: "Review the beliefs that change as evidence arrives.",
        cards: [
          { id: "card-prior", front: "Prior?", back: "Belief before evidence." },
          { id: "card-posterior", front: "Posterior?", back: "Belief after evidence." },
        ],
      },
    ];
    expect(validateUiDocument(document)).toBe(true);

    const base = { schemaVersion: 1 as const, documentId: document.id, documentRevision: document.revision, idempotencyKey: "group-completion" };
    const group = {
      ...base,
      type: "submit-question-group" as const,
      nodeId: "diagnostic-form",
      responses: [
        { questionId: "form-text", type: "text" as const, answer: "A belief before evidence." },
        { questionId: "form-choice", type: "choice" as const, optionIds: ["evidence"], text: "Observed data." },
        { questionId: "form-blanks", type: "blanks" as const, answers: ["prior", "posterior"] },
        { questionId: "form-match", type: "rows" as const, rows: [{ item: "prior", optionId: "before" }, { item: "posterior", optionId: "after" }] },
      ],
    };
    expect(validateUiActionAgainstDocument(group, document)).toBe(true);
    expect(validateUiActionAgainstDocument({ ...group, responses: [...group.responses].reverse() }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...group, responses: [{ ...group.responses[0]! }, { ...group.responses[1]!, optionIds: ["unknown"] }, ...group.responses.slice(2)] }, document)).toBe(false);

    const quiz = {
      ...base,
      type: "complete-quiz" as const,
      nodeId: "bayes-quiz",
      resultId: "quiz-result-1",
      answers: [{ questionId: "quiz-one", answer: "posterior" }, { questionId: "quiz-two", answer: "Evidence changes the posterior." }],
      score: 1,
      partialCreditPoints: 1.5,
      partialCredits: { "quiz-one": 1, "quiz-two": 0.5 },
      timing: { totalMs: 12_000, perQuestionMs: { "quiz-one": 4_000, "quiz-two": 8_000 } },
      flaggedQuestionIds: ["quiz-two"],
      pendingGradeQuestionIds: ["quiz-two"],
      skippedQuestionIds: ["quiz-three"],
    };
    expect(validateUiAction(quiz)).toBe(true);
    expect(validateUiActionAgainstDocument(quiz, document)).toBe(true);
    expect(validateUiActionAgainstDocument({ ...quiz, answers: [...quiz.answers].reverse() }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...quiz, timing: { ...quiz.timing, perQuestionMs: { unknown: 1 } } }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...quiz, score: 4 }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...quiz, skippedQuestionIds: ["quiz-one"] }, document)).toBe(false);

    const deck = {
      ...base,
      type: "complete-deck" as const,
      nodeId: "bayes-deck",
      ratings: [
        { cardId: "card-prior", rating: 2 as const, appliedIntervalDays: 6, easeAfter: 2.5 },
        { cardId: "card-posterior", rating: 0 as const, appliedIntervalDays: 1, easeAfter: 2.3 },
      ],
      summary: { reviewed: 2, lapses: 1 },
    };
    expect(validateUiActionAgainstDocument(deck, document)).toBe(true);
    expect(validateUiActionAgainstDocument({ ...deck, ratings: [...deck.ratings].reverse() }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...deck, summary: { reviewed: 1, lapses: 1 } }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...deck, ratings: [{ ...deck.ratings[0]!, cardId: "unknown" }] }, document)).toBe(false);
  });

  test("fails closed on unresolved resources, unstable options, stale completed snapshots, and recovery-shape errors", () => {
    const unresolved = uiDocumentFixture() as any;
    unresolved.nodes = [{ type: "quiz", id: "quiz-node", quizId: "quiz-1" }];
    expect(validateUiDocument(unresolved)).toBe(false);

    const unstableOptions = uiDocumentFixture() as any;
    unstableOptions.nodes[0].choices = ["posterior"];
    expect(validateUiDocument(unstableOptions)).toBe(false);

    const emptyOptions = uiDocumentFixture() as any;
    emptyOptions.nodes[0].choices = [];
    expect(validateUiDocument(emptyOptions)).toBe(false);

    const multiselectWithoutChoices = uiDocumentFixture() as any;
    multiselectWithoutChoices.nodes[0].multiSelect = true;
    expect(validateUiDocument(multiselectWithoutChoices)).toBe(false);

	const matchingWithLabelKeys = uiDocumentFixture() as any;
	matchingWithLabelKeys.nodes = [{
		type: "question",
		id: "matching-node",
		prompt: "Match each item",
		kind: "matching",
		items: ["A"],
		choices: [{ id: "option-one", label: "One" }],
		correctMatches: ["One"],
	}];
	expect(validateUiDocument(matchingWithLabelKeys)).toBe(false);
	matchingWithLabelKeys.nodes[0].correctMatches = ["option-one"];
	expect(validateUiDocument(matchingWithLabelKeys)).toBe(true);

    const unknownField = uiDocumentFixture() as any;
    unknownField.nodes[0].tracking = "not portable";
    expect(validateUiDocument(unknownField)).toBe(false);

    expect(validateUiAction({ ...uiActionFixture(), unbounded: true })).toBe(false);

    const result = uiActionResultFixture();
    expect(validateUiActionResult({ ...result, resultingDocument: { ...result.resultingDocument!, revision: 2 } })).toBe(false);
    expect(validateUiActionResult({ ...result, resultingDocument: { ...result.resultingDocument!, lifecycle: "ready" } })).toBe(false);
    expect(validateUiActionResult({ ...result, resultingDocument: undefined })).toBe(false);
    expect(validateUiActionResult({ ...result, status: "retryable", resultingDocument: undefined, retryAfterMs: undefined })).toBe(false);
    expect(validateUiActionResult({ ...result, status: "rejected", resultingDocument: result.resultingDocument })).toBe(false);
    expect(validateUiActionResult({ ...result, unbounded: true })).toBe(false);
  });

  test("journals receipts for deterministic replay and rejects idempotency-key collisions", () => {
    const journal = uiActionJournalFixture();
    const action = uiActionFixture();
    expect(validateUiActionJournal(journal)).toBe(true);
    expect(receiptForUiAction(journal, action)?.state).toBe("completed");
    expect(() => receiptForUiAction(journal, { ...action, answer: "different answer" })).toThrow(UiActionReplayConflictError);

    const duplicate = structuredClone(journal);
    duplicate.receipts.push({ ...duplicate.receipts[0]!, action: { ...action, answer: "different answer" }, actionFingerprint: "different" });
    expect(validateUiActionJournal(duplicate)).toBe(false);

    const malformed = structuredClone(journal);
    malformed.receipts[0]!.actionFingerprint = "not-canonical";
    expect(validateUiActionJournal(malformed)).toBe(false);
    expect(validateUiActionJournal({ ...journal, schemaVersion: 2 })).toBe(false);

    const unsafeUri = uiDocumentFixture() as any;
    unsafeUri.nodes = [{ type: "artifact", id: "artifact-node", resource: { id: "artifact-1", title: "Unsafe", format: "uri", uri: "file:///tmp/private" } }];
    expect(validateUiDocument(unsafeUri)).toBe(false);
    unsafeUri.nodes[0].resource.uri = "http://example.test/unsafe";
    expect(validateUiDocument(unsafeUri)).toBe(false);
    unsafeUri.nodes[0].resource.uri = "http://127.0.0.1:43123/asset";
    expect(validateUiDocument(unsafeUri)).toBe(true);
    unsafeUri.nodes[0].resource.uri = "http://localhost:43123/asset";
    expect(validateUiDocument(unsafeUri)).toBe(true);
    unsafeUri.nodes[0].resource.uri = "http://[::1]:43123/asset";
    expect(validateUiDocument(unsafeUri)).toBe(true);
    unsafeUri.nodes[0].resource.uri = "http://127.0.0.2:43123/asset";
    expect(validateUiDocument(unsafeUri)).toBe(false);
    for (const uri of [
      "https://user:password@keating.help/asset",
      "https://keating.help/asset?download=1",
      "https://keating.help/asset#section",
      "artifact:artifact-1?download=1",
      "artifact:artifact-1#section",
      "artifact://user:password@artifact-1",
      "artifact:/",
      "http://127.0.0.1:43123/asset?download=1",
      "http://localhost:43123/asset#section",
      "http://user:password@[::1]:43123/asset",
    ]) {
      unsafeUri.nodes[0].resource.uri = uri;
      expect(validateUiDocument(unsafeUri)).toBe(false);
    }
    unsafeUri.nodes[0].resource.uri = "https://keating.help/asset";
    expect(validateUiDocument(unsafeUri)).toBe(true);
    unsafeUri.nodes[0].resource.uri = "artifact:artifact-1";
    expect(validateUiDocument(unsafeUri)).toBe(true);
  });

  test("fully discriminates stream events and validates call/result ordering", () => {
    const stream = streamFixture();
    const toolResult = stream[3] as Extract<(typeof stream)[number], { type: "tool-result" }>;
    expect(stream.every(validateAgentStreamEvent)).toBe(true);
    expect(validateAgentStream(stream)).toBe(true);
    expect(validateAgentStream([{ ...toolResult, sequence: 0 }])).toBe(false);
    expect(validateAgentStream([{ ...toolResult, result: { ...toolResult.result, toolCallId: "unknown" } }])).toBe(false);
  });

  test("rejects duplicate tool calls and duplicate results by call id and idempotency key", () => {
    const stream = streamFixture();
    const text = stream[1]!;
    const call = stream[2] as Extract<(typeof stream)[number], { type: "tool-call" }>;
    const result = stream[3] as Extract<(typeof stream)[number], { type: "tool-result" }>;
    const completed = stream[5]!;

    expect(validateAgentStream([
      text,
      call,
      { ...call, id: "event-duplicate-call-id", sequence: 2 },
      { ...result, id: "event-result-after-duplicate-call", sequence: 3 },
      { ...completed, sequence: 4 },
    ])).toBe(false);
    expect(validateAgentStream([
      text,
      call,
      {
        ...call,
        id: "event-duplicate-call-key",
        sequence: 2,
        call: { ...call.call, id: "call-2" },
      },
      { ...result, id: "event-result-after-duplicate-key", sequence: 3 },
      { ...completed, sequence: 4 },
    ])).toBe(false);
    expect(validateAgentStream([
      text,
      call,
      result,
      { ...result, id: "event-duplicate-result", sequence: 3 },
      { ...completed, sequence: 4 },
    ])).toBe(false);
  });

  test("requires a recovery path for unavailable capabilities", () => {
    expect(validateCapabilityManifest(capabilityManifestFixture())).toBe(true);
    expect(validateCapabilityManifest({ schemaVersion: 1, generatedAt: "2026-08-10T00:00:00.000Z", entries: [{ id: "courses", available: false, surface: "mobile" }] })).toBe(false);

    const missingCapability = capabilityManifestFixture();
    missingCapability.entries.pop();
    expect(validateCapabilityManifest(missingCapability)).toBe(false);

    const unknownCapabilityField = capabilityManifestFixture() as any;
    unknownCapabilityField.entries[0].authorization = "not portable";
    expect(validateCapabilityManifest(unknownCapabilityField)).toBe(false);

    const availableWithRecovery = capabilityManifestFixture();
    availableWithRecovery.entries[0]!.recovery = "retry";
    expect(validateCapabilityManifest(availableWithRecovery)).toBe(false);
  });

  test("exposes workspace operations only from a truthful runtime capability", () => {
    const unavailable = {
      schemaVersion: 1 as const,
      generatedAt: "2026-08-10T00:00:00.000Z",
      surface: "mobile" as const,
      state: "unconfigured" as const,
      operations: [],
      recovery: { kind: "handoff" as const, reason: "No authenticated remote workspace is connected.", target: "web" as const },
    };
    expect(validateWorkspaceRuntimeCapability(unavailable)).toBe(true);
    expect(workspaceCanMutate(unavailable)).toBe(false);

    const inspectOnly = {
      ...unavailable,
      state: "ready" as const,
      operations: ["read"] as const,
      workspace: { id: "workspace-1", label: "Keating test workspace", revision: "revision-1" },
      recovery: undefined,
    };
    expect(validateWorkspaceRuntimeCapability(inspectOnly)).toBe(true);
    expect(workspaceCanMutate(inspectOnly)).toBe(false);

    const mutable = { ...inspectOnly, operations: ["read", "execute", "patch", "snapshot", "rollback"] as const };
    expect(validateWorkspaceRuntimeCapability(mutable)).toBe(true);
    expect(workspaceCanMutate(mutable)).toBe(true);

    expect(validateWorkspaceRuntimeCapability({ ...unavailable, operations: ["patch"] })).toBe(false);
    expect(validateWorkspaceRuntimeCapability({ ...inspectOnly, operations: ["read", "read"] })).toBe(false);
    expect(validateWorkspaceRuntimeCapability({ ...inspectOnly, recovery: unavailable.recovery })).toBe(false);
    expect(validateWorkspaceRuntimeCapability({ ...mutable, operations: ["read", "execute", "patch", "rollback"] })).toBe(true);
    expect(workspaceCanMutate({ ...mutable, operations: ["read", "execute", "patch", "rollback"] })).toBe(false);
    expect(validateWorkspaceRuntimeCapability({ ...unavailable, recovery: { ...unavailable.recovery, target: "mobile" } })).toBe(false);
    expect(validateWorkspaceRuntimeCapability({ ...mutable, authorization: "Bearer hidden" })).toBe(false);
  });

  test("closes stream events and keeps tool metadata JSON-safe and bounded", () => {
    const event = streamFixture()[1]!;
    expect(validateAgentStreamEvent({ ...event, authorization: "Bearer hidden" })).toBe(false);
    expect(validateToolCall({ id: "call-1", name: "quiz", arguments: { token: "not portable" }, idempotencyKey: "call-key-1" })).toBe(false);
    expect(validateToolCall({ id: "call-1", name: "quiz", arguments: { count: 1n }, idempotencyKey: "call-key-1" })).toBe(false);
    expect(validateToolCall({ id: "call-1", name: "quiz", arguments: { topic: "Bayes" }, idempotencyKey: "call-key-1", extra: true })).toBe(false);
    expect(validateToolResult({ toolCallId: "call-1", idempotencyKey: "call-key-1", status: "success", text: "ok", extra: true })).toBe(false);
    expect(validateAgentStreamEvent({ ...streamFixture()[0]!, text: "x".repeat(65_537) })).toBe(false);
  });

  test("fails closed on credential-like prose, branch cycles, and broken lineage", () => {
    const secretText = portableLearnerFixture();
    secretText.artifacts[0]!.content = "Use sk-protectedvalue1234567890, never export it.";
    expect(() => createPortableLearnerEnvelope(secretText)).toThrow("credential-like");

    const branchCycle = portableLearnerFixture();
    branchCycle.sessions[1]!.branches[0]!.parentBranchId = "branch-alternative";
    expect(() => createPortableLearnerEnvelope(branchCycle)).toThrow("invalid shape");

    const lineage = portableLearnerFixture();
    lineage.sessions[1]!.forkedFromMessageId = "missing-message";
    expect(() => createPortableLearnerEnvelope(lineage)).toThrow("invalid shape");

    const orphanedParent = portableLearnerFixture();
    delete orphanedParent.sessions[1]!.forkedFromMessageId;
    expect(validateLearnerSession(orphanedParent.sessions[1])).toBe(true);
    expect(() => createPortableLearnerEnvelope(orphanedParent)).not.toThrow();

    const orphanedForkPoint = portableLearnerFixture();
    delete orphanedForkPoint.sessions[1]!.parentSessionId;
    expect(validateLearnerSession(orphanedForkPoint.sessions[1])).toBe(false);
    expect(() => createPortableLearnerEnvelope(orphanedForkPoint)).toThrow("invalid shape");

    const backwardSession = portableLearnerFixture();
    backwardSession.sessions[0]!.updatedAt = "2026-08-07T00:00:00.000Z";
    expect(() => createPortableLearnerEnvelope(backwardSession)).toThrow("invalid shape");
  });

  test("fails closed on concurrent conflict and deterministically unions profile evidence", () => {
    const left = portableLearnerFixture();
    left.learnerProfile = { topicsExplored: ["Bayes"], strengths: ["calculus"], weaknesses: ["algebra"], sessionsCount: 1, lastSessionAt: "2026-08-10T00:00:00.000Z" };
    const right = portableLearnerFixture();
    right.learnerProfile = { topicsExplored: ["Logic"], strengths: ["proof"], weaknesses: ["algebra"], sessionsCount: 2, lastSessionAt: "2026-08-11T00:00:00.000Z" };
    const merged = mergePortableLearnerData(left, right);
    expect(merged.learnerProfile).toEqual({ topicsExplored: ["Bayes", "Logic"], strengths: ["calculus", "proof"], weaknesses: ["algebra"], sessionsCount: 2, lastSessionAt: "2026-08-11T00:00:00.000Z" });

    const conflicting = portableLearnerFixture();
    conflicting.artifacts[0]!.title = "Different title at same revision";
    expect(() => mergePortableLearnerData(portableLearnerFixture(), conflicting)).toThrow(MergeConflictError);
  });

  test("orders mixed-precision timestamps chronologically rather than lexicographically", () => {
    const document = uiDocumentFixture();
    document.createdAt = "2026-08-10T00:00:00Z";
    document.updatedAt = "2026-08-10T00:00:00.500Z";
    expect(validateUiDocument(document)).toBe(true);

    const left = portableLearnerFixture();
    const right = portableLearnerFixture();
    left.generatedAt = "2026-08-10T00:00:00Z";
    right.generatedAt = "2026-08-10T00:00:00.500Z";
    left.artifacts[0]!.updatedAt = "2026-08-10T00:00:00Z";
    right.artifacts[0]!.updatedAt = "2026-08-10T00:00:00.500Z";
    right.artifacts[0]!.title = "Newer mixed-precision artifact";
    left.learnerProfile.lastSessionAt = "2026-08-10T00:00:00Z";
    right.learnerProfile.lastSessionAt = "2026-08-10T00:00:00.500Z";
    const merged = mergePortableLearnerData(left, right);
    expect(merged.generatedAt).toBe("2026-08-10T00:00:00.500Z");
    expect(merged.artifacts[0]!.title).toBe("Newer mixed-precision artifact");
    expect(merged.learnerProfile.lastSessionAt).toBe("2026-08-10T00:00:00.500Z");
  });
});
