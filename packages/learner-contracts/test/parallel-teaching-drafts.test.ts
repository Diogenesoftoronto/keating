import { expect, test } from "bun:test";
import { DEFAULT_MODELS } from "../../runtime-config/src/index.js";
import { runTeachingDrafts, type TeachingDraftSnapshot } from "../src/judgement/teaching-drafts.js";
import type { JudgementBackendKey, JudgementCaller, JudgementRequest } from "../src/judgement/contracts.js";
import { teachingDraftAnswers, teachingDraftTurn as turn } from "./fixtures/teaching-drafts.js";

const jev: JudgementBackendKey = { backend: "system-one", model: "jev-1.14.0", calibrationSha256: null };
const gemini: JudgementBackendKey = { backend: "system-one", model: "gemini-decision-1", calibrationSha256: null };
const generated = (attempt: number) => ({ reply: { text: `Private candidate ${attempt}`, toolCalls: [] }, value: attempt });
const answers = (request: JudgementRequest, overrides: Record<string, string | number> = {}, backend = jev) =>
  ({ ok: true as const, response: { backend, answers: teachingDraftAnswers(request, overrides), usage: { inputTokens: 5, outputTokens: 1 } } });

/** The first arrival cannot finish until every member has actually started. */
function barrier(expected: number) {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return () => { if (++arrivals === expected) release(); return ready; };
}

test("Jev concurrently generates and reviews four private replies, compares fixed pairs and selects only between their nominees", async () => {
  const generation = barrier(4), mandatory = barrier(4), comparison = barrier(2);
  const attempts: number[] = [], requests: string[][] = [], progress: TeachingDraftSnapshot[] = [];
  let ticks = 0;
  const result = await runTeachingDrafts({
    turn, ruleIds: [], timeoutMs: 1200, now: () => ++ticks, onProgress: snapshot => progress.push(snapshot),
    generate: async ({ attempt, textOnlyRecovery }) => {
      attempts.push(attempt);
      expect(textOnlyRecovery).toBeUndefined();
      await generation();
      // A later attempt finishes first without changing the meaning of any attempt ID.
      if (attempt === 1) await Bun.sleep(5);
      return generated(attempt);
    },
    judge: async request => {
      if (request.questions.quality_progress) await mandatory();
      const choice = request.questions.draft_pair_choice ?? request.questions.draft_choice;
      if (choice?.type === "choice") {
        const members = Object.keys((request.state as { candidates: object }).candidates);
        expect(Object.keys(choice.criteria)).toEqual(members);
        requests.push(members);
        if (request.questions.draft_pair_choice) {
          await comparison();
          return answers(request, { draft_pair_choice: members[1]! });
        }
        return answers(request, { draft_choice: "draft_4" });
      }
      return answers(request);
    },
  });
  expect(attempts).toEqual([1, 2, 3, 4]);
  expect(requests).toEqual([["draft_1", "draft_2"], ["draft_3", "draft_4"], ["draft_2", "draft_4"]]);
  expect(result.status).toBe("released");
  expect(result.value).toBe(4);
  expect(result.receipt.attempts.map(a => a.attempt)).toEqual([1,2,3,4]);
  expect(result.receipt.selectionCandidateAttempts).toEqual([2,4]);
  const [first, second] = result.receipt.pairReviews!;
  expect(first).toMatchObject({ status: "compared", pair: 1, preferredAttempt: 2, finalistAttempt: 2, eligibleAttempts: [1,2], model: jev.model });
  expect(second).toMatchObject({ status: "compared", pair: 2, preferredAttempt: 4, finalistAttempt: 4, eligibleAttempts: [3,4] });
  expect(Math.max(first!.startedAtMs!, second!.startedAtMs!)).toBeLessThan(Math.min(first!.finishedAtMs!, second!.finishedAtMs!));
  expect(result.receipt.stateHistory!.filter(row => row.phase === "checking").map(row => row.attempt).sort()).toEqual([1,2,3,4]);
  expect(result.receipt.judgeUsage).toEqual({inputTokens: 40, outputTokens: 8});
  expect(JSON.stringify(progress)).not.toContain("Private candidate");
});

