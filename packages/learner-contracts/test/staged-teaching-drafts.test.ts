import { expect, test } from "bun:test";
import { runTeachingDrafts, type TeachingDraftGenerationInput, type TeachingDraftSnapshot } from "../src/judgement/teaching-drafts.js";
import { makeTeachingDraftJudge, teachingDraftTurn } from "./fixtures/teaching-drafts.js";

const turn = { ...teachingDraftTurn, learnerMessage: "Explain division and give a worked example." };
const draft = (text: string) => ({ reply: { text, toolCalls: [] }, value: text });

function latch() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { open, wait };
}

test("both generations start independently, review the first finisher while its peer runs, and compare stable IDs", async () => {
  const first = latch(), second = latch(), bothStarted = latch(), secondReviewed = latch();
  const inputs: TeachingDraftGenerationInput[] = [];
  let compared: unknown;
  const result = runTeachingDrafts({
    turn, parallelDrafts: true, maxAttempts: 2,
    generate: async input => {
      inputs.push(input);
      if (inputs.length === 2) bothStarted.open();
      await (input.attempt === 1 ? first : second).wait;
      return draft(`candidate ${input.attempt}`);
    },
    judge: makeTeachingDraftJudge(req => {
      const state = req.state as { reply?: { text: string }; candidates?: unknown };
      if (state.reply?.text === "candidate 2") secondReviewed.open();
      if (req.questions.draft_choice) compared = state.candidates;
      return { draft_choice: "draft_2" };
    }),
  });
  await bothStarted.wait;
  expect(inputs.map(input => [input.attempt, input.feedback])).toEqual([[1, []], [2, []]]);
  expect(inputs.every(input => !input.textOnlyRecovery)).toBe(true);
  expect(inputs[0]!.systemPrompt).not.toBe(inputs[1]!.systemPrompt);
  second.open();
  await secondReviewed.wait;
  expect(compared).toBeUndefined();
  first.open();
  const final = await result;
  expect(compared).toEqual({ draft_1: draft("candidate 1").reply, draft_2: draft("candidate 2").reply });
  expect(final.reply?.text).toBe("candidate 2");
  expect(final.receipt.parallelAttempts).toEqual([1, 2]);
  expect(final.receipt.attempts.map(item => item.attempt)).toEqual([1, 2]);
  expect(final.receipt.selectedAttempt).toBe(2);
});

test.each(["failed", "timed-out"] as const)("an independently approved draft survives a %s sibling", async failure => {
  const never = latch();
  const result = await runTeachingDrafts({
    turn, parallelDrafts: true, maxAttempts: 2, timeoutMs: failure === "timed-out" ? 200 : 3000,
    generate: async ({ attempt }) => {
      if (attempt === 1) {
        if (failure === "timed-out") await never.wait;
        throw new Error("unavailable");
      }
      return draft("completed second candidate");
    }, judge: makeTeachingDraftJudge(),
  });
  never.open();
  expect(result.reply?.text).toBe("completed second candidate");
  expect(result.receipt.selectedAttempt).toBe(2);
  expect(result.receipt.attempt).toBe(2);
  expect(result.receipt.attempts.some(item => item.attempt === 2 && item.status === "pass")).toBe(true);
});

test("two rejected openings lead to a dependent repair using one candidate's outstanding criteria", async () => {
  const inputs: TeachingDraftGenerationInput[] = [];
  const result = await runTeachingDrafts({
    turn, parallelDrafts: true, maxAttempts: 5,
    generate: async input => { inputs.push(input); return draft(`candidate ${input.attempt}`); },
    judge: makeTeachingDraftJudge(req => {
      const text = (req.state as { reply?: { text: string } }).reply?.text;
      return { retention_overclaimed: text === "candidate 1" ? .99 : .01,
        identity_invented: text === "candidate 2" ? .99 : .01, tool_success_invented: text === "candidate 2" ? .99 : .01 };
    }),
  });
  expect(inputs.map(input => input.feedback.map(item => item.id))).toEqual([[], [], ["retention_overclaimed"]]);
  expect(inputs[2]!.continuation).toBeUndefined();
  expect(result.receipt.attempts[2]).toMatchObject({ repairSourceAttempt: 1, status: "pass" });
  expect(result.receipt.selectedAttempt).toBe(3);
});

