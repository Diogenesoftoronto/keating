/** Every built-in remote fallback follows the same role as mobile provider settings. */
import { expect, test } from "bun:test";
import { DEFAULT_MODELS, MODEL_CHOICES } from "@keating/runtime-config";
import { BUILT_IN_MODEL_CATALOG } from "../src/lib/model-catalog";
import { settingsForProvider } from "../src/lib/provider-config";

test("mobile fallback catalog IDs, keys and labels follow mobile role defaults", () => {
  const remote = BUILT_IN_MODEL_CATALOG.filter(entry => entry.provider !== "litert");
  // The custom provider is intentionally free-form and has no built-in catalog row.
  expect(Object.fromEntries(remote.map(entry => [entry.provider, entry.id])))
    .toEqual(Object.fromEntries(Object.entries(DEFAULT_MODELS.mobile).filter(([provider]) => provider !== "custom")));
  for (const entry of remote) {
    const role = entry.provider as Exclude<keyof typeof DEFAULT_MODELS.mobile, "custom">;
    expect(entry.id).toBe(settingsForProvider(role).model);
    expect(entry.key).toBe(`${role}::${DEFAULT_MODELS.mobile[role]}`);
    expect(entry.name).toBe(MODEL_CHOICES.mobileFallback[role].label);
  }
});
