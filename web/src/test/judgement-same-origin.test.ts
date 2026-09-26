import { expect, test } from "bun:test";
import { createWebJudgementRuntime } from "../keating/judgement/runtime";
import type { JudgementAccountClient } from "../keating/judgement/public-account";

test("same-origin opt-in selects the product server while retaining default account routing", async () => {
  const saved = process.env.VITE_KEATING_JUDGEMENT_SAME_ORIGIN;
  const request = { state: "learner work", questions: { correct: { type: "noul" as const, instructions: "Correct result?" } } };
  const payload = { model: "jev-1.13", answers: { correct: { noul: .9 } } };
  const calls: string[] = [];
  const accountClient: JudgementAccountClient = {
    config: { issuer: "https://account.example" },
    getSession: () => ({ accessToken: "account-token", scope: "judgement:evaluate", expiresAt: Date.now() + 60_000, returnTo: "/" }),
    request: async () => { calls.push("account"); return Response.json(payload); },
  };
  try {
    for (const flag of ["false", "true", "1"]) {
      process.env.VITE_KEATING_JUDGEMENT_SAME_ORIGIN = flag;
      const runtime = createWebJudgementRuntime({
        settings: { backend: "hosted", localModelId: "not-installed", gatewayPath: "/api/judgement" },
        calibration: {},
        hosted: { accountClient, fetch: async (url, init) => {
          calls.push("same-origin");
          expect(url).toBe("/api/judgement");
          expect(new Headers(init.headers).get("authorization")).toBeNull();
          return { ok: true, status: 200, json: async () => payload };
        } },
      });
      const hosted = runtime.policy.tiers.find(tier => tier.key.backend === "system-one")!;
      expect((await hosted.call(request)).ok).toBe(true);
    }
    expect(calls).toEqual(["account", "same-origin", "account"]);
  } finally {
    if (saved === undefined) delete process.env.VITE_KEATING_JUDGEMENT_SAME_ORIGIN;
    else process.env.VITE_KEATING_JUDGEMENT_SAME_ORIGIN = saved;
  }
});
