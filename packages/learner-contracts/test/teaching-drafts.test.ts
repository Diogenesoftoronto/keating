import { describe, expect, test } from "bun:test";
import { runTeachingDrafts, type TeachingDraftSnapshot } from "../src/judgement/teaching-drafts.js";
import type { TeachingPolicyTurn } from "../src/judgement/teaching-policy-types.js";
import type { JudgementCaller, JudgementRequest, JudgementAnswer } from "../src/judgement/contracts.js";
import { measureStateComposition } from "../src/judgement/state-metrics.js";

const turn: TeachingPolicyTurn = { learnerMessage: "Explain division.", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general" };
function answers(request: JudgementRequest, override: Record<string, string | number> = {}): Record<string, JudgementAnswer> {
  return Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === "choice") {
      const choice = typeof override[id] === "string" ? override[id] as string : id === "draft_standard" ? "concise" : id === "draft_reasoning" ? "low" : Object.keys(question.criteria)[0]!;
      return [id, { type: "choice", choice, confidence: 0.99, probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === choice ? 1 : 0])) }];
    }
    return [id, { type: "noul", noul: typeof override[id] === "number" ? override[id] : id.startsWith("quality_") ? 0.99 : 0.01 }];
  }));
}
const makeJudge = (mutate: (request: JudgementRequest) => Record<string, string | number> = () => ({})): JudgementCaller => async (request) => ({ ok: true, response: { answers: answers(request, mutate(request)), backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null }, usage: { inputTokens: 10, outputTokens: 2 } } });

