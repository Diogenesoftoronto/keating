import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudyEstimateReceipt } from "../keating/judgement/study-estimates";
mock.module("../hooks/keating-storage", () => ({ getInitPromise: () => Promise.resolve(), keatingStorage: {} }));
const { StudyEstimateDetails } = await import("../pages/ComingUp");
mock.restore();

test("study estimates visibly separate unknown values, concrete model and generic effort from learning outcomes", () => {
  const receipt: StudyEstimateReceipt = { version: 1, deckId: "deck", sourceDigest: "digest", questionsDigest: "questions", cardIds: ["one"],
    createdAt: 1, evidenceSource: "proxy", calibration: "unvalidated", backend: { backend: "system-one", model: "jev-test-version", calibrationSha256: null },
    response: { backend: { backend: "system-one", model: "jev-test-version", calibrationSha256: null }, answers: {} },
    readinessProbability: null, expectedCorrect: null, estimatedSeconds: null,
    cards: [{ id: "one", successProbability: null, difficulty: null, effort: null }] };
  const html = renderToStaticMarkup(<StudyEstimateDetails receipt={receipt} fronts={{ one: "Explain the fraction" }} />);
  expect(html).toContain("Uncalibrated study estimates"); expect(html).toContain("Expected unaided recall: unknown");
  expect(html).toContain("Readiness: unknown"); expect(html).toContain("Planning time: unknown");
  expect(html).toContain("jev-test-version"); expect(html).toContain("generic effort bands");
  expect(html).toContain("Explain the fraction"); expect(html).not.toContain("0%"); expect(html).not.toContain("time limit");
});
