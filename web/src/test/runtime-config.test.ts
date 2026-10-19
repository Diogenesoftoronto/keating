/** Platform adapters preserve explicit consent overrides and canonical fallback behavior. */
import { expect, test } from "bun:test";
import { DEFAULT_NOTORGANIC_SCOPE, NOTORGANIC_CHAT_MODEL_IDS } from "@keating/runtime-config";
import { NOTORGANIC_CHAT_MODELS } from "../notorganic-provider";
import { publicClientConfig, publicClientMaxCostMicrousd } from "../notorganic-provider/public-client";

const env = { VITE_NOTORGANIC_PUBLIC_ISSUER: "https://api.notorganic.info", VITE_NOTORGANIC_AUTHORIZATION_URL: "https://id.notorganic.info/authorize" };
test("web model picker IDs match the model list used to derive consent", () => {
  expect(NOTORGANIC_CHAT_MODELS.map(model => model.id)).toEqual([...NOTORGANIC_CHAT_MODEL_IDS]);
});
test("empty or absent scope derives consent; explicit restrictive override is retained", () => {
  for (const scope of [undefined, "", "   "]) {
    expect(publicClientConfig({ ...env, VITE_NOTORGANIC_SCOPE: scope }, "https://keating.test", false)?.scope).toBe(DEFAULT_NOTORGANIC_SCOPE);
  }
  expect(publicClientConfig({ ...env, VITE_NOTORGANIC_SCOPE: "usage:read" }, "https://keating.test", false)?.scope).toBe("usage:read");
  expect(publicClientConfig({}, "https://keating.test", false)).toBeNull();
});
test("browser reservation env overrides the canonical ceiling with existing validation", () => {
  expect(publicClientMaxCostMicrousd({})).toBe(100000);
  expect(publicClientMaxCostMicrousd({ VITE_NOTORGANIC_MAX_COST_MICROUSD: "1234" })).toBe(1234);
  expect(() => publicClientMaxCostMicrousd({ VITE_NOTORGANIC_MAX_COST_MICROUSD: "0" })).toThrow("positive integer");
});