describe("private draft loop", () => {
  test("preflight rebuilds the window and diagnostics measure each actual batch", async () => {
    const conversation = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `PRIVATE_TURN_${index} ${"x".repeat(400)}` }));
    const calls: JudgementRequest[] = [];
    const progress: TeachingDraftSnapshot[] = [];
    const result = await runTeachingDrafts({ turn: { ...turn, conversation },
      judgementModel: { id: "fixture", requestTokens: null, stateQuestionTokens: 4000 },
      onProgress: snapshot => progress.push(snapshot),
      judge: async (request, signal) => { calls.push(request); return makeJudge()(request, signal); },
      generate: async () => ({ reply: { text: "PRIVATE_REPLY", toolCalls: [] }, value: "ok" }),
    });
    expect(calls.length).toBeGreaterThan(0);
    const retained = (calls[0]!.state as { turn: TeachingPolicyTurn }).turn.conversation;
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.length).toBeLessThan(conversation.length);
    expect(retained).toEqual(conversation.slice(-retained.length));
    expect(result.receipt.stateHistory).toHaveLength(calls.length);
    expect(result.receipt.stateHistory!.map(sample => sample.state)).toEqual(calls.map(request => measureStateComposition(request, 4000)));
    expect(result.receipt.state).toEqual(measureStateComposition(calls.at(-1)!, 4000));
    expect(result.receipt.slides![0]!.after!.fillRatio).toBeLessThanOrEqual(.65);
    expect(progress.some(snapshot => snapshot.phase === "checking" && snapshot.state?.sections.reply.bytes! > 0)).toBe(true);
    expect(JSON.stringify(progress)).not.toContain("PRIVATE_");
  });

  test("the conversation window slides but active work is never evicted", async () => {
    const activeWork = { plan: { documentId: "plan", revision: 1, title: "Division", outline: [{ id: "groups", title: "Equal groups", status: "in_progress" as const, depth: 0 }] }, focus: null, openInteractions: [], truncated: false };
    const conversation = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `turn ${index} ${"x".repeat(400)}` }));
    const states: string[] = [];
    await runTeachingDrafts({
      turn: { ...turn, conversation, activeWork },
      judgementModel: { id: "fixture", requestTokens: null, stateQuestionTokens: 2_000 },
      judge: async (request, signal) => { states.push(JSON.stringify(request.state)); return makeJudge()(request, signal); },
      generate: async () => ({ reply: { text: "Division splits a quantity into equal groups.", toolCalls: [] }, value: "ok" }),
    });
    expect(states.length).toBeGreaterThan(0);
    expect(states.some((state) => !state.includes("turn 0 "))).toBe(true);
    for (const state of states) expect(state).toContain("Equal groups");
  });

  test("failed text never reaches diagnostics or revision context; only an approved value is returned", async () => {
    const updates: TeachingDraftSnapshot[] = [];
    const revisions: unknown[] = [];
    let generation = 0;
    const judge = makeJudge((request): Record<string, string | number> => JSON.stringify(request.state).includes("PRIVATE_REJECTED") ? { retention_overclaimed: 0.99 } : {});
    const result = await runTeachingDrafts({ turn, judge, onProgress: (snapshot) => updates.push(snapshot), generate: async (input) => {
      revisions.push(input.feedback);
      generation++;
      const text = generation === 1 ? "PRIVATE_REJECTED: you will remember this forever." : "Division splits a quantity into equal groups.";
      return { reply: { text, toolCalls: [] }, value: text };
    } });
    expect(result.status).toBe("released");
    expect(result.value).toBe("Division splits a quantity into equal groups.");
    expect(result.receipt.attempts.map(({ status }) => status)).toEqual(["fail", "pass"]);
    expect(JSON.stringify(updates)).not.toContain("PRIVATE_REJECTED");
    expect(JSON.stringify(revisions)).not.toContain("PRIVATE_REJECTED");
    expect(JSON.stringify(revisions)).toContain("retention_overclaimed");
    expect(result.receipt.judgeUsage).toEqual({ inputTokens: 40, outputTokens: 8 });
  });

  test("failed candidates cannot enter the selector and exhausted retries return no draft", async () => {
    const calls: JudgementRequest[] = [];
    let generated = 0;
    const base = makeJudge((request): Record<string, string | number> => request.questions.retention_overclaimed ? { retention_overclaimed: 0.99 } : {});
    const result = await runTeachingDrafts({ turn, maxAttempts: 2, judge: async (request, signal) => { calls.push(request); return base(request, signal); }, generate: async () => {
      generated++; return { reply: { text: "hidden", toolCalls: [] }, value: "MUST_NOT_ESCAPE" };
    } });
    expect(generated).toBe(2);
    expect(result.status).toBe("withheld");
    expect(result.value).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("MUST_NOT_ESCAPE");
    expect(calls.some((request) => request.questions.draft_choice)).toBe(false);
  });

  test("Jev can select the better passing option without exposing the other", async () => {
    let generated = 0;
    const result = await runTeachingDrafts({ turn, judge: makeJudge(() => ({ draft_standard: "supported", draft_choice: "draft_2" })), generate: async () => {
      generated++; return { reply: { text: `candidate ${generated}`, toolCalls: [] }, value: generated };
    } });
    expect(result.status).toBe("released");
    expect(result.value).toBe(2);
    expect(result.receipt.selectedAttempt).toBe(2);
    expect(result.receipt.attempts).toHaveLength(2);
  });

  test("selector no_match cannot fall back to an unchosen draft", async () => {
    const result = await runTeachingDrafts({ turn, judge: makeJudge(() => ({ draft_choice: "no_match" })), generate: async () => ({ reply: { text: "answer", toolCalls: [] }, value: "answer" }) });
    expect(result.status).toBe("withheld");
    expect(result.receipt.reason).toBe("selection-abstained");
    expect(result.value).toBeUndefined();
  });

  test("adaptive effort respects an explicit off ceiling and does not lower standards after failure", async () => {
    const levels: string[] = [];
    let n = 0;
    const result = await runTeachingDrafts({ turn, maxReasoning: "off", maxAttempts: 2, judge: makeJudge((request) => ({ draft_reasoning: "high", draft_standard: "deep", ...(request.questions.quality_progress ? { quality_progress: 0.5 } : {}) })), generate: async ({ reasoning }) => {
      levels.push(reasoning); n++; return { reply: { text: `candidate ${n}`, toolCalls: [] }, value: n };
    } });
    expect(levels).toEqual(["off", "off"]);
    expect(result.status).toBe("withheld");
    expect(result.receipt.qualityThreshold).toBe(0.85);
    expect(result.receipt.attempts.every(({ standard }) => standard === "deep")).toBe(true);
  });

  test("host schema/evidence failure cannot be overruled by Jev", async () => {
    const result = await runTeachingDrafts({ turn, maxAttempts: 1, judge: makeJudge(), check: () => [{ id: "schema", source: "deterministic", severity: "critical", status: "fail", probability: 1 }], generate: async () => ({ reply: { text: "answer", toolCalls: [] }, value: "answer" }) });
    expect(result.status).toBe("withheld");
  });

  test("off or unavailable judgment does not dispatch an actor", async () => {
    let generated = false;
    const result = await runTeachingDrafts({ turn, judge: async () => ({ ok: false, error: { code: "backend-unavailable", retryable: false } }), generate: async () => { generated = true; return { reply: { text: "secret", toolCalls: [] }, value: "secret" }; } });
    expect(generated).toBe(false);
    expect(result.status).toBe("withheld");
  });

  test("cancellation ignores late provider work and returns no text", async () => {
    const controller = new AbortController();
    const result = await runTeachingDrafts({ turn, judge: makeJudge(), signal: controller.signal, generate: async () => {
      controller.abort(); return { reply: { text: "late private response", toolCalls: [] }, value: "late private response" };
    } });
    expect(result.status).toBe("cancelled");
    expect(result.value).toBeUndefined();
  });

  test("total timeout bounds a provider that ignores its signal", async () => {
    const result = await runTeachingDrafts({ turn, judge: makeJudge(), timeoutMs: 10, generate: () => new Promise(() => {}) });
    expect(result.status).toBe("withheld");
    expect(result.receipt.reason).toBe("time-budget");
  });

  test("review and release use the same detached reply even if a provider mutates its object", async () => {
    const reply = { text: "original answer", toolCalls: [] };
    const value = { text: "native metadata" };
    const base = makeJudge();
    const result = await runTeachingDrafts({ turn, judge: async (request, signal) => {
      if (request.questions.quality_progress) { reply.text = "UNREVIEWED_MUTATION"; value.text = "UNREVIEWED_MUTATION"; }
      return base(request, signal);
    }, generate: async () => ({ reply, value }) });
    expect(result.status).toBe("released");
    expect(result.reply?.text).toBe("original answer");
    expect(result.value?.text).toBe("native metadata");
    expect(JSON.stringify(result)).not.toContain("UNREVIEWED_MUTATION");
  });

  test("selection retains full evidence and explicitly narrows only approved candidates to fit", async () => {
    const largeTurn = { ...turn, learnerEvidence: [{ kind: "source", content: "e".repeat(78_000) }] };
    const result = await runTeachingDrafts({ turn: largeTurn, judge: makeJudge(() => ({ draft_standard: "supported" })),
      generate: async () => ({ reply: { text: "a".repeat(10_000), toolCalls: [] }, value: "approved" }) });
    expect(result.status).toBe("released");
    expect(result.receipt.selectionCandidateAttempts).toEqual([1]);
    expect(result.receipt.selectionOmittedForBudget).toEqual([2]);
    expect(result.reply?.text).toHaveLength(10_000);
  });
});

