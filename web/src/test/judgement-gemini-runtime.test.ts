import { afterEach, expect, test } from "bun:test";
import { GEMINI_DECISION_ENDPOINT, GEMINI_DECISION_MODEL, runTeachingDrafts, type JudgementRequest } from "@keating/learner-contracts";
import { getAppStorage, setAppStorage, type AppStorage } from "../keating/app-storage";
import { DEFAULT_JUDGEMENT_MODEL_SETTINGS } from "../keating/judgement-model";
import { createDraftGateJudgementCaller } from "../keating/judgement/draft-gate";
import { GEMINI_DECISION_KEY_ID } from "../keating/judgement/gemini-key";
import { createWebJudgementRuntime } from "../keating/judgement/runtime";
import { answerDraftGateReview } from "./helpers/teaching-draft-judge";

const originalFetch = globalThis.fetch;
let previous: AppStorage | undefined;
try { previous = getAppStorage(); } catch {}
afterEach(() => { globalThis.fetch = originalFetch; setAppStorage(previous!); });
const settings = { ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, hostedProvider: "gemini-decision" as const, customModel: "unrelated-jev-id" };
const request = { state: "A synthetic learner answer", questions: { valid: { type: "noul" as const, instructions: "Is the answer valid?" } } };
function configure(key: string | null) {
  setAppStorage({ providerKeys: { get: async (id: string) => {
    expect(id).toBe(GEMINI_DECISION_KEY_ID);
    return key;
  } } } as unknown as AppStorage);
  return createWebJudgementRuntime({ settings, calibration: {}, localScorer: {
    modelId: settings.localModelId, scoreLabels: async () => { throw Error("Unexpected local dispatch"); },
  } });
}

test("real web judgement selection plans and reviews one ordinary tutor reply on Google's native wire", async () => {
  const runtime = configure("synthetic-google-review-key");
  expect(runtime.judgementModel).toEqual({ id: GEMINI_DECISION_MODEL, requestTokens: 64000, stateQuestionTokens: 32000 });
  expect(runtime.policy.tiers.map(tier => tier.key.model)).toEqual([GEMINI_DECISION_MODEL]);
  const rounds: string[][] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe(GEMINI_DECISION_ENDPOINT);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    const headers = new Headers(init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("synthetic-google-review-key");
    expect(headers.has("authorization")).toBe(false);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(GEMINI_DECISION_MODEL);
    rounds.push(Object.keys(body.questions));
    const result = answerDraftGateReview({ state: JSON.parse(body.input), questions: body.questions } as JudgementRequest);
    if (!result.ok) throw Error("Bad test request");
    const answers = Object.fromEntries(Object.entries(result.response.answers).map(([id, value]) =>
      [id, value.type === "noul" ? { type: "noul", noul: value.noul > .5 ? .99 : .01, confidence: .99 } : value]));
    for (const [id, question] of Object.entries(body.questions as JudgementRequest["questions"])) {
      if (question.type === "score") answers[id] = { type: "score", score: 0, confidence: 1,
        legend: Object.fromEntries(question.criteria.entries()),
        probabilities: Object.fromEntries(question.criteria.map((_, i) => [i, i === 0 ? 1 : 0])),
      };
    }
    return Response.json({ answers, usage: { total_input_tokens: 450, total_output_tokens: 0 } });
  }) as typeof fetch;
  const result = await runTeachingDrafts({ judge: createDraftGateJudgementCaller(runtime), judgementModel: runtime.judgementModel,
    configuredDecisionModel: runtime.judgementModel?.id, turn: { learnerMessage: "What is four factorial?", conversation: [],
      learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general" },
    generate: async ({attempt}) => ({ value: attempt, reply: { text: "Four factorial is 24.", toolCalls: [] } }),
  });
  expect({status:result.status, reason:result.receipt.reason, failure:result.receipt.decisionFailure}).toEqual({status:"released",reason:null,failure:undefined});
  expect(result.value).toBe(1);
  expect(result.receipt.judgeModel).toBe(GEMINI_DECISION_MODEL);
  expect(result.receipt.pairReviews).toBeUndefined();
  expect(rounds.some(ids => ids.includes("draft_standard"))).toBe(true);
  expect(rounds.some(ids => ids.includes("quality_progress"))).toBe(true);
  expect(rounds.flat()).not.toContain("draft_pair_choice");
});

test("missing, invalid and refused Google keys stay failed on the selected reviewer", async () => {
  let dispatches = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    expect(String(url)).toBe(GEMINI_DECISION_ENDPOINT);
    dispatches++;
    return Response.json({ error: { message: "private upstream explanation" } }, { status: 403 });
  }) as typeof fetch;
  for (const key of [null, "invalid\nheader", "wrong-google-key"]) {
    const result = await createDraftGateJudgementCaller(configure(key))(request);
    expect(result).toMatchObject({ ok: false, error: { code: "backend-unauthorized" } });
    expect(JSON.stringify(result)).not.toContain("private");
  }
  expect(dispatches).toBe(1);
  expect((await createDraftGateJudgementCaller(configure("valid-format"))(request, AbortSignal.abort()))).toMatchObject({ ok:false, error:{code:"cancelled"} });
  expect(dispatches).toBe(1);
});
