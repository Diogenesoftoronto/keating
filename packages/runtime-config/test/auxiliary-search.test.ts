import { describe, expect, test } from "bun:test";
import { DEFAULT_MODELS, GPT_6_LUNA_PROFILE, MODEL_PREFERENCES } from "../src/index.js";

describe("auxiliary web search configuration", () => {
  test("prefers GPT-6 Luna without changing primary model defaults", () => {
    expect(MODEL_PREFERENCES.auxiliarySearch.openai[0]).toBe("gpt-6-luna");
    expect(MODEL_PREFERENCES.auxiliarySearch.openai).not.toContain("gpt-5-mini");
    expect(DEFAULT_MODELS.cli.openai).toBe("gpt-5.5");
    expect(DEFAULT_MODELS.mobile.openai).toBe("gpt-5.4");
    expect(DEFAULT_MODELS.web.notorganic).toBe("inkling-2-small");
  });
  test("provides documented Luna limits and standard token rates", () => {
    expect(GPT_6_LUNA_PROFILE).toMatchObject({
      id: MODEL_PREFERENCES.auxiliarySearch.openai[0], name: "GPT-6 Luna",
      contextWindow: 1_050_000, maxTokens: 128_000,
      cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    });
    expect(GPT_6_LUNA_PROFILE.cost.tiers).toEqual([
      { inputTokensAbove: 272_000, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 },
    ]);
  });
});
