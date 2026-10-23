import { describe, expect, test } from "bun:test";
import {
  forecastLearningReview,
  forecastLearningSuccess,
  groundLearningEvidence,
  groundLearningExtractions,
  isLearningForecastInterval,
  learningSourceHash,
  rankImportantLearningQuestions,
  verifyLearningEvidence,
  type LearningEvidenceAnchor,
  type LearningOutcomePoint,
} from "../src/learning-intelligence.js";

const source = Object.freeze({ sessionId: "session-a", messageId: "message-b", role: "user", text: "🙂 I divided by x. Then x = 2." });
const now = "2026-10-23T00:00:00.000Z";
function history(kind: "quiz" | "card" = "quiz"): LearningOutcomePoint[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `event-${index}`, targetId: "algebra", kind,
    at: new Date(Date.UTC(2026, 9, index + 1)).toISOString(), value: kind === "quiz" ? index / 7 : index % 4,
  }));
}
function anchor(): LearningEvidenceAnchor {
  const result = groundLearningEvidence(source, { quote: "Then x = 2." });
  if (result.status !== "grounded") throw new Error("Fixture did not ground");
  return result.anchor;
}

describe("learning evidence grounding", () => {
  test("keeps exact UTF-16 offsets and rejects a source edit outside the passage", () => {
    const evidence = anchor();
    expect(evidence.start).toBe(source.text.indexOf("Then"));
    expect(evidence.end).toBe(source.text.length);
    expect(verifyLearningEvidence(source, evidence)).toBe(true);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(verifyLearningEvidence({ ...source, text: source.text.replace("divided", "multiplied") }, evidence)).toBe(false);
    expect(verifyLearningEvidence({ ...source, sessionId: "other" }, evidence)).toBe(false);
    expect(verifyLearningEvidence(source, { ...evidence, start: undefined } as unknown as LearningEvidenceAnchor)).toBe(false);
    expect(learningSourceHash(source.text)).toBe(learningSourceHash(source.text));
    expect(learningSourceHash(source.text + " ")).not.toBe(evidence.sourceHash);
  });

  test("repeated passages need explicit matching offsets and malformed ranges fail closed", () => {
    const repeated = { ...source, text: "x = 2; x = 2" };
    expect(groundLearningEvidence(repeated, { quote: "x = 2" })).toEqual({ status: "abstained", reason: "ambiguous-passage" });
    expect(groundLearningEvidence(repeated, { quote: "x = 2", start: 7, end: 12 }).status).toBe("grounded");
    for (const candidate of [
      { quote: "x = 2", start: 0 }, { quote: "x = 2", start: -1, end: 4 },
      { quote: "x = 2", start: 0.5, end: 5 }, { quote: "x = 2", start: 0, end: Infinity },
    ]) expect(groundLearningEvidence(repeated, candidate)).toEqual({ status: "abstained", reason: "invalid-range" });
    expect(groundLearningEvidence(source, { quote: "\ude42", start: 1, end: 2 })).toEqual({ status: "abstained", reason: "invalid-range" });
    expect(groundLearningEvidence(source, { quote: "I multiplied by x." })).toEqual({ status: "abstained", reason: "passage-mismatch" });
    expect(groundLearningEvidence(source, { quote: "Then x = 2.", sourceHash: "old" })).toEqual({ status: "abstained", reason: "source-changed" });
  });

  test("extractions preserve abstention instead of manufacturing a missing passage", () => {
    const result = groundLearningExtractions(source, [
      { kind: "answer-step", quote: "I divided by x." },
      { kind: "memory", quote: "" },
      { kind: "important-question", quote: "What happens for x = 0?" },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.kind).toBe("answer-step");
    expect(result.abstentions).toEqual([
      { index: 1, kind: "memory", reason: "missing-passage" },
      { index: 2, kind: "important-question", reason: "passage-mismatch" },
    ]);
  });
});

describe("advisory learning forecasts", () => {
  test("sparse, repeated, contradictory, future-only or simultaneous outcomes cannot create numeric certainty", () => {
    for (const points of [history().slice(0, 7), Array(8).fill(history()[0]!), history().map(point => ({ ...point, at: now })),
      history().map(point => ({ ...point, at: "2027-01-01T00:00:00.000Z" }))]) {
      expect(forecastLearningSuccess(points, { targetId: "algebra", kind: "quiz", now })).toMatchObject({
        status: "unknown", reason: "insufficient-history", p10: null, median: null, p90: null,
      });
    }
    const conflicting = [...history(), { ...history()[0]!, value: 0.8 }];
    expect(forecastLearningSuccess(conflicting, { targetId: "algebra", kind: "quiz", now }).reason).toBe("invalid-history");
  });

  test("keeps quiz scores and subjective card ratings separate with ordered empirical ranges", () => {
    const points = [...history(), ...history("card").map(point => ({ ...point, id: `card-${point.id}` }))];
    const before = structuredClone(points);
    const quiz = forecastLearningSuccess(points, { targetId: "algebra", kind: "quiz", now });
    expect(quiz).toMatchObject({ status: "estimate", observedCount: 8, measure: "quiz-score", provenance: "local-baseline", baseline: "empirical-outcomes" });
    expect(isLearningForecastInterval(quiz)).toBe(true);
    const card = forecastLearningSuccess(points, { targetId: "algebra", kind: "card", now });
    expect(card).toMatchObject({ observedCount: 8, measure: "card-rating" });
    expect(isLearningForecastInterval(card, 0, 3)).toBe(true);
    expect(points).toEqual(before);
  });

  test("uses the existing SRS due time without deriving a forgetting probability or changing it", () => {
    const dueAt = "2026-10-22T00:00:00.000Z";
    expect(forecastLearningReview([], { targetId: "algebra", now, dueAt })).toMatchObject({
      kind: "review", status: "unknown", baseline: "srs-schedule", due: true, dueAt, median: null,
    });
    expect(forecastLearningReview(history("card"), { targetId: "algebra", now, dueAt: "bad" })).toMatchObject({ status: "unknown", due: null, reason: "invalid-history", p10: null });
  });

  test("rejects invalid model intervals without sorting, clamping or filling missing values", () => {
    for (const value of [{ p10: 0.8, median: 0.5, p90: 0.9 }, { p10: -0.1, median: 0.5, p90: 0.9 },
      { p10: 0.1, median: 0.5, p90: Infinity }, { median: 0.5 }, [0.1, 0.5, 0.9], null]) {
      expect(isLearningForecastInterval(value)).toBe(false);
    }
    expect(isLearningForecastInterval({ p10: 0.1, median: 0.5, p90: 0.9 })).toBe(true);
  });

  test("ranks grounded questions by observed difficulty without claiming exam importance", () => {
    const candidates = [
      { id: "new", targetId: "geometry", evidence: anchor() },
      { id: "challenge", targetId: "algebra", evidence: anchor() },
    ];
    const result = rankImportantLearningQuestions(candidates, history(), { now });
    expect(result[0]).toMatchObject({ id: "challenge", kind: "importance", reason: "observed-difficulty", observedCount: 8, challengeCount: 5 });
    expect(result[1]).toMatchObject({ id: "new", reason: "insufficient-history", challengeCount: 0 });
    expect(result[0]!.evidence).toEqual(candidates[1]!.evidence);
  });
});