test("only a completed paired final vote is visible at release, independently of a later host selection", async () => {
  for (const mode of ["normal", "incomplete-semifinal", "host-switch", "single", "unavailable", "wrong-keys", "invalid-distribution", "contradictory", "missing-confidence", "unguided"] as const) {
    const progress: TeachingDraftSnapshot[] = [];
    let finalRequests = 0;
    const result = await runTeachingDrafts({
      turn, ruleIds: [], generate: async ({attempt}) => {
        if (mode === "incomplete-semifinal" && attempt === 2) throw Error("one lane failed");
        return generated(attempt);
      },
      onProgress: row => progress.push(row),
      maxAttempts: mode === "single" ? 1 : mode === "unguided" ? 2 : undefined,
      collectAllAttempts: mode === "unguided",
      ...(mode === "host-switch" ? { activityLearningMode: "live" as const, activityLearning: async ({baselineAttempt, candidates}) => {
        const other = candidates.find(candidate => candidate.attempt !== baselineAttempt)!.attempt;
        return { attempt: other, receipt: {
          version: 1, status: "active", target: "next-linked-objective-score", model: DEFAULT_MODELS.judgement.tabular,
          asOf: 1, baselineAttempt, selectedAttempt: other,
          counts: { exposures: 40, labelled: 40, train: 30, validation: 10, candidates: 2 },
          validation: { kind: "squared-error", modelLoss: 0.1, baselineLoss: 0.2, passed: true },
          predictedScores: [{attempt: other, score: 0.8}], reasons: [], scope: "chronological-within-learner", causal: false, unaidedLearning: "unknown",
        } };
      } } : {}),
      judge: async request => {
        const outcome = answers(request, {}, mode === "unguided" ? gemini : jev);
        const final = request.questions.draft_choice;
        if (final?.type !== "choice") return outcome;
        finalRequests++;
        if (mode === "unavailable") return {ok:false, error:{code:"backend-unavailable", retryable:false}};
        const [first,second] = Object.keys(final.criteria);
        expect([first,second]).toEqual(mode === "unguided" ? ["draft_1","draft_2"] : ["draft_1","draft_3"]);
        const probabilities = mode === "wrong-keys" ? { [first!]: .54, private_unknown_key: .46 }
          : { [first!]: mode === "contradictory" ? .46 : .54, [second!]: mode === "invalid-distribution" ? .12 : mode === "contradictory" ? .54 : .46 };
        outcome.response.answers.draft_choice = {type:"choice", choice:first!, probabilities, confidence:.08};
        if (mode === "missing-confidence") delete (outcome.response.answers.draft_choice as {confidence?: number}).confidence;
        return outcome;
      },
    });
    expect(result.status).toBe("released");
    expect(finalRequests).toBe(mode === "single" ? 0 : 1);
    expect(progress.filter(row=>row.phase !== "released").every(row=>row.finalComparison === undefined)).toBe(true);
    expect(progress.at(-1)?.finalComparison).toEqual(result.receipt.finalComparison);
    if (mode === "normal" || mode === "incomplete-semifinal" || mode === "host-switch") {
      expect(result.receipt.finalComparison).toEqual({candidateAttempts:[1,3], preferredAttempt:1,
        probabilities:{draft_1:.54,draft_3:.46}, confidence:.08, model:jev.model});
      expect(result.receipt.selectedAttempt).toBe(mode === "host-switch" ? 3 : 1);
    } else expect(result.receipt.finalComparison).toBeUndefined();
  }
});

