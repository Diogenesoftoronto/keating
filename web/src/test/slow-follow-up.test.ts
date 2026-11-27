import { describe, expect, test } from "bun:test";
import type { JudgementAnswer, JudgementCaller, JudgementRequest, TeachingFollowUpReceipt, TeachingPolicyCheck, TeachingPolicyTurn } from "@keating/learner-contracts";
import {
  CAPABILITY_DISCLAIMER,
  createSlowFollowUpWorker,
  decideFollowUp,
  followUpNote,
  runSlowFollowUp,
  type FastReplyCheck,
  type FastReplyRelease,
  type SlowFollowUpHost,
  type SlowFollowUpRequest,
} from "../keating/judgement/slow-follow-up";
import { DRAFT_GATE_JUDGE } from "./helpers/teaching-draft-judge";

const TURN: TeachingPolicyTurn = {
  learnerMessage: "What's the newest approved CRISPR therapy?",
  conversation: [], learnerEvidence: [], inlineLabAvailable: true, interactiveRepliesAvailable: true,
  availableTools: [], toolResults: [], sources: [], assessment: "unknown", improvementRuns: null, domain: "unknown",
};

/** Answers every yes/no question "no" (0) unless overridden, separately for reply checks and planning. */
function judge(overrides: { reply?: Record<string, number>; plan?: Record<string, number> } = {}, calls: JudgementRequest[] = []): JudgementCaller {
  return async request => {
    calls.push(request);
    const onReply = "reply" in (request.state as object);
    const answers: Record<string, JudgementAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type !== "noul") continue;
      answers[id] = { type: "noul", noul: (onReply ? overrides.reply : overrides.plan)?.[id] ?? 0 };
    }
    return { ok: true, response: { backend: DRAFT_GATE_JUDGE, answers } };
  };
}

function release(overrides: Partial<FastReplyRelease> = {}): FastReplyRelease {
  return { messageTimestamp: 1_000, releasedAt: 1_000, text: "Casgevy edits blood stem cells outside the body.", turn: TURN, judge: judge(), ...overrides };
}

function host(overrides: Partial<SlowFollowUpHost> & { busy?: boolean[]; newer?: number } = {}) {
  const posts: SlowFollowUpRequest[] = [];
  const records: { checks: readonly TeachingPolicyCheck[]; followUp: TeachingFollowUpReceipt }[] = [];
  const busy = overrides.busy ?? [];
  let idleWaits = 0;
  const value: SlowFollowUpHost = {
    isLive: () => true,
    isBusy: () => busy.length > 0 && busy.shift()!,
    whenIdle: async () => { idleWaits++; },
    learnerMessagesAfter: () => overrides.newer ?? 0,
    post: request => { posts.push(request); return true; },
    record: (_timestamp, update) => { records.push(update); },
    now: () => 2_000,
    ...overrides,
  };
  return { value, posts, records, idleWaits: () => idleWaits };
}

