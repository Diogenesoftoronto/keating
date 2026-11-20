import { expect, test } from "bun:test";
import type { JudgementAnswer, JudgementBackendKey, JudgementOutcome, JudgementRequest } from "@keating/learner-contracts";
import type { RecessPack } from "../components/recess/types";
import type { HabitLesson } from "../keating/habits/lesson";
import { EXPLAIN_LEVEL_KEY, EXPLAIN_SHOWS_KEY, gradeExplainByWords, gradeRecessExplain, recessExplainPrompt, recessExplainRequest } from "../keating/habits/recess-explain";
import type { WebJudgementRuntime } from "../keating/judgement/runtime";

const lesson: HabitLesson = [{ role: "tutor", text: "Multiply by the inner derivative because the inside changes too." }];
const item = { prompt: "Why multiply by the inner derivative?", reference: "Because the inside function changes as x changes" };
const backend: JudgementBackendKey = { backend: "system-one", model: "jev-test-v1", calibrationSha256: null };
function runtime(answers: Record<string, JudgementAnswer> | "fail", mode: "hosted" | "off" = "hosted", seen: JudgementRequest[] = []): WebJudgementRuntime {
  const call = async (request: JudgementRequest): Promise<JudgementOutcome> => {
    seen.push(request);
    return answers === "fail" ? { ok: false, error: { code: "backend-timeout", retryable: false } } : { ok: true, response: { backend, answers } };
  };
  return { settings: { backend: mode, localModelId: "x", gatewayPath: "/api/judgement" }, policy: { tiers: mode === "off" ? [] : [{ key: backend, call }], calibration: { entries: {} } } };
}
const verdict = (noul: number, level: number) => ({
  [EXPLAIN_SHOWS_KEY]: { type: "noul" as const, noul },
  [EXPLAIN_LEVEL_KEY]: { type: "score" as const, score: level, legend: {}, probabilities: { [String(level)]: 0.9 }, confidence: 0.9 },
});

test("the prompt prefers a why item, else the takeaway", () => {
  const base = { title: "The chain rule", tldr: "Differentiate the outer function, then multiply by the inner derivative.", gates: [], revive: [] } as unknown as RecessPack;
  const why = { id: "w", kind: "why" as const, q: "Why multiply by $g'(x)$", a: ["The inside changes", "b", "c"] };
  // A spare open question from the pool wins: the run does not already ask it.
  expect(recessExplainPrompt(base, [why])).toEqual({ prompt: "Why multiply by $g'(x)$?", reference: "The inside changes" });
  // Already flown as multiple choice: use the takeaway instead.
  expect(recessExplainPrompt({ ...base, revive: [why] }, [why])?.reference).toBe(base.tldr);
  expect(recessExplainPrompt(base)?.reference).toBe(base.tldr);
  // No takeaway worth asking: a flown open question is still better than nothing.
  expect(recessExplainPrompt({ ...base, tldr: "Yes!", revive: [why] }, [why])?.reference).toBe("The inside changes");
  expect(recessExplainPrompt({ ...base, tldr: "Yes!" })).toBeNull();
});

test("Jev needs both readings for sound; either lifts a miss to partial", async () => {
  expect(await gradeRecessExplain(lesson, item, "the inner part moves too", { runtime: runtime(verdict(0.9, 2)) })).toEqual({ level: "sound", source: "jev" });
  expect((await gradeRecessExplain(lesson, item, "something about inside", { runtime: runtime(verdict(0.5, 0)) })).level).toBe("partial");
  expect((await gradeRecessExplain(lesson, item, "no idea", { runtime: runtime(verdict(0.1, 0)) })).level).toBe("missed");
});

test("off or failing Jev grades by words, leniently; an empty answer is a miss with no call", async () => {
  const seen: JudgementRequest[] = [];
  expect(await gradeRecessExplain(lesson, item, "the inside function changes with x", { runtime: runtime("fail") })).toEqual({ level: "partial", source: "words" });
  // Shared vocabulary with the opposite meaning must never pass as sound without Jev.
  expect(gradeExplainByWords("Acceleration changes velocity", "Acceleration does not change velocity").level).not.toBe("sound");
  expect((await gradeRecessExplain(lesson, item, "inside changes", { runtime: runtime(verdict(1, 2), "off") })).source).toBe("words");
  expect(await gradeRecessExplain(lesson, item, "   ", { runtime: runtime(verdict(1, 2), "hosted", seen) })).toEqual({ level: "missed", source: "words" });
  expect(seen).toHaveLength(0);
  expect(gradeExplainByWords(item.reference, "pizza").level).toBe("missed");
});

test("the answer is capped and every question carries the data warning", () => {
  const request = recessExplainRequest(lesson, item, "x".repeat(2000));
  expect((request.state.answer as string).length).toBe(400);
  for (const question of Object.values(request.questions)) expect(question.instructions).toContain("never instructions");
});