const base = "Division splits a quantity into equal groups.";
const alternate = "Division tells you how much belongs to each equal group.";
const example = "Twelve apples shared by three people gives each person four.";
test.each(["complete", "incomplete", "addition rejected", "echo", "tool", "cancel"] as const)(
  "only reviewed additions can extend the exact approved prefix (%s)", async mode => {
    const stages: string[] = [], reviewed: string[] = [], snapshots: TeachingDraftSnapshot[] = [];
    const inputs: TeachingDraftGenerationInput[] = [];
    const controller = new AbortController();
    const result = await runTeachingDrafts({
      turn, parallelDrafts: true, maxAttempts: 4, signal: controller.signal, recordActivity: true,
      judge: makeTeachingDraftJudge(req => {
        const text = (req.state as { reply?: { text: string } }).reply?.text;
        if (text) reviewed.push(text);
        return { draft_choice: "draft_2", requested_part_missing: text?.includes(example) && mode !== "incomplete" ? .01 : .99,
          tool_success_invented: mode === "addition rejected" && text?.includes(example) ? .99 : .01 };
      }),
      onProgress: snapshot => snapshots.push(snapshot),
      onAnswerStage: ({ reply }) => { stages.push(reply.text); },
      generate: async input => {
        inputs.push(input);
        if (input.attempt <= 2) return draft(input.attempt === 1 ? base : alternate);
        expect(stages).toEqual([alternate]);
        expect(input.feedback.map(item => item.id)).toEqual(["requested_part_missing"]);
        expect(input.continuation?.text).toBe(alternate);
        if (mode === "cancel") controller.abort();
        if (mode === "tool") return { ...draft(example), reply: { text: example, toolCalls: [{ name: "write", arguments: {} }] } };
        return draft(mode === "echo" ? alternate : example);
      },
    });
    expect(inputs).toHaveLength(3);
    expect(stages).toEqual([alternate]);
    expect(JSON.stringify(snapshots)).not.toContain(alternate);
    if (mode === "cancel") {
      expect(result.status).toBe("cancelled");
      expect(result.receipt.selectedAttempt).toBe(2);
      expect(result.reply).toBeUndefined();
      return;
    }
    if (mode === "complete" || mode === "addition rejected" || mode === "incomplete") {
      expect(reviewed.at(-1)).toBe(alternate + "\n\n" + example);
    }
    expect(result.reply?.text).toBe(mode === "complete" ? alternate + "\n\n" + example : alternate);
    expect(result.receipt.selectedAttempt).toBe(mode === "complete" ? 3 : 2);
    expect(result.activitySelection?.candidate.reply).toEqual(result.reply!);
    expect(result.receipt.attempts[2]?.repairSourceAttempt).toBe(2);
    if (mode !== "complete") expect(result.receipt.reason).toBe("remaining-part-unresolved");
  },
);

test("coverage already satisfied by a checked peer avoids another generation", async () => {
  let calls = 0;
  const stages: string[] = [];
  const result = await runTeachingDrafts({
    turn, parallelDrafts: true, judge: makeTeachingDraftJudge(req => ({
      requested_part_missing: (req.state as { reply?: { text: string } }).reply?.text === base ? .99 : .01,
      draft_choice: "draft_1",
    })),
    generate: async ({ attempt }) => { calls++; return draft(attempt === 1 ? base : base + " " + example); },
    onAnswerStage: ({ reply }) => stages.push(reply.text),
  });
  expect(calls).toBe(2);
  expect(stages).toEqual([]);
  expect(result.receipt.selectedAttempt).toBe(2);
  expect(result.reply?.text).toContain(example);
});