describe("slow follow-up decisions", () => {
  test("nothing found: the checks are recorded and no follow-up is posted", async () => {
    const calls: JudgementRequest[] = [];
    const h = host();
    const result = await runSlowFollowUp(release({ judge: judge({}, calls) }), h.value);
    expect(result.outcome).toBe("none");
    expect(h.posts).toHaveLength(0);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.followUp.outcome).toBe("none");
    // The reply's checks (with the disclaimer question) and the planner, asked in parallel.
    expect(calls).toHaveLength(2);
    expect(calls.some(request => CAPABILITY_DISCLAIMER in request.questions)).toBe(true);
    expect(h.records[0]!.checks.some(check => check.id === "direct_help_withheld" && check.status === "pass")).toBe(true);
  });

  test("a small fix goes to the fast model, and waits for idle when the learner is mid-turn", async () => {
    const h = host({ busy: [true, true, false] });
    const result = await runSlowFollowUp(release({ judge: judge({ reply: { direct_help_withheld: 0.95 } }) }), h.value);
    expect(result).toMatchObject({ outcome: "posted", kind: "quick", findings: ["direct_help_withheld"] });
    expect(h.idleWaits()).toBe(2);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]!.kind).toBe("quick");
    expect(h.posts[0]!.diverted).toBe(false);
    expect(h.posts[0]!.note).toContain("Give that help now");
  });

  test("a wrong \"I can't check\" is a quick fix", async () => {
    const h = host();
    const result = await runSlowFollowUp(release({ judge: judge({ reply: { [CAPABILITY_DISCLAIMER]: 0.9 } }) }), h.value);
    expect(result).toMatchObject({ outcome: "posted", kind: "quick", findings: [CAPABILITY_DISCLAIMER] });
  });

  test("a turn needing fresh sources goes to the slow model with its research notes", async () => {
    const prompts: string[] = [];
    const h = host({ research: async prompt => { prompts.push(prompt); return "Casgevy was approved in 2023. https://example.test/fda"; } });
    const result = await runSlowFollowUp(release({ judge: judge({ plan: { fresh_sources_needed: 0.9 } }) }), h.value);
    expect(result).toMatchObject({ outcome: "posted", kind: "work" });
    expect(prompts).toHaveLength(1);
    expect(h.posts[0]!.note).toContain("https://example.test/fda");
    expect(h.posts[0]!.note).toContain("untrusted data");
  });

  test("research that finds nothing to correct posts nothing", async () => {
    const h = host({ research: async () => "NOTHING" });
    const result = await runSlowFollowUp(release({ judge: judge({ plan: { fresh_sources_needed: 0.9 } }) }), h.value);
    expect(result.outcome).toBe("none");
    expect(h.posts).toHaveLength(0);
  });

  test("a leaked checkpoint answer is recorded but never followed up", async () => {
    const h = host();
    const result = await runSlowFollowUp(release({ judge: judge({ reply: { checkpoint_answer_leaked: 0.95 } }) }), h.value);
    expect(result.outcome).toBe("none");
    expect(h.records[0]!.checks.some(check => check.id === "checkpoint_answer_leaked" && check.status === "fail")).toBe(true);
  });

  test("an activity the planner recommends goes to the slow model", () => {
    const check: FastReplyCheck = { checks: [], freshSources: false, judgementMs: 1,
      interaction: { action: "create", families: [{ family: "quiz", components: ["Quiz"] }] } as unknown as FastReplyCheck["interaction"] };
    expect(decideFollowUp(check)).toMatchObject({ kind: "work", component: true, findings: ["interaction_recommended"] });
    expect(decideFollowUp({ ...check, interaction: { action: "none", families: [] } as unknown as FastReplyCheck["interaction"] })).toBeNull();
  });

  test("a replaced conversation aborts before posting and records nothing", async () => {
    let live = true;
    const slowJudge: JudgementCaller = async (request, signal) => { live = false; return judge({ reply: { direct_help_withheld: 0.95 } })(request, signal); };
    const h = host({ isLive: () => live });
    const result = await runSlowFollowUp(release({ judge: slowJudge }), h.value);
    expect(result.outcome).toBe("aborted");
    expect(h.posts).toHaveLength(0);
    expect(h.records).toHaveLength(0);
  });

  test("an abort signal stops a check that is still waiting", async () => {
    const controller = new AbortController();
    const hanging: JudgementCaller = () => new Promise(() => {});
    const h = host();
    const pending = runSlowFollowUp(release({ judge: hanging }), h.value, { signal: controller.signal });
    controller.abort();
    expect((await pending).outcome).toBe("aborted");
    expect(h.posts).toHaveLength(0);
  });

  test("one newer learner message diverts the follow-up, marks it and keeps it on the earlier turn", async () => {
    const h = host({ newer: 1 });
    const result = await runSlowFollowUp(release({ judge: judge({ reply: { direct_help_withheld: 0.95 } }) }), h.value);
    expect(result.outcome).toBe("diverted");
    expect(h.posts[0]!.diverted).toBe(true);
    expect(h.posts[0]!.note).toContain("Following up on my earlier reply about");
    expect(h.posts[0]!.note).toContain("Do not answer or repeat anything about the learner's newer messages");
    expect(h.posts[0]!.turn).toBe(TURN);
  });

  test("an activity for a topic the learner has moved on from is dropped", async () => {
    const h = host({ newer: 1 });
    const result = await runSlowFollowUp(release({ judge: judge({ reply: { practice_missing: 0.95 } }) }), h.value);
    expect(result.outcome).toBe("none");
    expect(h.posts).toHaveLength(0);
  });

  test("an activity suggestion alone is not worth a follow-up when the reply already asked something", () => {
    const interaction = { action: "create", families: [{ family: "quiz", components: ["Quiz"] }] } as unknown as FastReplyCheck["interaction"];
    const check: FastReplyCheck = { checks: [], freshSources: false, judgementMs: 1, interaction };
    expect(decideFollowUp(check, { asked: true })).toBeNull();
    expect(decideFollowUp(check, { asked: false })).toMatchObject({ findings: ["interaction_recommended"] });
    const withFix: FastReplyCheck = { ...check, checks: [{ id: "direct_help_withheld", source: "jev", severity: "major", status: "fail", probability: 0.9 }] };
    expect(decideFollowUp(withFix, { asked: true })?.findings).toEqual(["direct_help_withheld", "interaction_recommended"]);
  });

  test("research that clears the reply settles an unsupported-facts finding", async () => {
    const h = host({ research: async () => "NOTHING" });
    const result = await runSlowFollowUp(release({ judge: judge({ reply: { research_skipped: 0.95 } }) }), h.value);
    expect(result.outcome).toBe("none");
    expect(h.posts).toHaveLength(0);
    // A failed search is not a clean bill: the reviewed round still does the work.
    const failed = host({ research: async () => null });
    expect((await runSlowFollowUp(release({ judge: judge({ reply: { research_skipped: 0.95 } }) }), failed.value)).outcome).toBe("posted");
  });

  test("a follow-up not ready within the bound is diverted", async () => {
    const h = host({ now: () => 1_000 + 61_000 });
    const result = await runSlowFollowUp(release({ judge: judge({ reply: { direct_help_withheld: 0.95 } }) }), h.value, { divertAfterMs: 60_000 });
    expect(result.outcome).toBe("diverted");
  });

  test("another turn starting first is retried after it, then given up", async () => {
    let tries = 0;
    const h = host({ post: () => ++tries >= 2 });
    expect((await runSlowFollowUp(release({ judge: judge({ reply: { direct_help_withheld: 0.95 } }) }), h.value)).outcome).toBe("posted");
    expect(tries).toBe(2);
    const never = host({ post: () => false });
    expect((await runSlowFollowUp(release({ judge: judge({ reply: { direct_help_withheld: 0.95 } }) }), never.value, { postAttempts: 3 })).outcome).toBe("failed");
  });

  test("one background run per fast reply", async () => {
    const h = host();
    const worker = createSlowFollowUpWorker(h.value);
    const first = worker.start(release());
    expect(worker.start(release())).toBeNull();
    await first;
    expect(worker.start(release({ messageTimestamp: 2_000 }))).not.toBeNull();
    worker.dispose();
    expect(worker.start(release({ messageTimestamp: 3_000 }))).toBeNull();
  });

  test("the note never re-answers the question the reply asked", () => {
    const decision = { kind: "quick" as const, findings: ["direct_help_withheld"], research: false, component: false };
    const asked = followUpNote({ messageTimestamp: 1, text: "Multiply by the inner derivative.\n\nWhich part of sin(x²) would you differentiate first?" }, decision, { diverted: false });
    const plain = followUpNote({ messageTimestamp: 1, text: "The chain rule multiplies the derivatives." }, decision, { diverted: false });
    expect(asked).toContain("Do not answer it or give away its answer");
    expect(plain).not.toContain("Do not answer it");
  });
});
