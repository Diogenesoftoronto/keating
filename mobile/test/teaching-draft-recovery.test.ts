import { expect, test } from "bun:test";
import { TUTOR_RATE_LIMIT_MESSAGE, type JudgementRequest, type TeachingPolicyTurn } from "@keating/learner-contracts";
import { createMobileTeachingDraftRound, MOBILE_WITHHELD_TEACHING_REPLY } from "../src/lib/judgement/teaching-drafts";
import { createMobileJudgementRuntime } from "../src/lib/judgement/runtime";
import { settingsForProvider } from "../src/lib/provider-config";
import { buildProviderRequest } from "../src/lib/provider-client";
import { runMobileToolLoop } from "../src/lib/provider-tool-loop";
import { acceptingTeachingJudge, EMPTY_LEARNER_DATA } from "./helpers/judgement-fixtures";
import { estimatedRequestTokens, estimatedStateQuestionTokens } from "../../packages/learner-contracts/src/judgement/state-metrics";
import { createMobileJudgementRuntime, mobileTeachingDraftReviewers } from "../src/lib/judgement/runtime";
import { MOBILE_JULIA_MODEL } from "../src/lib/judgement/julia-contract";

test.each([false, true])("native teaching retries incomplete local planning with the complete history on its permitted hosted reviewer (partial %s)", async partial => {
  const history = Array.from({ length: 36 }, (_, index) => ({ id: String(index), role: index % 2 ? "assistant" as const : "user" as const,
    content: `Exchange ${index}. ${"Use groups of counters to illustrate the example. ".repeat(14)}`, createdAt: index }));
  const hostedTurns: TeachingPolicyTurn[] = [];
  const localCounts = new Set<number>();
  let skipped = false;
  const runtime = createMobileJudgementRuntime({ hostedEnabled: true, localEnabled: true, localModel: MOBILE_JULIA_MODEL,
    localConsent: async () => true, consent: async () => true,
    localScorer: async ({ state, instructions, labels }) => {
      localCounts.add((state as { turn: TeachingPolicyTurn }).turn.conversation.length);
      if (partial && !skipped) { skipped = true; return null; }
      const quality = instructions.startsWith("Does `reply` make substantive progress") || instructions.startsWith("Does the scope of the reply fit");
      const choice = quality ? "yes" : labels[0];
      return labels.map(label => Number(label === choice));
    },
    request: async body => {
      const input = JSON.parse(body) as JudgementRequest & { state: string };
      const state = JSON.parse(input.state) as { turn: TeachingPolicyTurn };
      hostedTurns.push(state.turn);
      const outcome = await acceptingTeachingJudge({ ...input, state });
      if (!outcome.ok) throw new Error("Expected a fixture judgement");
      return Response.json({ model: "judgement-jev/jev-1.14.0", answers: outcome.response.answers });
    },
  });
  const round = createMobileTeachingDraftRound({ judge: runtime.call, reviewers: mobileTeachingDraftReviewers(runtime.policy),
    current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    request: async () => ({ text: "Four factorial is 24.", calls: [], assistantTurn: null, usage: null }),
  });
  const result = await round(settingsForProvider("openai"), null, [...history, { id: "latest", role: "user", content: "What is four factorial?", createdAt: 99 }]);
  expect(result.text).toBe("Four factorial is 24.");
  expect(localCounts.size).toBeGreaterThan(0);
  expect(Math.max(...localCounts)).toBeLessThan(history.length);
  if (partial) {
    expect(hostedTurns.length).toBeGreaterThan(1);
    const expected = history.map(({ role, content }) => ({ role, content }));
    for (const turn of hostedTurns) expect(turn.conversation).toEqual(expected);
  } else {
    expect(hostedTurns).toHaveLength(0);
  }
});

