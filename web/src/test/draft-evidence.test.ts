import { describe, expect, test } from "bun:test";
import { DRAFT_EVIDENCE_ANSWER_CHARS, DRAFT_EVIDENCE_RECENT, teachingDraftEvidence } from "../keating/judgement/draft-evidence";
import type { CompleteLearnerStartupContext } from "../keating/session-start-hooks";
import type { QuestionCheckRecord } from "../keating/storage";

const check = (index: number, extra: Partial<QuestionCheckRecord> = {}): QuestionCheckRecord => ({
  id: `c${index}`, topic: "fractions", question: `Question ${index}`, answer: `Answer ${index}`, grading: "auto", score: 1, createdAt: index, ...extra,
});

const context = (questionChecks: QuestionCheckRecord[]) => ({
  schemaVersion: 1,
  learnerState: {},
  goals: [],
  evidence: { quizResults: [], questionChecks, cardReviews: [] },
  flashcards: { decks: [] },
  coverageGaps: {},
}) as unknown as CompleteLearnerStartupContext;

const content = (evidence: ReturnType<typeof teachingDraftEvidence>, kind: string) =>
  evidence.learnerEvidence!.find(entry => entry.kind === kind)!.content;

describe("teaching draft evidence", () => {
  test("keeps the newest records, says how many were omitted and clips long answers", () => {
    const checks = Array.from({ length: 25 }, (_, index) => check(index));
    checks[24] = check(24, { answer: "a".repeat(5_000) });
    const parsed = JSON.parse(content(teachingDraftEvidence(context(checks)), "submitted comprehension records"));
    expect(parsed.newest).toHaveLength(DRAFT_EVIDENCE_RECENT);
    expect(parsed.newest[0].id).toBe("c24");
    expect(parsed.newest[0].answer).toHaveLength(DRAFT_EVIDENCE_ANSWER_CHARS);
    expect(parsed.olderRecordsOmitted).toBe(15);
  });

  test("small histories stay a plain list", () => {
    expect(JSON.parse(content(teachingDraftEvidence(context([check(1)])), "submitted comprehension records"))).toEqual([check(1)]);
  });

  test("pending submissions are never capped", () => {
    const checks = Array.from({ length: 25 }, (_, index) => check(index, { grading: "pending", score: undefined }));
    expect(teachingDraftEvidence(context(checks)).pendingSubmissions).toHaveLength(25);
  });
});
