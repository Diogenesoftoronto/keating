import { describe, expect, it } from "bun:test";
import { compileOpenUISourceToSharedDocument, LANGUAGE_PRACTICE_ROUNDS_FIXTURE, validateUiAction, validateUiActionAgainstDocument, validateUiDocument, type UiAction } from "../src/index.js";

const document = compileOpenUISourceToSharedDocument(`root = LearningSurface([language])\nlanguage = LanguagePractice("language", "A little Spanish", "Spanish", ${JSON.stringify(LANGUAGE_PRACTICE_ROUNDS_FIXTURE)}, "resumable")`, { documentId: "language-document", createdAt: "2026-09-06T00:00:00.000Z" });
const action: Extract<UiAction, { type: "complete-language-practice" }> = {
  schemaVersion: 1, type: "complete-language-practice", documentId: document.id, documentRevision: 0, nodeId: "language", idempotencyKey: "language-result",
  rounds: [
    { roundId: "greeting", outcome: "correct", attempts: 2, timeMs: 4_238, answer: "¡BUENOS DÍAS!" },
    { roundId: "coffee", outcome: "retry", attempts: 1, timeMs: 7_401, answer: "un Quiero café" },
    { roundId: "hello", outcome: "correct", attempts: 1, timeMs: 2_178, answer: "Hola." },
    { roundId: "thanks", outcome: "practiced", attempts: 1, timeMs: 9_781 },
  ], correct: 2, objectiveTotal: 3, pronunciationPracticed: 1, totalMs: 25_000,
};

describe("language practice source and completion", () => {
  it("preserves all four round modes, authored audio and attribution", () => {
    expect(validateUiDocument(document)).toBe(true);
    expect(document.nodes[0]).toEqual({ type: "language-practice", id: "language", title: "A little Spanish", language: "Spanish", rounds: LANGUAGE_PRACTICE_ROUNDS_FIXTURE });
  });
  it("keeps exact timings, attempts, and objective answers separate from pronunciation practice", () => {
    expect(validateUiAction(JSON.parse(JSON.stringify(action)))).toBe(true);
    expect(validateUiActionAgainstDocument(action, document)).toBe(true);
  });
  it("rejects fabricated pronunciation scores, answer uploads, and changed objective outcomes", () => {
    expect(validateUiActionAgainstDocument({ ...action, rounds: action.rounds.map((round) => round.roundId === "thanks" ? { ...round, answer: "uploaded speech" } : round) }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...action, rounds: action.rounds.map((round) => round.roundId === "thanks" ? { ...round, outcome: "correct", answer: "Gracias" } : round), correct: 3, pronunciationPracticed: 0 }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...action, rounds: action.rounds.map((round) => round.roundId === "greeting" ? { ...round, answer: "Buenas noches" } : round) }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...action, rounds: action.rounds.map((round) => round.roundId === "coffee" ? { ...round, answer: "Quiero un café" } : round) }, document)).toBe(false);
  });
  it("allows honest skipped audio rounds without granting practice credit", () => {
    expect(validateUiActionAgainstDocument({ ...action, rounds: action.rounds.map((round) => round.roundId === "thanks" ? { ...round, outcome: "skipped", attempts: 0 } : round), pronunciationPracticed: 0 }, document)).toBe(true);
  });
  it("rejects reordered or missing rounds and impossible summary/timing values", () => {
    expect(validateUiActionAgainstDocument({ ...action, rounds: [...action.rounds].reverse() }, document)).toBe(false);
    expect(validateUiActionAgainstDocument({ ...action, rounds: action.rounds.slice(0, 3), pronunciationPracticed: 0 }, document)).toBe(false);
    for (const patch of [{ totalMs: 1 }, { totalMs: 2.5 }, { correct: 3 }, { objectiveTotal: 4 }, { pronunciationPracticed: 0 }]) expect(validateUiActionAgainstDocument({ ...action, ...patch }, document)).toBe(false);
  });
  it("requires complete word permutations and safe reference URLs", () => {
    const node = document.nodes[0];
    if (node?.type !== "language-practice") throw new Error("Expected language practice");
    const replace = (round: unknown) => ({ ...document, nodes: [{ ...node, rounds: [round] }] });
    expect(validateUiDocument(replace({ ...LANGUAGE_PRACTICE_ROUNDS_FIXTURE[1], correctOrder: ["want", "coffee", "coffee"] }))).toBe(false);
    for (const referenceAudioUrl of ["javascript:alert(1)", "//example.com/audio.mp3", "/audio\\clip.mp3", "https://user:pass@example.com/clip.mp3", "https://example.com/clip.mp3?token=secret"]) expect(validateUiDocument(replace({ ...LANGUAGE_PRACTICE_ROUNDS_FIXTURE[2], referenceAudioUrl }))).toBe(false);
  });
});
