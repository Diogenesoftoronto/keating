import { expect, test } from "bun:test";
import { TUTOR_RATE_LIMIT_MESSAGE } from "@keating/learner-contracts";
import { createMobileTeachingDraftRound, MOBILE_WITHHELD_TEACHING_REPLY } from "../src/lib/judgement/teaching-drafts";
import { createMobileJudgementRuntime } from "../src/lib/judgement/runtime";
import { settingsForProvider } from "../src/lib/provider-config";
import { acceptingTeachingJudge, EMPTY_LEARNER_DATA } from "./helpers/judgement-fixtures";

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
