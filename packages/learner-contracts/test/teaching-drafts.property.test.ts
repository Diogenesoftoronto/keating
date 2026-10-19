/** Fast generated checks for attempt budgets, cancellation, and honest receipts. */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

describe("teaching draft properties", () => {
  test("host rejection consumes no more than the declared budget and remains visible", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (maxAttempts) => {
      let generated = 0;
      const result = await runTeachingDrafts({
        refinement: "extended", turn: teachingDraftTurn, maxAttempts,
        judge: makeTeachingDraftJudge(),
        check: () => [{ id: "fixture_host_gate", source: "deterministic", severity: "critical", status: "fail", probability: 1 }],
        generate: async () => ({ reply: { text: `candidate ${++generated}`, toolCalls: [] }, value: generated }),
      });
      expect(generated).toBe(maxAttempts);
      expect(result.status).toBe("withheld");
      expect(result.value).toBeUndefined();
      expect(result.reply).toBeUndefined();
      expect(result.receipt.attempts).toHaveLength(maxAttempts);
      expect(result.receipt.attempts.map((attempt) => attempt.status)).toEqual(Array(maxAttempts).fill("fail"));
      expect(result.receipt.attempts.every((attempt) => attempt.checks.some((check) => check.id === "fixture_host_gate"
        && check.status === "fail" && check.source === "deterministic" && check.severity === "critical"))).toBe(true);
      expect(result.receipt.selectedAttempt).toBeNull();
    }), { numRuns: 12 });
  });

  test("aborting during generation never publishes late private output", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (maxAttempts) => {
      const controller = new AbortController();
      let generated = 0;
      const result = await runTeachingDrafts({
        refinement: "extended", turn: teachingDraftTurn, maxAttempts, signal: controller.signal,
        judge: makeTeachingDraftJudge(),
        generate: async () => {
          generated++;
          controller.abort();
          return { reply: { text: "late private output", toolCalls: [] }, value: "late private output" };
        },
      });
      expect(generated).toBe(1);
      expect(result.status).toBe("cancelled");
      expect(result.value).toBeUndefined();
      expect(result.reply).toBeUndefined();
      expect(result.receipt.reason).toBe("cancelled");
      expect(result.receipt.selectedAttempt).toBeNull();
      expect(JSON.stringify(result.receipt)).not.toContain("late private output");
    }), { numRuns: 8 });
  });
});