describe("paired interactive and prose drafts", () => {
  const simulation = (extra: Record<string, string | number> = {}) => (request: JudgementRequest): Record<string, string | number> =>
    request.questions.learning_task ? { draft_standard: "supported", learning_task: 0.95, variable_relationship: 0.95, ...extra } : {};
  const collect = () => {
    const prompts: string[] = [];
    const generate = async (input: { systemPrompt: string }) => { prompts.push(input.systemPrompt); return { reply: { text: `candidate ${prompts.length}`, toolCalls: [] }, value: prompts.length }; };
    return { prompts, generate };
  };

  test("an activity recommendation pairs a required-activity draft against a prose draft, order randomized", async () => {
    for (const [roll, order] of [[0.1, ["interactive", "prose"]], [0.9, ["prose", "interactive"]]] as const) {
      const { prompts, generate } = collect();
      const result = await runTeachingDrafts({ turn, random: () => roll, judge: makeJudge(simulation()), generate });
      expect(result.receipt.attempts.map(({ variant }) => variant)).toEqual([...order]);
      const interactive = prompts[order.indexOf("interactive")]!;
      const prose = prompts[order.indexOf("prose")]!;
      expect(interactive).toContain("Include exactly one OpenUI activity this turn: Simulation");
      expect(interactive).not.toContain("At most one OpenUI activity");
      expect(prose).toContain("Answer without a new OpenUI activity this turn.");
      expect(prose).not.toContain("Simulation");
      expect(result.receipt.interaction).toMatchObject({ action: "create", paired: true, features: ["variable_relationship"], families: [{ family: "manipulable", components: ["Simulation"] }] });
      expect(result.receipt.planningMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("the selector sees draft keys only, never variant labels", async () => {
    const selections: JudgementRequest[] = [];
    const base = makeJudge(simulation());
    const { generate } = collect();
    await runTeachingDrafts({ turn, random: () => 0.1, generate, judge: async (request, signal) => {
      if (request.questions.draft_choice) selections.push(request);
      return base(request, signal);
    } });
    expect(selections).toHaveLength(1);
    const text = JSON.stringify(selections[0]);
    for (const label of ["interactive", "prose", "variant"]) expect(text).not.toContain(label);
    expect(Object.keys((selections[0]!.state as { candidates: object }).candidates)).toEqual(["draft_1", "draft_2"]);
  });

  test("a revision repairs the same variant before drafting the other", async () => {
    let checks = 0;
    const judge = makeJudge((request) => {
      if (request.questions.learning_task) return simulation()(request);
      return request.questions.retention_overclaimed && ++checks === 1 ? { retention_overclaimed: 0.99 } : {};
    });
    const { generate } = collect();
    const result = await runTeachingDrafts({ turn, random: () => 0.1, judge, generate });
    expect(result.receipt.attempts.map(({ variant, status }) => `${variant}:${status}`)).toEqual(["interactive:fail", "interactive:pass", "prose:pass"]);
  });

  test("no recommendation, grade-first, or a concise standard stays unpaired", async () => {
    const plain = await runTeachingDrafts({ turn, judge: makeJudge(() => ({ draft_standard: "supported" })), generate: collect().generate });
    expect(plain.receipt.attempts.map(({ variant }) => variant)).toEqual(["default", "default"]);
    expect(plain.receipt.interaction).toMatchObject({ action: "none", paired: false });

    const concise = collect();
    const short = await runTeachingDrafts({ turn, judge: makeJudge(simulation({ draft_standard: "concise" })), generate: concise.generate });
    expect(concise.prompts).toHaveLength(1);
    expect(short.receipt.attempts.map(({ variant }) => variant)).toEqual(["default"]);
    expect(short.receipt.interaction).toMatchObject({ action: "create", paired: false });
    expect(concise.prompts[0]).toContain("At most one OpenUI activity");

    const pending = await runTeachingDrafts({ turn: { ...turn, pendingSubmissions: [{ kind: "quiz", id: "q", questionIds: ["a"] }] }, judge: makeJudge(simulation()), generate: collect().generate });
    expect(pending.receipt.interaction).toMatchObject({ action: "grade-first", paired: false });
    expect(pending.receipt.attempts.every(({ variant }) => variant === "default")).toBe(true);
  });
});