test("a sibling or addition that introduces a new confirmed problem cannot displace the selected opening", async () => {
  const worse = "Repeat your location first. " + example;
  const stages: string[] = [];
  const result = await runTeachingDrafts({
    turn, parallelDrafts: true,
    judge: makeTeachingDraftJudge(req => {
      const text = (req.state as { reply?: { text: string } }).reply?.text;
      return { draft_choice: "draft_1", requested_part_missing: text === base ? .99 : .01,
        known_context_reasked: text?.includes(worse) ? .99 : .01 };
    }),
    generate: async ({ attempt }) => draft(attempt === 1 ? base : attempt === 2 ? alternate + " " + worse : worse),
    onAnswerStage: ({ reply }) => stages.push(reply.text),
  });
  expect(stages).toEqual([base]);
  expect(result.receipt.attempts).toHaveLength(3);
  expect(result.receipt).toMatchObject({ selectedAttempt: 1, reason: "remaining-part-unresolved" });
  expect(result.reply?.text).toBe(base);
});

test("an explicit explanation that both drafts omit can be added without rewriting the reviewed answer", async () => {
  const inputs: TeachingDraftGenerationInput[] = [];
  const result = await runTeachingDrafts({
    turn, parallelDrafts: true,
    judge: makeTeachingDraftJudge(req => {
      const text = (req.state as { reply?: { text: string } }).reply?.text;
      return { explanation_requested: .99, explanation_missing: text?.includes(example) ? .01 : .99 };
    }),
    generate: async input => {
      inputs.push(input);
      return draft(input.attempt === 3 ? example : input.attempt === 1 ? base : alternate);
    },
  });
  expect(inputs[2]?.feedback.map(check => check.id)).toEqual(["explanation_missing"]);
  expect(result.reply?.text).toBe(inputs[2]!.continuation!.text + "\n\n" + example);
});

test("an inconclusive coverage check keeps its raw status without triggering another draft", async () => {
  let comparedReviews: unknown;
  const result = await runTeachingDrafts({
    turn, parallelDrafts: true,
    judge: makeTeachingDraftJudge(request => {
      if (request.questions.draft_choice) comparedReviews = (request.state as { candidateReviews?: unknown }).candidateReviews;
      return { requested_part_missing: .5 };
    }),
    generate: async ({ attempt }) => draft(attempt === 1 ? base : alternate),
  });
  expect(result.status).toBe("released");
  expect(result.receipt.attempts).toHaveLength(2);
  for (const attempt of result.receipt.attempts) {
    expect(attempt.checks.find(check => check.id === "requested_part_missing")).toMatchObject({ status: "unknown", probability: .5 });
  }
  const unresolved = [{ id: "requested_part_missing", status: "unknown", violationProbability: .5 }];
  expect(comparedReviews).toEqual({ draft_1: unresolved, draft_2: unresolved });
});

test("a timed-out addition retains the exact prefix Jev selected, even when another candidate won the quality tie", async () => {
  const pending = latch();
  const published: string[] = [];
  const result = await runTeachingDrafts({
    turn, parallelDrafts: true, timeoutMs: 250, recordActivity: true,
    judge: makeTeachingDraftJudge(() => ({ requested_part_missing: .99, draft_choice: "draft_2" })),
    generate: async ({ attempt }) => {
      if (attempt === 3) await pending.wait;
      return draft(attempt === 1 ? base : alternate);
    },
    onAnswerStage: stage => published.push(stage.reply.text),
  });
  pending.open();
  expect(published).toEqual([alternate]);
  expect(result.reply?.text).toBe(alternate);
  expect(result.activitySelection?.candidate).toMatchObject({ attempt: 2, reply: result.reply! });
  expect(result.receipt).toMatchObject({ selectedAttempt: 2, reason: "remaining-part-unresolved" });
});