test("revoking native local consent during planning stops before hosted fallback", async () => {
  let consent = true, hostedCalls = 0, draftCalls = 0;
  const runtime = createMobileJudgementRuntime({ hostedEnabled: true, localEnabled: true, localModel: MOBILE_JULIA_MODEL,
    localConsent: async () => consent, localScorer: async () => { consent = false; return null; },
    request: async () => { hostedCalls++; return new Response(null, { status: 403 }); } });
  const round = createMobileTeachingDraftRound({ judge: runtime.call, reviewers: mobileTeachingDraftReviewers(runtime.policy),
    current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    request: async () => { draftCalls++; return { text: "Private draft", calls: [], assistantTurn: null, usage: null }; } });
  const result = await round(settingsForProvider("openai"), null, [{ id: "latest", role: "user", content: "What is four factorial?", createdAt: 99 }]);
  expect(result.text).toBe("Decision planning stopped before the tutor could draft a reply. The decision request was cancelled.");
  expect(consent).toBe(false);
  expect(hostedCalls).toBe(0);
  expect(draftCalls).toBe(0);
});

test("the native draft host sends each judgement batch within its active scorer's token budgets", async () => {
  const runtime = createMobileJudgementRuntime({ hostedEnabled: false, localEnabled: true, localModel: MOBILE_JULIA_MODEL });
  const measured: { request: number; question: number }[] = [];
  const round = createMobileTeachingDraftRound({ judgementModel: mobileTeachingDraftReviewers(runtime.policy)[0]!.judgementModel,
    current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    judge: async request => {
      measured.push({ request: estimatedRequestTokens(request), question: estimatedStateQuestionTokens(request) });
      return acceptingTeachingJudge(request);
    },
    request: async () => ({ text: "Four factorial is 24.", calls: [], assistantTurn: null, usage: null }),
  });
  const history = Array.from({ length: 36 }, (_, index) => ({ id: String(index), role: index % 2 ? "assistant" as const : "user" as const,
    content: "An earlier exchange about grouping numbers. ".repeat(14), createdAt: index }));
  await round(settingsForProvider("openai"), null, [...history, { id: "latest", role: "user", content: "What is four factorial?", createdAt: 99 }]);
  expect(measured.length).toBeGreaterThan(0);
  expect(Math.max(...measured.map(call => call.request))).toBeGreaterThan(2_048 * 0.8);
  for (const call of measured) {
    expect(call.request).toBeLessThanOrEqual(2_048);
    expect(call.question).toBeLessThanOrEqual(2_048);
  }
});

test("a gateway question-size limit splits the native check without evicting any history", async () => {
  const history = [{ id: "first", createdAt: 1, role: "user" as const, content: "Use an example with apples." },
    { id: "reply", createdAt: 2, role: "assistant" as const, content: "How many apples?" }];
  const seen: number[] = [];
  const round = createMobileTeachingDraftRound({ current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    judgementModel: mobileTeachingDraftReviewers(createMobileJudgementRuntime({ hostedEnabled: true }).policy)[0]!.judgementModel, maxQuestionChars: 2_500,
    judge: async request => {
      const state = request.state as { turn?: { conversation: unknown[] } };
      if (state.turn) expect(state.turn.conversation).toEqual(history.map(({ role, content }) => ({ role, content })));
      seen.push(JSON.stringify(request.questions).length);
      return acceptingTeachingJudge(request);
    },
    request: async () => ({ text: "Divide six apples into two groups of three.", calls: [], assistantTurn: null, usage: null }),
  });
  await round(settingsForProvider("openai"), null, [...history, { id: "latest", role: "user", content: "Six, split into two groups.", createdAt: 3 }]);
  expect(seen.length).toBeGreaterThan(1);
  expect(Math.max(...seen)).toBeLessThanOrEqual(2_500);
});

test("native final recovery disables tools while preserving selected model and answers the learner", async () => {
  let calls = 0;
  const request = createMobileTeachingDraftRound({ judge: acceptingTeachingJudge, current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    request: async (settings, _key, messages, options) => {
      calls++; expect(settings.model).toBe("selected-teacher"); expect(messages[0]!.content).toBe("What is four factorial?");
      if (options?.tools?.length === 0) {
        expect(options.systemPrompt).toContain("Do not claim actions");
        return { text: "Four factorial is 24.", calls: [], assistantTurn: null, usage: null };
      }
      return { text: "", calls: [{ id: "invalid", name: "unknown_tool", arguments: {} }], assistantTurn: null, usage: null };
    } });
  const result = await request({ ...settingsForProvider("openai"), model: "selected-teacher" }, "key",
    [{ id: "user", role: "user", content: "What is four factorial?", createdAt: 1 }],
    { tools: [{ name: "workspace_inspect", description: "Read", parameters: { type: "object", properties: {} } }] });
  expect(calls).toBe(3); expect(result.text).toBe("Four factorial is 24."); expect(result.calls).toEqual([]);
});

