import { expect, test } from "bun:test";
import { NOTORGANIC_ORDINARY_TEXT_MODELS, hasNotOrganicInferenceScope, notOrganicInferenceScope } from "../src/index.js";
test("ordinary model choices share one capability without granting unrelated processing", () => {
  for (const model of NOTORGANIC_ORDINARY_TEXT_MODELS) {
    expect(notOrganicInferenceScope(model)).toBe("infer:text");
    expect(hasNotOrganicInferenceScope(new Set(["infer:text"]), model)).toBe(true);
    expect(hasNotOrganicInferenceScope(new Set([`infer:${model}`]), model)).toBe(true);
  }
  for (const model of ["flint", "ampersand-tutor-v0.1", "persona", "image", "audio", "vision", "embedding", "future-private-model", "gpt-6.1-sol-other"]) {
    expect(notOrganicInferenceScope(model)).toBe(`infer:${model}`);
    expect(hasNotOrganicInferenceScope(new Set(["infer:text"]), model)).toBe(false);
  }
  expect(hasNotOrganicInferenceScope(new Set(["infer:balanced"]), "inkling-2-small")).toBe(false);
  expect(hasNotOrganicInferenceScope(new Set(["infer:*", "wallet:read"]), "inkling-2-small")).toBe(false);
});
