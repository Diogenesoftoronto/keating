import { describe, expect, test } from "bun:test";
import { createGeminiDecisionCaller as sharedGeminiDecisionCaller } from "../packages/learner-contracts/src/index.js";
import type { JudgementRequest } from "../packages/learner-contracts/src/judgement/contracts.js";
import { projectTeachingPolicyDecision, teachingPolicyDecisionRequest, type TeachingPolicyTurn } from "../packages/learner-contracts/src/judgement/teaching-policy.js";
import { createGeminiDecisionCaller, GEMINI_DECISION_ENDPOINT, GEMINI_DECISION_MODEL, readGeminiDecisionUsage,
  type GeminiDecisionReceipt } from "../scripts/openui-diagnostics/gemini-decision.js";

const questions: JudgementRequest["questions"] = {
  yes: { type: "noul", instructions: "Is it damaged?", criteria: { true: "Broken", false: "Intact" } },
  resolution: { type: "choice", instructions: "Choose a route.", criteria: { repair: "Needs a repair", other: null } },
  severity: { type: "score", instructions: "Rate severity.", criteria: ["Cosmetic", "Workaround", "Blocked"] },
};
const request: JudgementRequest = { state: { context: [{ type: "image", uri: "synthetic/plain-data" }], note: "Line one.\nLine two." }, questions };
const usage = { total_input_tokens: 113, total_output_tokens: 0, total_tokens: 113, input_tokens_by_modality: [{ modality: "text", tokens: 113 }] };
const answers = {
  yes: { type: "noul", noul: .03, confidence: .97 },
  resolution: { type: "choice", choice: "repair", probabilities: { other: .17, repair: .83 }, confidence: .83 },
  severity: { type: "score", score: 1.12, legend: { "0": "Cosmetic", "1": "Workaround", "2": "Blocked" },
    probabilities: { "0": .03, "1": .83, "2": .15 }, confidence: .83 },
} as const;
const valid = { answers, usage };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
async function recorded(payload: unknown, status = 200) {
  const receipts: GeminiDecisionReceipt[] = [];
  const caller = createGeminiDecisionCaller({ apiKey: "test-key", fetch: async () => response(payload, status), onReceipt: r => { receipts.push(r); } });
  return { outcome: await caller(request), receipt: receipts[0]! };
}