test("an unsafe pair preference cannot execute a rejected tool, and a generation error cannot cancel the other pair", async () => {
  const result = await runTeachingDrafts({ turn, ruleIds: [],
    generate: async ({attempt}) => {
      if (attempt === 3) throw Error("upstream unavailable");
      if (attempt === 1) return { ...generated(attempt), reply: { text: "", toolCalls: [{name: "unavailable", arguments: {secret: "private!"}}] } };
      return generated(attempt);
    },
    judge: async request => answers(request, request.questions.draft_pair_choice ? {draft_pair_choice:"draft_1"} : {}),
  });
  expect(result.status).toBe("released");
  expect(result.value).toBe(2);
  expect(result.reply?.toolCalls).toEqual([]);
  expect(result.receipt.attempts.map(a => a.status)).toEqual(["fail","pass","generation-error","pass"]);
  expect(result.receipt.pairReviews).toMatchObject([
    {pair:1,status:"compared",candidateAttempts:[1,2],preferredAttempt:1,eligibleAttempts:[2],finalistAttempt:2},
    {pair:2,status:"incomplete",candidateAttempts:[4],preferredAttempt:null,eligibleAttempts:[4],finalistAttempt:4},
  ]);
  expect(result.receipt.pairReviews![1]?.startedAtMs).toBeUndefined();
  expect(result.receipt.pairReviews![0]?.candidateIssueIds?.find(row => row.attempt === 1)?.issues).toContain("available_tool");
  expect(result.receipt.pairReviews![1]?.candidateIssueIds).toEqual([{ attempt: 4, issues: [] }]);
  expect(JSON.stringify(result.receipt)).not.toContain("private!");
});

test.each(["unavailable", "partial"] as const)("pair issues identify the affected sibling when another review is %s", async missing => {
  const drafts = ["Cu.", "Copper uses Cu, so you've mastered all the elements.", "The symbol is Cu.", "Copper is Cu."];
  const result = await runTeachingDrafts({
    turn: { ...turn, learnerMessage: "What is the symbol for copper?" },
    generate: async ({ attempt }) => ({ value: attempt, reply: { text: drafts[attempt - 1]!, toolCalls: [] } }),
    ruleIds: ["checkpoint_answer_leaked", "checkpoint_continued", "checkpoint_not_interactive", "direct_answer_missing",
      "assessed_work_completed", "mastery_overclaimed"],
    check: reply => reply.text === drafts[3] ? [{ id: "private host detail", source: "deterministic",
      severity: "critical", status: "fail", probability: 1 }] : [],
    judge: async request => {
      if (request.questions.learning_task) return answers(request, { learning_task: .99, direct_answer_requested: .99, plain_reply_requested: .99 });
      const reply = (request.state as { reply?: { text: string } }).reply;
      if (reply?.text === drafts[0]) return answers(request, { checkpoint_answer_leaked: .89 });
      if (reply?.text === drafts[1]) return answers(request, { mastery_overclaimed: .92, checkpoint_continued: .51 });
      if (reply?.text === drafts[2]) {
        if (missing === "unavailable") return { ok: false, error: { code: "backend-unavailable", retryable: true } };
        const outcome = answers(request);
        delete outcome.response.answers.mastery_overclaimed;
        return outcome;
      }
      return answers(request);
    },
  });
  expect(result.receipt.attempts[0]!.checks).toContainEqual({ id: "checkpoint_answer_leaked", status: "fail",
    source: "jev", severity: "major", probability: .89, applicability: "standalone-direct-answer" });
  expect(result.receipt.pairReviews?.map(pair => pair.candidateIssueIds)).toEqual([
    [{ attempt: 1, issues: [] }, { attempt: 2, issues: ["checkpoint_continued", "mastery_overclaimed"] }],
    [],
  ]);
  expect(result.receipt.pairReviews?.[1]?.candidateAttempts).toEqual([3, 4]);
  expect(result.value).toBe(1);
});

test("uses the planning provider's returned identity, honors caller caps, and preserves research collection", async () => {
  for (const config of [
    { backend: gemini, configured: jev, cap: undefined, count: 1, paired: false, collectAll: false },
    { backend: jev, configured: gemini, cap: undefined, count: 4, paired: true, collectAll: false },
    { backend: jev, configured: jev, cap: 2, count: 2, paired: true, collectAll: false },
    { backend: jev, configured: jev, cap: 5, count: 5, paired: false, collectAll: true },
  ]) {
    let calls = 0;
    const result = await runTeachingDrafts({ turn, ruleIds: [], maxAttempts:config.cap, collectAllAttempts:config.collectAll,
      judgementModel:{id:config.configured.model,requestTokens:null,stateQuestionTokens:null},
      judge:async request => answers(request, {}, config.backend),
      generate:async ({attempt})=>{calls++; return generated(attempt);},
    });
    expect(calls).toBe(config.count);
    expect(Boolean(result.receipt.pairReviews)).toBe(config.paired);
    if (config.paired && config.cap === 2) expect(result.receipt.pairReviews?.[1]).toMatchObject({status:"incomplete",candidateAttempts:[],finalistAttempt:null});
  }
});

