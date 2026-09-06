import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type UiActionReceipt,
} from "@keating/learner-contracts";
import { SharedUiDocumentRenderer } from "../../keating/openui/shared-renderer";
import { ExamRenderer } from "../ExamRenderer";
import { EXAM_FIXTURE_DOCUMENT as document, EXAM_FIXTURE_NODE as node } from "./fixtures";


describe("source Exam rendering", () => {
  it("uses the separate exam start surface without revealing questions or grading", () => {
    const html = renderToStaticMarkup(
      <SharedUiDocumentRenderer document={document} />,
    );
    expect(html).toContain('data-exam="exam-caches"');
    expect(html).toContain("Start exam");
    expect(html).toContain("30 minutes");
    expect(html).not.toContain("When the source changes frequently.");
    expect(html).not.toContain("A shorter TTL narrows");
  });
  it("restores exact saved timing and leaves free responses pending for the teacher", () => {
    const receipt: UiActionReceipt = {
      schemaVersion: 1,
      state: "completed",
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      actionFingerprint: "exam-result",
      action: {
        schemaVersion: 1,
        type: "complete-quiz",
        documentId: document.id,
        documentRevision: 0,
        nodeId: node.id,
        resultId: "exam-result",
        idempotencyKey: "exam-result",
        answers: [{ questionId: "exam-explain", answer: "A live departure board" }],
        score: 0,
        partialCreditPoints: 0,
        partialCredits: {},
        timing: { totalMs: 12_179, perQuestionMs: { "exam-explain": 4_238 } },
        skippedQuestionIds: node.questions.filter((question) => question.id !== "exam-explain").map((question) => question.id),
        flaggedQuestionIds: [],
        pendingGradeQuestionIds: ["exam-explain"],
        examTimedOut: false,
      },
    };
    const html = renderToStaticMarkup(
      <SharedUiDocumentRenderer document={document} receipts={[receipt]} />,
    );
    expect(html).toContain("12.179s");
    expect(html).toContain("4.238s");
    expect(html).toContain("1 awaiting grading");
    expect(html).not.toContain("Start exam");
  });
  it("refuses an undersized direct-rendered exam before it can start", () => {
    const html = renderToStaticMarkup(<ExamRenderer node={{ ...node, questions: node.questions.slice(0, 19) }} disabled={false} />);
    expect(html).toContain("Exams require at least 20 questions");
    expect(html).toContain("This exam has 19");
    expect(html).not.toContain("Start exam");
  });

});
