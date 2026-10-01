import { describe, expect, test } from "bun:test";
import { type JudgementRequest } from "@keating/learner-contracts";
import { createCustomJudgementBackend, CUSTOM_JUDGEMENT_ENDPOINT } from "../keating/judgement/custom-backend";

const request: JudgementRequest = { state: { learner: "Evidence" }, questions: {
  yes: { type: "noul", instructions: "Is this correct?" },
  which: { type: "choice", instructions: "Choose", criteria: { a: "First", b: null } },
  level: { type: "score", instructions: "Assess", criteria: ["Incomplete", "Complete"] },
} };
const answers = {
  yes: { type: "noul", noul: 0.8 },
  which: { type: "choice", choice: "a", probabilities: { a: 0.8, b: 0.2 }, confidence: 0.8 },
  level: { type: "score", score: 0.7, legend: { "0": "Incomplete", "1": "Complete" },
    probabilities: { "0": 0.3, "1": 0.7 }, confidence: 0.7 },
} as const;
const config = { model: "jev-latest", apiKey: "user-secret" };
const response = () => Response.json({ model: "jev-2026-09", answers, usage: { input_tokens: 12, output_tokens: 4 } });

describe("custom TypeSafe judgement", () => {
  test("relays user key separately from the typed body and records resolved identity", async () => {
    let captured: RequestInit | undefined;
    const options = { ...config, fetch: async (url: string, init: RequestInit) => {
      expect(url).toBe(CUSTOM_JUDGEMENT_ENDPOINT);
      captured = init;
      return response();
    } };
    const backend = createCustomJudgementBackend(options)!;
    options.apiKey = "changed-key";
    options.model = "changed-model";
    expect(backend.isAvailable?.()).toBe(true);
    const result = await backend.call(request);
    expect(captured?.redirect).toBe("error");
    expect(captured?.credentials).toBe("omit");
    expect(captured?.headers).toEqual({ "content-type": "application/json", authorization: "Bearer user-secret" });
    expect(JSON.parse(captured?.body as string)).toEqual({ ...request, model: "jev-latest" });
    expect(captured?.body).not.toContain("user-secret");
    expect(result).toEqual({ ok: true, response: { answers,
      backend: { backend: "system-one", model: "jev-2026-09", calibrationSha256: null },
      usage: { inputTokens: 12, outputTokens: 4 } } });
  });

  test("rejects missing credentials and invalid model before any request", () => {
    for (const invalid of [{ ...config, apiKey: " " }, { ...config, apiKey: "key\r\ninjected" },
      { ...config, model: " " }, { ...config, model: "x".repeat(201) }, { ...config, model: "x\ny" }]) {
      expect(createCustomJudgementBackend(invalid)).toBeNull();
    }
  });

  test("rejects malformed payload and unresolved returned alias", async () => {
    for (const payload of [null, { answers: [] }, { answers, model: "jev-latest" }, { answers }]) {
      const backend = createCustomJudgementBackend({ ...config, fetch: async () => Response.json(payload) })!;
      expect(await backend.call(request)).toEqual({ ok: false,
        error: { code: "response-malformed", retryable: false } });
    }
  });

  test("invalid individual answers are dropped by the shared codec", async () => {
    const backend = createCustomJudgementBackend({ ...config, fetch: async () => Response.json({
      model: "jev-2026-09", answers: { yes: { type: "noul", noul: 2 },
        which: { ...answers.which, choice: "undeclared" }, level: answers.level },
    }) })!;
    const result = await backend.call(request);
    expect(result.ok && result.response.answers).toEqual({ level: answers.level });
  });

  test("402 and authentication failures are returned without retries or reading unsafe error bodies", async () => {
    for (const [status, code] of [[402, "backend-payment-required"], [401, "backend-unauthorized"]] as const) {
      let calls = 0;
      const backend = createCustomJudgementBackend({ ...config, fetch: async () => {
        calls++;
        return { ok: false, status, json: () => { throw new Error("unsafe learner data"); } } as unknown as Response;
      } })!;
      expect(await backend.call(request)).toEqual({ ok: false, error: { code, retryable: false } });
      expect(calls).toBe(1);
    }
  });

  test("redirection/network failures expose only an authored error", async () => {
    const backend = createCustomJudgementBackend({ ...config, fetch: async (_url, init) => {
      expect(init.redirect).toBe("error");
      throw new Error("redirect to attacker, key=user-secret");
    } })!;
    expect(await backend.call(request)).toEqual({ ok: false,
      error: { code: "backend-unavailable", retryable: true } });
  });

  test("pre-aborted requests cost nothing", async () => {
    let calls = 0;
    const backend = createCustomJudgementBackend({ ...config, fetch: async () => { calls++; return response(); } })!;
    expect(await backend.call(request, AbortSignal.abort())).toEqual({ ok: false,
      error: { code: "cancelled", retryable: false } });
    expect(calls).toBe(0);
  });

  test("cancellation and timeout settle even when an injected fetch ignores abort", async () => {
    for (const cancel of [true, false]) {
      let requestSignal: AbortSignal | undefined;
      const controller = new AbortController();
      const backend = createCustomJudgementBackend({ ...config, timeoutMs: 10,
        fetch: async (_url, init) => { requestSignal = init.signal!; return new Promise<Response>(() => {}); } })!;
      const operation = backend.call(request, controller.signal);
      if (cancel) controller.abort();
      expect(await operation).toEqual({ ok: false,
        error: { code: cancel ? "cancelled" : "backend-timeout", retryable: false } });
      expect(requestSignal?.aborted).toBe(true);
    }
  });
});