test.each([429, 503])("native classroom attributes a tutor HTTP %i using the response status and keeps the provider body private", async status => {
  let tutorRequests = 0;
  let judgeRequests = 0;
  const request = createMobileTeachingDraftRound({
    current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased() {},
    judge: async (input, signal) => {
      judgeRequests++;
      const outcome = await acceptingTeachingJudge(input, signal);
      return outcome.ok ? { ...outcome, response: { ...outcome.response,
        backend: { backend: "system-one", model: "jev-fixture", calibrationSha256: null } } } : outcome;
    },
  });
  const result = await request(settingsForProvider("minimax"), "fixture",
    [{ id: "learner", role: "user", content: "Can I predict what happens?", createdAt: 1 }], {
      fetchImpl: async () => {
        tutorRequests++;
        const message = status === 429 ? "PRIVATE upstream detail" : "HTTP 429 is in this PRIVATE upstream detail";
        return Response.json({error: { message }}, {status});
      },
    });
  expect([tutorRequests, judgeRequests]).toEqual([4, 1]);
  expect(result).toEqual({ text: status === 429 ? TUTOR_RATE_LIMIT_MESSAGE : MOBILE_WITHHELD_TEACHING_REPLY,
    calls: [], assistantTurn: null, usage: null });
});

test("native decision planning denial identifies the configured router alias without starting the tutor or leaking the denied response", async () => {
  let decisionRequests = 0;
  let tutorRequests = 0;
  const runtime = createMobileJudgementRuntime({
    hostedEnabled: true,
    request: async () => {
      decisionRequests++;
      return Response.json({failure:"PRIVATE denial relay-origin-denied"}, {status:403, headers:{"X-Keating-Judgement-Error":"relay-origin-denied"}});
    },
  });
  const model = runtime.policy.tiers[0]!.key.model;
  const round = createMobileTeachingDraftRound({judge:runtime.call, configuredDecisionModel:model,
    current:() => true, evidence:async () => EMPTY_LEARNER_DATA, onReleased() {},
    request:async () => { tutorRequests++; throw Error("unexpected tutor request"); }});
  const reply = await round(settingsForProvider("minimax"), "fixture",
    [{id:"learner",role:"user",content:"PRIVATE answer",createdAt:1}]);
  expect([decisionRequests,tutorRequests]).toEqual([1,0]);
  expect(reply.text).toContain("Decision planning stopped before the tutor could draft a reply");
  expect(reply.text).toContain("denied access");
  expect(reply.text).toContain(model);
  expect(reply.text).not.toMatch(/PRIVATE|relay-origin-denied|rejected the page/);
  expect(reply).toMatchObject({usage:null,assistantTurn:null,calls:[]});
});

test("LiteRT keeps its single generation lease and publishes one reviewed answer", async () => {
  let generations = 0;
  const round = createMobileTeachingDraftRound({
    current: () => true, evidence: async () => EMPTY_LEARNER_DATA, onReleased: () => {},
    judge: async request => {
      const outcome = await acceptingTeachingJudge(request);
      if (!outcome.ok || !outcome.response.answers.identity_invented) return outcome;
      return { ...outcome, response: { ...outcome.response, answers: { ...outcome.response.answers,
        identity_invented: { type: "noul", noul: 0 } } } };
    },
    request: async () => { generations++; return { text: "Four factorial is 24.", calls: [], assistantTurn: null, usage: null }; },
  });
  const result = await round(settingsForProvider("litert"), null, [{ id: "u1", role: "user", content: "What is four factorial?", createdAt: 1 }]);
  expect(result.text).toBe("Four factorial is 24.");
  expect(generations).toBe(1);
});

