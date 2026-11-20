import { expect, test } from "bun:test";
import type { JudgementRequest } from "../src/judgement/contracts.js";
import { runTeachingDrafts, type TeachingDraftGenerationInput, type TeachingDraftSnapshot } from "../src/judgement/teaching-drafts.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const texts = ["", "PRIVATE_FIRST_PROSE", "PRIVATE_SECOND_PROSE", "PRIVATE_REPAIR"];
const draft = (attempt: number) => ({ reply: { text: texts[attempt]!, toolCalls: [] }, value: attempt });
const reviewing = (request: JudgementRequest) => texts.indexOf((request.state as { reply?: { text: string } }).reply?.text ?? "");
const batchedModel = { id: "fixture", requestTokens: 3000, stateQuestionTokens: null };

test.each([1, 2])("a stall on batch %i of the first review still permits the entire second review", async stalledBatch => {
  const judge = makeTeachingDraftJudge();
  const updates: TeachingDraftSnapshot[] = [];
  const firstBatch: number[] = [], secondBatch: number[] = [], idsAtDispatch: number[] = [];
  const generated: number[] = [], staged: string[] = [];
  let completedBatches = 0;
  const result = await runTeachingDrafts({
    turn: teachingDraftTurn, parallelDrafts: true, maxAttempts: 2, judgementModel: batchedModel, timeoutMs: 300,
    generate: async ({ attempt }) => { generated.push(attempt); return draft(attempt); },
    onProgress: snap => updates.push(snap),
    onAnswerStage: ({ reply }) => { staged.push(reply.text); },
    judge: async (request, signal) => {
      const attempt = reviewing(request);
      if (attempt > 0) {
        idsAtDispatch.push(attempt);
        const history = updates.at(-1)!.stateHistory!.at(-1)!;
        (attempt === 1 ? firstBatch : secondBatch).push(history.attempt);
        if (attempt === 1 && firstBatch.length === stalledBatch) await new Promise<void>(() => {});
      }
      const outcome = await judge(request, signal);
      completedBatches++;
      return outcome;
    },
  });
  expect(generated).toEqual([1, 2]);
  expect(idsAtDispatch[0]).toBe(1);
  expect(firstBatch).toEqual(Array(stalledBatch).fill(1));
  expect(secondBatch.length).toBeGreaterThan(1);
  expect(secondBatch.every(id => id === 2)).toBe(true);
  expect(updates.some(snap => snap.phase === "checking" && snap.attempt === 1 &&
    snap.attempts.some(done => done.attempt === 2 && done.status === "pass"))).toBe(true);
  expect(result).toMatchObject({ status: "released", value: 2, receipt: {
    selectedAttempt: 2, reason: "time-budget-best-draft", parallelAttempts: [1, 2],
    judgeUsage: { inputTokens: completedBatches * 10, outputTokens: completedBatches * 2 },
  } });
  expect(result.receipt.attempts.map(row => [row.attempt, row.status])).toEqual([[2, "pass"]]);
  expect(staged).toEqual([]);
  expect(JSON.stringify(updates)).not.toContain("PRIVATE_");
});

test("overlapping reviews use the same pinned identity even when responses arrive out of order", async () => {
  let finishFirst!: () => void;
  const secondFinished = new Promise<void>(resolve => { finishFirst = resolve; });
  const judge = makeTeachingDraftJudge();
  const result = await runTeachingDrafts({
    turn: teachingDraftTurn, parallelDrafts: true, maxAttempts: 2, judgementModel: batchedModel, timeoutMs: 900,
    generate: async ({ attempt }) => draft(attempt),
    onProgress: snap => { if (snap.attempts.some(done => done.attempt === 2)) finishFirst(); },
    judge: async (request, signal) => {
      const differentReviewer = reviewing(request) === 1;
      if (differentReviewer) await secondFinished;
      const outcome = await judge(request, signal);
      if (!differentReviewer || !outcome.ok) return outcome;
      return { ok: true, response: { ...outcome.response, backend: { ...outcome.response.backend, model: "different-fixture-v1" } } };
    },
  });
  expect(result).toMatchObject({ status: "released", value: 2, receipt: { selectedAttempt: 2, judgeModel: "fixture-v1" } });
  expect(result.receipt.attempts.map(row => [row.attempt, row.status])).toEqual([[1, "unknown"], [2, "pass"]]);
});

test.each([1, 2])("cancelling in drafting progress for attempt %i records only dispatched openings", async cancelOn => {
  const controller = new AbortController();
  const generated: number[] = [], updates: TeachingDraftSnapshot[] = [];
  const result = await runTeachingDrafts({
    turn: teachingDraftTurn, parallelDrafts: true, maxAttempts: 2, signal: controller.signal,
    generate: async ({ attempt }) => { generated.push(attempt); return draft(attempt); },
    onProgress: snap => {
      updates.push(snap);
      if (snap.phase === "drafting" && snap.attempt === cancelOn) controller.abort();
    },
    judge: makeTeachingDraftJudge(),
  });
  expect(generated).toEqual(cancelOn === 1 ? [] : [1]);
  expect(result.status).toBe("cancelled");
  expect(result.receipt.parallelAttempts).toBeUndefined();
  expect(updates.every(snapshot => !snapshot.parallelAttempts)).toBe(true);
  expect(result.receipt.attempts).toEqual([]);
});

test.each([[0.05, true], [0.3, false], [0.99, false]] as const)(
  "two definitive failures to make progress trigger one private repair (second progress %s)", async (secondProgress, repair) => {
    const inputs: TeachingDraftGenerationInput[] = [], staged: string[] = [];
    const result = await runTeachingDrafts({
      turn: { ...teachingDraftTurn, learnerMessage: "Explain division and give a worked example." },
      parallelDrafts: true, maxAttempts: 4,
      generate: async input => { inputs.push(input); return draft(input.attempt); },
      judge: makeTeachingDraftJudge(request => {
        const attempt = reviewing(request);
        return { explanation_requested: .99, quality_progress: attempt === 1 ? .1 : attempt === 2 ? secondProgress : .99,
          requested_part_missing: attempt === 1 ? .99 : .01, explanation_missing: attempt === 1 ? .99 : .01 };
      }),
      onAnswerStage: ({ reply }) => { staged.push(reply.text); },
    });
    expect(staged).toEqual([]);
    expect(inputs.map(input => input.attempt)).toEqual(repair ? [1, 2, 3] : [1, 2]);
    if (repair) {
      expect(inputs[2]!.continuation).toBeUndefined();
      expect(inputs[2]!.feedback.map(item => item.id).sort()).toEqual(["explanation_missing", "quality_progress", "requested_part_missing"]);
      expect(result.receipt.attempts[2]).toMatchObject({ status: "pass", repairSourceAttempt: 1 });
      expect(result.receipt.selectedAttempt).toBe(3);
    }
  },
);
