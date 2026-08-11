import { describe, expect, test } from "bun:test";
import {
  ContractValidationError,
  createPortableLearnerEnvelope,
  isContractTimestamp,
  mergeDatedRecords,
  mergePortableLearnerData,
  parsePortableLearnerEnvelope,
  type PortableLearnerData,
} from "../src/index.js";
import { portableLearnerFixture } from "./fixtures.js";

describe("portable learner contracts", () => {
  test("round-trips a versioned, secret-free fixture deterministically", () => {
    const envelope = createPortableLearnerEnvelope(portableLearnerFixture());
    const parsed = parsePortableLearnerEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(envelope.schemaVersion).toBe(3);
    expect(parsed).toEqual(envelope);
    expect(parsed.payload.sessions[1]?.parentSessionId).toBe("session-source");
    expect(parsed.payload.sessions[0]?.messages[0]?.attachments?.[0]?.name).toBe("bayes-tree.png");
    expect(parsed.payload.artifacts[0]?.attachment?.mimeType).toBe("image/png");
    expect(parsed.payload.quizResults[0]?.partialCreditPoints).toBe(1);
    expect(parsed.payload.quizResults[0]?.timing).toEqual({ totalMs: 12_000, perQuestionMs: { "q-1": 4_000, "q-2": 8_000 } });
    expect(parsed.payload.quizResults[0]?.flaggedQuestionIds).toEqual(["q-2"]);
    expect(parsed.payload.quizResults[0]?.pendingGradeQuestionIds).toEqual(["q-2"]);
    expect(parsed.payload.quizResults[0]?.skippedQuestionIds).toEqual(["q-2"]);
    expect(parsed.payload.decks[0]?.cards[0]?.id).toBe("card-1");
    expect(parsed.payload.cardReviews[0]?.rating).toBe(3);
    expect(parsed.payload.feedbackEvents[0]?.rating).toBe("helpful");
    expect(parsed.payload.usageEvents[0]?.providerReported.totalTokens).toBe(200);
    expect(parsed.payload.topicEvidence[0]?.reference).toEqual({ kind: "quiz-result", id: "quiz-result-1" });
    expect(parsed.payload.benchmarks[0]?.provenance).toBe("benchmark-run");
    expect(parsed.payload.evolutions[0]?.provenance).toBe("evolution-run");
  });

  test("fails closed on unsupported versions and secret-bearing fields", () => {
    const envelope = createPortableLearnerEnvelope(portableLearnerFixture());
    expect(() => parsePortableLearnerEnvelope({ ...envelope, schemaVersion: 4 })).toThrow(ContractValidationError);
    expect(() => createPortableLearnerEnvelope({ ...portableLearnerFixture(), apiKey: "not-exportable" } as unknown as PortableLearnerData))
      .toThrow("apiKey");
    expect(() => createPortableLearnerEnvelope({ ...portableLearnerFixture(), NOTORGANIC_ASSERTION_PRIVATE_KEY: "not-exportable" } as unknown as PortableLearnerData))
      .toThrow("NOTORGANIC_ASSERTION_PRIVATE_KEY");
    expect(() => createPortableLearnerEnvelope({ ...portableLearnerFixture(), workspaceFiles: [{ content: "private" }] } as unknown as PortableLearnerData))
      .toThrow("workspaceFiles");
  });

  test("rejects unknown and credential-bearing fields at the envelope and portable-data boundaries", () => {
    const envelope = createPortableLearnerEnvelope(portableLearnerFixture());
    const credentialFields = ["apiKey", "sessionToken", "clientSecret", "password", "cookie"] as const;

    for (const field of credentialFields) {
      expect(() => parsePortableLearnerEnvelope({ ...envelope, [field]: "not-exportable" }))
        .toThrow(ContractValidationError);
      expect(() => parsePortableLearnerEnvelope({
        ...envelope,
        payload: { ...envelope.payload, [field]: "not-exportable" },
      })).toThrow(ContractValidationError);
      expect(() => createPortableLearnerEnvelope({
        ...portableLearnerFixture(),
        [field]: "not-exportable",
      } as unknown as PortableLearnerData)).toThrow(ContractValidationError);
    }

    const unknownSessionField = portableLearnerFixture();
    (unknownSessionField.sessions[0] as unknown as Record<string, unknown>).presentationHint = "not portable";
    expect(() => createPortableLearnerEnvelope(unknownSessionField)).toThrow("invalid shape");

    const nestedSecret = portableLearnerFixture();
    (nestedSecret.artifacts[0]!.attachment as Record<string, unknown>).authorization = "Bearer not-exportable";
    expect(() => createPortableLearnerEnvelope(nestedSecret)).toThrow("authorization");
  });

  test("deduplicates deterministically and keeps the newest record", () => {
    const merged = mergeDatedRecords(
      [{ id: "a", updatedAt: "2026-08-09T00:00:00.000Z", value: "old" }],
      [{ id: "a", updatedAt: "2026-08-10T00:00:00.000Z", value: "new" }, { id: "b", updatedAt: "2026-08-10T00:00:00.000Z" }],
    );
    expect(merged).toEqual([
      { id: "a", updatedAt: "2026-08-10T00:00:00.000Z", value: "new" },
      { id: "b", updatedAt: "2026-08-10T00:00:00.000Z" },
    ]);
  });

  test("treats equivalent timestamp precision as the same record instant", () => {
    const merged = mergeDatedRecords(
      [{ id: "same-instant", createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z", value: "same" }],
      [{ id: "same-instant", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z", value: "same" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.value).toBe("same");
  });

  test("rejects calendar-normalized timestamp dates", () => {
    expect(isContractTimestamp("2026-02-28T00:00:00Z")).toBe(true);
    expect(isContractTimestamp("2026-02-30T00:00:00Z")).toBe(false);
  });

  test("fails closed on malformed nested records and active branch references", () => {
    const invalidBranch = portableLearnerFixture();
    invalidBranch.sessions[1]!.activeBranchId = "missing";
    expect(() => createPortableLearnerEnvelope(invalidBranch)).toThrow("invalid shape");

    const invalidMessage = portableLearnerFixture();
    invalidMessage.sessions[1]!.messages[0]!.role = "invalid" as never;
    expect(() => createPortableLearnerEnvelope(invalidMessage)).toThrow("invalid shape");

    const localAttachment = portableLearnerFixture();
    localAttachment.sessions[0]!.messages[0]!.attachments![0]!.name = "file:///private/bayes-tree.png";
    expect(() => createPortableLearnerEnvelope(localAttachment)).toThrow("invalid shape");

    const attachmentWithBytes = portableLearnerFixture();
    (attachmentWithBytes.sessions[0]!.messages[0]!.attachments![0] as unknown as Record<string, unknown>).uri = "file:///private/bayes-tree.png";
    expect(() => createPortableLearnerEnvelope(attachmentWithBytes)).toThrow("invalid shape");

    const nonUserAttachment = portableLearnerFixture();
    nonUserAttachment.sessions[0]!.messages[0]!.role = "assistant";
    expect(() => createPortableLearnerEnvelope(nonUserAttachment)).toThrow("invalid shape");

    const duplicateAttachment = portableLearnerFixture();
    duplicateAttachment.sessions[0]!.messages[0]!.attachments!.push({
      id: "attachment-source", kind: "document", name: "bayes.pdf", mimeType: "application/pdf", sizeBytes: 512,
    });
    expect(() => createPortableLearnerEnvelope(duplicateAttachment)).toThrow("invalid shape");

    const oversizedAttachments = portableLearnerFixture();
    oversizedAttachments.sessions[0]!.messages[0]!.attachments = [
      { id: "attachment-1", kind: "image", name: "one.png", mimeType: "image/png", sizeBytes: 8 * 1024 * 1024 },
      { id: "attachment-2", kind: "image", name: "two.png", mimeType: "image/png", sizeBytes: 8 * 1024 * 1024 },
      { id: "attachment-3", kind: "document", name: "three.pdf", mimeType: "application/pdf", sizeBytes: 1 },
    ];
    expect(() => createPortableLearnerEnvelope(oversizedAttachments)).toThrow("invalid shape");

    const invalidAttachment = portableLearnerFixture();
    invalidAttachment.artifacts[0]!.attachment!.sizeBytes = -1;
    expect(() => createPortableLearnerEnvelope(invalidAttachment)).toThrow("invalid shape");

    const invalidQuiz = portableLearnerFixture();
    invalidQuiz.quizResults[0]!.score = 3;
    expect(() => createPortableLearnerEnvelope(invalidQuiz)).toThrow("invalid shape");

    const invalidReview = portableLearnerFixture();
    invalidReview.cardReviews[0]!.rating = 4 as never;
    expect(() => createPortableLearnerEnvelope(invalidReview)).toThrow("invalid shape");

    const danglingFeedbackMessage = portableLearnerFixture();
    danglingFeedbackMessage.feedbackEvents[0]!.messageId = "missing-message";
    expect(() => createPortableLearnerEnvelope(danglingFeedbackMessage)).toThrow("invalid shape");

    const danglingFeedbackSession = portableLearnerFixture();
    danglingFeedbackSession.feedbackEvents[0]!.sessionId = "missing-session";
    expect(() => createPortableLearnerEnvelope(danglingFeedbackSession)).toThrow("invalid shape");

    const invalidFeedbackRating = portableLearnerFixture();
    invalidFeedbackRating.feedbackEvents[0]!.rating = "unknown" as never;
    expect(() => createPortableLearnerEnvelope(invalidFeedbackRating)).toThrow("invalid shape");

    const credentialUrl = portableLearnerFixture();
    credentialUrl.artifacts[0]!.attachment!.remoteUrl = "https://user:password@keating.help/artifact";
    expect(() => createPortableLearnerEnvelope(credentialUrl)).toThrow("invalid shape");

    for (const suffix of ["?access_token=hidden", "?X-Amz-Signature=hidden", "?download=1", "#section"]) {
      const nonBareUrl = portableLearnerFixture();
      nonBareUrl.artifacts[0]!.attachment!.remoteUrl = `https://keating.help/artifact${suffix}`;
      expect(() => createPortableLearnerEnvelope(nonBareUrl)).toThrow("invalid shape");
    }

    const encodedSignedUrl = portableLearnerFixture();
    encodedSignedUrl.artifacts[0]!.attachment!.remoteUrl = "https://keating.help/artifact?%74oken=hidden";
    expect(() => createPortableLearnerEnvelope(encodedSignedUrl)).toThrow("invalid shape");

    const insecureUrl = portableLearnerFixture();
    insecureUrl.artifacts[0]!.attachment!.remoteUrl = "http://127.0.0.1/artifact";
    expect(() => createPortableLearnerEnvelope(insecureUrl)).toThrow("invalid shape");

  });

  test("fails closed on malformed portable quiz-completion metadata", () => {
    const unknownQuizField = portableLearnerFixture();
    (unknownQuizField.quizResults[0] as unknown as Record<string, unknown>).graderHint = "not portable";
    expect(() => createPortableLearnerEnvelope(unknownQuizField)).toThrow("invalid shape");

    const invalidPartialCreditPoints = portableLearnerFixture();
    invalidPartialCreditPoints.quizResults[0]!.partialCreditPoints = -0.5;
    expect(() => createPortableLearnerEnvelope(invalidPartialCreditPoints)).toThrow("invalid shape");

    const invalidTiming = portableLearnerFixture();
    invalidTiming.quizResults[0]!.timing!.totalMs = -1;
    expect(() => createPortableLearnerEnvelope(invalidTiming)).toThrow("invalid shape");

    const invalidPerQuestionTiming = portableLearnerFixture();
    invalidPerQuestionTiming.quizResults[0]!.timing!.perQuestionMs["q-1"] = Number.MAX_SAFE_INTEGER + 1;
    expect(() => createPortableLearnerEnvelope(invalidPerQuestionTiming)).toThrow("invalid shape");

    const unknownTimingField = portableLearnerFixture();
    (unknownTimingField.quizResults[0]!.timing as unknown as Record<string, unknown>).clock = "monotonic";
    expect(() => createPortableLearnerEnvelope(unknownTimingField)).toThrow("invalid shape");

    const duplicateFlag = portableLearnerFixture();
    duplicateFlag.quizResults[0]!.flaggedQuestionIds = ["q-2", "q-2"];
    expect(() => createPortableLearnerEnvelope(duplicateFlag)).toThrow("invalid shape");

    const invalidSkippedQuestion = portableLearnerFixture();
    invalidSkippedQuestion.quizResults[0]!.skippedQuestionIds = ["not a question id"];
    expect(() => createPortableLearnerEnvelope(invalidSkippedQuestion)).toThrow("invalid shape");
  });

  test("keeps provider accounting exact and topic evidence referential", () => {
    const missingCost = portableLearnerFixture();
    delete missingCost.usageEvents[0]!.providerReported.costUsd;
    expect(createPortableLearnerEnvelope(missingCost).payload.usageEvents).toHaveLength(1);

    const inconsistentTotals = portableLearnerFixture();
    inconsistentTotals.usageEvents[0]!.providerReported.totalTokens = 199;
    expect(() => createPortableLearnerEnvelope(inconsistentTotals)).toThrow("invalid shape");

    const emptyProviderReport = portableLearnerFixture();
    emptyProviderReport.usageEvents[0]!.providerReported = {};
    expect(() => createPortableLearnerEnvelope(emptyProviderReport)).toThrow("invalid shape");

    const danglingUsageSession = portableLearnerFixture();
    danglingUsageSession.usageEvents[0]!.sessionId = "missing-session";
    expect(() => createPortableLearnerEnvelope(danglingUsageSession)).toThrow("invalid shape");

    const mismatchedAssessmentTopic = portableLearnerFixture();
    mismatchedAssessmentTopic.topicEvidence[0]!.topic = "Probability";
    expect(() => createPortableLearnerEnvelope(mismatchedAssessmentTopic)).toThrow("invalid shape");

    const danglingEvidenceReference = portableLearnerFixture();
    danglingEvidenceReference.topicEvidence[0]!.reference!.id = "missing-quiz";
    expect(() => createPortableLearnerEnvelope(danglingEvidenceReference)).toThrow("invalid shape");

    const wrongProvenanceReference = portableLearnerFixture();
    wrongProvenanceReference.topicEvidence[0]!.reference = { kind: "session", id: "session-1" };
    expect(() => createPortableLearnerEnvelope(wrongProvenanceReference)).toThrow("invalid shape");

    const unlinkedActivity = portableLearnerFixture();
    unlinkedActivity.topicEvidence[0]!.reference = undefined;
    expect(() => createPortableLearnerEnvelope(unlinkedActivity)).toThrow("invalid shape");

    const mismatchedReviewTopic = portableLearnerFixture();
    mismatchedReviewTopic.topicEvidence.push({
      id: "evidence-review-mismatch", topic: "Probability", createdAt: "2026-08-10T00:00:00.000Z", provenance: "review",
      reference: { kind: "card-review", id: "review-1" },
    });
    expect(() => createPortableLearnerEnvelope(mismatchedReviewTopic)).toThrow("invalid shape");
  });

  test("merges portable records without mutating either input", () => {
    const left = portableLearnerFixture();
    const right = portableLearnerFixture();
    right.artifacts[0]!.title = "Updated Bayes plan";
    right.artifacts[0]!.updatedAt = "2026-08-11T00:00:00.000Z";
    const merged = mergePortableLearnerData(left, right);
    expect(merged.artifacts).toHaveLength(1);
    expect(merged.artifacts[0]!.title).toBe("Updated Bayes plan");
    expect(left.artifacts[0]!.title).toBe("Bayes plan");
  });

  test("merges usage and topic evidence deterministically", () => {
    const left = portableLearnerFixture();
    const right = portableLearnerFixture();
    right.usageEvents[0]!.providerReported = { totalTokens: 250, costUsd: 0.01 };
    right.usageEvents[0]!.createdAt = "2026-08-11T00:00:00.000Z";
    right.topicEvidence.push({
      id: "evidence-3", topic: "Bayes", createdAt: "2026-08-11T00:00:00.000Z", provenance: "review",
      reference: { kind: "card-review", id: "review-1" },
    });
    const merged = mergePortableLearnerData(left, right);
    expect(merged.usageEvents[0]!.providerReported).toEqual({ totalTokens: 250, costUsd: 0.01 });
    expect(merged.topicEvidence.map((entry) => entry.id)).toEqual(["evidence-1", "evidence-2", "evidence-3"]);
    expect(left.usageEvents[0]!.providerReported.totalTokens).toBe(200);
  });

  test("merges explicit feedback without treating it as learner competency", () => {
    const left = portableLearnerFixture();
    const right = portableLearnerFixture();
    right.feedbackEvents.push({
      id: "feedback-2", sessionId: "session-1", messageId: "message-1", rating: "missed", createdAt: "2026-08-11T00:00:00.000Z",
    });
    const merged = mergePortableLearnerData(left, right);
    expect(merged.feedbackEvents.map((event) => event.rating)).toEqual(["helpful", "missed"]);
    expect(merged.learnerProfile.strengths).toEqual([]);
    expect(merged.learnerProfile.weaknesses).toEqual([]);
  });
});
