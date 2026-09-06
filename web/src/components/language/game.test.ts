import { describe, expect, it } from "bun:test";
import { LANGUAGE_PRACTICE_ROUNDS_FIXTURE, type UiLanguagePracticeNode } from "@keating/learner-contracts";
import { checkLanguageAnswer, languageCompletion } from "./game";

describe("language answer checks", () => {
  it("accepts harmless case, Unicode, whitespace and sentence punctuation without erasing accents", () => {
    const round = LANGUAGE_PRACTICE_ROUNDS_FIXTURE[0]!;
    expect(checkLanguageAnswer(round, "  ¡BUENOS  DI\u0301AS!  ")).toBe(true);
    expect(checkLanguageAnswer(round, "Buenos dias")).toBe(false);
    expect(checkLanguageAnswer(round, "Buenas noches")).toBe(false);
  });
  it("checks every token once in the authored order", () => {
    const round = LANGUAGE_PRACTICE_ROUNDS_FIXTURE[1]!;
    expect(checkLanguageAnswer(round, ["want", "a", "coffee"])).toBe(true);
    expect(checkLanguageAnswer(round, ["want", "coffee", "a"])).toBe(false);
    expect(checkLanguageAnswer(round, ["want", "a", "a"])).toBe(false);
    expect(checkLanguageAnswer(round, ["want"])).toBe(false);
  });
  it("never awards an objective pronunciation score", () => {
    expect(checkLanguageAnswer(LANGUAGE_PRACTICE_ROUNDS_FIXTURE[3]!, "Gracias")).toBe(false);
    const node: UiLanguagePracticeNode = { type: "language-practice", id: "language", title: "Spanish", language: "Spanish", rounds: LANGUAGE_PRACTICE_ROUNDS_FIXTURE };
    const result = languageCompletion(node, [{ roundId: "thanks", outcome: "practiced", attempts: 2, timeMs: 4_238 }], 7_901);
    expect(result).toMatchObject({ correct: 0, objectiveTotal: 3, pronunciationPracticed: 1, totalMs: 7_901 });
    expect(result.rounds[0]).toEqual({ roundId: "thanks", outcome: "practiced", attempts: 2, timeMs: 4_238 });
  });
});
