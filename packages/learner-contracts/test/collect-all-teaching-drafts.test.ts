import { expect, test } from "bun:test";
import { runTeachingDrafts } from "../src/judgement/teaching-drafts.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

test("explicit collection reviews ten actual candidates while default ordinary mode stops early", async () => {
  for (const collectAllAttempts of [false, true]) {
    let generated = 0, reviews = 0;
    const result = await runTeachingDrafts({ turn: teachingDraftTurn, collectAllAttempts, maxAttempts: 10,
      judge: makeTeachingDraftJudge(request => { if (request.questions.quality_progress) reviews++; return {}; }),
      generate: async () => ({ reply: { text: `candidate ${++generated}`, toolCalls: [] }, value: generated }),
    });
    expect(result.status).toBe("released");
    expect(generated).toBe(collectAllAttempts ? 10 : 1);
    expect(reviews).toBe(generated);
    expect(result.receipt.attempts).toHaveLength(generated);
  }
});

test("collection caps at ten attempts, records failures separately and still honors cancellation", async () => {
  let generated = 0;
  const result = await runTeachingDrafts({ turn: teachingDraftTurn, collectAllAttempts: true, maxAttempts: 100,
    judge: makeTeachingDraftJudge(), generate: async () => {
      if (++generated === 3) throw new Error("fixture generation failed");
      return { reply: { text: `candidate ${generated}`, toolCalls: [] }, value: generated };
    } });
  expect(generated).toBe(10);
  expect(result.receipt.attempts.filter(item => item.status === "generation-error")).toHaveLength(1);
  expect(result.receipt.attempts.filter(item => item.status !== "generation-error")).toHaveLength(9);
  const abort = new AbortController(); generated = 0;
  const cancelled = await runTeachingDrafts({ turn: teachingDraftTurn, collectAllAttempts: true, signal: abort.signal,
    judge: makeTeachingDraftJudge(), generate: async () => {
      if (++generated === 2) abort.abort();
      return { reply: { text: `candidate ${generated}`, toolCalls: [] }, value: generated };
    } });
  expect(cancelled.status).toBe("cancelled");
  expect(generated).toBe(2);
});
