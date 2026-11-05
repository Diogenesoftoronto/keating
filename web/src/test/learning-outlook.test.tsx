import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { learningSourceHash } from "@keating/learner-contracts";
import { LearningOutlookView } from "../components/LearningOutlook";
import {
  clearLearningOutlook, constraintPlanningMessage, isDeadlineLike, LEARNING_OUTLOOK_MAX_AGE_MS, loadLearningOutlook,
  plannableConstraints, recordConstraintAction, saveLearningOutlook,
} from "../keating/learning-intelligence/outlook";
import type { LearningForecastProposal } from "../keating/learning-intelligence/forecasts";
import { MemoryStorage } from "./helpers/memory-storage";

const now = Date.parse("2026-11-05T12:00:00Z");
const forecast: LearningForecastProposal = { id: "topic:fractions", label: "Next graded answer", measure: "graded-answer-score", observedCount: 9,
  baseline: 0.5, maximum: 1, status: "unvalidated-model-proposal", p10: 0.4, median: 0.6, p90: 0.8 };

test.each([
  ["My exam is on Friday", true], ["the interview is next week", true], ["due Nov 12", true], ["in two weeks", true],
  ["I only have 20 minutes a day", false], ["no calculators allowed", false],
])("isDeadlineLike(%s) is %s", (quote, expected) => {
  expect(isDeadlineLike(quote)).toBe(expected);
});

test("the outlook is shown only for the history it was computed from, and only while recent", () => {
  const storage = new MemoryStorage();
  saveLearningOutlook({ at: now, historyId: "h1", forecasts: [forecast], revisit: [] }, storage);
  expect(loadLearningOutlook("h1", now + 1, storage)?.forecasts).toHaveLength(1);
  expect(loadLearningOutlook("h2", now + 1, storage)).toBeNull();
  expect(loadLearningOutlook("h1", now + LEARNING_OUTLOOK_MAX_AGE_MS + 1, storage)).toBeNull();
  // Nothing worth showing erases the last outlook rather than leaving it stale.
  saveLearningOutlook({ at: now, historyId: "h1", forecasts: [{ ...forecast, status: "insufficient-history", median: undefined }], revisit: [] }, storage);
  expect(loadLearningOutlook("h1", now + 1, storage)).toBeNull();
  saveLearningOutlook({ at: now, historyId: "h1", forecasts: [], revisit: [{ question: "Explain a half", missedCount: 4, attempts: 8 }] }, storage);
  clearLearningOutlook(storage);
  expect(loadLearningOutlook("h1", now + 1, storage)).toBeNull();
});

test("the outlook card states a range, its basis, and that it is unvalidated", () => {
  const html = renderToStaticMarkup(<LearningOutlookView onPractice={() => {}} outlook={{ version: 1, at: now, historyId: "h1",
    forecasts: [forecast, { ...forecast, id: "card:d:c", label: "Recall at the next scheduled review", measure: "self-reported-card-rating", maximum: 3, p10: 1, median: 2, p90: 3, dueAt: now + 86_400_000 },
      { ...forecast, id: "abstained", label: "Hidden", status: "abstained" }],
    revisit: [{ question: "Explain a half", missedCount: 4, attempts: 8 }] }} />);
  expect(html).toContain("around 60% (between 40% and 80%)");
  expect(html).toContain("rate this card “good”");
  expect(html).toContain("Based on 9 recorded answers");
  expect(html).toContain("hasn&#x27;t been validated");
  expect(html).toContain("Missed 4 of 8 attempts");
  expect(html).not.toContain("Hidden");
  expect(renderToStaticMarkup(<LearningOutlookView onPractice={() => {}} outlook={null} />)).toBe("");
});

test("only grounded, deadline-shaped constraints in this message are offered, once", () => {
  const storage = new MemoryStorage();
  const text = "My exam is on Friday and I only have 20 minutes a day.";
  const anchor = (quote: string, messageId = "m1") => ({ sessionId: "s1", messageId, quote, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length, sourceHash: learningSourceHash(text) });
  storage.setItem("keating:learning-evidence:v1:s1", JSON.stringify({ scope: "a", items: [
    { kind: "learning-constraint", evidence: anchor("My exam is on Friday") },
    { kind: "learning-constraint", evidence: anchor("I only have 20 minutes a day") },
    { kind: "learning-constraint", evidence: anchor("My exam is on Friday", "other-message") },
    { kind: "lesson-fact", evidence: anchor("My exam is on Friday") },
  ] }));
  const offered = plannableConstraints("s1", ["m1"], text, storage);
  expect(offered.map(item => item.quote)).toEqual(["My exam is on Friday"]);
  // Edited text no longer contains the quote: nothing to plan around.
  expect(plannableConstraints("s1", ["m1"], "My test moved.", storage)).toEqual([]);
  recordConstraintAction("s1", offered[0]!.referenceId, "dismissed", storage);
  expect(plannableConstraints("s1", ["m1"], text, storage)).toEqual([]);
  expect(constraintPlanningMessage("My exam is on Friday")).toContain("“My exam is on Friday”");
});