test("a provider identity switch at review cannot authorize release through a pair preference", async () => {
  const result = await runTeachingDrafts({turn, ruleIds: [], generate: async ({attempt}) => generated(attempt),
    judge: async request => answers(request, {}, request.questions.quality_progress ? gemini : jev),
  });
  expect(result.status).toBe("withheld");
  expect(result.receipt.attempts.every(a => a.status === "unknown")).toBe(true);
  expect(result.receipt.pairReviews?.map(r=>r.eligibleAttempts)).toEqual([[],[]]);
  expect(result.value).toBeUndefined();
});

test("a long candidate may slide its own review window without removing the other three candidates' evidence", async () => {
  const conversation = Array.from({length: 8}, (_, i) => ({
    role: i % 2 ? "assistant" as const : "user" as const, content: `Original message ${i}. ${"A".repeat(500)}`,
  }));
  const seen = new Map<number, number>();
  const result = await runTeachingDrafts({
    turn: {...turn, conversation}, ruleIds: [],
    judgementModel: { id: jev.model, requestTokens: null, stateQuestionTokens: 6000 },
    generate: async ({attempt}) => ({ ...generated(attempt),
      reply: {text: String(attempt) + (attempt === 1 ? "L".repeat(10_000) : "X"), toolCalls: []} }),
    judge: async request => {
      if (request.questions.quality_progress) {
        const state = request.state as {reply: {text:string}; turn:{conversation: unknown[]}};
        seen.set(Number(state.reply.text[0]), state.turn.conversation.length);
      }
      return answers(request);
    },
  });
  expect(result.status).toBe("released");
  expect(seen.size).toBe(4);
  expect(seen.get(1)).toBeLessThan(conversation.length);
  for (const attempt of [2,3,4]) expect(seen.get(attempt)).toBe(conversation.length);
  expect(result.receipt.slides?.filter(s => s.phase === "checking").map(s => s.attempt)).toEqual([1]);
});

test("a hung pair comparison preserves the other pair's observed preference and releases within the deadline", async () => {
  const result = await runTeachingDrafts({
    turn, ruleIds: [], timeoutMs: 200, generate: async ({attempt}) => generated(attempt),
    judge: async request => {
      const choice = request.questions.draft_pair_choice;
      if (choice?.type === "choice") {
        if (Object.hasOwn(choice.criteria, "draft_3")) await new Promise<void>(() => {});
        return answers(request, { draft_pair_choice:"draft_2" });
      }
      return answers(request);
    },
  });
  expect(result.status).toBe("released");
  expect(result.value).toBe(2);
  expect(result.receipt.reason).toBe("time-budget-best-draft");
  expect(result.receipt.pairReviews).toMatchObject([
    { status:"compared", preferredAttempt:2, finalistAttempt:2 },
    { status:"unavailable", error:"backend-timeout", finalistAttempt:3 },
  ]);
});

test.each(["deadline","cancel"] as const)("an interrupted candidate respects %s with three reviewed siblings", async mode => {
  const controller = new AbortController();
  const progress: TeachingDraftSnapshot[] = [];
  let reviews = 0, calls = 0;
  const judge: JudgementCaller = async request => {
    if (request.questions.quality_progress && ++reviews === 3 && mode === "cancel") setTimeout(()=>controller.abort(),1);
    return answers(request);
  };
  const result = await runTeachingDrafts({ turn, ruleIds: [], timeoutMs:200, judge,signal:controller.signal,
    onProgress:s => progress.push(s),
    generate:async ({attempt})=>{calls++; if(attempt===2) await new Promise<void>(()=>{}); return generated(attempt);},
  });
  expect(calls).toBe(4);
  expect(result.status).toBe(mode === "cancel" ? "cancelled" : "released");
  expect(result.value).toBe(mode === "cancel" ? undefined : 1);
  expect(result.receipt.reason).toBe(mode === "cancel" ? "cancelled" : "time-budget-best-draft");
  expect(result.receipt.attempts.map(a=>a.status)).toEqual(["pass","generation-error","pass","pass"]);
  expect(progress.at(-1)?.phase).toBe(result.status);
});