test.each(["complete", "abort", "unexpected-tool"] as const)("native staged reply handles %s without repeating the opening or running a private tool", async mode => {
  const opening = "A square number is an integer multiplied by itself.";
  const addition = "For example, three times three is nine.";
  const deltas: string[] = [];
  const controller = new AbortController();
  let allowAddition!: () => void;
  const waiting = new Promise<void>(resolve => { allowAddition = resolve; });
  let openingSeen!: () => void;
  const shown = new Promise<void>(resolve => { openingSeen = resolve; });
  let attempts = 0;
  let recorded: string | undefined;
  const requestRound = createMobileTeachingDraftRound({
    current: () => !controller.signal.aborted, evidence: async () => EMPTY_LEARNER_DATA,
    onReleased: selection => { recorded = selection?.candidate.reply.text; },
    judge: async request => {
      const outcome = await acceptingTeachingJudge(request);
      if (!outcome.ok) return outcome;
      const reply = (request.state as { reply?: { text: string } }).reply?.text;
      const answers = { ...outcome.response.answers };
      if (answers.identity_invented) answers.identity_invented = { type: "noul", noul: Number(reply?.includes("PRIVATE")) };
      if (answers.requested_part_missing) answers.requested_part_missing = { type: "noul", noul: Number(!reply?.includes(addition)) };
      return { ...outcome, response: { ...outcome.response, answers } };
    },
    request: async (settings, key, messages, options) => {
      const attempt = ++attempts;
      expect(options?.onTextDelta).toBeUndefined();
      expect(options?.onReasoningDelta).toBeUndefined();
      expect(options?.onToolCall).toBeUndefined();
      const usage = { inputTokens: 2, outputTokens: 1, totalTokens: 3 };
      if (attempt < 3) return { text: attempt === 1 ? opening : "PRIVATE alternative", calls: [], assistantTurn: null, usage };
      expect(options?.tools).toEqual([]);
      expect(options?.systemPrompt).not.toContain(opening);
      const data = { role: "user", content: JSON.stringify({ publishedText: opening }) };
      const body = JSON.parse(String(buildProviderRequest(settings, key, messages, options).init.body));
      expect(body.input.at(-1)).toEqual(data);
      const afterTools = JSON.parse(String(buildProviderRequest(settings, key, messages, { ...options,
        continuation: { provider: "openai", previousResponseId: "previous", results: [{ name: "read", callId: "retrieval", output: { text: "evidence" } }] },
      }).init.body));
      expect(afterTools.previous_response_id).toBe("previous");
      expect(afterTools.input).toEqual([{ type: "function_call_output", call_id: "retrieval", output: '{"text":"evidence"}' }, data]);
      await waiting;
      return { text: addition, calls: mode === "unexpected-tool" ? [{ id: "bad", name: "write", arguments: {} }] : [], assistantTurn: null, usage };
    },
  });
  const task = runMobileToolLoop(settingsForProvider("openai"), null, [{ id: "u1", role: "user", createdAt: 1, content: "Define a square number and give an example." }], {
    sessionId: "staged-native", triggeringMessageId: "u1", createdAt: 1, signal: controller.signal, requestRound,
    onTextDelta: delta => { deltas.push(delta); openingSeen(); },
    commitToolCall: async () => { throw new Error("A private tool reached the executor."); },
  });
  try {
    await shown;
    expect(deltas).toEqual([opening]);
    if (mode === "abort") controller.abort();
    allowAddition();
    if (mode === "abort") {
      await expect(task).rejects.toMatchObject({ name: "AbortError" });
      expect(deltas).toEqual([opening]);
      expect(recorded).toBeUndefined();
      return;
    }
    const final = await task;
    expect(deltas).toEqual(mode === "complete" ? [opening, "\n\n" + addition] : [opening]);
    expect(final).toMatchObject({ text: deltas.join(""), toolCalls: 0, usage: { totalTokens: 9 } });
    expect(recorded).toBe(final.text);
  } finally { allowAddition(); }
});
