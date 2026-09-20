import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionJudgementReviewView } from "../components/QuestionJudgementReview";
import { questionCheckIdsForUiAction, type QuestionCheckRecord } from "../keating/storage";

const check: QuestionCheckRecord = {
  id: "saved", question: "Why is it atomic?", answer: "It commits all changes together.", topic: "Databases",
  grading: "pending", createdAt: 1,
  judgement: { evidenceKind: "model-estimate", final: { id: "saved", verdict: "pending", credit: null,
    grading: "pending", tier: "deterministic", source: "proxy", evidenceQuote: null, rubricSource: "authored", attempts: [] },
    proposal: { verdict: "correct", credit: 1, evidenceQuote: "It commits all changes together.",
      backend: { backend: "system-one", model: "synthetic-judge-version", calibrationSha256: null },
      score: { type: "score", score: 1, legend: { "0": "incorrect", "1": "correct" }, probabilities: { "0": 0.1, "1": 0.9 }, confidence: 0.9 } } },
};

test("review estimate is visible beside pending final grade, exact evidence, and concrete model", () => {
  const html = renderToStaticMarkup(<QuestionJudgementReviewView checks={[check]} />);
  expect(html).toContain("Review estimate");
  expect(html).toContain("Final grade pending.");
  expect(html).toContain("suggests the answer is correct");
  expect(html).toContain("has not been validated for automatic grading");
  expect(html).toContain("From your answer");
  expect(html).toContain("Reviewed by synthetic-judge-version");
  expect(html).not.toContain("90%");
  expect(html).not.toContain("100%");
  expect(html).not.toContain("calibrationSha256");
});

test("forged evidence is not displayed and a teacher grade is distinct from a prior estimate", () => {
  const modified: QuestionCheckRecord = { ...check, grading: "model", score: 0.5,
    judgement: { ...check.judgement!, proposal: { ...check.judgement!.proposal!, evidenceQuote: "invented evidence" } } };
  const html = renderToStaticMarkup(<QuestionJudgementReviewView checks={[modified]} />);
  expect(html).toContain("Recorded grade: 50%");
  expect(html).not.toContain("Final grade pending");
  expect(html).not.toContain("invented evidence");
});

test("unavailable review stays pending, with no incorrect verdict invented", () => {
  const unavailable = { ...check, judgement: { ...check.judgement!, proposal: null, evidenceKind: "unavailable" as const } };
  const html = renderToStaticMarkup(<QuestionJudgementReviewView checks={[unavailable]} />);
  expect(html).toContain("A model review was unavailable. Your answer is saved.");
  expect(html).toContain("Final grade pending");
  expect(html).not.toContain("needs correction");
});

test("canonical review lookup identifies the exact action, not another attempt with the same question", () => {
  const first = questionCheckIdsForUiAction({ schemaVersion: 1, type: "submit-question-group", documentId: "doc",
    documentRevision: 0, nodeId: "group", idempotencyKey: "attempt1", responses: [{ questionId: "q", type: "text", answer: "a" }] });
  const second = questionCheckIdsForUiAction({ schemaVersion: 1, type: "submit-question-group", documentId: "doc",
    documentRevision: 0, nodeId: "group", idempotencyKey: "attempt2", responses: [{ questionId: "q", type: "text", answer: "a" }] });
  expect(first).toEqual(["openui:question-check:doc:attempt1:q"]);
  expect(first).not.toEqual(second);
});