describe("offline Google Decisions transport", () => {
  test("the classroom and the original studies share one transport", () => {
    expect(sharedGeminiDecisionCaller).toBe(createGeminiDecisionCaller);
  });

  test("sends the original JSON and rubric to the named Google endpoint and preserves reported probabilities", async () => {
    const signal = new AbortController().signal;
    const receipts: GeminiDecisionReceipt[] = [];
    let requests = 0;
    const caller = createGeminiDecisionCaller({ apiKey: "credential-fixture", onReceipt: item => { receipts.push(item); }, fetch: async (url, init) => {
      requests++;
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/decisions");
      expect(url).toBe(GEMINI_DECISION_ENDPOINT);
      expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "x-goog-api-key": "credential-fixture", "content-type": "application/json" } });
      expect(init.signal).toBe(signal);
      expect(JSON.parse(init.body)).toEqual({ model: "gemini-decision-1", input: JSON.stringify(request.state), questions: {
        yes: { type: "noul", instructions: questions.yes!.instructions, criteria: { true_description: "Broken", false_description: "Intact" } },
        resolution: { type: "choice", instructions: questions.resolution!.instructions, criteria: { repair: "Needs a repair", other: "" } }, severity: questions.severity,
      } });
      return response(valid);
    } });
    const result = await caller(request, signal);
    expect(requests).toBe(1);
    expect(result).toEqual({ ok: true, response: { backend: { backend: "system-one", model: GEMINI_DECISION_MODEL, calibrationSha256: null },
      usage: { inputTokens: 113, outputTokens: 0 }, answers: { yes: { type: "noul", noul: .03 }, resolution: answers.resolution, severity: answers.severity } } });
    expect(receipts).toEqual([{ provider: "google", requestedModel: GEMINI_DECISION_MODEL, reportedModel: null,
      modelProvenance: "documented-request-model", httpStatus: 200, usage: { inputTokens: 113, outputTokens: 0 }, errorCode: null }]);
    expect(JSON.stringify([result, receipts])).not.toContain("credential-fixture");
  });

  test("requires coherent identity and keeps the explicit response name distinct from the documented request name", async () => {
    for (const name of [GEMINI_DECISION_MODEL, `models/${GEMINI_DECISION_MODEL}`]) {
      const { outcome, receipt } = await recorded({ ...valid, model: name });
      expect(outcome.ok).toBe(true);
      expect(receipt).toMatchObject({ reportedModel: name, modelProvenance: "response-model" });
    }
    for (const overrides of [{ model: "jev-1.14.0" }, { model: "gemini-decision-latest" }, { model: null },
      { model: GEMINI_DECISION_MODEL, model_version: "unexpected-model" }, { unexpected: true }]) {
      const { outcome, receipt } = await recorded({ ...valid, ...overrides });
      expect(outcome).toMatchObject({ ok: false, error: { code: "response-malformed" } });
      expect(receipt).toMatchObject({ modelProvenance: "unverified", usage: { inputTokens: 113, outputTokens: 0 } });
    }
  });

  test("rejects partial, extra, non-probabilistic or inconsistent typed answers even when the HTTP call was billable", async () => {
    const malformed = [
      { yes: answers.yes }, { ...answers, unrelated: answers.yes },
      { ...answers, yes: { type: "noul", noul: .5 } }, { ...answers, yes: { ...answers.yes, noul: 1.3 } },
      { ...answers, yes: { ...answers.yes, confidence: .03 } }, { ...answers, yes: { ...answers.yes, generated: "unknown output" } },
      { ...answers, resolution: { ...answers.resolution, choice: "invented" } }, { ...answers, resolution: { ...answers.resolution, choice: "other" } },
      { ...answers, resolution: { ...answers.resolution, probabilities: { repair: .83 } } },
      { ...answers, resolution: { ...answers.resolution, probabilities: { ...answers.resolution.probabilities, invented: .01 } } },
      { ...answers, resolution: { ...answers.resolution, probabilities: { repair: .83, other: .82 } } },
      { ...answers, severity: { ...answers.severity, score: 99 } }, { ...answers, severity: { ...answers.severity, score: .1 } },
      { ...answers, severity: { ...answers.severity, legend: { "0": "Blocked", "1": "Workaround", "2": "Cosmetic" } } },
      { ...answers, severity: { ...answers.severity, probabilities: { "0": .03, "1": .97 } } },
    ];
    for (const partial of malformed) {
      const { outcome, receipt } = await recorded({ answers: partial, usage });
      expect(outcome).toMatchObject({ ok: false, error: { code: "response-malformed" } });
      expect(receipt.usage).toEqual({ inputTokens: 113, outputTokens: 0 });
    }
    expect((await recorded({ answers })).receipt.usage).toBeNull();
    const unexpectedBilling = { total_input_tokens: 20, total_output_tokens: 1, total_tokens: 21 };
    const invalidUsage = await recorded({ answers, usage: unexpectedBilling });
    expect(invalidUsage.outcome).toMatchObject({ ok: false, error: { code: "response-malformed" } });
    expect(invalidUsage.receipt.usage).toEqual({ inputTokens: 20, outputTokens: 1 });
    expect(readGeminiDecisionUsage({ usage: { input_tokens: 20, output_tokens: 0 } })).toBeNull();
  });

  test("returns authored errors without sensitive payloads, retries, or free-call assumptions", async () => {
    const reason = { "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com", reason: "API_KEY_INVALID" };
    const invalidKey = await recorded({ error: { details: [reason], message: "private provider detail" } }, 400);
    expect(invalidKey.outcome).toMatchObject({ ok: false, error: { code: "backend-unauthorized", retryable: false } });
    expect(invalidKey.receipt.errorCode).toBe("backend-unauthorized");
    expect(JSON.stringify(invalidKey)).not.toContain("private provider detail");
    const badRequest = await recorded({ error: { details: [{ ...reason, reason: "INVALID_ARGUMENT" }] } }, 400);
    expect(badRequest.outcome).toMatchObject({ ok: false, error: { code: "request-invalid" } });
    for (const [status, code] of [[400,"request-invalid"],[401,"backend-unauthorized"],[429,"backend-rate-limited"],[503,"backend-overloaded"],[504,"backend-timeout"]] as const) {
      const { outcome, receipt } = await recorded({ error: { message: "private provider detail" }, usage }, status);
      expect(outcome).toMatchObject({ ok: false, error: { code } });
      expect(receipt).toMatchObject({ httpStatus: status, usage: { inputTokens: 113, outputTokens: 0 }, errorCode: code });
      expect(JSON.stringify([outcome, receipt])).not.toContain("private provider detail");
    }
    let calls = 0;
    const receipts: GeminiDecisionReceipt[] = [];
    const caller = createGeminiDecisionCaller({ apiKey: "test", onReceipt: r => { receipts.push(r); }, fetch: async () => { calls++; throw Error("private provider detail"); } });
    expect(await caller(request)).toMatchObject({ ok: false, error: { code: "backend-unavailable" } });
    expect(calls).toBe(1);
    expect(receipts[0]).toMatchObject({ httpStatus: null, usage: null });
    expect(await caller(request, AbortSignal.abort())).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(await caller({ state: {}, questions: { "bad key": questions.yes! } })).toMatchObject({ ok: false, error: { code: "request-invalid" } });
    expect(calls).toBe(1);
    const controller = new AbortController();
    const interrupted = createGeminiDecisionCaller({ apiKey: "test", onReceipt: r => { receipts.push(r); },
      fetch: async () => { controller.abort(); return response(valid); } });
    expect(await interrupted(request, controller.signal)).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(receipts.at(-1)?.usage).toEqual({ inputTokens: 113, outputTokens: 0 });
  });

  test("normal teaching-plan questions pass through the injected caller to a product checkpoint recommendation", async () => {
    const turn: TeachingPolicyTurn = { learnerMessage: "Let me predict the next spin.", conversation: [], learnerEvidence: [],
      availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: 0, domain: "general" };
    const planRequest = teachingPolicyDecisionRequest(turn);
    const caller = createGeminiDecisionCaller({ apiKey: "fixture", fetch: async (_, init) => {
      const wire = JSON.parse(init.body);
      expect(wire.input).toBe(JSON.stringify(planRequest.state));
      expect(Object.keys(wire.questions)).toEqual(Object.keys(planRequest.questions));
      const decisions = Object.fromEntries(Object.keys(wire.questions).map(k => [k, { type: "noul", confidence: .99,
        noul: ["learner_response_due", "prediction_opportunity", "learning_task"].includes(k) ? .99 : .01 }]));
      return response({ answers: decisions, usage });
    } });
    const outcome = await caller(planRequest);
    const plan = projectTeachingPolicyDecision(turn, outcome);
    expect(outcome.ok).toBe(true);
    expect(plan.interaction.action).toBe("create");
    expect(plan.interaction.families.flatMap(f => f.components)).toContain("Question");
  });
});
