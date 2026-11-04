import { expect, test, spyOn } from "bun:test";
import { harnessTurnTimeout } from "./benchmark_harness_v3.js";
import { RESEARCH_CAPTURE_MAX_DEADLINE_MS, validateResearchCapture, type NativeResearchCapture } from "./native_draft_review.js";
import { runTeachingDrafts } from "../../packages/learner-contracts/src/judgement/teaching-drafts.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "../../packages/learner-contracts/test/fixtures/teaching-drafts.js";

const research = (deadline_ms = 3_600_000): NativeResearchCapture => ({
  max_attempts: 10, thinking: "max", deadline_ms,
  services_module: { path: "/offline/deadline-fixture.ts", sha256: "a".repeat(64) },
});

test("research capture accepts an explicit one-hour deadline and rejects overflow", () => {
  expect(RESEARCH_CAPTURE_MAX_DEADLINE_MS).toBe(3_600_000);
  for (const ms of [1, 600_001, 1_800_000, 3_600_000]) {
    expect(() => validateResearchCapture(research(ms))).not.toThrow();
  }
  for (const ms of [0, -1, 3_600_001, Infinity, NaN, 1.5]) {
    expect(() => validateResearchCapture(research(ms))).toThrow("harness_invalid_research_capture");
  }
});

test("harness turn ceiling grows only with explicit research capture; defaults stay unchanged", () => {
  expect(harnessTurnTimeout({})).toBe(60_000);
  expect(harnessTurnTimeout({ limits: { turn_timeout_ms: 600_000 } })).toBe(600_000);
  expect(() => harnessTurnTimeout({ limits: { turn_timeout_ms: 600_001 } })).toThrow("harness_invalid_limits");
  expect(harnessTurnTimeout({ research_capture: research() })).toBe(60_000);
  expect(harnessTurnTimeout({ research_capture: research(), limits: { turn_timeout_ms: 600_001 } })).toBe(600_001);
  expect(harnessTurnTimeout({ research_capture: research(), limits: { turn_timeout_ms: 3_600_000 } })).toBe(3_600_000);
  expect(() => harnessTurnTimeout({ research_capture: research(), limits: { turn_timeout_ms: 3_600_001 } })).toThrow("harness_invalid_limits");
  expect(harnessTurnTimeout({ research_capture: research(), limits: { turn_timeout_ms: 20_000 } })).toBe(20_000);
});

test("shared controller installs the one-hour timer only for explicit collection and still reviews ten drafts", async () => {
  for (const [collectAllAttempts, timeoutMs, expected] of [
    [false, undefined, 90_000], [true, undefined, 90_000],
    [false, 3_600_000, 180_000], [true, 3_600_000, 3_600_000],
    [true, 3_600_001, 3_600_000], [true, 600_001, 600_001], [true, 20_000, 20_000],
  ] as const) {
    const installed: number[] = [];
    const original = globalThis.setTimeout;
    const timers = spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => {
      installed.push(delay ?? 0);
      return original(handler, delay, ...args);
    });
    let generated = 0, reviews = 0;
    try {
      const result = await runTeachingDrafts({ turn: teachingDraftTurn, collectAllAttempts, timeoutMs, maxAttempts: 10,
        judge: makeTeachingDraftJudge(request => { if (request.questions.quality_progress) reviews++; return {}; }),
        generate: async () => ({ reply: { text: `offline deadline candidate ${++generated}`, toolCalls: [] }, value: generated }),
      });
      expect(installed[0]).toBe(expected);
      expect(result.status).toBe("released");
      expect(generated).toBe(collectAllAttempts ? 10 : 1);
      expect(reviews).toBe(generated);
    } finally { timers.mockRestore(); }
  }
});

test("one-hour collection keeps caller cancellation and does not dispatch remaining drafts", async () => {
  const abort = new AbortController();
  let generated = 0;
  const result = await runTeachingDrafts({ turn: teachingDraftTurn, collectAllAttempts: true,
    maxAttempts: 10, timeoutMs: 3_600_000, signal: abort.signal, judge: makeTeachingDraftJudge(),
    generate: async () => {
      if (++generated === 2) abort.abort();
      return { reply: { text: `offline candidate ${generated}`, toolCalls: [] }, value: generated };
    },
  });
  expect(result.status).toBe("cancelled");
  expect(generated).toBe(2);
});
