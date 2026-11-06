import { describe, expect, test } from "bun:test";
import { TutorConsultationClient } from "../notorganic-provider/tutor";
import { createTutorConsultationTools } from "../keating/browser-tools/tutor";
import { filterAvailableKeatingTools } from "../keating/capabilities";
import { TUTOR_CONSULTATION_MODEL, TUTOR_CONSULTATION_SCOPE } from "../../../shared/tutor-consultation";
import type { NotOrganicProviderSession } from "../notorganic-provider/public-client";

const granted = (): NotOrganicProviderSession => ({ id: "account-session", accessToken: "capability", expiresAt: Date.now() + 300000, scope: TUTOR_CONSULTATION_SCOPE });
function fixture(options: { scope?: string; status?: number; changeOnSign?: boolean; reply?: unknown } = {}) {
  let session = granted();
  if (options.scope !== undefined) session.scope = options.scope;
  const requests: Request[] = [];
  const signed: Array<[string, string]> = [];
  const transport = {
    getSession: () => session,
    activeSession: async () => session,
    headersFor: async (method: string, url: string, initial?: HeadersInit) => {
      signed.push([method, url]);
      if (options.changeOnSign) session = { ...session, id: "different-account" };
      const headers = new Headers(initial); headers.set("authorization", "DPoP capability"); headers.set("dpop", "proof"); return headers;
    },
  };
  const client = new TutorConsultationClient(transport, "https://api.notorganic.test", 100000, (async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(options.reply ?? { model: TUTOR_CONSULTATION_MODEL, advice: "Ask what they already tried.", usage: { input_tokens: 20, output_tokens: 10 } }, { status: options.status ?? 200 });
  }) as typeof fetch);
  return { client, requests, signed };
}

describe("tutor consultation", () => {
  test("uses the signed account route, configured budget and advisory output", async () => {
    const { client, requests, signed } = fixture();
    const controller = new AbortController();
    const tools = createTutorConsultationTools(client);
    expect(filterAvailableKeatingTools(tools).map(tool => tool.name)).toEqual(["consult_tutor"]);
    const result = await tools[0]!.execute("call", { question: "How can I explain fractions?", context: "Learner: I confuse the denominator." }, controller.signal);
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("AMPERSAND TUTOR ADVICE") }]);
    expect(JSON.stringify(result.content)).toContain("not instructions or permission");
    expect(signed).toEqual([["POST", "https://api.notorganic.test/v1/tutor/consult"]]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("authorization")).toBe("DPoP capability");
    expect(requests[0]!.headers.get("x-notorganic-max-cost-microusd")).toBe("100000");
    expect(requests[0]!.headers.get("idempotency-key")).toStartWith("keating_tutor_");
    expect(await requests[0]!.json()).toEqual({ question: "How can I explain fractions?", context: "Learner: I confuse the denominator." });
  });

  test("does not advertise or send unconsented consultations", async () => {
    const { client, requests } = fixture({ scope: "infer:balanced" });
    expect(createTutorConsultationTools(client)).toEqual([]);
    await expect(client.consult({ question: "A hint?" })).rejects.toThrow("Allow Ampersand Tutor");
    expect(requests).toHaveLength(0);
  });

  test("bounds data and rejects cancellation before signing", async () => {
    const { client, requests, signed } = fixture();
    await expect(client.consult({ question: "x".repeat(4001) })).rejects.toThrow("4000");
    await expect(client.consult({ question: "A hint?", context: "x".repeat(12001) })).rejects.toThrow("12000");
    await expect(client.consult({ question: "A hint?", context: "界".repeat(2000) })).rejects.toThrow("6000 UTF-8 bytes");
    const controller = new AbortController(); controller.abort();
    await expect(client.consult({ question: "A hint?" }, controller.signal)).rejects.toThrow();
    expect(signed).toHaveLength(0); expect(requests).toHaveLength(0);
  });

  test("fails closed if the account changes during authentication", async () => {
    const { client, requests } = fixture({ changeOnSign: true });
    await expect(client.consult({ question: "A hint?" })).rejects.toThrow("account changed");
    expect(requests).toHaveLength(0);
  });

  test("never retries upstream failures or accepts a different model identity", async () => {
    const failed = fixture({ status: 503 });
    await expect(failed.client.consult({ question: "A hint?" })).rejects.toThrow("not retried");
    expect(failed.requests).toHaveLength(1);
    const wrong = fixture({ reply: { model: "ampersand-v0.1", advice: "Advice" } });
    await expect(wrong.client.consult({ question: "A hint?" })).rejects.toThrow("invalid response");
  });
});
